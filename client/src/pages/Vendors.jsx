import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

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
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '' });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');

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
      await api.post('/vendors', form);
      setForm({ name: '', email: '', phone: '', address: '' });
      setShowAdd(false);
      fetchVendors();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRequestCoi = async (vendorId) => {
    try {
      await api.post(`/vendors/${vendorId}/request-coi`);
      alert('COI request sent!');
    } catch (err) {
      alert('Failed to send request: ' + err.message);
    }
  };

  const canManage = user?.role === 'ADMIN' || user?.role === 'REVIEWER';

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Vendors</h1>
        {canManage && (
          <button onClick={() => setShowAdd(!showAdd)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium">
            Add Vendor
          </button>
        )}
      </div>

      {/* Add vendor form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="bg-white p-6 rounded-xl border mb-6">
          {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm">Save</button>
            <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-lg border text-sm">Cancel</button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <input placeholder="Search vendors..." value={search} onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm w-64" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm">
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
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-6 py-3 font-medium text-gray-600">Name</th>
                <th className="text-left px-6 py-3 font-medium text-gray-600">Email</th>
                <th className="text-left px-6 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-6 py-3 font-medium text-gray-600">Latest COI</th>
                <th className="text-right px-6 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((vendor) => (
                <tr key={vendor.id} className="border-b last:border-0 hover:bg-gray-50">
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
      )}
    </div>
  );
}
