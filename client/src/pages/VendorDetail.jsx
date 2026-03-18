import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import PdfUploadZone from '../components/PdfUploadZone';

const statusColors = {
  PENDING_REVIEW: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-gray-100 text-gray-800',
};

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
      // Refresh vendor data to show new COI
      const updated = await api.get(`/vendors/${id}`);
      setVendor(updated);
    } catch (err) {
      setUploadError(err.message || 'Failed to upload COI');
    } finally {
      setUploading(false);
    }
  };

  const canManage = user?.role === 'ADMIN' || user?.role === 'REVIEWER';
  const isAdmin = user?.role === 'ADMIN';

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;
  if (!vendor) return <div className="text-center py-12 text-gray-500">Vendor not found</div>;

  const portalUrl = `${window.location.origin}/portal/${vendor.uploadToken}`;

  return (
    <div>
      <Link to="/vendors" className="text-sm text-blue-600 hover:underline mb-4 inline-block">Back to Vendors</Link>

      <div className="bg-white rounded-xl border p-6 mb-6">
        <div className="flex justify-between items-start gap-4">
          <div className="flex-1">
            {editing ? (
              <div className="space-y-3">
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="px-3 py-2 border rounded-lg text-lg font-bold" />
                <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                  className="px-3 py-2 border rounded-lg w-full" placeholder="Contact Name" />
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="px-3 py-2 border rounded-lg w-full" placeholder="Email" />
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="px-3 py-2 border rounded-lg w-full" placeholder="Phone" />
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="px-3 py-2 border rounded-lg w-full" placeholder="Address" />
                <div className="flex gap-2">
                  <button onClick={handleSave} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Save</button>
                  <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-lg border text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-2xl font-bold">{vendor.name}</h1>
                {vendor.contactName && <p className="text-gray-600 mt-1">{vendor.contactName}</p>}
                <p className="text-gray-600 mt-1">{vendor.email}</p>
                {vendor.phone && <p className="text-gray-600">{vendor.phone}</p>}
                {vendor.address && <p className="text-gray-600">{vendor.address}</p>}
              </>
            )}
          </div>
          {canManage && !editing && (
            <div className="flex gap-2">
              <button onClick={() => setEditing(true)} className="text-sm text-blue-600 hover:underline">Edit</button>
              {isAdmin && (
                <button onClick={() => setShowDeleteModal(true)} className="text-sm text-red-600 hover:underline">Delete</button>
              )}
            </div>
          )}
        </div>

        <div className="mt-4 pt-4 border-t">
          <p className="text-sm text-gray-500">Portal Link</p>
          <div className="flex items-center gap-2 mt-1">
            <code className="text-sm bg-gray-100 px-3 py-1.5 rounded-lg flex-1 overflow-x-auto">{portalUrl}</code>
            <button onClick={() => { navigator.clipboard.writeText(portalUrl); }}
              className="text-sm text-blue-600 hover:underline whitespace-nowrap">Copy</button>
          </div>
        </div>
      </div>

      {/* COI History */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">COI History</h2>
        {canManage && (
          <button
            onClick={() => setShowUpload(!showUpload)}
            className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700"
          >
            {showUpload ? 'Cancel' : 'Upload COI'}
          </button>
        )}
      </div>

      {/* Upload zone */}
      {showUpload && (
        <div className="bg-white rounded-xl border p-6 mb-6">
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
        <div className="space-y-3">
          {vendor.cois?.map((coi) => (
            <Link key={coi.id} to={`/cois/${coi.id}`}
              className="block bg-white rounded-xl border p-4 hover:bg-gray-50 transition-colors">
              <div className="flex justify-between items-center">
                <div>
                  <p className="font-medium">
                    Submitted {new Date(coi.submittedAt).toLocaleDateString()}
                  </p>
                  <p className="text-sm text-gray-500">
                    GL: {coi.glCoverageAmount ? `$${(coi.glCoverageAmount / 100).toLocaleString()}` : 'N/A'}
                    {' | '}
                    WC: {coi.wcCoverageAmount ? `$${(coi.wcCoverageAmount / 100).toLocaleString()}` : 'N/A'}
                  </p>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[coi.status]}`}>
                  {coi.status.replace('_', ' ')}
                </span>
              </div>
            </Link>
          ))}
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
