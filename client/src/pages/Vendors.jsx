import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useUsage } from '../contexts/UsageContext';
import DeleteConfirmationModal from '../components/DeleteConfirmationModal';
import EmailTagInput from '../components/EmailTagInput';
import { CANONICAL_TRADES } from '../constants/trades';
import { VENDOR_FILTERS, vendorStatus } from '../constants/status';
import {
  Button, Card, Chip, CoverageChip, Input, Select, StatusPill, PageTitle, Th, EmptyState,
} from '../components/ui';

function CoverageChips({ coverages }) {
  if (!coverages?.length) return <span className="text-xs text-faint">—</span>;
  return (
    <div className="flex gap-1 flex-wrap">
      {coverages.map((c) => (
        <CoverageChip
          key={c.key}
          tone={c.tone}
          title={
            c.verdict === 'skipped'
              ? `${c.label}: not required`
              : `${c.label}: ${c.verdict}${c.limit ? ` · $${c.limit.toLocaleString()}` : ''}${c.expiresAt ? ` · expires ${c.expiresAt}` : ''}`
          }
        >
          {c.chip}
        </CoverageChip>
      ))}
    </div>
  );
}

// Right-side drawer holding the same fields the inline form used to.
function AddVendorDrawer({ open, onClose, onCreated }) {
  const toast = useToast();
  const empty = { name: '', contactName: '', email: '', phone: '', address: '', trade: '', additionalEmails: [] };
  const [form, setForm] = useState(empty);
  const [w9File, setW9File] = useState(null);
  const [maFile, setMaFile] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setForm(empty); setW9File(null); setMaFile(null); setError(''); }
  }, [open]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.trade) delete payload.trade;
      if (!payload.additionalEmails?.length) delete payload.additionalEmails;
      const created = await api.post('/vendors', payload);
      if (w9File || maFile) {
        const fd = new FormData();
        if (w9File) fd.append('w9', w9File);
        if (maFile) fd.append('masterAgreement', maFile);
        await api.upload(`/vendors/${created.id}/documents`, fd);
      }
      toast.success(`${created.name} added`);
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const field = 'w-full px-3 py-2.5 rounded-control border border-line-strong bg-white text-[13px] focus:outline-none focus:border-navy';

  return (
    <>
      <div className="fixed inset-0 bg-navy-deep/40 z-40" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white border-l border-line flex flex-col shadow-2xl">
        <div className="px-6 py-5 border-b border-line flex items-center justify-between">
          <h2 className="text-base font-bold text-navy">Add vendor</h2>
          <button onClick={onClose} className="text-muted hover:text-navy p-1" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">
          {error && <div className="bg-bad-bg text-bad-text px-4 py-3 rounded-control text-[13px]">{error}</div>}

          {[
            { key: 'name', label: 'Name', required: true },
            { key: 'contactName', label: 'Contact name' },
            { key: 'email', label: 'Email', required: true, type: 'email' },
            { key: 'phone', label: 'Phone' },
            { key: 'address', label: 'Address' },
          ].map((f) => (
            <div key={f.key}>
              <label className="block text-[13px] font-semibold text-ink-2 mb-1">
                {f.label} {f.required && <span className="text-amber-text">*</span>}
              </label>
              <input
                type={f.type || 'text'}
                required={f.required}
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                className={field}
              />
            </div>
          ))}

          <div>
            <label className="block text-[13px] font-semibold text-ink-2 mb-1">Trade</label>
            <select value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} className={field}>
              <option value="">Select a trade…</option>
              {CANONICAL_TRADES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-[13px] font-semibold text-ink-2 mb-1">
              Additional emails <span className="text-faint font-normal">(CC on requests)</span>
            </label>
            <EmailTagInput
              value={form.additionalEmails}
              onChange={(emails) => setForm({ ...form, additionalEmails: emails })}
              placeholder="Add email addresses…"
            />
          </div>

          {[['w9', 'W-9', setW9File], ['ma', 'Master agreement', setMaFile]].map(([key, label, setter]) => (
            <div key={key}>
              <label className="block text-[13px] font-semibold text-ink-2 mb-1">
                {label} <span className="text-faint font-normal">(PDF or image)</span>
              </label>
              <input
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setter(e.target.files?.[0] || null)}
                className="w-full text-[13px] file:mr-3 file:py-2 file:px-3 file:rounded-control file:border file:border-line-strong file:bg-white file:text-[13px] file:cursor-pointer hover:file:bg-card-alt"
              />
            </div>
          ))}
        </form>

        <div className="px-6 py-4 border-t border-line bg-card-alt flex gap-2">
          <Button variant="amber" onClick={submit} disabled={saving} className="flex-1">
            {saving ? 'Saving…' : 'Add vendor'}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </aside>
    </>
  );
}

export default function Vendors() {
  const { user } = useAuth();
  const toast = useToast();
  const { refreshUsage } = useUsage();
  const [searchParams, setSearchParams] = useSearchParams();
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [applyUrl, setApplyUrl] = useState(null);
  const [search, setSearch] = useState('');
  const [tradeFilter, setTradeFilter] = useState(searchParams.get('trade') || '');
  const [selected, setSelected] = useState(new Set());
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [requestingBulk, setRequestingBulk] = useState(false);

  // The chip label is what lives in the URL; several DB statuses map to one chip.
  const statusParam = searchParams.get('status') || '';
  const activeFilter =
    VENDOR_FILTERS.find((f) => f.statuses?.includes(statusParam))?.label || 'All';

  useEffect(() => {
    api.get('/organization').then((org) => setApplyUrl(`${window.location.origin}/apply/${org.slug || org.id}`)).catch(() => {});
  }, []);

  const fetchVendors = async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (tradeFilter) params.set('trade', tradeFilter);
      setVendors(await api.get(`/vendors?${params}`));
    } catch (err) {
      toast.error("Couldn't load vendors");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchVendors(); }, [search, tradeFilter]);

  // Status is filtered client-side so switching chips is instant and the
  // coverage chips never flicker.
  const filter = VENDOR_FILTERS.find((f) => f.label === activeFilter);
  const visible = filter?.statuses ? vendors.filter((v) => filter.statuses.includes(v.coiStatus)) : vendors;

  const setStatusFilter = (label) => {
    const f = VENDOR_FILTERS.find((x) => x.label === label);
    const next = new URLSearchParams(searchParams);
    if (f?.statuses) next.set('status', f.statuses[0]);
    else next.delete('status');
    setSearchParams(next);
  };

  const canManage = ['ADMIN', 'MEMBER', 'REVIEWER'].includes(user?.role);
  const canDelete = ['ADMIN', 'MEMBER'].includes(user?.role);
  const allSelected = visible.length > 0 && visible.every((v) => selected.has(v.id));

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visible.map((v) => v.id)));
  const toggleOne = (id) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const handleRequestCoi = async (vendorId, force = false) => {
    try {
      await api.post(`/vendors/${vendorId}/request-coi`, force ? { force: true } : undefined);
      toast.success('COI request sent');
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('recently')) {
        if (window.confirm('A request went out in the last 24 hours. Send another anyway?')) {
          return handleRequestCoi(vendorId, true);
        }
      } else if (msg.includes('deliverable')) {
        toast.error('No deliverable email on file — fix the address first');
      } else {
        toast.error(`Couldn't send: ${err.message}`);
      }
    }
  };

  const handleBulkRequest = async () => {
    setRequestingBulk(true);
    const tally = { sent: 0, skipped: 0, badEmail: 0, failed: 0 };
    for (const id of selected) {
      try {
        await api.post(`/vendors/${id}/request-coi`);
        tally.sent++;
      } catch (err) {
        const reason = (err.message || '').toLowerCase();
        if (reason.includes('recently')) tally.skipped++;
        else if (reason.includes('deliverable')) tally.badEmail++;
        else tally.failed++;
      }
    }
    setRequestingBulk(false);
    const parts = [`${tally.sent} sent`];
    if (tally.skipped) parts.push(`${tally.skipped} already requested today`);
    if (tally.badEmail) parts.push(`${tally.badEmail} with no usable email`);
    if (tally.failed) parts.push(`${tally.failed} failed`);
    const msg = parts.join(' · ');
    if (tally.failed || tally.badEmail) toast.warning(msg);
    else toast.success(msg);
  };

  const handleBulkDelete = async () => {
    setDeleting(true);
    try {
      await api.delete('/vendors/bulk', { ids: [...selected] });
      setSelected(new Set());
      setShowDeleteModal(false);
      fetchVendors();
      refreshUsage();
    } finally {
      setDeleting(false);
    }
  };

  const GRID = 'grid grid-cols-[28px_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_auto] gap-3.5 items-center';

  return (
    <div className="px-9 py-8 max-w-content w-full flex flex-col gap-5">
      <div className="flex justify-between items-center gap-4 flex-wrap">
        <PageTitle count={vendors.length}>Vendors</PageTitle>
        <div className="flex gap-2 flex-wrap">
          {canManage && selected.size > 0 && (
            <Button onClick={handleBulkRequest} disabled={requestingBulk}>
              {requestingBulk ? 'Sending…' : `Request COI (${selected.size})`}
            </Button>
          )}
          {canDelete && selected.size > 0 && (
            <Button variant="danger" onClick={() => setShowDeleteModal(true)}>Delete ({selected.size})</Button>
          )}
          {canManage && (
            <>
              {applyUrl && (
                <Button
                  title={applyUrl}
                  onClick={() => {
                    navigator.clipboard.writeText(applyUrl);
                    toast.success('Application link copied');
                  }}
                >
                  Copy application link
                </Button>
              )}
              <Button as={Link} to="/import">Import</Button>
              <Button variant="amber" onClick={() => setShowAdd(true)}>Add vendor</Button>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <Input
          placeholder="Search vendors…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-60"
        />
        {VENDOR_FILTERS.map((f) => (
          <Chip key={f.label} active={activeFilter === f.label} onClick={() => setStatusFilter(f.label)}>
            {f.label}
          </Chip>
        ))}
        <Select
          value={tradeFilter}
          onChange={(e) => {
            setTradeFilter(e.target.value);
            const next = new URLSearchParams(searchParams);
            e.target.value ? next.set('trade', e.target.value) : next.delete('trade');
            setSearchParams(next);
          }}
          className="ml-auto"
        >
          <option value="">All trades</option>
          {CANONICAL_TRADES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
      </div>

      <Card className="overflow-hidden">
        <div className={`${GRID} px-5 py-2.5 bg-card-alt border-b border-line-divider text-[11px] font-bold uppercase tracking-[0.06em] text-muted`}>
          <span>
            {canDelete && (
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-3.5 h-3.5 rounded-chip border-line-strong cursor-pointer" />
            )}
          </span>
          <span>Vendor</span>
          <span>Trade</span>
          <span>Coverage</span>
          <span>Next expiry</span>
          <span>Status</span>
        </div>

        {loading ? (
          <EmptyState>Loading…</EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState action={canManage && <Button variant="amber" onClick={() => setShowAdd(true)}>Add vendor</Button>}>
            {vendors.length === 0 ? 'No vendors yet.' : 'No vendors match these filters.'}
          </EmptyState>
        ) : (
          visible.map((v) => {
            const status = vendorStatus(v.coiStatus);
            return (
              <div
                key={v.id}
                className={`${GRID} px-5 py-[13px] border-b border-line-divider last:border-0 text-[13px]
                  hover:bg-card-alt transition-colors duration-150 ${selected.has(v.id) ? 'bg-card-alt' : ''}`}
              >
                <span>
                  {canDelete && (
                    <input
                      type="checkbox"
                      checked={selected.has(v.id)}
                      onChange={() => toggleOne(v.id)}
                      className="w-3.5 h-3.5 rounded-chip border-line-strong cursor-pointer"
                    />
                  )}
                </span>
                <div className="flex flex-col gap-px min-w-0">
                  <Link to={`/vendors/${v.id}`} className="text-sm font-semibold text-navy hover:text-amber truncate">
                    {v.name}
                  </Link>
                  <span className="text-xs text-muted truncate" title={v.email}>{v.email}</span>
                </div>
                <span className="text-ink-2 truncate">{v.trade || '—'}</span>
                <CoverageChips coverages={v.coverages} />
                <span className="text-ink-2 tabular">
                  {v.nextExpiration
                    ? new Date(`${v.nextExpiration}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : '—'}
                </span>
                <div className="flex items-center gap-2 justify-end">
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  {canManage && (
                    <button
                      onClick={() => handleRequestCoi(v.id)}
                      className="text-xs font-semibold text-navy hover:text-amber whitespace-nowrap"
                    >
                      Request
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}

        <div className="px-5 py-3 text-xs text-muted flex justify-between gap-4 flex-wrap">
          <span>Showing {visible.length} of {vendors.length}</span>
          <span>
            Coverage chips: green = meets requirement · amber = expiring · red = missing or under limit · gray = not required
          </span>
        </div>
      </Card>

      <AddVendorDrawer
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreated={() => {
          fetchVendors();
          refreshUsage();
        }}
      />

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
