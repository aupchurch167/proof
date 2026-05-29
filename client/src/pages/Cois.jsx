import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api, API_BASE } from '../utils/api';
import { useToast } from '../contexts/ToastContext';

const statusColors = {
  PENDING_REVIEW: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-gray-100 text-gray-800',
};

const coverageTypeLabels = {
  GENERAL_LIABILITY: 'GL',
  WORKERS_COMP: 'WC',
  UMBRELLA: 'Umbrella',
  AUTO: 'Auto',
  OTHER: 'Other',
};

const dateFieldMap = {
  glActive: 'glExpirationDate',
  wcActive: 'wcExpirationDate',
  umbActive: 'umbExpirationDate',
  anyActive: null,
};

function formatCurrency(cents) {
  if (!cents) return '—';
  return `$${(cents / 100).toLocaleString()}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString();
}

function soonestExpiration(coi) {
  return [coi.glExpirationDate, coi.wcExpirationDate, coi.umbExpirationDate, coi.autoExpirationDate]
    .filter(Boolean)
    .sort()[0] || null;
}

export default function Cois() {
  const toast = useToast();
  const [cois, setCois] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [coverageFilter, setCoverageFilter] = useState('');
  const [expiringWithin, setExpiringWithin] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dateFilterBy, setDateFilterBy] = useState('');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [exportingPdfs, setExportingPdfs] = useState(false);

  useEffect(() => {
    let url = '/cois?';
    if (statusFilter) url += `status=${statusFilter}&`;
    api.get(url)
      .then(setCois)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [statusFilter]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIndicator = (field) => {
    if (sortField !== field) return ' ↕';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  };

  const filtered = useMemo(() => {
    let result = cois;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c => c.vendor?.name?.toLowerCase().includes(q));
    }

    if (coverageFilter) {
      result = result.filter(c => c.coverageType === coverageFilter);
    }

    if (expiringWithin) {
      const days = parseInt(expiringWithin);
      const now = new Date();
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + days);
      result = result.filter(c => {
        const s = soonestExpiration(c);
        if (!s) return false;
        const d = new Date(s);
        return d >= now && d <= cutoff;
      });
    }

    if (dateFilterBy && (dateFrom || dateTo)) {
      const field = dateFieldMap[dateFilterBy];
      result = result.filter(c => {
        if (dateFilterBy === 'anyActive') {
          const expirations = [c.glExpirationDate, c.wcExpirationDate, c.umbExpirationDate, c.autoExpirationDate].filter(Boolean);
          if (expirations.length === 0) return false;
          return expirations.some(val => {
            const d = new Date(val);
            if (dateFrom && d < new Date(dateFrom)) return false;
            return true;
          });
        }
        const val = c[field];
        if (!val) return false;
        const d = new Date(val);
        if (dateFrom && d < new Date(dateFrom)) return false;
        return true;
      });
    }

    if (sortField) {
      result = [...result].sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
        if (!aVal && !bVal) return 0;
        if (!aVal) return 1;
        if (!bVal) return -1;
        const cmp = new Date(aVal) - new Date(bVal);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [cois, search, coverageFilter, expiringWithin, dateFrom, dateTo, dateFilterBy, sortField, sortDir]);

  const exportCsv = () => {
    const headers = ['Vendor', 'Status', 'Coverage Type', 'GL Coverage', 'GL Expires', 'WC Coverage', 'WC Expires', 'Umbrella Coverage', 'Umbrella Expires', 'Auto Coverage', 'Auto Expires', 'Submitted'];
    const rows = filtered.map(c => [
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
    const coiIds = filtered.filter(c => c.pdfPath).map(c => c.id);
    if (coiIds.length === 0) {
      toast.warning('No COIs with PDF files in the current results.');
      return;
    }
    setExportingPdfs(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_BASE}/reports/export-pdfs`, {
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
      toast.error('Failed to export PDFs: ' + err.message);
    } finally {
      setExportingPdfs(false);
    }
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold">Certificates of Insurance</h1>
        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={exportPdfs} disabled={filtered.length === 0 || exportingPdfs}
            className="border border-blue-600 text-blue-600 px-4 py-2.5 sm:py-2 rounded-lg hover:bg-blue-50 disabled:opacity-50 text-sm font-medium text-center">
            {exportingPdfs ? 'Merging...' : 'Export PDFs'}
          </button>
          <button onClick={exportCsv} disabled={filtered.length === 0}
            className="bg-blue-600 text-white px-4 py-2.5 sm:py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium text-center">
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            placeholder="Search by vendor name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-2.5 sm:py-2 border rounded-lg text-base sm:text-sm w-full sm:w-64"
          />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2.5 sm:py-2 border rounded-lg text-base sm:text-sm w-full sm:w-auto">
            <option value="">All Statuses</option>
            <option value="PENDING_REVIEW">Pending Review</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="EXPIRED">Expired</option>
          </select>
          <select value={coverageFilter} onChange={(e) => setCoverageFilter(e.target.value)}
            className="px-3 py-2.5 sm:py-2 border rounded-lg text-base sm:text-sm w-full sm:w-auto">
            <option value="">All Coverage Types</option>
            <option value="GENERAL_LIABILITY">GL</option>
            <option value="WORKERS_COMP">WC</option>
            <option value="UMBRELLA">Umbrella</option>
            <option value="AUTO">Auto</option>
          </select>
          <select value={expiringWithin} onChange={(e) => setExpiringWithin(e.target.value)}
            className="px-3 py-2.5 sm:py-2 border rounded-lg text-base sm:text-sm w-full sm:w-auto">
            <option value="">Expiring Within</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
          </select>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="text-sm font-medium text-gray-600 whitespace-nowrap">Active Coverage:</label>
          <select value={dateFilterBy} onChange={(e) => setDateFilterBy(e.target.value)}
            className="px-3 py-2.5 sm:py-2 border rounded-lg text-base sm:text-sm w-full sm:w-auto">
            <option value="">All</option>
            <option value="glActive">GL Coverage Active</option>
            <option value="wcActive">WC Coverage Active</option>
            <option value="umbActive">Umbrella Coverage Active</option>
            <option value="anyActive">Any Coverage Active</option>
          </select>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="text-sm text-gray-600 whitespace-nowrap">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2.5 sm:py-2 border rounded-lg text-base sm:text-sm w-full sm:w-auto" />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="text-sm text-gray-600 whitespace-nowrap">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2.5 sm:py-2 border rounded-lg text-base sm:text-sm w-full sm:w-auto" />
          </div>
          {(search || statusFilter || coverageFilter || expiringWithin || dateFrom || dateTo) && (
            <button
              onClick={() => { setSearch(''); setStatusFilter(''); setCoverageFilter(''); setExpiringWithin(''); setDateFrom(''); setDateTo(''); setDateFilterBy(''); }}
              className="text-sm text-gray-500 hover:text-gray-700 whitespace-nowrap">
              Clear filters
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No COIs found</div>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-4">{filtered.length} COI(s) found</p>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Vendor</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">GL Coverage</th>
                  <th
                    className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900"
                    onClick={() => handleSort('glExpirationDate')}
                  >
                    GL Expires{sortIndicator('glExpirationDate')}
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden xl:table-cell">WC Coverage</th>
                  <th
                    className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900 hidden xl:table-cell"
                    onClick={() => handleSort('wcExpirationDate')}
                  >
                    WC Expires{sortIndicator('wcExpirationDate')}
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 hidden xl:table-cell">Umbrella Coverage</th>
                  <th
                    className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer select-none hover:text-gray-900 hidden xl:table-cell"
                    onClick={() => handleSort('umbExpirationDate')}
                  >
                    Umbrella Expires{sortIndicator('umbExpirationDate')}
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Reviewed By</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((coi) => (
                  <tr key={coi.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-4">
                      <Link to={`/cois/${coi.id}`} className="text-blue-600 hover:underline font-medium">
                        {coi.vendor?.name}
                      </Link>
                      <p className="text-xs text-gray-400">{new Date(coi.submittedAt).toLocaleDateString()}</p>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[coi.status]}`}>
                        {coi.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-gray-600">
                      {coverageTypeLabels[coi.coverageType] || '—'}
                    </td>
                    <td className="px-4 py-4 text-gray-600">{formatCurrency(coi.glCoverageAmount)}</td>
                    <td className="px-4 py-4 text-gray-600">{formatDate(coi.glExpirationDate)}</td>
                    <td className="px-4 py-4 text-gray-600 hidden xl:table-cell">{formatCurrency(coi.wcCoverageAmount)}</td>
                    <td className="px-4 py-4 text-gray-600 hidden xl:table-cell">{formatDate(coi.wcExpirationDate)}</td>
                    <td className="px-4 py-4 text-gray-600 hidden xl:table-cell">{formatCurrency(coi.umbCoverageAmount)}</td>
                    <td className="px-4 py-4 text-gray-600 hidden xl:table-cell">{formatDate(coi.umbExpirationDate)}</td>
                    <td className="px-4 py-4 text-gray-600">
                      {coi.reviewedBy ? `${coi.reviewedBy.firstName} ${coi.reviewedBy.lastName}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className="md:hidden space-y-3">
            {filtered.map((coi) => {
              const soonest = soonestExpiration(coi);
              return (
                <Link key={coi.id} to={`/cois/${coi.id}`}
                  className="block bg-white rounded-xl border p-4 hover:bg-gray-50 transition-colors">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-medium text-blue-600 truncate">{coi.vendor?.name}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${statusColors[coi.status]}`}>
                      {coi.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500 space-y-1">
                    <div className="flex justify-between">
                      <span>Submitted</span>
                      <span>{new Date(coi.submittedAt).toLocaleDateString()}</span>
                    </div>
                    {soonest && (
                      <div className="flex justify-between">
                        <span>Soonest Expiration</span>
                        <span className={new Date(soonest) < new Date() ? 'text-red-600 font-medium' : ''}>
                          {new Date(soonest).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                    {coi.coverageType && (
                      <div className="flex justify-between">
                        <span>Coverage Type</span>
                        <span>{coverageTypeLabels[coi.coverageType] || coi.coverageType}</span>
                      </div>
                    )}
                    {coi.glCoverageAmount && (
                      <div className="flex justify-between">
                        <span>GL Coverage</span>
                        <span>{formatCurrency(coi.glCoverageAmount)}</span>
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
