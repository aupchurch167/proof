import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';

const statusColors = {
  COMPLIANT: 'bg-green-100 text-green-800',
  NON_COMPLIANT: 'bg-red-100 text-red-800',
  EXPIRING_SOON: 'bg-yellow-100 text-yellow-800',
  EXPIRED: 'bg-red-100 text-red-800',
  PENDING: 'bg-blue-100 text-blue-800',
  NO_COI: 'bg-gray-100 text-gray-800',
};

const statusLabels = {
  COMPLIANT: 'Compliant',
  NON_COMPLIANT: 'Non-Compliant',
  EXPIRING_SOON: 'Expiring Soon',
  EXPIRED: 'Expired',
  PENDING: 'Pending',
  NO_COI: 'No COI',
};

export default function Vendors() {
  const { user } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [orgSlug, setOrgSlug] = useState(null);
  const applyUrl = orgSlug ? `${window.location.origin}/apply/${orgSlug}` : null;

  useEffect(() => {
    api.get('/organization').then((org) => setOrgSlug(org.slug || org.id)).catch(() => {});
  }, []);
  const [form, setForm] = useState({ name: '', contactName: '', email: '', phone: '', address: '' });
  const [w9File, setW9File] = useState(null);
  const [maFile, setMaFile] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [requestingBulk, setRequestingBulk] = useState(false);

  const fetchVendors = async () => {
    try {
      let url = '/vendors?';
      if (search) url += `search=${encodeURIComponent(search)}&`;
      if (statusFilter) url += `status=${statusFilter}&`;
      const data = await api.get(url);
      setVendors(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchVendors(); }, [search, statusFilter]);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const created = await api.post('/vendors', form);
      if (w9File || maFile) {
        const fd = new FormData();
        if (w9File) fd.append('w9', w9File);
        if (maFile) fd.append('masterAgreement', maFile);
        await api.upload(`/vendors/${created.id}/documents`, fd);
      }
      setForm({ name: '', contactName: '', email: '', phone: '', address: '' });
      setW9File(null);
      setMaFile(null);
      setShowAdd(false);
      fetchVendors();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRequestCoi = async (vendorId, force = false) => {
    try {
      await api.post(`/vendors/${vendorId}/request-coi`, force ? { force: true } : undefined);
      toast.success('COI request sent!');
    } catch (err) {
      const msg = err.message || '';
      if (msg.toLowerCase().includes('recently')) {
        if (window.confirm('A COI request was already sent to this vendor in the last 24 hours. Send another anyway?')) {
          return handleRequestCoi(vendorId, true);
        }
      } else {
        toast.error('Failed to send request: ' + msg);
      }
    }
  };

  const allSelected = vendors.length > 0 && vendors.every((v) => selected.has(v.id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(vendors.map((v) => v.id)));
    }
  };

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleBulkRequestCoi = async () => {
    setRequestingBulk(true);
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    for (const vendorId of selected) {
      try {
        await api.post(`/vendors/${vendorId}/request-coi`);
        sent++;
      } catch (err) {
        // Cooldown: vendor was already emailed in the last 24 hours.
        if ((err.message || '').toLowerCase().includes('recently')) {
          skipped++;
        } else {
          failed++;
        }
      }
    }
    setRequestingBulk(false);
    const parts = [`${sent} sent`];
    if (skipped > 0) parts.push(`${skipped} skipped (already requested in last 24h)`);
    if (failed > 0) parts.push(`${failed} failed`);
    const msg = `COI requests: ${parts.join(', ')}`;
    if (failed > 0) toast.warning(msg);
    else if (skipped > 0) toast.info ? toast.info(msg) : toast.success(msg);
    else toast.success(msg);
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      await api.delete('/vendors/bulk', { ids: [...selected] });
      setSelected(new Set());
      setShowDeleteModal(false);
      fetchVendors();
    } finally {
      setDeleting(false);
    }
  };

  const canManage = ['ADMIN', 'MEMBER', 'REVIEWER'].includes(user?.role);
  const canDelete = ['ADMIN', 'MEMBER'].includes(user?.role);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">Vendors</h1>
        <div className="flex flex-wrap gap-2">
          {canManage && someSelected && (
            <button onClick={handleBulkRequestCoi} disabled={requestingBulk}
              className="border border-blue-600 text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-50 text-sm font-medium disabled:opacity-50">
              {requestingBulk ? 'Sending...' : `Request COI (${selected.size})`}
            </button>
          )}
          {canDelete && someSelected && (
            <button onClick={() => setShowDeleteModal(true)}
              className="text-red-600 underline text-sm font-medium hover:text-red-800 px-2 py-2">
              Delete Selected ({selected.size})
            </button>
          )}
          {canManage && (
            <>
              {applyUrl && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(applyUrl);
                    toast.success('Application link copied to clipboard');
                  }}
                  className="border border-gray-300 px-3 py-2 rounded-lg hover:bg-gray-50 text-sm font-medium"
                  title={applyUrl}
                >
                  Copy Application Link
                </button>
              )}
              <button onClick={() => setShowAdd(!showAdd)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium">
                Add Vendor
              </button>
            </>
          )}
        </div>
      </div>

      {/* Add vendor form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="bg-white p-4 sm:p-6 rounded-xl border mb-6">
          {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}
          <div className="grid sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
                className="w-full px-3 py-2.5 border rounded-lg text-base sm:text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Name</label>
              <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                className="w-full px-3 py-2.5 border rounded-lg text-base sm:text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required
                className="w-full px-3 py-2.5 border rounded-lg text-base sm:text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2.5 border rounded-lg text-base sm:text-sm" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full px-3 py-2.5 border rounded-lg text-base sm:text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">W9 <span className="text-gray-400 font-normal">(PDF or image)</span></label>
              <input type="file" accept="application/pdf,image/*"
                onChange={(e) => setW9File(e.target.files?.[0] || null)}
                className="w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:text-sm file:cursor-pointer hover:file:bg-gray-50" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Master Agreement <span className="text-gray-400 font-normal">(PDF or image)</span></label>
              <input type="file" accept="application/pdf,image/*"
                onChange={(e) => setMaFile(e.target.files?.[0] || null)}
                className="w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-gray-300 file:bg-white file:text-sm file:cursor-pointer hover:file:bg-gray-50" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 text-sm">Save</button>
            <button type="button" onClick={() => { setShowAdd(false); setW9File(null); setMaFile(null); }} className="px-4 py-2.5 rounded-lg border text-sm">Cancel</button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input placeholder="Search vendors..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2.5 border rounded-lg text-base sm:text-sm w-full sm:w-64" />
        <select value={statusFilter} onChange={(e) => {
            setStatusFilter(e.target.value);
            if (e.target.value) {
              setSearchParams({ status: e.target.value });
            } else {
              setSearchParams({});
            }
          }}
          className="px-3 py-2.5 border rounded-lg text-base sm:text-sm w-full sm:w-auto">
          <option value="">All Statuses</option>
          {Object.entries(statusLabels).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {/* Vendor list */}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : vendors.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>No vendors found</p>
          {canManage && <p className="text-sm mt-1">Add your first vendor to get started</p>}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  {canDelete && (
                    <th className="px-4 py-3 w-10">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll}
                        className="rounded border-gray-300 cursor-pointer" />
                    </th>
                  )}
                  <th className="text-left px-6 py-3 font-medium text-gray-600">Name</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-600">Email</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-6 py-3 font-medium text-gray-600">Latest COI</th>
                  <th className="text-right px-6 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((vendor) => (
                  <tr key={vendor.id} className={`border-b last:border-0 hover:bg-gray-50 ${selected.has(vendor.id) ? 'bg-blue-50' : ''}`}>
                    {canDelete && (
                      <td className="px-4 py-4">
                        <input type="checkbox" checked={selected.has(vendor.id)} onChange={() => toggleOne(vendor.id)}
                          className="rounded border-gray-300 cursor-pointer" />
                      </td>
                    )}
                    <td className="px-6 py-4">
                      <Link to={`/vendors/${vendor.id}`} className="text-blue-600 hover:underline font-medium">
                        {vendor.name}
                      </Link>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{vendor.email}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[vendor.coiStatus]}`}>
                        {statusLabels[vendor.coiStatus]}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {vendor.cois?.[0]
                        ? new Date(vendor.cois[0].submittedAt).toLocaleDateString()
                        : 'None'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {canManage && (
                        <button onClick={() => handleRequestCoi(vendor.id)}
                          className="text-blue-600 hover:underline text-sm">
                          Request COI
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {canDelete && (
              <div className="flex items-center gap-2 px-1">
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                  className="rounded border-gray-300 cursor-pointer w-5 h-5" />
                <span className="text-sm text-gray-500">Select all</span>
              </div>
            )}
            {vendors.map((vendor) => (
              <div key={vendor.id} className={`bg-white rounded-xl border p-4 ${selected.has(vendor.id) ? 'border-blue-300 bg-blue-50' : ''}`}>
                <div className="flex items-start gap-3">
                  {canDelete && (
                    <input type="checkbox" checked={selected.has(vendor.id)} onChange={() => toggleOne(vendor.id)}
                      className="rounded border-gray-300 cursor-pointer w-5 h-5 mt-0.5 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <Link to={`/vendors/${vendor.id}`} className="text-blue-600 hover:underline font-medium truncate">
                        {vendor.name}
                      </Link>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${statusColors[vendor.coiStatus]}`}>
                        {statusLabels[vendor.coiStatus]}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 truncate mt-1">{vendor.email}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-gray-400">
                        {vendor.cois?.[0]
                          ? `COI: ${new Date(vendor.cois[0].submittedAt).toLocaleDateString()}`
                          : 'No COI'}
                      </span>
                      {canManage && (
                        <button onClick={() => handleRequestCoi(vendor.id)}
                          className="text-blue-600 text-sm py-1">
                          Request COI
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <DeleteConfirmationModal
        isOpen={showDeleteModal}
        itemCount={selected.size}
        itemLabel="vendor"
        loading={deleting}
        onConfirm={handleBulkDelete}
        onCancel={() => setShowDeleteModal(false)}
      />
    </div>
  );
}
