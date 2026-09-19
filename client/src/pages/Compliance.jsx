import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

// Ordered most-urgent-first so the default tab is the thing to do today.
const BUCKETS = [
  {
    key: 'expired',
    label: 'Expired',
    tile: 'bg-red-50 border-red-200',
    accent: 'text-red-700',
    blurb: 'Coverage has lapsed. Chase these before anything else.',
    empty: 'No expired coverage. Nice.',
  },
  {
    key: 'ignoredRequests',
    label: 'Ignored Requests',
    tile: 'bg-orange-50 border-orange-200',
    accent: 'text-orange-700',
    blurb: 'Asked a week or more ago and still nothing back.',
    empty: 'Every COI request has been answered.',
  },
  {
    key: 'expiringSoon',
    label: 'Expiring Soon',
    tile: 'bg-yellow-50 border-yellow-200',
    accent: 'text-yellow-700',
    blurb: 'Coverage lapses within 30 days.',
    empty: 'Nothing expiring in the next 30 days.',
  },
  {
    key: 'noCoi',
    label: 'No COI',
    tile: 'bg-gray-50 border-gray-200',
    accent: 'text-gray-700',
    blurb: 'No certificate on file at all.',
    empty: 'Every vendor has a certificate on file.',
  },
  {
    key: 'pendingReview',
    label: 'Pending Review',
    tile: 'bg-blue-50 border-blue-200',
    accent: 'text-blue-700',
    blurb: 'Uploaded and waiting on someone here.',
    empty: 'Nothing waiting on review.',
  },
];

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

function expirationLabel(entry) {
  if (entry.daysUntilExpiration === null || entry.daysUntilExpiration === undefined) return '—';
  const days = entry.daysUntilExpiration;
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'Expires today';
  return `${days}d left`;
}

// The one line that explains why this vendor is on the list right now.
function urgencyLabel(bucketKey, entry) {
  switch (bucketKey) {
    case 'expired':
    case 'expiringSoon':
      return expirationLabel(entry);
    case 'pendingReview':
      return `Waiting since ${formatDate(entry.pendingSince)}`;
    case 'ignoredRequests':
      return `${entry.daysSinceRequest}d since request`;
    default:
      return entry.lastRequestAt
        ? `Requested ${entry.daysSinceRequest}d ago`
        : 'Never requested';
  }
}

export default function Compliance() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeBucket, setActiveBucket] = useState('expired');
  const [busyId, setBusyId] = useState(null);
  // Only the first load picks a tab; reloads after an action must not yank the
  // user off the list they're working through.
  const tabChosen = useRef(false);

  const canManage = ['ADMIN', 'MEMBER', 'REVIEWER'].includes(user?.role);

  const load = async () => {
    try {
      const overview = await api.get('/compliance/overview');
      setData(overview);
      if (!tabChosen.current) {
        const firstWithWork = BUCKETS.find((b) => overview.counts[b.key] > 0);
        if (firstWithWork) setActiveBucket(firstWithWork.key);
        tabChosen.current = true;
      }
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRequestCoi = async (vendorId, force = false) => {
    setBusyId(vendorId);
    try {
      await api.post(`/vendors/${vendorId}/request-coi`, force ? { force: true } : undefined);
      toast.success('COI request sent');
      await load();
    } catch (err) {
      const msg = err.message || '';
      if (msg.toLowerCase().includes('deliverable')) {
        toast.error('No deliverable email on file — fix the address on the vendor first');
      } else if (msg.toLowerCase().includes('recently')) {
        if (window.confirm('A COI request was already sent to this vendor in the last 24 hours. Send another anyway?')) {
          setBusyId(null);
          return handleRequestCoi(vendorId, true);
        }
      } else {
        toast.error('Failed to send request: ' + msg);
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkContacted = async (vendor) => {
    const note = window.prompt(`How did you reach ${vendor.name}? (optional note)`);
    if (note === null) return;
    setBusyId(vendor.id);
    try {
      await api.post(`/compliance/vendors/${vendor.id}/contacted`, note ? { note } : {});
      toast.success(`${vendor.name} marked as contacted`);
      await load();
    } catch (err) {
      toast.error('Failed to mark contacted: ' + err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;
  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 mb-2">Failed to load compliance overview</p>
        <button onClick={() => { setLoading(true); load(); }} className="text-blue-600 hover:underline text-sm">Retry</button>
      </div>
    );
  }

  const active = BUCKETS.find((b) => b.key === activeBucket) || BUCKETS[0];
  const rows = data.buckets[active.key] || [];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-1">
        <h1 className="text-2xl font-bold">Compliance</h1>
        <p className="text-sm text-gray-500">
          {data.totalVendors} vendor(s) · updated {new Date(data.generatedAt).toLocaleTimeString()}
        </p>
      </div>
      <p className="text-sm text-gray-500 mb-6">Who needs chasing today, in one place.</p>

      {data.badEmails > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 mb-6 text-sm">
          <strong>{data.badEmails}</strong> vendor(s) have no deliverable email address. Automated
          requests and reminders skip them — fix the address on the vendor record to start chasing.
        </div>
      )}

      {/* Bucket tiles double as the tab bar */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        {BUCKETS.map((bucket) => {
          const isActive = bucket.key === active.key;
          return (
            <button
              key={bucket.key}
              onClick={() => { tabChosen.current = true; setActiveBucket(bucket.key); }}
              className={`${bucket.tile} text-left p-4 rounded-xl border transition-shadow hover:shadow-md ${
                isActive ? 'ring-2 ring-blue-500 ring-offset-1' : ''
              }`}
            >
              <p className={`text-2xl font-bold ${bucket.accent}`}>{data.counts[bucket.key]}</p>
              <p className="text-sm text-gray-600">{bucket.label}</p>
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">{active.label}</h2>
          <p className="text-sm text-gray-500">{active.blurb}</p>
        </div>

        {rows.length === 0 ? (
          <p className="text-gray-500 text-sm px-4 sm:px-6 py-10 text-center">{active.empty}</p>
        ) : (
          <>
            {/* Desktop table */}
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-6 py-3 font-medium text-gray-600">Vendor</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-600">Trade</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-600">Email</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-600">Urgency</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-600">Chase History</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <Link to={`/vendors/${entry.id}`} className="text-blue-600 hover:underline font-medium">
                        {entry.name}
                      </Link>
                      {entry.escalatedAt && (
                        <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          Escalated
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500 text-xs">{entry.trade || ''}</td>
                    <td className="px-6 py-4 text-gray-600">
                      {entry.badEmail ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800"
                          title={entry.email}>
                          No valid email
                        </span>
                      ) : (
                        entry.email
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-700">{urgencyLabel(active.key, entry)}</td>
                    <td className="px-6 py-4 text-gray-500 text-xs">
                      {entry.lastRequestAt ? (
                        <>
                          Requested {formatDate(entry.lastRequestAt)}
                          {entry.chaseCount > 0 && ` · ${entry.chaseCount} follow-up(s)`}
                          {entry.lastContactedAt && ` · contacted ${formatDate(entry.lastContactedAt)}`}
                        </>
                      ) : (
                        'No request sent'
                      )}
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      {canManage && (
                        <>
                          <button
                            onClick={() => handleRequestCoi(entry.id)}
                            disabled={busyId === entry.id || entry.badEmail}
                            title={entry.badEmail ? 'Vendor has no deliverable email address' : undefined}
                            className="text-blue-600 hover:underline text-sm disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed">
                            Request COI
                          </button>
                          {active.key === 'ignoredRequests' && (
                            <button
                              onClick={() => handleMarkContacted(entry)}
                              disabled={busyId === entry.id}
                              className="ml-4 text-gray-600 hover:underline text-sm disabled:text-gray-400">
                              Mark contacted
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile card list */}
            <div className="md:hidden divide-y">
              {rows.map((entry) => (
                <div key={entry.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/vendors/${entry.id}`} className="text-blue-600 hover:underline font-medium truncate">
                      {entry.name}
                    </Link>
                    <span className="text-xs text-gray-600 flex-shrink-0">{urgencyLabel(active.key, entry)}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1 truncate">
                    {entry.badEmail ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                        No valid email
                      </span>
                    ) : (
                      entry.email
                    )}
                    {entry.escalatedAt && (
                      <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        Escalated
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {entry.lastRequestAt
                      ? `Requested ${formatDate(entry.lastRequestAt)}${entry.chaseCount > 0 ? ` · ${entry.chaseCount} follow-up(s)` : ''}`
                      : 'No request sent'}
                  </p>
                  {canManage && (
                    <div className="flex gap-4 mt-3">
                      <button
                        onClick={() => handleRequestCoi(entry.id)}
                        disabled={busyId === entry.id || entry.badEmail}
                        className="text-blue-600 text-sm disabled:text-gray-400 disabled:cursor-not-allowed">
                        Request COI
                      </button>
                      {active.key === 'ignoredRequests' && (
                        <button
                          onClick={() => handleMarkContacted(entry)}
                          disabled={busyId === entry.id}
                          className="text-gray-600 text-sm disabled:text-gray-400">
                          Mark contacted
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
