import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../utils/api';
import PdfUploadZone from '../components/PdfUploadZone';

const API_BASE = '/api';

const VENDOR_TEMPLATE_FIELDS = [
  { key: 'name', label: 'Vendor Name', required: true },
  { key: 'contact_name', label: 'Contact Name', required: false },
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

function autoMatch(csvHeaders, templateFields) {
  const map = {};
  for (const field of templateFields) {
    let match = csvHeaders.find(h => h.toLowerCase() === field.key.toLowerCase());
    if (!match) {
      match = csvHeaders.find(h => h.toLowerCase() === field.label.toLowerCase());
    }
    if (!match) {
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
    <div className="flex items-center mb-7 overflow-x-auto">
      {labels.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} className="flex items-center gap-2.5 flex-1 min-w-fit">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-none border
                ${done || active ? 'bg-navy text-white border-navy' : 'bg-white text-muted border-line-strong'}`}
            >
              {done ? '\u2713' : i + 1}
            </span>
            <span className={`text-[13px] whitespace-nowrap ${active ? 'font-bold text-navy' : 'font-medium text-muted'}`}>
              {label}
            </span>
            {i < labels.length - 1 && <span className="flex-1 h-px bg-line mx-2.5 min-w-[20px]" />}
          </div>
        );
      })}
    </div>
  );
}

function PdfStatusBadge({ status, error: errorMsg }) {
  if (status === 'pending') return <span className="text-xs text-faint bg-warm px-2 py-1 rounded">Pending</span>;
  if (status === 'processing') return <span className="text-xs text-navy bg-info-bg px-2 py-1 rounded animate-pulse">Processing...</span>;
  if (status === 'success') return <span className="text-xs text-ok-text bg-ok-bg px-2 py-1 rounded">Success</span>;
  if (status === 'error') return <span className="text-xs text-bad-text bg-bad-bg px-2 py-1 rounded" title={errorMsg}>Failed</span>;
  return null;
}

export default function Import() {
  const { user } = useAuth();
  const [importType, setImportType] = useState('vendors');
  const [step, setStep] = useState(0);
  const [requestAfterImport, setRequestAfterImport] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [requestSummary, setRequestSummary] = useState(null);
  const [file, setFile] = useState(null);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [rowCount, setRowCount] = useState(0);
  const [headerMap, setHeaderMap] = useState({});
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [runComplianceCheck, setRunComplianceCheck] = useState(true);

  const [vendors, setVendors] = useState([]);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [pdfFiles, setPdfFiles] = useState([]);
  const [processingPdfs, setProcessingPdfs] = useState(false);
  const [pdfResults, setPdfResults] = useState(null);

  const templateFields = importType === 'vendors' ? VENDOR_TEMPLATE_FIELDS : COI_TEMPLATE_FIELDS;

  useEffect(() => {
    if (importType === 'coi-pdfs') {
      api.get('/vendors').then(setVendors).catch(() => {});
    }
  }, [importType]);

  const reset = () => {
    setStep(0);
    setFile(null);
    setCsvHeaders([]);
    setPreviewRows([]);
    setRowCount(0);
    setHeaderMap({});
    setResults(null);
    setError('');
    setRunComplianceCheck(true);
    setSelectedVendorId('');
    setPdfFiles([]);
    setPdfResults(null);
  };

  const handleTypeChange = (type) => {
    setImportType(type);
    reset();
  };

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

      const autoMapped = autoMatch(data.headers, templateFields);
      setHeaderMap(autoMapped);

      setStep(1);
    } catch (err) {
      setError(err.message);
    }
  };

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

  const requestCertificates = async () => {
    setRequesting(true);
    const tally = { sent: 0, skipped: 0, badEmail: 0, failed: 0 };
    try {
      const vendors = await api.get('/vendors?status=NO_COI');
      for (const v of vendors) {
        try {
          await api.post(`/vendors/${v.id}/request-coi`);
          tally.sent++;
        } catch (err) {
          const reason = (err.message || '').toLowerCase();
          if (reason.includes('recently')) tally.skipped++;
          else if (reason.includes('deliverable')) tally.badEmail++;
          else tally.failed++;
        }
      }
      const parts = [`${tally.sent} request${tally.sent === 1 ? '' : 's'} sent`];
      if (tally.skipped) parts.push(`${tally.skipped} already asked today`);
      if (tally.badEmail) parts.push(`${tally.badEmail} had no usable email`);
      if (tally.failed) parts.push(`${tally.failed} failed`);
      setRequestSummary(parts.join(' · '));
    } catch (err) {
      setRequestSummary(`Couldn't send requests: ${err.message}`);
    } finally {
      setRequesting(false);
    }
  };

  const handleImport = async () => {
    setImporting(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('headerMap', JSON.stringify(headerMap));
      if (importType === 'cois') {
        formData.append('runComplianceCheck', runComplianceCheck.toString());
      }

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
    window.location.href = `${API_BASE}/import/template/${type}`;
  };

  const handlePdfFilesSelected = (newFiles) => {
    const entries = newFiles.map(f => ({
      file: f,
      status: 'pending',
      error: null,
      coiId: null,
    }));
    setPdfFiles(prev => [...prev, ...entries]);
  };

  const handleRemovePdf = (index) => {
    setPdfFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleProcessPdfs = async () => {
    if (!selectedVendorId) {
      setError('Please select a vendor before processing.');
      return;
    }

    setError('');
    setProcessingPdfs(true);
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < pdfFiles.length; i++) {
      if (pdfFiles[i].status !== 'pending') continue;

      setPdfFiles(prev => prev.map((p, j) => j === i ? { ...p, status: 'processing' } : p));

      try {
        const formData = new FormData();
        formData.append('pdf', pdfFiles[i].file);

        const result = await api.upload(`/vendors/${selectedVendorId}/coi/upload`, formData);

        setPdfFiles(prev => prev.map((p, j) =>
          j === i ? { ...p, status: 'success', coiId: result.coiId } : p
        ));
        successCount++;
      } catch (err) {
        setPdfFiles(prev => prev.map((p, j) =>
          j === i ? { ...p, status: 'error', error: err.message } : p
        ));
        failedCount++;
      }
    }

    setPdfResults({ success: successCount, failed: failedCount });
    setProcessingPdfs(false);
  };

  const canManage = user?.role === 'ADMIN' || user?.role === 'REVIEWER';
  if (!canManage) return <div className="text-center py-12 text-muted">Admin or Reviewer access required</div>;

  const isCsvImport = importType === 'vendors' || importType === 'cois';

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Bulk Import</h1>
      <p className="text-muted text-sm mb-6">Import vendors and COIs from CSV or PDF files</p>

      {/* Import type toggle */}
      <div className="flex flex-col sm:flex-row gap-2 mb-6">
        <button onClick={() => handleTypeChange('vendors')}
          className={`px-4 py-2.5 sm:py-2 rounded-control text-sm font-medium transition-colors ${
            importType === 'vendors' ? 'bg-amber text-white' : 'bg-warm text-ink-2 hover:bg-line'
          }`}>
          Import Vendors
        </button>
        <button onClick={() => handleTypeChange('cois')}
          className={`px-4 py-2.5 sm:py-2 rounded-control text-sm font-medium transition-colors ${
            importType === 'cois' ? 'bg-amber text-white' : 'bg-warm text-ink-2 hover:bg-line'
          }`}>
          Import COIs (CSV)
        </button>
        <button onClick={() => handleTypeChange('coi-pdfs')}
          className={`px-4 py-2.5 sm:py-2 rounded-control text-sm font-medium transition-colors ${
            importType === 'coi-pdfs' ? 'bg-amber text-white' : 'bg-warm text-ink-2 hover:bg-line'
          }`}>
          Import COI PDFs
        </button>
      </div>

      {/* CSV Import Flow */}
      {isCsvImport && (
        <>
          <StepIndicator step={step} labels={['Upload', 'Match columns', 'Review', 'Request certificates']} />

          {error && (
            <div className="bg-bad-bg text-bad-text px-4 py-3 rounded-control mb-6 text-sm">{error}</div>
          )}

          {/* Step 0: Upload */}
          {step === 0 && (
            <div className="bg-white rounded-card border p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-6">
                <div>
                  <h2 className="text-lg font-semibold">Upload {importType === 'vendors' ? 'Vendor' : 'COI'} CSV</h2>
                  <p className="text-sm text-muted mt-1">
                    {importType === 'vendors'
                      ? 'Required columns: name, email. Optional: phone, address.'
                      : 'Required column: vendor_email (must match existing vendor). All other coverage fields optional.'}
                  </p>
                </div>
                <button onClick={() => handleDownloadTemplate(importType)}
                  className="text-sm text-navy hover:underline font-medium whitespace-nowrap py-1">
                  Download Template
                </button>
              </div>

              {/* Template preview */}
              <div className="bg-card-alt rounded-control p-4 mb-6 overflow-x-auto">
                <p className="text-xs font-medium text-muted mb-2 uppercase tracking-wide">Expected Template Format</p>
                <table className="text-xs">
                  <thead>
                    <tr>
                      {templateFields.map(f => (
                        <th key={f.key} className={`px-3 py-1.5 text-left whitespace-nowrap ${f.required ? 'text-ink font-semibold' : 'text-muted font-medium'}`}>
                          {f.key}{f.required ? ' *' : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="text-faint">
                      {templateFields.map(f => (
                        <td key={f.key} className="px-3 py-1.5 whitespace-nowrap italic">
                          {importType === 'vendors'
                            ? { name: 'Acme Plumbing', contact_name: 'John Doe', email: 'billing@acme.com', phone: '555-0101', address: '123 Main St' }[f.key] || ''
                            : { vendor_email: 'billing@acme.com', gl_policy_number: 'GL-123', gl_coverage_amount: '1000000', gl_expiration_date: '2026-12-31' }[f.key] || '...'}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              <PdfUploadZone
                key={importType}
                accept=".csv"
                maxSizeMB={5}
                label="Drag and drop your CSV here"
                sublabel="or click to select a file"
                sizeLabel="Max 5MB, CSV only"
                onFileSelect={(selectedFile) => setFile(selectedFile)}
              />

              <button onClick={handleFileUpload} disabled={!file}
                className="mt-4 w-full sm:w-auto bg-amber text-white px-6 py-2.5 rounded-control hover:bg-amber-hover disabled:opacity-50 font-medium">
                Parse &amp; Continue
              </button>
            </div>
          )}

          {/* Step 1: Map Headers */}
          {step === 1 && (
            <div className="bg-white rounded-card border p-4 sm:p-6">
              <h2 className="text-lg font-semibold mb-2">Verify Header Mapping</h2>
              <p className="text-sm text-muted mb-1">
                We detected <strong>{csvHeaders.length}</strong> columns and <strong>{rowCount}</strong> data rows.
              </p>
              <p className="text-sm text-muted mb-6">
                Match each required field to the correct column from your CSV.
              </p>

              <div className="space-y-3 mb-6">
                {templateFields.map((field) => {
                  const mapped = headerMap[field.key];
                  const isMatched = !!mapped;
                  return (
                    <div key={field.key}
                      className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-3 rounded-control border ${
                        field.required && !isMatched ? 'border-bad-line bg-bad-bg' :
                        isMatched ? 'border-ok bg-ok-bg' :
                        'border-line'
                      }`}>
                      <div className="sm:w-48 flex-shrink-0">
                        <span className="text-sm font-medium">{field.label}</span>
                        {field.required && <span className="text-bad-text ml-1">*</span>}
                        <p className="text-xs text-faint">{field.key}</p>
                      </div>
                      <svg className="w-5 h-5 text-faint flex-shrink-0 hidden sm:block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                        className={`flex-1 px-3 py-2.5 sm:py-2 border rounded-control text-base sm:text-sm ${
                          isMatched ? 'border-green-300' : field.required ? 'border-bad-line' : ''
                        }`}
                      >
                        <option value="">-- Skip (don't import) --</option>
                        {csvHeaders.map(h => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                      {isMatched && (
                        <span className="text-ok-text text-sm flex-shrink-0">Matched</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* CSV headers reference */}
              <div className="bg-card-alt rounded-control p-4 mb-6">
                <p className="text-xs font-medium text-muted mb-2 uppercase tracking-wide">Your CSV Headers</p>
                <div className="flex flex-wrap gap-2">
                  {csvHeaders.map(h => {
                    const isUsed = Object.values(headerMap).includes(h);
                    return (
                      <span key={h} className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        isUsed ? 'bg-ok-bg text-ok-text' : 'bg-line text-muted'
                      }`}>
                        {h} {isUsed ? '\u2713' : ''}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={() => { setStep(0); setError(''); }}
                  className="px-4 py-2.5 border rounded-control text-sm order-2 sm:order-1">Back</button>
                <button onClick={handleConfirmHeaders}
                  className="bg-amber text-white px-6 py-2.5 rounded-control hover:bg-amber-hover font-medium order-1 sm:order-2">
                  Confirm Mapping &amp; Preview
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Preview & Import */}
          {step === 2 && (
            <div className="bg-white rounded-card border p-4 sm:p-6">
              <h2 className="text-lg font-semibold mb-2">Preview Import</h2>
              <p className="text-sm text-muted mb-4">
                Showing first {Math.min(5, previewRows.length)} of {rowCount} rows with your header mapping applied.
              </p>

              <div className="overflow-x-auto mb-6">
                <table className="text-sm w-full">
                  <thead>
                    <tr className="bg-card-alt border-b">
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted">#</th>
                      {templateFields.filter(f => headerMap[f.key]).map(f => (
                        <th key={f.key} className="px-3 py-2 text-left text-xs font-medium text-muted whitespace-nowrap">
                          {f.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-3 py-2 text-faint">{i + 1}</td>
                        {templateFields.filter(f => headerMap[f.key]).map(f => (
                          <td key={f.key} className="px-3 py-2 text-ink-2 whitespace-nowrap">
                            {row[headerMap[f.key]] || <span className="text-faint">empty</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-info-bg border border-line rounded-control p-4 mb-6">
                <p className="text-sm text-info-text">
                  Ready to import <strong>{rowCount}</strong> {importType === 'vendors' ? 'vendor(s)' : 'COI(s)'}.
                  {importType === 'vendors'
                    ? ' Duplicates (same email) will be skipped.'
                    : ' Vendor email must match an existing vendor in your organization.'}
                </p>
              </div>

              {importType === 'cois' && (
                <label className="flex items-start gap-3 mb-6 p-4 bg-white border rounded-control cursor-pointer hover:bg-card-alt">
                  <input type="checkbox" checked={runComplianceCheck}
                    onChange={(e) => setRunComplianceCheck(e.target.checked)}
                    className="rounded w-5 h-5 text-navy mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-sm font-medium text-ink">Run compliance check during import</span>
                    <p className="text-xs text-muted mt-0.5">
                      Each COI will be checked against your organization's minimum coverage requirements.
                    </p>
                  </div>
                </label>
              )}

              {importType === 'vendors' && (
                <label className="flex items-start gap-3 mb-6 p-4 bg-card-alt border border-line rounded-control cursor-pointer">
                  <input type="checkbox" checked={requestAfterImport}
                    onChange={(e) => setRequestAfterImport(e.target.checked)}
                    className="rounded-chip w-4 h-4 mt-0.5 flex-shrink-0 accent-navy" />
                  <div>
                    <span className="text-sm font-medium text-ink">
                      After import, email all {rowCount} vendors a certificate request
                    </span>
                    <p className="text-xs text-muted mt-0.5">
                      Vendors with no usable email address are skipped and flagged for you.
                    </p>
                  </div>
                </label>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={() => { setStep(1); setError(''); }}
                  className="px-4 py-2.5 border border-line-strong rounded-control text-[13px] font-semibold text-navy order-2 sm:order-1">Back</button>
                <button onClick={handleImport} disabled={importing}
                  className="bg-amber text-white px-6 py-2.5 rounded-control hover:bg-amber-hover disabled:opacity-50 text-[13px] font-semibold order-1 sm:order-2">
                  {importing ? 'Importing...' : `Import ${rowCount} ${importType === 'vendors' ? 'vendors' : 'COIs'}`}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Results */}
          {step === 3 && results && (
            <div className="bg-white rounded-card border border-line p-4 sm:p-6">
              <h2 className="text-lg font-bold text-navy mb-4">Import complete</h2>

              <div className={`grid gap-4 mb-6 grid-cols-2 ${results.flagged > 0 ? 'sm:grid-cols-3' : ''}`}>
                <div className="bg-ok-bg p-4 rounded-control border border-ok">
                  <p className="text-2xl font-bold text-ok-text">{results.created}</p>
                  <p className="text-sm text-ok-text">Imported</p>
                </div>
                <div className={`p-4 rounded-control border ${results.skipped > 0 ? 'bg-warn-bg border-amber' : 'bg-card-alt border-line'}`}>
                  <p className={`text-2xl font-bold ${results.skipped > 0 ? 'text-warn-text' : 'text-faint'}`}>{results.skipped}</p>
                  <p className={`text-sm ${results.skipped > 0 ? 'text-yellow-600' : 'text-faint'}`}>Skipped</p>
                </div>
                {results.flagged > 0 && (
                  <div className="bg-orange-50 p-4 rounded-control border border-orange-200 col-span-2 sm:col-span-1">
                    <p className="text-2xl font-bold text-orange-700">{results.flagged}</p>
                    <p className="text-sm text-orange-600">Flagged</p>
                  </div>
                )}
              </div>

              {importType === 'vendors' && requestAfterImport && results.created > 0 && (
                <div className="mb-6 p-4 bg-card-alt border border-line rounded-control flex flex-col gap-2.5">
                  {requestSummary ? (
                    <span className="text-[13px] text-ink">{requestSummary}</span>
                  ) : (
                    <>
                      <span className="text-[13px] text-ink">
                        Ask the {results.created} imported vendors for a certificate now?
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={requestCertificates}
                          disabled={requesting}
                          className="bg-amber text-white px-4 py-2 rounded-control hover:bg-amber-hover disabled:opacity-50 text-[13px] font-semibold"
                        >
                          {requesting ? 'Sending…' : `Request from ${results.created} vendors`}
                        </button>
                        <button
                          onClick={() => setRequestSummary('Skipped — you can request certificates any time from the Vendors page.')}
                          className="px-4 py-2 border border-line-strong rounded-control text-[13px] font-semibold text-navy"
                        >
                          Not now
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {results.errors.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-ink-2 mb-2">Skipped Rows</h3>
                  <div className="bg-card-alt rounded-control border max-h-60 overflow-y-auto overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left px-4 py-2 text-xs font-medium text-muted">Row</th>
                          <th className="text-left px-4 py-2 text-xs font-medium text-muted">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.errors.map((err, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="px-4 py-2 text-muted">{err.row}</td>
                            <td className="px-4 py-2 text-muted">{err.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={reset}
                  className="bg-amber text-white px-6 py-2.5 rounded-control hover:bg-amber-hover font-medium">
                  Import More
                </button>
                <a href={importType === 'vendors' ? '/vendors' : '/cois'}
                  className="px-4 py-2.5 border rounded-control text-sm font-medium hover:bg-card-alt text-center">
                  View {importType === 'vendors' ? 'Vendors' : 'COIs'}
                </a>
              </div>
            </div>
          )}
        </>
      )}

      {/* COI PDF Bulk Import Flow */}
      {importType === 'coi-pdfs' && (
        <div className="bg-white rounded-card border p-4 sm:p-6">
          {error && (
            <div className="bg-bad-bg text-bad-text px-4 py-3 rounded-control mb-6 text-sm">{error}</div>
          )}

          <h2 className="text-lg font-semibold mb-2">Upload COI PDFs</h2>
          <p className="text-sm text-muted mb-6">
            Select a vendor, then drop one or more PDF files.
          </p>

          {/* Vendor selector */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-ink-2 mb-2">Vendor</label>
            <select
              value={selectedVendorId}
              onChange={(e) => setSelectedVendorId(e.target.value)}
              className={`w-full px-3 py-2.5 border rounded-control text-base sm:text-sm ${
                !selectedVendorId ? 'border-line-strong' : 'border-green-300 bg-ok-bg'
              }`}
              disabled={processingPdfs}
            >
              <option value="">-- Select a vendor --</option>
              {vendors.map(v => (
                <option key={v.id} value={v.id}>{v.name} ({v.email})</option>
              ))}
            </select>
          </div>

          {/* Drop zone */}
          <div className={!selectedVendorId ? 'opacity-50 pointer-events-none' : ''}>
            <PdfUploadZone
              accept=".pdf"
              multiple
              maxSizeMB={10}
              label="Drag and drop COI PDFs here"
              sublabel="or click to browse files"
              sizeLabel="Max 10MB per file, PDF only"
              onFileSelect={handlePdfFilesSelected}
            />
          </div>
          {!selectedVendorId && (
            <p className="text-xs text-faint mt-1">Select a vendor above to enable file upload.</p>
          )}

          {/* File list */}
          {pdfFiles.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-ink-2 mb-3">
                {pdfFiles.length} file(s) queued
              </h3>
              <div className="space-y-2">
                {pdfFiles.map((pf, i) => (
                  <div key={i} className={`flex items-center gap-3 sm:gap-4 px-3 sm:px-4 py-3 rounded-control border ${
                    pf.status === 'success' ? 'border-ok bg-ok-bg' :
                    pf.status === 'error' ? 'border-bad-line bg-bad-bg' :
                    pf.status === 'processing' ? 'border-line bg-info-bg' :
                    'border-line'
                  }`}>
                    <svg className="w-5 h-5 text-faint flex-shrink-0 hidden sm:block" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink-2 truncate">{pf.file.name}</p>
                      <p className="text-xs text-faint">{(pf.file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>

                    <PdfStatusBadge status={pf.status} error={pf.error} />

                    {pf.status === 'error' && pf.error && (
                      <span className="text-xs text-bad-text max-w-[120px] sm:max-w-[200px] truncate hidden sm:inline" title={pf.error}>{pf.error}</span>
                    )}

                    {pf.status === 'success' && pf.coiId && (
                      <a href={`/cois/${pf.coiId}`} className="text-xs text-navy hover:underline flex-shrink-0">
                        View COI
                      </a>
                    )}

                    {pf.status === 'pending' && (
                      <button onClick={() => handleRemovePdf(i)} className="text-faint hover:text-bad-text flex-shrink-0 p-1">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Summary */}
              {pdfResults && (
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div className="bg-ok-bg p-4 rounded-control border border-ok">
                    <p className="text-2xl font-bold text-ok-text">{pdfResults.success}</p>
                    <p className="text-sm text-ok-text">Processed</p>
                  </div>
                  <div className={`p-4 rounded-control border ${pdfResults.failed > 0 ? 'bg-bad-bg border-bad-line' : 'bg-card-alt border-line'}`}>
                    <p className={`text-2xl font-bold ${pdfResults.failed > 0 ? 'text-bad-text' : 'text-faint'}`}>{pdfResults.failed}</p>
                    <p className={`text-sm ${pdfResults.failed > 0 ? 'text-bad-text' : 'text-faint'}`}>Failed</p>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-col sm:flex-row gap-3 mt-4">
                {pdfFiles.some(pf => pf.status === 'pending') && (
                  <button
                    onClick={handleProcessPdfs}
                    disabled={processingPdfs}
                    className="bg-ok text-white px-6 py-2.5 rounded-control hover:bg-ok-text disabled:opacity-50 font-medium"
                  >
                    {processingPdfs ? 'Processing...' : `Process ${pdfFiles.filter(pf => pf.status === 'pending').length} PDF(s)`}
                  </button>
                )}
                {pdfResults && (
                  <>
                    <button onClick={reset}
                      className="bg-amber text-white px-6 py-2.5 rounded-control hover:bg-amber-hover font-medium">
                      Import More
                    </button>
                    <a href="/cois"
                      className="px-4 py-2.5 border rounded-control text-sm font-medium hover:bg-card-alt text-center">
                      View COIs
                    </a>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
