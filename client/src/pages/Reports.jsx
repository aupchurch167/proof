import { useState, useEffect } from 'react';
import { api } from '../utils/api';

const statusColors = {
  PENDING_REVIEW: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-gray-100 text-gray-800',
};

function ExpirationCell({ dateStr }) {
  if (!dateStr) return <span className="text-gray-300">-</span>;
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.ceil((d - now) / (1000 * 60 * 60 * 24));
  let color = 'text-gray-600';
  if (diffDays < 0) color = 'text-red-600 font-medium';
  else if (diffDays <= 30) color = 'text-yellow-600 font-medium';
  return <span className={color}>{d.toLocaleDateString()}</span>;
}

export default function Reports() {
  const [cois, setCois] = useState([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState('');
  const [filterBy, setFilterBy] = useState('submission');
  const [exportingPdfs, setExportingPdfs] = useState(false);

  const fetchReport = async () => {
    setLoading(true);
    try {
      let url = '/reports/cois?';
      if (startDate) url += `startDate=${startDate}&`;
      if (endDate) url += `endDate=${endDate}&`;
      if (status) url += `status=${status}&`;
      if (filterBy === 'expiration') url += 'filterBy=expiration&';
      const data = await api.get(url);
      setCois(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReport(); }, []);

  const exportCsv = () => {
    const headers = ['Vendor', 'Status', 'Coverage Type', 'GL Coverage', 'GL Expires', 'WC Coverage', 'WC Expires', 'Umbrella Coverage', 'Umbrella Expires', 'Auto Coverage', 'Auto Expires', 'Expiring Coverages', 'Submitted'];
    const rows = cois.map(c => [
      c.vendor?.name,
      c.status,
      c.coverageType || '',
      c.glCoverageAmount ? (c.glCoverageAmount / 100) : '',
      c.glExpirationDate ? new Date(c.glExpirationDate).toLocaleDateString() : '',
      c.wcCoverageAmount ? (c.wcCoverageAmount / 100) : '',
      c.wcExpirationDate ? new Date(c.wcExpirationDate).toLocaleDateString() : '',
      c.umbCoverageAmount ? (c.umbCoverageAmount / 100) : '',
      c.umbExpirationDate ? new Date(c.umbExpirationDate).toLocaleDateString() : '',
      c.autoCoverageAmount ? (c.autoCoverageAmount / 100) : '',
      c.autoExpirationDate ? new Date(c.autoExpirationDate).toLocaleDateString() : '',
      c.expiringCoverages?.join(', ') || '',
      new Date(c.submittedAt).toLocaleDateString(),
    ]);

    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coi-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPdfs = async () => {
    const coiIds = cois.filter(c => c.pdfPath).map(c => c.id);
    if (coiIds.length === 0) {
      alert('No COIs with PDF files in the current results.');
      return;
    }
    setExportingPdfs(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/reports/export-pdfs', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ coiIds }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Export failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `coi-export-${new Date().toISOString().split('T')[0]}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Failed to export PDFs: ' + err.message);
    } finally {
      setExportingPdfs(false);
    }
  };

  const hasExpiringColumn = filterBy === 'expiration' && (startDate || endDate);

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Audit Reports</h1>
        <div className="flex gap-2">
          <button onClick={exportPdfs} disabled={cois.length === 0 || exportingPdfs}
            className="border border-blue-600 text-blue-600 px-4 py-2 rounded-lg hover:bg-blue-50 disabled:opacity-50 text-sm font-medium">
            {exportingPdfs ? 'Merging...' : 'Export PDFs'}
          </button>
          <button onClick={exportCsv} disabled={cois.length === 0}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border p-4 mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Filter Dates By</label>
            <select value={filterBy} onChange={(e) => setFilterBy(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm">
              <option value="submission">Submission Date</option>
              <option value="expiration">Expiration Date</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {filterBy === 'expiration' ? 'Expires After' : 'Start Date'}
            </label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {filterBy === 'expiration' ? 'Expires Before' : 'End Date'}
            </label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="px-3 py-2 border rounded-lg text-sm">
              <option value="">All</option>
              <option value="APPROVED">Approved</option>
              <option value="PENDING_REVIEW">Pending</option>
              <option value="REJECTED">Rejected</option>
              <option value="EXPIRED">Expired</option>
            </select>
          </div>
          <button onClick={fetchReport}
            className="bg-gray-900 text-white px-4 py-2 rounded-lg text-sm hover:bg-gray-800">
            Run Report
          </button>
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-4">{cois.length} COI(s) found</p>
          {cois.length > 0 && (
            <div className="bg-white rounded-xl border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Vendor</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                    {hasExpiringColumn && (
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Expiring Coverage</th>
                    )}
                    <th className="text-left px-4 py-3 font-medium text-gray-600">GL</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">GL Exp</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">WC</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">WC Exp</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Umb</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Umb Exp</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Auto</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Auto Exp</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {cois.map((coi) => (
                    <tr key={coi.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{coi.vendor?.name}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[coi.status]}`}>
                          {coi.status.replace('_', ' ')}
                        </span>
                      </td>
                      {hasExpiringColumn && (
                        <td className="px-4 py-3">
                          {coi.expiringCoverages?.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {coi.expiringCoverages.map(c => (
                                <span key={c} className="px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs font-medium">
                                  {c}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 text-gray-600">{coi.glCoverageAmount ? `$${(coi.glCoverageAmount/100).toLocaleString()}` : '-'}</td>
                      <td className="px-4 py-3"><ExpirationCell dateStr={coi.glExpirationDate} /></td>
                      <td className="px-4 py-3 text-gray-600">{coi.wcCoverageAmount ? `$${(coi.wcCoverageAmount/100).toLocaleString()}` : '-'}</td>
                      <td className="px-4 py-3"><ExpirationCell dateStr={coi.wcExpirationDate} /></td>
                      <td className="px-4 py-3 text-gray-600">{coi.umbCoverageAmount ? `$${(coi.umbCoverageAmount/100).toLocaleString()}` : '-'}</td>
                      <td className="px-4 py-3"><ExpirationCell dateStr={coi.umbExpirationDate} /></td>
                      <td className="px-4 py-3 text-gray-600">{coi.autoCoverageAmount ? `$${(coi.autoCoverageAmount/100).toLocaleString()}` : '-'}</td>
                      <td className="px-4 py-3"><ExpirationCell dateStr={coi.autoExpirationDate} /></td>
                      <td className="px-4 py-3 text-gray-600">{new Date(coi.submittedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
