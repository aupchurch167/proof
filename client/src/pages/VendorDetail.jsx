import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import PdfUploadZone from '../components/PdfUploadZone';

const reviewStatusColors = {
  PENDING_REVIEW: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-gray-100 text-gray-800',
};

const COVERAGE_TYPES = [
  { key: 'GENERAL_LIABILITY', label: 'General Liability', policyField: 'glPolicyNumber', amountField: 'glCoverageAmount', dateField: 'glExpirationDate' },
  { key: 'WORKERS_COMP', label: 'Workers Comp', policyField: 'wcPolicyNumber', amountField: 'wcCoverageAmount', dateField: 'wcExpirationDate' },
  { key: 'UMBRELLA', label: 'Umbrella', policyField: 'umbPolicyNumber', amountField: 'umbCoverageAmount', dateField: 'umbExpirationDate' },
  { key: 'AUTO', label: 'Automobile', policyField: 'autoPolicyNumber', amountField: 'autoCoverageAmount', dateField: 'autoExpirationDate' },
];

function getExpirationStatus(dateStr) {
  if (!dateStr) return 'none';
  const exp = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'expired';
  if (diffDays <= 30) return 'expiring';
  return 'valid';
}

function ExpirationBadge({ dateStr }) {
  if (!dateStr) return <span className="text-xs text-gray-400">No date</span>;
  const status = getExpirationStatus(dateStr);
  const dateLabel = new Date(dateStr).toLocaleDateString();
  const colors = {
    valid: 'bg-green-100 text-green-700',
    expiring: 'bg-yellow-100 text-yellow-700',
    expired: 'bg-red-100 text-red-700',
  };
  const labels = { valid: dateLabel, expiring: `${dateLabel} (expiring)`, expired: `${dateLabel} (expired)` };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status]}`}>{labels[status]}</span>;
}

function CoverageBreakdown({ coi }) {
  return (
    <div className="grid grid-cols-2 gap-2 mt-3">
      {COVERAGE_TYPES.map(ct => {
        const amount = coi[ct.amountField];
        const date = coi[ct.dateField];
        const hasData = amount || date;
        if (!hasData) return null;
        return (
          <div key={ct.key} className="text-xs">
            <p className="font-medium text-gray-600">{ct.label}</p>
            {amount && <p className="text-gray-500">${(amount / 100).toLocaleString()}</p>}
            {date && <ExpirationBadge dateStr={date} />}
          </div>
        );
      })}
    </div>
  );
}

function CoverageSummary({ cois }) {
  const coverageMap = {};
  for (const ct of COVERAGE_TYPES) {
    const matching = cois
      .filter(c => c.status === 'APPROVED' && (c[ct.amountField] || c[ct.dateField]))
      .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    coverageMap[ct.key] = matching[0] || null;
  }

  return (
    <div className="bg-white rounded-xl border p-4 sm:p-6 mb-6">
      <h2 className="text-lg font-semibold mb-4">Coverage Summary</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {COVERAGE_TYPES.map(ct => {
          const coi = coverageMap[ct.key];
          const status = coi ? getExpirationStatus(coi[ct.dateField]) : 'none';
          const borderColor = {
            valid: 'border-green-200 bg-green-50',
            expiring: 'border-yellow-200 bg-yellow-50',
            expired: 'border-red-200 bg-red-50',
            none: 'border-gray-200 bg-gray-50',
          }[status];
          const dotColor = {
            valid: 'bg-green-500',
            expiring: 'bg-yellow-500',
            expired: 'bg-red-500',
            none: 'bg-gray-300',
          }[status];

          return (
            <div key={ct.key} className={`border rounded-lg p-3 ${borderColor}`}>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${dotColor}`} />
                <span className="text-sm font-medium">{ct.label}</span>
              </div>
              {coi ? (
                <div className="mt-2 text-xs space-y-1">
                  {coi[ct.amountField] && (
                    <p className="text-gray-600">${(coi[ct.amountField] / 100).toLocaleString()}</p>
                  )}
                  {coi[ct.dateField] && (
                    <ExpirationBadge dateStr={coi[ct.dateField]} />
                  )}
                  {coi[ct.policyField] && (
                    <p className="text-gray-400">Policy: {coi[ct.policyField]}</p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-gray-400 mt-2">No active coverage</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function VendorDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [vendor, setVendor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    api.get(`/vendors/${id}`)
      .then((v) => { setVendor(v); setForm({ name: v.name, contactName: v.contactName || '', email: v.email, phone: v.phone || '', address: v.address || '' }); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    try {
      const updated = await api.put(`/vendors/${id}`, form);
      setVendor({ ...vendor, ...updated });
      setEditing(false);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/vendors/${id}`);
      navigate('/vendors');
    } finally {
      setDeleting(false);
    }
  };

  const handleUploadCoi = async (file) => {
    setUploading(true);
    setUploadError('');
    try {
      const formData = new FormData();
      formData.append('pdf', file);
      await api.upload(`/vendors/${id}/coi/upload`, formData);
      setShowUpload(false);
      const updated = await api.get(`/vendors/${id}`);
      setVendor(updated);
    } catch (err) {
      setUploadError(err.message || 'Failed to upload COI');
    } finally {
      setUploading(false);
    }
  };

  const handleRequestCoi = async () => {
    setRequesting(true);
    try {
      await api.post(`/vendors/${id}/request-coi`);
      alert('COI request email sent!');
    } catch (err) {
      alert('Failed to send request: ' + err.message);
    } finally {
      setRequesting(false);
    }
  };

  const canManage = user?.role === 'ADMIN' || user?.role === 'REVIEWER';
  const isAdmin = user?.role === 'ADMIN';

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;
  if (!vendor) return <div className="text-center py-12 text-gray-500">Vendor not found</div>;

  const portalUrl = `${window.location.origin}/portal/${vendor.uploadToken}`;

  const coverageTypeLabels = {
    GENERAL_LIABILITY: 'General Liability',
    WORKERS_COMP: 'Workers Comp',
    UMBRELLA: 'Umbrella',
    AUTO: 'Automobile',
    OTHER: 'Multi-Coverage',
  };
  const groupedCois = {};
  const ungroupedCois = [];
  for (const coi of (vendor.cois || [])) {
    if (coi.coverageType && coi.coverageType !== 'OTHER') {
      if (!groupedCois[coi.coverageType]) groupedCois[coi.coverageType] = [];
      groupedCois[coi.coverageType].push(coi);
    } else {
      ungroupedCois.push(coi);
    }
  }

  return (
    <div>
      <Link to="/vendors" className="text-sm text-blue-600 hover:underline mb-4 inline-block">Back to Vendors</Link>

      <div className="bg-white rounded-xl border p-4 sm:p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-3">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="px-3 py-2.5 border rounded-lg text-lg font-bold w-full text-base" />
                <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                  className="px-3 py-2.5 border rounded-lg w-full text-base" placeholder="Contact Name" />
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="px-3 py-2.5 border rounded-lg w-full text-base" placeholder="Email" />
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="px-3 py-2.5 border rounded-lg w-full text-base" placeholder="Phone" />
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="px-3 py-2.5 border rounded-lg w-full text-base" placeholder="Address" />
                <div className="flex gap-2">
                  <button onClick={handleSave} className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm">Save</button>
                  <button onClick={() => setEditing(false)} className="px-4 py-2.5 rounded-lg border text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-xl sm:text-2xl font-bold">{vendor.name}</h1>
                {vendor.contactName && <p className="text-gray-600 mt-1">{vendor.contactName}</p>}
                <p className="text-gray-600 mt-1 break-all">{vendor.email}</p>
                {vendor.phone && <p className="text-gray-600">{vendor.phone}</p>}
                {vendor.address && <p className="text-gray-600">{vendor.address}</p>}
              </>
            )}
          </div>
          {canManage && !editing && (
            <div className="flex gap-3 sm:gap-2">
              <button onClick={() => setEditing(true)} className="text-sm text-blue-600 hover:underline py-1">Edit</button>
              {isAdmin && (
                <button onClick={() => setShowDeleteModal(true)} className="text-sm text-red-600 hover:underline py-1">Delete</button>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t">
          <p className="text-sm text-gray-500">Portal Link</p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-1">
            <code className="text-xs sm:text-sm bg-gray-100 px-3 py-1.5 rounded-lg flex-1 overflow-x-auto break-all">{portalUrl}</code>
            <button onClick={() => { navigator.clipboard.writeText(portalUrl); }}
              className="text-sm text-blue-600 hover:underline whitespace-nowrap py-1">Copy</button>
          </div>
        </div>
      </div>

      {/* Coverage Summary */}
      {vendor.cois?.length > 0 && <CoverageSummary cois={vendor.cois} />}

      {/* COI History */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
        <h2 className="text-lg font-semibold">COI History</h2>
        {canManage && (
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              onClick={handleRequestCoi}
              disabled={requesting}
              className="text-sm border border-blue-600 text-blue-600 px-3 py-2 sm:py-1.5 rounded-lg hover:bg-blue-50 disabled:opacity-50 text-center"
            >
              {requesting ? 'Sending...' : 'Request COI'}
            </button>
            <button
              onClick={() => setShowUpload(!showUpload)}
              className="text-sm bg-blue-600 text-white px-3 py-2 sm:py-1.5 rounded-lg hover:bg-blue-700 text-center"
            >
              {showUpload ? 'Cancel' : 'Upload COI'}
            </button>
          </div>
        )}
      </div>

      {/* Upload zone */}
      {showUpload && (
        <div className="bg-white rounded-xl border p-4 sm:p-6 mb-6">
          <PdfUploadZone
            onUpload={handleUploadCoi}
            loading={uploading}
            error={uploadError}
          />
        </div>
      )}

      {vendor.cois?.length === 0 ? (
        <p className="text-gray-500 text-sm">No COIs on file</p>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedCois).map(([type, cois]) => (
            <div key={type}>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {coverageTypeLabels[type] || type}
              </h3>
              <div className="space-y-2">
                {cois.map((coi) => (
                  <Link key={coi.id} to={`/cois/${coi.id}`}
                    className="block bg-white rounded-xl border p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1">
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-sm">
                            Submitted {new Date(coi.submittedAt).toLocaleDateString()}
                          </p>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${reviewStatusColors[coi.status]}`}>
                            {coi.status.replace('_', ' ')}
                          </span>
                        </div>
                        <CoverageBreakdown coi={coi} />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}

          {ungroupedCois.length > 0 && (
            <div>
              {Object.keys(groupedCois).length > 0 && (
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Multi-Coverage / Untyped
                </h3>
              )}
              <div className="space-y-2">
                {ungroupedCois.map((coi) => (
                  <Link key={coi.id} to={`/cois/${coi.id}`}
                    className="block bg-white rounded-xl border p-4 hover:bg-gray-50 transition-colors">
                    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1">
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-sm">
                            Submitted {new Date(coi.submittedAt).toLocaleDateString()}
                          </p>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${reviewStatusColors[coi.status]}`}>
                            {coi.status.replace('_', ' ')}
                          </span>
                        </div>
                        <CoverageBreakdown coi={coi} />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        itemCount={1}
        itemLabel="vendor"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteModal(false)}
      />
    </div>
  );
}
