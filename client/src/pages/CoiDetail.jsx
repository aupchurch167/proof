import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

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
  const [coi, setCoi] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [rejectReason, setRejectReason] = useState('');
  const [showReject, setShowReject] = useState(false);

  useEffect(() => {
    api.get(`/cois/${id}`)
      .then((c) => { setCoi(c); setForm(c); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    try {
      const updated = await api.put(`/cois/${id}`, form);
      setCoi({ ...coi, ...updated });
      setEditing(false);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleApprove = async () => {
    try {
      const updated = await api.post(`/cois/${id}/approve`);
      setCoi({ ...coi, ...updated, status: 'APPROVED' });
    } catch (err) {
      alert(err.message);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return alert('Please provide a reason');
    try {
      const updated = await api.post(`/cois/${id}/reject`, { reason: rejectReason });
      setCoi({ ...coi, ...updated, status: 'REJECTED' });
      setShowReject(false);
    } catch (err) {
      alert(err.message);
    }
  };

  const canReview = (user?.role === 'ADMIN' || user?.role === 'REVIEWER') && coi?.status === 'PENDING_REVIEW';

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
      <Link to="/cois" className="text-sm text-blue-600 hover:underline mb-4 inline-block">Back to COIs</Link>

      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold">COI Detail</h1>
          <p className="text-gray-600">
            Vendor: <Link to={`/vendors/${coi.vendor?.id}`} className="text-blue-600 hover:underline">
              {coi.vendor?.name}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {coi.pdfPath && (
            <a href={`/uploads/${coi.pdfPath}`} target="_blank" rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:underline">View PDF</a>
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

      {/* Coverage table */}
      <div className="bg-white rounded-xl border mb-6 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b">
              <th className="text-left px-6 py-3 font-medium text-gray-600">Coverage Type</th>
              <th className="text-left px-6 py-3 font-medium text-gray-600">Policy Number</th>
              <th className="text-left px-6 py-3 font-medium text-gray-600">Coverage Amount</th>
              <th className="text-left px-6 py-3 font-medium text-gray-600">Expiration Date</th>
            </tr>
          </thead>
          <tbody>
            {coverageRows.map((row) => (
              <tr key={row.label} className="border-b last:border-0">
                <td className="px-6 py-4 font-medium">{row.label}</td>
                <td className="px-6 py-4 text-gray-600">
                  {editing ? (
                    <input value={form[row.policy] || ''} onChange={(e) => setForm({ ...form, [row.policy]: e.target.value })}
                      className="px-2 py-1 border rounded w-full" />
                  ) : coi[row.policy] || 'N/A'}
                </td>
                <td className="px-6 py-4 text-gray-600">
                  {editing ? (
                    <input type="number" value={form[row.amount] || ''} onChange={(e) => setForm({ ...form, [row.amount]: parseInt(e.target.value) || null })}
                      className="px-2 py-1 border rounded w-full" placeholder="Amount in cents" />
                  ) : formatCurrency(coi[row.amount])}
                </td>
                <td className="px-6 py-4 text-gray-600">
                  {editing ? (
                    <input type="date" value={form[row.date]?.split('T')[0] || ''} onChange={(e) => setForm({ ...form, [row.date]: e.target.value })}
                      className="px-2 py-1 border rounded" />
                  ) : formatDate(coi[row.date])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Agent info */}
      <div className="bg-white rounded-xl border p-6 mb-6">
        <h3 className="font-semibold mb-3">Insurance Agent</h3>
        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Name:</span> {coi.agentName || 'N/A'}
          </div>
          <div>
            <span className="text-gray-500">Email:</span> {coi.agentEmail || 'N/A'}
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
        <div className="bg-white rounded-xl border p-6 mb-6">
          <h3 className="font-semibold mb-3">Review</h3>
          <div className="text-sm space-y-1">
            <p><span className="text-gray-500">Reviewed by:</span> {coi.reviewedBy.firstName} {coi.reviewedBy.lastName}</p>
            <p><span className="text-gray-500">Reviewed at:</span> {coi.reviewedAt ? new Date(coi.reviewedAt).toLocaleString() : 'N/A'}</p>
            {coi.reviewNotes && <p><span className="text-gray-500">Notes:</span> {coi.reviewNotes}</p>}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {(user?.role === 'ADMIN' || user?.role === 'REVIEWER') && !editing && (
          <button onClick={() => setEditing(true)}
            className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Edit Data</button>
        )}
        {editing && (
          <>
            <button onClick={handleSave} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Save Changes</button>
            <button onClick={() => { setEditing(false); setForm(coi); }} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
          </>
        )}
        {canReview && !editing && (
          <>
            <button onClick={handleApprove}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700">Approve</button>
            <button onClick={() => setShowReject(true)}
              className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700">Reject</button>
          </>
        )}
      </div>

      {/* Reject modal */}
      {showReject && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Reject COI</h3>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection..."
              className="w-full px-3 py-2 border rounded-lg mb-4 h-32 resize-none" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowReject(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              <button onClick={handleReject} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm">Reject</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
