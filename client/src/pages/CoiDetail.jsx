import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

function formatCurrency(cents) {
  if (cents == null) return 'N/A';
  return `$${(cents / 100).toLocaleString()}`;
}

function formatDate(d) {
  if (!d) return 'N/A';
  return new Date(d).toLocaleDateString();
}

export default function CoiDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queueMode = searchParams.get('queue') === 'pending';
  const [coi, setCoi] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [queueCount, setQueueCount] = useState(null);

  useEffect(() => {
    api.get(`/cois/${id}`)
      .then((c) => { setCoi(c); setForm(c); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!queueMode) return;
    api.get('/cois?status=PENDING_REVIEW')
      .then((rows) => setQueueCount(rows.length))
      .catch(console.error);
  }, [queueMode, id]);

  async function advanceQueue() {
    try {
      const rows = await api.get('/cois?status=PENDING_REVIEW');
      const next = rows.find((c) => c.id !== id);
      if (next) {
        navigate(`/cois/${next.id}?queue=pending`);
      } else {
        toast.success('All pending COIs reviewed!');
        navigate('/cois?status=PENDING_REVIEW');
      }
    } catch (err) {
      toast.error('Could not load next pending COI');
    }
  }

  const handleSave = async () => {
    try {
      const updated = await api.put(`/cois/${id}`, form);
      setCoi({ ...coi, ...updated });
      setEditing(false);
      toast.success('Changes saved');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleApprove = async () => {
    try {
      const updated = await api.post(`/cois/${id}/approve`);
      setCoi({ ...coi, ...updated, status: 'APPROVED' });
      toast.success('COI approved');
      if (queueMode) await advanceQueue();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return toast.warning('Please provide a reason');
    try {
      const updated = await api.post(`/cois/${id}/reject`, { reason: rejectReason });
      setCoi({ ...coi, ...updated, status: 'REJECTED' });
      setShowReject(false);
      setRejectReason('');
      toast.success('COI rejected');
      if (queueMode) await advanceQueue();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/cois/${id}`);
      navigate(`/vendors/${coi.vendor?.id}`);
    } finally {
      setDeleting(false);
    }
  };

  const canReview = ['ADMIN', 'MEMBER', 'REVIEWER'].includes(user?.role) && coi?.status === 'PENDING_REVIEW';

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;
  if (!coi) return <div className="text-center py-12 text-gray-500">COI not found</div>;

  const coverageRows = [
    { label: 'General Liability', policy: 'glPolicyNumber', amount: 'glCoverageAmount', date: 'glExpirationDate' },
    { label: 'Workers Comp', policy: 'wcPolicyNumber', amount: 'wcCoverageAmount', date: 'wcExpirationDate' },
    { label: 'Umbrella', policy: 'umbPolicyNumber', amount: 'umbCoverageAmount', date: 'umbExpirationDate' },
    { label: 'Automobile', policy: 'autoPolicyNumber', amount: 'autoCoverageAmount', date: 'autoExpirationDate' },
  ];

  return (
    <div>
      <Link to="/cois?status=PENDING_REVIEW" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
        {queueMode ? '← Back to pending reviews' : 'Back to COIs'}
      </Link>

      {queueMode && queueCount !== null && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <p className="text-sm text-blue-900">
            Reviewing pending COIs — <strong>{queueCount}</strong> remaining
          </p>
          {canReview && (
            <button
              onClick={advanceQueue}
              className="text-sm text-blue-700 hover:underline self-start sm:self-auto"
            >
              Skip to next →
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">COI Detail</h1>
          <p className="text-gray-600">
            Vendor: <Link to={`/vendors/${coi.vendor?.id}`} className="text-blue-600 hover:underline">
              {coi.vendor?.name}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {coi.pdfPath && (
            <button
              onClick={async () => {
                const { url } = await api.get(`/cois/${coi.id}/pdf`);
                window.open(url, '_blank');
              }}
              className="text-sm text-blue-600 hover:underline py-1">View PDF</button>
          )}
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
            coi.status === 'APPROVED' ? 'bg-green-100 text-green-800' :
            coi.status === 'REJECTED' ? 'bg-red-100 text-red-800' :
            coi.status === 'PENDING_REVIEW' ? 'bg-blue-100 text-blue-800' :
            'bg-gray-100 text-gray-800'
          }`}>
            {coi.status.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Compliance flags */}
      {coi.complianceFlags && coi.complianceFlags.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
          <h3 className="font-semibold text-yellow-800 mb-2">Compliance Issues</h3>
          <ul className="space-y-1">
            {coi.complianceFlags.map((flag, i) => (
              <li key={i} className="text-sm text-yellow-700">{flag.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Coverage — Desktop table */}
      <div className="hidden sm:block bg-white rounded-xl border mb-6 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left px-4 sm:px-6 py-3 font-medium text-gray-600">Coverage Type</th>
              <th className="text-left px-4 sm:px-6 py-3 font-medium text-gray-600">Policy Number</th>
              <th className="text-left px-4 sm:px-6 py-3 font-medium text-gray-600">Coverage Amount</th>
              <th className="text-left px-4 sm:px-6 py-3 font-medium text-gray-600">Expiration Date</th>
            </tr>
          </thead>
          <tbody>
            {coverageRows.map((row) => (
              <tr key={row.label} className="border-b last:border-0">
                <td className="px-4 sm:px-6 py-4 font-medium">{row.label}</td>
                <td className="px-4 sm:px-6 py-4 text-gray-600">
                  {editing ? (
                    <input value={form[row.policy] || ''} onChange={(e) => setForm({ ...form, [row.policy]: e.target.value })}
                      className="px-2 py-1.5 border rounded w-full text-sm" />
                  ) : coi[row.policy] || 'N/A'}
                </td>
                <td className="px-4 sm:px-6 py-4 text-gray-600">
                  {editing ? (
                    <input type="number" value={form[row.amount] || ''} onChange={(e) => setForm({ ...form, [row.amount]: parseInt(e.target.value) || null })}
                      className="px-2 py-1.5 border rounded w-full text-sm" placeholder="Amount in cents" />
                  ) : formatCurrency(coi[row.amount])}
                </td>
                <td className="px-4 sm:px-6 py-4 text-gray-600">
                  {editing ? (
                    <input type="date" value={form[row.date]?.split('T')[0] || ''} onChange={(e) => setForm({ ...form, [row.date]: e.target.value })}
                      className="px-2 py-1.5 border rounded text-sm" />
                  ) : formatDate(coi[row.date])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Coverage — Mobile cards */}
      <div className="sm:hidden space-y-3 mb-6">
        {coverageRows.map((row) => (
          <div key={row.label} className="bg-white rounded-xl border p-4">
            <p className="font-medium mb-2">{row.label}</p>
            {editing ? (
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-gray-500">Policy Number</label>
                  <input value={form[row.policy] || ''} onChange={(e) => setForm({ ...form, [row.policy]: e.target.value })}
                    className="w-full px-3 py-2.5 border rounded-lg text-base" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Amount (cents)</label>
                  <input type="number" value={form[row.amount] || ''} onChange={(e) => setForm({ ...form, [row.amount]: parseInt(e.target.value) || null })}
                    className="w-full px-3 py-2.5 border rounded-lg text-base" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Expiration</label>
                  <input type="date" value={form[row.date]?.split('T')[0] || ''} onChange={(e) => setForm({ ...form, [row.date]: e.target.value })}
                    className="w-full px-3 py-2.5 border rounded-lg text-base" />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <p className="text-xs text-gray-400">Policy</p>
                  <p className="text-gray-600">{coi[row.policy] || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Amount</p>
                  <p className="text-gray-600">{formatCurrency(coi[row.amount])}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Expires</p>
                  <p className="text-gray-600">{formatDate(coi[row.date])}</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Certificate Holder / Additionally Insured */}
      <div className="bg-white rounded-xl border p-4 sm:p-6 mb-6">
        <h3 className="font-semibold mb-3">Certificate Holder / Additionally Insured</h3>
        {coi.certificateHolderName ? (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-gray-500">Name:</span> {coi.certificateHolderName}
            </div>
            {coi.certificateHolderAddress && (
              <div className="text-sm">
                <span className="text-gray-500">Address:</span> {coi.certificateHolderAddress}
              </div>
            )}
            {(() => {
              const orgName = coi.organization?.name;
              if (!orgName) return null;
              const holderNorm = coi.certificateHolderName.toLowerCase().trim();
              const orgNorm = orgName.toLowerCase().trim();
              const isMatch = holderNorm.includes(orgNorm) || orgNorm.includes(holderNorm);
              return isMatch ? (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                  ✓ Additionally Insured Verified
                </span>
              ) : (
                <div>
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                    ⚠ Additionally Insured Mismatch
                  </span>
                  <p className="text-xs text-gray-500 mt-1">
                    Expected: {orgName}
                  </p>
                </div>
              );
            })()}
          </div>
        ) : (
          <p className="text-sm text-gray-400">Not extracted</p>
        )}
      </div>

      {/* Agent info */}
      <div className="bg-white rounded-xl border p-4 sm:p-6 mb-6">
        <h3 className="font-semibold mb-3">Insurance Agent</h3>
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-gray-500">Name:</span> {coi.agentName || 'N/A'}
          </div>
          <div>
            <span className="text-gray-500">Email:</span> <span className="break-all">{coi.agentEmail || 'N/A'}</span>
          </div>
          <div>
            <span className="text-gray-500">Phone:</span> {coi.agentPhone || 'N/A'}
          </div>
          <div>
            <span className="text-gray-500">Company:</span> {coi.insuranceCompany || 'N/A'}
          </div>
        </div>
      </div>

      {/* Review info */}
      {coi.reviewedBy && (
        <div className="bg-white rounded-xl border p-4 sm:p-6 mb-6">
          <h3 className="font-semibold mb-3">Review</h3>
          <div className="text-sm space-y-1">
            <p><span className="text-gray-500">Reviewed by:</span> {coi.reviewedBy.firstName} {coi.reviewedBy.lastName}</p>
            <p><span className="text-gray-500">Reviewed at:</span> {coi.reviewedAt ? new Date(coi.reviewedAt).toLocaleString() : 'N/A'}</p>
            {coi.reviewNotes && <p><span className="text-gray-500">Notes:</span> {coi.reviewNotes}</p>}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 sm:gap-3">
        {['ADMIN', 'MEMBER', 'REVIEWER'].includes(user?.role) && !editing && (
          <button onClick={() => setEditing(true)}
            className="px-4 py-2.5 border rounded-lg text-sm hover:bg-gray-50">Edit Data</button>
        )}
        {editing && (
          <>
            <button onClick={handleSave} className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm">Save Changes</button>
            <button onClick={() => { setEditing(false); setForm(coi); }} className="px-4 py-2.5 border rounded-lg text-sm">Cancel</button>
          </>
        )}
        {canReview && !editing && (
          <>
            <button onClick={handleApprove}
              className="bg-green-600 text-white px-4 py-2.5 rounded-lg text-sm hover:bg-green-700">Approve</button>
            <button onClick={() => setShowReject(true)}
              className="bg-red-600 text-white px-4 py-2.5 rounded-lg text-sm hover:bg-red-700">Reject</button>
          </>
        )}
        {['ADMIN', 'MEMBER'].includes(user?.role) && !editing && (
          <button onClick={() => setShowDeleteModal(true)}
            className="text-red-600 hover:underline text-sm py-2.5">Delete COI</button>
        )}
      </div>

      {/* Reject modal */}
      {showReject && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-xl sm:rounded-xl p-6 w-full sm:max-w-md sm:mx-4">
            <h3 className="text-lg font-semibold mb-4">Reject COI</h3>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection..."
              className="w-full px-3 py-2.5 border rounded-lg mb-4 h-32 resize-none text-base sm:text-sm" />
            <div className="flex flex-col sm:flex-row gap-2 sm:justify-end">
              <button onClick={() => setShowReject(false)} className="px-4 py-2.5 border rounded-lg text-sm order-2 sm:order-1">Cancel</button>
              <button onClick={handleReject} className="bg-red-600 text-white px-4 py-2.5 rounded-lg text-sm order-1 sm:order-2">Reject</button>
            </div>
          </div>
        </div>
      )}

      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        itemCount={1}
        itemLabel="COI"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteModal(false)}
      />
    </div>
  );
}
