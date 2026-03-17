import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const API_BASE = '/api';

const VENDOR_TEMPLATE_FIELDS = [
  { key: 'name', label: 'Vendor Name', required: true },
  { key: 'email', label: 'Email', required: true },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'address', label: 'Address', required: false },
];

const COI_TEMPLATE_FIELDS = [
  { key: 'vendor_email', label: 'Vendor Email (lookup)', required: true },
  { key: 'gl_policy_number', label: 'GL Policy Number', required: false },
  { key: 'gl_coverage_amount', label: 'GL Coverage Amount ($)', required: false },
  { key: 'gl_expiration_date', label: 'GL Expiration Date', required: false },
  { key: 'wc_policy_number', label: 'WC Policy Number', required: false },
  { key: 'wc_coverage_amount', label: 'WC Coverage Amount ($)', required: false },
  { key: 'wc_expiration_date', label: 'WC Expiration Date', required: false },
  { key: 'umb_policy_number', label: 'Umbrella Policy Number', required: false },
  { key: 'umb_coverage_amount', label: 'Umbrella Coverage Amount ($)', required: false },
  { key: 'umb_expiration_date', label: 'Umbrella Expiration Date', required: false },
  { key: 'auto_policy_number', label: 'Auto Policy Number', required: false },
  { key: 'auto_coverage_amount', label: 'Auto Coverage Amount ($)', required: false },
  { key: 'auto_expiration_date', label: 'Auto Expiration Date', required: false },
  { key: 'agent_name', label: 'Agent Name', required: false },
  { key: 'agent_email', label: 'Agent Email', required: false },
  { key: 'agent_phone', label: 'Agent Phone', required: false },
  { key: 'insurance_company', label: 'Insurance Company', required: false },
];

// Try to auto-match CSV headers to template fields
function autoMatch(csvHeaders, templateFields) {
  const map = {};
  for (const field of templateFields) {
    // Exact match
    let match = csvHeaders.find(h => h.toLowerCase() === field.key.toLowerCase());
    if (!match) {
      // Match by label
      match = csvHeaders.find(h => h.toLowerCase() === field.label.toLowerCase());
    }
    if (!match) {
      // Fuzzy: strip underscores/spaces and compare
      const normalize = (s) => s.toLowerCase().replace(/[_\s-]/g, '');
      match = csvHeaders.find(h => normalize(h) === normalize(field.key) || normalize(h) === normalize(field.label));
    }
    if (match) {
      map[field.key] = match;
    }
  }
  return map;
}

function StepIndicator({ step, labels }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {labels.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
            i < step ? 'bg-green-100 text-green-700' :
            i === step ? 'bg-blue-600 text-white' :
            'bg-gray-100 text-gray-400'
          }`}>
            {i < step ? '\u2713' : i + 1}
          </div>
          <span className={`text-sm ${i === step ? 'font-medium text-gray-900' : 'text-gray-400'}`}>{label}</span>
          {i < labels.length - 1 && <div className="w-8 h-px bg-gray-200" />}
        </div>
      ))}
    </div>
  );
}

export default function Import() {
  const { user } = useAuth();
  const [importType, setImportType] = useState('vendors'); // 'vendors' | 'cois'
  const [step, setStep] = useState(0); // 0=upload, 1=map headers, 2=preview, 3=results
  const [file, setFile] = useState(null);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [rowCount, setRowCount] = useState(0);
  const [headerMap, setHeaderMap] = useState({});
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');

  const templateFields = importType === 'vendors' ? VENDOR_TEMPLATE_FIELDS : COI_TEMPLATE_FIELDS;

  const reset = () => {
    setStep(0);
    setFile(null);
    setCsvHeaders([]);
    setPreviewRows([]);
    setRowCount(0);
    setHeaderMap({});
    setResults(null);
    setError('');
  };

  const handleTypeChange = (type) => {
    setImportType(type);
    reset();
  };

  // Step 0: Upload CSV and get preview
  const handleFileUpload = async () => {
    if (!file) return;
    setError('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch(`${API_BASE}/import/preview`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to parse CSV');
      }

      const data = await res.json();
      setCsvHeaders(data.headers);
      setPreviewRows(data.preview);
      setRowCount(data.rowCount);

      // Auto-match headers
      const autoMapped = autoMatch(data.headers, templateFields);
      setHeaderMap(autoMapped);

      setStep(1);
    } catch (err) {
      setError(err.message);
    }
  };

  // Step 1 → 2: Validate required mappings exist
  const handleConfirmHeaders = () => {
    const missing = templateFields
      .filter(f => f.required && !headerMap[f.key])
      .map(f => f.label);

    if (missing.length > 0) {
      setError(`Required mappings missing: ${missing.join(', ')}`);
      return;
    }
    setError('');
    setStep(2);
  };

  // Step 2 → 3: Run import
  const handleImport = async () => {
    setImporting(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('headerMap', JSON.stringify(headerMap));

      const token = localStorage.getItem('accessToken');
      const endpoint = importType === 'vendors' ? '/import/vendors' : '/import/cois';
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Import failed');
      }

      const data = await res.json();
      setResults(data);
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadTemplate = (type) => {
    const token = localStorage.getItem('accessToken');
    window.open(`${API_BASE}/import/template/${type}?token=${token}`, '_blank');
  };

  const canManage = user?.role === 'ADMIN' || user?.role === 'REVIEWER';
  if (!canManage) return <div className="text-center py-12 text-gray-500">Admin or Reviewer access required</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Bulk Import</h1>
      <p className="text-gray-500 text-sm mb-6">Import vendors and COIs from CSV files</p>

      {/* Import type toggle */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => handleTypeChange('vendors')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            importType === 'vendors' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}>
          Import Vendors
        </button>
        <button onClick={() => handleTypeChange('cois')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            importType === 'cois' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}>
          Import COIs
        </button>
      </div>

      <StepIndicator step={step} labels={['Upload CSV', 'Map Headers', 'Preview & Import', 'Results']} />

      {error && (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg mb-6 text-sm">{error}</div>
      )}

      {/* Step 0: Upload */}
      {step === 0 && (
        <div className="bg-white rounded-xl border p-6">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h2 className="text-lg font-semibold">Upload {importType === 'vendors' ? 'Vendor' : 'COI'} CSV</h2>
              <p className="text-sm text-gray-500 mt-1">
                {importType === 'vendors'
                  ? 'Required columns: name, email. Optional: phone, address.'
                  : 'Required column: vendor_email (must match existing vendor). All other coverage fields optional.'}
              </p>
            </div>
            <a href={`${API_BASE}/import/template/${importType}`}
              className="text-sm text-blue-600 hover:underline font-medium"
              download>
              Download Template
            </a>
          </div>

          {/* Template preview */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6 overflow-x-auto">
            <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Expected Template Format</p>
            <table className="text-xs">
              <thead>
                <tr>
                  {templateFields.map(f => (
                    <th key={f.key} className={`px-3 py-1.5 text-left whitespace-nowrap ${f.required ? 'text-gray-900 font-semibold' : 'text-gray-500 font-medium'}`}>
                      {f.key}{f.required ? ' *' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="text-gray-400">
                  {templateFields.map(f => (
                    <td key={f.key} className="px-3 py-1.5 whitespace-nowrap italic">
                      {importType === 'vendors'
                        ? { name: 'Acme Plumbing', email: 'billing@acme.com', phone: '555-0101', address: '123 Main St' }[f.key] || ''
                        : { vendor_email: 'billing@acme.com', gl_policy_number: 'GL-123', gl_coverage_amount: '1000000', gl_expiration_date: '2026-12-31' }[f.key] || '...'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="border-2 border-dashed rounded-xl p-8 text-center mb-4">
            <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files[0])}
              className="hidden" id="csv-upload" />
            <label htmlFor="csv-upload" className="cursor-pointer">
              {file ? (
                <div>
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-gray-500 mt-1">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div>
                  <svg className="w-10 h-10 text-gray-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-gray-600">Click to select CSV file</p>
                </div>
              )}
            </label>
          </div>

          <button onClick={handleFileUpload} disabled={!file}
            className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
            Parse &amp; Continue
          </button>
        </div>
      )}

      {/* Step 1: Map Headers */}
      {step === 1 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-semibold mb-2">Verify Header Mapping</h2>
          <p className="text-sm text-gray-500 mb-1">
            We detected <strong>{csvHeaders.length}</strong> columns and <strong>{rowCount}</strong> data rows.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            Match each required field to the correct column from your CSV. Auto-matched fields are pre-selected.
          </p>

          <div className="space-y-3 mb-6">
            {templateFields.map((field) => {
              const mapped = headerMap[field.key];
              const isMatched = !!mapped;
              return (
                <div key={field.key}
                  className={`flex items-center gap-4 p-3 rounded-lg border ${
                    field.required && !isMatched ? 'border-red-300 bg-red-50' :
                    isMatched ? 'border-green-200 bg-green-50' :
                    'border-gray-200'
                  }`}>
                  <div className="w-56 flex-shrink-0">
                    <span className="text-sm font-medium">{field.label}</span>
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                    <p className="text-xs text-gray-400">{field.key}</p>
                  </div>
                  <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                  <select
                    value={mapped || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setHeaderMap(prev => {
                        const next = { ...prev };
                        if (val) {
                          next[field.key] = val;
                        } else {
                          delete next[field.key];
                        }
                        return next;
                      });
                    }}
                    className={`flex-1 px-3 py-2 border rounded-lg text-sm ${
                      isMatched ? 'border-green-300' : field.required ? 'border-red-300' : ''
                    }`}
                  >
                    <option value="">-- Skip (don't import) --</option>
                    {csvHeaders.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  {isMatched && (
                    <span className="text-green-600 text-sm flex-shrink-0">Matched</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Show detected CSV headers for reference */}
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Your CSV Headers</p>
            <div className="flex flex-wrap gap-2">
              {csvHeaders.map(h => {
                const isUsed = Object.values(headerMap).includes(h);
                return (
                  <span key={h} className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                    isUsed ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'
                  }`}>
                    {h} {isUsed ? '\u2713' : ''}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => { setStep(0); setError(''); }}
              className="px-4 py-2 border rounded-lg text-sm">Back</button>
            <button onClick={handleConfirmHeaders}
              className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 font-medium">
              Confirm Mapping &amp; Preview
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Preview & Import */}
      {step === 2 && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-semibold mb-2">Preview Import</h2>
          <p className="text-sm text-gray-500 mb-4">
            Showing first {Math.min(5, previewRows.length)} of {rowCount} rows with your header mapping applied.
          </p>

          <div className="overflow-x-auto mb-6">
            <table className="text-sm w-full">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">#</th>
                  {templateFields.filter(f => headerMap[f.key]).map(f => (
                    <th key={f.key} className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                    {templateFields.filter(f => headerMap[f.key]).map(f => (
                      <td key={f.key} className="px-3 py-2 text-gray-700 whitespace-nowrap">
                        {row[headerMap[f.key]] || <span className="text-gray-300">empty</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <p className="text-sm text-blue-800">
              Ready to import <strong>{rowCount}</strong> {importType === 'vendors' ? 'vendor(s)' : 'COI(s)'}.
              {importType === 'vendors'
                ? ' Duplicates (same email) will be skipped.'
                : ' Vendor email must match an existing vendor in your organization.'}
            </p>
          </div>

          <div className="flex gap-3">
            <button onClick={() => { setStep(1); setError(''); }}
              className="px-4 py-2 border rounded-lg text-sm">Back</button>
            <button onClick={handleImport} disabled={importing}
              className="bg-green-600 text-white px-6 py-2.5 rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium">
              {importing ? 'Importing...' : `Import ${rowCount} ${importType === 'vendors' ? 'Vendor(s)' : 'COI(s)'}`}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Results */}
      {step === 3 && results && (
        <div className="bg-white rounded-xl border p-6">
          <h2 className="text-lg font-semibold mb-4">Import Complete</h2>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <p className="text-2xl font-bold text-green-700">{results.created}</p>
              <p className="text-sm text-green-600">Successfully imported</p>
            </div>
            <div className={`p-4 rounded-lg border ${results.skipped > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200'}`}>
              <p className={`text-2xl font-bold ${results.skipped > 0 ? 'text-yellow-700' : 'text-gray-400'}`}>{results.skipped}</p>
              <p className={`text-sm ${results.skipped > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>Skipped</p>
            </div>
          </div>

          {results.errors.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Skipped Rows</h3>
              <div className="bg-gray-50 rounded-lg border max-h-60 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">CSV Row</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.errors.map((err, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-4 py-2 text-gray-600">{err.row}</td>
                        <td className="px-4 py-2 text-gray-600">{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={reset}
              className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 font-medium">
              Import More
            </button>
            <a href={importType === 'vendors' ? '/vendors' : '/cois'}
              className="px-4 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-50">
              View {importType === 'vendors' ? 'Vendors' : 'COIs'}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
