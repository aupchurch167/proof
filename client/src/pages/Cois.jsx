import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';

const statusColors = {
  PENDING_REVIEW: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-gray-100 text-gray-800',
};

export default function Cois() {
  const [cois, setCois] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    let url = '/cois?';
    if (statusFilter) url += `status=${statusFilter}`;
    api.get(url)
      .then(setCois)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [statusFilter]);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Certificates of Insurance</h1>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm">
          <option value="">All Statuses</option>
          <option value="PENDING_REVIEW">Pending Review</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="EXPIRED">Expired</option>
        </select>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : cois.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No COIs found</div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="text-left px-6 py-3 font-medium text-gray-600">Vendor</th>
                <th className="text-left px-6 py-3 font-medium text-gray-600">Submitted</th>
                <th className="text-left px-6 py-3 font-medium text-gray-600">GL Coverage</th>
                <th className="text-left px-6 py-3 font-medium text-gray-600">GL Expires</th>
                <th className="text-left px-6 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-6 py-3 font-medium text-gray-600">Reviewed By</th>
              </tr>
            </thead>
            <tbody>
              {cois.map((coi) => (
                <tr key={coi.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <Link to={`/cois/${coi.id}`} className="text-blue-600 hover:underline font-medium">
                      {coi.vendor?.name}
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {new Date(coi.submittedAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {coi.glCoverageAmount ? `$${(coi.glCoverageAmount / 100).toLocaleString()}` : 'N/A'}
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {coi.glExpirationDate ? new Date(coi.glExpirationDate).toLocaleDateString() : 'N/A'}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[coi.status]}`}>
                      {coi.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-600">
                    {coi.reviewedBy ? `${coi.reviewedBy.firstName} ${coi.reviewedBy.lastName}` : '-'}
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
