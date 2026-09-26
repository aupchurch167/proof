import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useUsage } from '../contexts/UsageContext';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import PdfUploadZone from '../components/PdfUploadZone';
import EmailTagInput from '../components/EmailTagInput';
import ReplyList from '../components/ReplyList';
import { CANONICAL_TRADES } from '../constants/trades';
import { vendorStatus, coiStatus, VERDICT } from '../constants/status';
import { Button, Card, Dot, StatusPill, Eyebrow, EmptyState } from '../components/ui';

const money = (dollars) => (dollars == null ? null : `$${dollars.toLocaleString()}`);
const shortMoney = (dollars) => {
  if (dollars == null) return null;
  if (dollars >= 1000000) return `$${(dollars / 1000000).toString().replace(/\.0$/, '')}M`;
  if (dollars >= 1000) return `$${Math.round(dollars / 1000)}K`;
  return `$${dollars}`;
};
const day = (d) => (d ? new Date(d.length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null);

// One card per coverage line. The top border and the value carry the verdict,
// so the state reads at a glance without parsing the footnote.
function CoverageCard({ coverage, lastRequestAt }) {
  const verdict = VERDICT[coverage.verdict] || VERDICT.skipped;
  const isMissing = coverage.verdict === 'missing';
  const isBad = verdict.tone === 'bad';

  const topBorder = {
    ok: '#1a8a5a', warn: '#e8890c', bad: '#c0392b', none: '#c9c3b8',
  }[verdict.tone];

  const value = isMissing
    ? 'Not on file'
    : coverage.verdict === 'skipped'
      ? '—'
      : money(coverage.limit) || 'Not on file';

  const footer = coverage.verdict === 'skipped'
    ? "Your template doesn't require it"
    : [
        coverage.required ? `Required ${shortMoney(coverage.required)}` : null,
        coverage.expiresAt ? `Exp ${day(coverage.expiresAt)}` : (isMissing && lastRequestAt ? `Requested ${day(lastRequestAt)}` : null),
      ].filter(Boolean).join(' · ');

  return (
    <div
      className={`rounded-stat px-[18px] py-4 flex flex-col gap-2 border
        ${isMissing ? 'bg-bad-bg border-bad-line' : 'bg-white border-line'}`}
      style={{ borderTopWidth: '3px', borderTopColor: topBorder }}
    >
      {/* Wraps rather than truncating: a long verdict like "Under limit" must
          never cost the reader the name of the coverage it applies to. */}
      <div className={`flex justify-between items-baseline gap-2 flex-wrap text-xs font-bold uppercase tracking-[0.05em] ${isMissing ? 'text-bad-text' : 'text-muted'}`}>
        <span>{coverage.short || coverage.label}</span>
        <span className={`whitespace-nowrap flex-none ${isMissing ? '' : { ok: 'text-ok-text', warn: 'text-warn-text', bad: 'text-bad-text', none: 'text-muted' }[verdict.tone]}`}>
          {verdict.label}
        </span>
      </div>
      <span className={`text-[22px] font-extrabold tracking-[-0.02em] ${isBad ? 'text-bad-text' : coverage.verdict === 'skipped' ? 'text-faint' : 'text-navy'}`}>
        {value}
      </span>
      <span className={`text-xs ${isBad ? 'text-bad-text' : 'text-muted'}`}>{footer}</span>
    </div>
  );
}

export default function VendorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const { refreshUsage } = useUsage();

  const [vendor, setVendor] = useState(null);
  const [replies, setReplies] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [requesting, setRequesting] = useState(false);

  const load = async () => {
    try {
      const v = await api.get(`/vendors/${id}`);
      setVendor(v);
      setForm({
        name: v.name, contactName: v.contactName || '', email: v.email,
        phone: v.phone || '', address: v.address || '', trade: v.trade || '',
        additionalEmails: v.additionalEmails || [], notes: v.notes || '',
      });
    } catch (err) {
      toast.error("Couldn't load this vendor");
    } finally {
      setLoading(false);
    }
    api.get(`/replies/vendor/${id}`).then(setReplies).catch(() => {});
    api.get(`/audit?range=all&vendorId=${id}`).then((d) => setActivity(d.events || [])).catch(() => {});
  };

  useEffect(() => { load(); }, [id]);

  const save = async () => {
    try {
      await api.put(`/vendors/${id}`, form);
      setEditing(false);
      toast.success('Saved');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleUpload = async (file) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('pdf', file);
      await api.upload(`/vendors/${id}/coi/upload`, fd);
      toast.success('Certificate uploaded — Proof is reading it');
      setShowUpload(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
    }
  };

  const requestCoi = async (force = false) => {
    setRequesting(true);
    try {
      await api.post(`/vendors/${id}/request-coi`, force ? { force: true } : undefined);
      toast.success('Request sent');
      load();
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('recently')) {
        if (window.confirm('A request went out in the last 24 hours. Send another anyway?')) {
          setRequesting(false);
          return requestCoi(true);
        }
      } else if (msg.includes('deliverable')) {
        toast.error('No deliverable email on file — fix the address first');
      } else {
        toast.error(err.message);
      }
    } finally {
      setRequesting(false);
    }
  };

  if (loading) return <div className="p-9 text-[13px] text-muted">Loading…</div>;
  if (!vendor) return <div className="p-9 text-[13px] text-muted">Vendor not found.</div>;

  const status = vendorStatus(vendor.coiStatus);
  const canManage = ['ADMIN', 'MEMBER', 'REVIEWER'].includes(user?.role);
  const canDelete = ['ADMIN', 'MEMBER'].includes(user?.role);

  // The primary action names the specific gap when there is one — "Request
  // workers' comp" beats a generic "Request COI" when that's what's missing.
  const missing = (vendor.coverages || []).find((c) => c.verdict === 'missing');
  const ctaLabel = missing ? `Request ${missing.label.toLowerCase()}` : 'Request COI';

  const superseded = new Set(vendor.supersededCoiIds || []);
  const certificates = vendor.cois || [];

  return (
    <div className="px-9 py-8 max-w-content w-full flex flex-col gap-[22px]">
      <Link to="/vendors" className="self-start text-[13px] text-muted hover:text-navy">← Vendors</Link>

      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-navy">{vendor.name}</h1>
            <StatusPill tone={status.tone} className="!text-xs !px-2.5 !py-1">
              {status.label}
            </StatusPill>
          </div>
          {vendor.statusReason && (
            <p className="text-[13px] leading-snug text-bad-text max-w-3xl">{vendor.statusReason}</p>
          )}
          <div className="flex gap-4 flex-wrap text-[13px] text-ink-2">
            {[vendor.trade, vendor.contactName, vendor.email, vendor.phone].filter(Boolean).map((bit, i) => (
              <span key={i}>{bit}</span>
            ))}
          </div>
        </div>
        {canManage && (
          <div className="flex gap-2 flex-wrap">
            <Button onClick={() => setEditing(!editing)}>{editing ? 'Cancel' : 'Edit'}</Button>
            <Button onClick={() => setShowUpload(!showUpload)}>Upload COI</Button>
            <Button variant="amber" onClick={() => requestCoi()} disabled={requesting}>
              {requesting ? 'Sending…' : ctaLabel}
            </Button>
          </div>
        )}
      </div>

      {editing && (
        <Card className="p-5 flex flex-col gap-4">
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              ['name', 'Name'], ['contactName', 'Contact name'], ['email', 'Email'],
              ['phone', 'Phone'], ['address', 'Address'],
            ].map(([key, label]) => (
              <div key={key}>
                <label className="block text-[13px] font-semibold text-ink-2 mb-1">{label}</label>
                <input
                  value={form[key] || ''}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  className="w-full px-3 py-2.5 rounded-control border border-line-strong text-[13px] focus:outline-none focus:border-navy"
                />
              </div>
            ))}
            <div>
              <label className="block text-[13px] font-semibold text-ink-2 mb-1">Trade</label>
              <select
                value={form.trade || ''}
                onChange={(e) => setForm({ ...form, trade: e.target.value })}
                className="w-full px-3 py-2.5 rounded-control border border-line-strong text-[13px] focus:outline-none focus:border-navy"
              >
                <option value="">Select a trade…</option>
                {CANONICAL_TRADES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[13px] font-semibold text-ink-2 mb-1">
                Additional emails <span className="text-faint font-normal">(CC on requests)</span>
              </label>
              <EmailTagInput
                value={form.additionalEmails || []}
                onChange={(emails) => setForm({ ...form, additionalEmails: emails })}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="navy" onClick={save}>Save changes</Button>
            {canDelete && (
              <Button variant="danger" onClick={() => setShowDeleteModal(true)} className="ml-auto">
                Delete vendor
              </Button>
            )}
          </div>
        </Card>
      )}

      {showUpload && (
        <Card className="p-5">
          <PdfUploadZone onUpload={handleUpload} loading={uploading} />
        </Card>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        {(vendor.coverages || []).map((c) => (
          <CoverageCard key={c.key} coverage={c} lastRequestAt={vendor.lastCoiRequestAt} />
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-line-divider flex justify-between items-center">
            <span className="text-[15px] font-bold text-navy">Certificates</span>
            <span className="text-xs text-muted">{certificates.length} on file</span>
          </div>

          {certificates.length === 0 ? (
            <EmptyState>No certificates on file yet.</EmptyState>
          ) : (
            certificates.map((coi) => {
              const s = coiStatus(coi.status, { superseded: superseded.has(coi.id) });
              const covers = ['gl', 'auto', 'wc', 'umb']
                .filter((k) => coi[`${k === 'auto' ? 'auto' : k}CoverageAmount`] != null)
                .map((k) => ({ gl: 'GL', auto: 'Auto', wc: 'WC', umb: 'Umb' }[k]))
                .join(' · ');
              return (
                <Link
                  key={coi.id}
                  to={`/cois/${coi.id}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3.5 items-center px-5 py-3.5
                    border-b border-line-divider last:border-0 hover:bg-card-alt transition-colors duration-150"
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-sm font-semibold text-navy truncate">
                      {(coi.pdfPath || '').split('/').pop() || 'Certificate'}
                    </span>
                    <span className="text-xs text-muted">
                      Uploaded {day(coi.submittedAt)}
                      {coi.reviewedAt ? ' · reviewed' : ''}
                    </span>
                  </div>
                  <span className="text-xs text-ink-2 whitespace-nowrap">{covers || '—'}</span>
                  <StatusPill tone={s.tone}>{s.label}</StatusPill>
                </Link>
              );
            })
          )}

          <div className="px-5 py-4 flex flex-col gap-2 border-t border-line-divider">
            <Eyebrow>Other documents</Eyebrow>
            <div className="flex gap-2 flex-wrap">
              {vendor.w9Url ? (
                <a href={vendor.w9Url} target="_blank" rel="noreferrer"
                  className="text-[13px] px-3 py-1.5 border border-line-strong rounded-[7px] text-navy hover:border-navy">
                  W-9
                </a>
              ) : (
                <span className="text-[13px] px-3 py-1.5 border border-dashed border-line-strong rounded-[7px] text-muted">
                  + W-9
                </span>
              )}
              {vendor.masterAgreementUrl ? (
                <a href={vendor.masterAgreementUrl} target="_blank" rel="noreferrer"
                  className="text-[13px] px-3 py-1.5 border border-line-strong rounded-[7px] text-navy hover:border-navy">
                  Master agreement
                </a>
              ) : (
                <span className="text-[13px] px-3 py-1.5 border border-dashed border-line-strong rounded-[7px] text-muted">
                  + Master agreement
                </span>
              )}
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 py-3.5 border-b border-line-divider text-[15px] font-bold text-navy">Activity</div>
          {activity.length === 0 ? (
            <EmptyState>Nothing has happened here yet.</EmptyState>
          ) : (
            activity.slice(0, 12).map((a) => (
              <div key={a.id} className="grid grid-cols-[8px_minmax(0,1fr)] gap-3 px-5 py-3 border-b border-line-divider last:border-0">
                <Dot tone={a.tone} className="mt-1" />
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[13px] text-ink leading-[1.4]">{a.detail}</span>
                  <span className="text-[11px] text-faint">
                    {new Date(a.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {a.by}
                  </span>
                </div>
              </div>
            ))
          )}
          {replies.length > 0 && (
            <div className="px-5 py-4 border-t border-line-divider">
              <Eyebrow className="mb-2">Email replies</Eyebrow>
              <ReplyList replies={replies} />
            </div>
          )}
        </Card>
      </div>

      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        itemCount={1}
        itemLabel="vendor"
        loading={deleting}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await api.delete(`/vendors/${id}`);
            toast.success('Vendor deleted');
            refreshUsage();
            navigate('/vendors');
          } finally {
            setDeleting(false);
          }
        }}
        onCancel={() => setShowDeleteModal(false)}
      />
    </div>
  );
}
