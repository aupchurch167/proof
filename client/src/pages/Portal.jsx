import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

const API_BASE = '/api';

export default function Portal() {
  const { token } = useParams();
  const [vendor, setVendor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [complianceFlags, setComplianceFlags] = useState(null);
  const [editingInfo, setEditingInfo] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => {
    fetch(`${API_BASE}/portal/${token}`)
      .then(res => {
        if (!res.ok) throw new Error('Invalid link');
        return res.json();
      })
      .then((v) => {
        setVendor(v);
        setForm({ name: v.name, contactName: v.contactName || '', email: v.email, phone: v.phone || '', address: v.address || '' });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleUpdateInfo = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/portal/${token}/info`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed to update');
      const updated = await res.json();
      setVendor(updated);
      setEditingInfo(false);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('pdf', file);

      const res = await fetch(`${API_BASE}/portal/${token}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Upload failed');
      }

      const data = await res.json();
      setUploaded(true);
      setComplianceFlags(data.complianceFlags);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (error && !vendor) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Invalid Link</h1>
          <p className="text-gray-500">This upload link is not valid or has expired.</p>
        </div>
      </div>
    );
  }

  if (uploaded) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          <div className="bg-white p-8 rounded-xl shadow-sm border text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold mb-2">COI Uploaded!</h1>
            <p className="text-gray-500 mb-4">Your certificate of insurance has been submitted for review.</p>
            {complianceFlags && complianceFlags.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-4 text-left">
                <p className="font-medium text-yellow-800 mb-2">Potential issues detected:</p>
                <ul className="text-sm text-yellow-700 space-y-1">
                  {complianceFlags.map((flag, i) => (
                    <li key={i}>{flag.message}</li>
                  ))}
                </ul>
                <p className="text-xs text-yellow-600 mt-2">The reviewing team will follow up if any changes are needed.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-lg mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Proof</h1>
          <p className="text-gray-500 mt-2">COI Upload Portal</p>
        </div>

        {/* Vendor info */}
        <div className="bg-white p-6 rounded-xl shadow-sm border mb-6">
          <div className="flex justify-between items-start">
            <h2 className="text-lg font-semibold mb-3">Your Information</h2>
            {!editingInfo && (
              <button onClick={() => setEditingInfo(true)} className="text-sm text-blue-600 hover:underline">Edit</button>
            )}
          </div>
          {editingInfo ? (
            <form onSubmit={handleUpdateInfo} className="space-y-3">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" placeholder="Company Name" />
              <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" placeholder="Contact Name" />
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" placeholder="Email" />
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" placeholder="Phone" />
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" placeholder="Address" />
              <div className="flex gap-2">
                <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">Save</button>
                <button type="button" onClick={() => setEditingInfo(false)} className="px-4 py-2 border rounded-lg text-sm">Cancel</button>
              </div>
            </form>
          ) : (
            <div className="text-sm space-y-1">
              <p><span className="text-gray-500">Company:</span> {vendor.name}</p>
              {vendor.contactName && <p><span className="text-gray-500">Contact:</span> {vendor.contactName}</p>}
              <p><span className="text-gray-500">Email:</span> {vendor.email}</p>
              {vendor.phone && <p><span className="text-gray-500">Phone:</span> {vendor.phone}</p>}
              {vendor.address && <p><span className="text-gray-500">Address:</span> {vendor.address}</p>}
            </div>
          )}
        </div>

        {/* Certificate Requirements */}
        {vendor.organization && (
          <div className="bg-blue-50 p-6 rounded-xl border border-blue-200 mb-6">
            <h2 className="text-lg font-semibold text-blue-900 mb-3">Certificate Requirements</h2>
            <div className="text-sm space-y-2 text-blue-800">
              <p><span className="font-medium">Additionally Insured:</span></p>
              <div className="bg-white rounded-lg p-4 border border-blue-200">
                <p className="font-medium text-gray-900">{vendor.organization.name}</p>
                {vendor.organization.address && (
                  <p className="text-gray-600 mt-1">{vendor.organization.address}</p>
                )}
              </div>
              <p className="text-blue-700 text-xs mt-3">
                {vendor.organization.additionalInsuredNote
                  || 'Please list the above company as Additionally Insured on your Certificate of Insurance.'}
              </p>
            </div>
          </div>
        )}

        {/* Upload form */}
        <form onSubmit={handleUpload} className="bg-white p-6 rounded-xl shadow-sm border">
          <h2 className="text-lg font-semibold mb-4">Upload Certificate of Insurance</h2>
          <p className="text-sm text-gray-500 mb-4">Please upload your current COI as a PDF file.</p>

          {error && <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}

          <div className="border-2 border-dashed rounded-xl p-8 text-center mb-4">
            <input type="file" accept=".pdf" onChange={(e) => setFile(e.target.files[0])}
              className="hidden" id="pdf-upload" />
            <label htmlFor="pdf-upload" className="cursor-pointer">
              {file ? (
                <div>
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-gray-500 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              ) : (
                <div>
                  <svg className="w-12 h-12 text-gray-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-gray-600">Click to select PDF file</p>
                  <p className="text-xs text-gray-400 mt-1">Max 10MB</p>
                </div>
              )}
            </label>
          </div>

          <button type="submit" disabled={!file || uploading}
            className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
            {uploading ? 'Uploading & Analyzing...' : 'Upload COI'}
          </button>

          {uploading && (
            <p className="text-sm text-gray-500 text-center mt-3">
              We're extracting data from your COI. This may take a moment...
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
