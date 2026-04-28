import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

const statusColors = {
  COMPLIANT: 'bg-green-100 text-green-800',
  NON_COMPLIANT: 'bg-red-100 text-red-800',
  EXPIRING_SOON: 'bg-yellow-100 text-yellow-800',
  EXPIRED: 'bg-red-100 text-red-800',
  PENDING: 'bg-blue-100 text-blue-800',
  NO_COI: 'bg-gray-100 text-gray-800',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [pendingCois, setPendingCois] = useState([]);
  const [expiring, setExpiring] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/reports/compliance'),
      api.get('/cois?status=PENDING_REVIEW'),
      api.get('/reports/expiring?days=30'),
    ])
      .then(([s, p, e]) => {
        setStats(s);
        setPendingCois(p);
        setExpiring(e);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;
  if (error) return <div className="text-center py-12"><p className="text-red-500 mb-2">Failed to load dashboard</p><button onClick={() => window.location.reload()} className="text-blue-600 hover:underline text-sm">Retry</button></div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {/* Stats grid */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {[
            { label: 'Total Vendors', value: stats.total, color: 'bg-white', status: '' },
            { label: 'Compliant', value: stats.compliant, color: 'bg-green-50', status: 'COMPLIANT' },
            { label: 'Non-Compliant', value: stats.nonCompliant, color: 'bg-red-50', status: 'NON_COMPLIANT' },
            { label: 'Expiring Soon', value: stats.expiringSoon, color: 'bg-yellow-50', status: 'EXPIRING_SOON' },
            { label: 'Expired', value: stats.expired, color: 'bg-red-50', status: 'EXPIRED' },
            { label: 'Pending', value: stats.pending, color: 'bg-blue-50', status: 'PENDING' },
          ].map((s) => (
            <div
              key={s.label}
              onClick={() => navigate(s.status ? `/vendors?status=${s.status}` : '/vendors')}
              className={`${s.color} p-4 rounded-xl border cursor-pointer transition-shadow hover:shadow-md hover:border-gray-300`}
            >
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-sm text-gray-600">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-8">
        {/* Pending COIs */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Pending Review</h2>
            <Link to="/cois" className="text-sm text-blue-600 hover:underline">View all</Link>
          </div>
          {pendingCois.length === 0 ? (
            <p className="text-gray-500 text-sm">No COIs pending review</p>
          ) : (
            <div className="space-y-3">
              {pendingCois.slice(0, 5).map((coi) => (
                <Link key={coi.id} to={`/cois/${coi.id}`}
                  className="block p-3 rounded-lg border hover:bg-gray-50 transition-colors">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="font-medium">{coi.vendor?.name}</p>
                      <p className="text-sm text-gray-500">
                        Submitted {new Date(coi.submittedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      Pending
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Expiring Soon */}
        <div className="bg-white rounded-xl border p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Expiring Soon</h2>
            <Link to="/cois" className="text-sm text-blue-600 hover:underline">View all COIs</Link>
          </div>
          {expiring.length === 0 ? (
            <p className="text-gray-500 text-sm">No COIs expiring in the next 30 days</p>
          ) : (
            <div className="space-y-3">
              {expiring.slice(0, 5).map((coi) => {
                const earliest = [coi.glExpirationDate, coi.wcExpirationDate, coi.umbExpirationDate, coi.autoExpirationDate]
                  .filter(Boolean)
                  .sort()[0];
                return (
                  <Link key={coi.id} to={`/cois/${coi.id}`}
                    className="block p-3 rounded-lg border hover:bg-gray-50 transition-colors">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-medium">{coi.vendor?.name}</p>
                        <p className="text-sm text-gray-500">
                          Expires {earliest ? new Date(earliest).toLocaleDateString() : 'N/A'}
                        </p>
                      </div>
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                        Expiring
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
