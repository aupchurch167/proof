import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../contexts/ToastContext';
import { coiStatus } from '../constants/status';
import { Button, Card, Chip, Input, PageTitle, StatusPill, EmptyState } from '../components/ui';

const FILTERS = [
  { label: 'In review', status: 'PENDING_REVIEW' },
  { label: 'Active', status: 'APPROVED' },
  { label: 'Changes requested', status: 'REJECTED' },
  { label: 'All', status: '' },
];

const money = (cents) => (cents == null ? null : `$${Math.round(cents / 100).toLocaleString()}`);
const day = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

export default function Cois() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const [cois, setCois] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const status = searchParams.get('status') || 'PENDING_REVIEW';

  useEffect(() => {
    setLoading(true);
    api.get(`/cois${status ? `?status=${status}` : ''}`)
      .then(setCois)
      .catch(() => toast.error("Couldn't load certificates"))
      .finally(() => setLoading(false));
  }, [status]);

  const setStatus = (next) => {
    const p = new URLSearchParams(searchParams);
    next ? p.set('status', next) : p.delete('status');
    setSearchParams(p);
  };

  const q = search.trim().toLowerCase();
  const visible = q
    ? cois.filter((c) => (c.vendor?.name || '').toLowerCase().includes(q))
    : cois;

  const pending = status === 'PENDING_REVIEW';
  const ROW = 'grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3.5 items-center';

  return (
    <div className="px-9 py-8 max-w-content w-full flex flex-col gap-5">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div className="flex flex-col gap-1.5">
          <PageTitle count={visible.length}>Review queue</PageTitle>
          <span className="text-sm text-ink-2">
            Certificates Proof has read and checked. You decide what to do with them.
          </span>
        </div>
        {pending && visible.length > 0 && (
          <Button as={Link} to={`/cois/${visible[0].id}?queue=pending`} variant="amber">
            Start reviewing
          </Button>
        )}
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <Input placeholder="Search by vendor…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-60" />
        {FILTERS.map((f) => (
          <Chip key={f.label} active={status === f.status} onClick={() => setStatus(f.status)}>
            {f.label}
          </Chip>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className={`${ROW} px-5 py-2.5 bg-card-alt border-b border-line-divider text-[11px] font-bold uppercase tracking-[0.06em] text-muted`}>
          <span>Vendor</span><span>Uploaded</span><span>Coverage read</span><span>Soonest expiry</span><span>Status</span>
        </div>

        {loading ? (
          <EmptyState>Loading…</EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState>
            {pending ? 'Nothing waiting on review. You are all caught up.' : 'No certificates match these filters.'}
          </EmptyState>
        ) : (
          visible.map((coi) => {
            const s = coiStatus(coi.status);
            const soonest = [coi.glExpirationDate, coi.wcExpirationDate, coi.umbExpirationDate, coi.autoExpirationDate]
              .filter(Boolean).sort()[0];
            const read = [
              coi.glCoverageAmount && `GL ${money(coi.glCoverageAmount)}`,
              coi.autoCoverageAmount && `Auto ${money(coi.autoCoverageAmount)}`,
              coi.wcCoverageAmount && `WC ${money(coi.wcCoverageAmount)}`,
            ].filter(Boolean).join(' · ');
            const flagCount = Array.isArray(coi.complianceFlags) ? coi.complianceFlags.length : 0;

            return (
              <Link
                key={coi.id}
                to={`/cois/${coi.id}${coi.status === 'PENDING_REVIEW' ? '?queue=pending' : ''}`}
                className={`${ROW} px-5 py-[13px] border-b border-line-divider last:border-0 text-[13px]
                  hover:bg-card-alt transition-colors duration-150`}
              >
                <span className="text-sm font-semibold text-navy truncate">{coi.vendor?.name}</span>
                <span className="text-ink-2 tabular">{day(coi.submittedAt)}</span>
                <span className="text-ink-2 truncate" title={read}>
                  {read || <span className="text-faint">Not read yet</span>}
                </span>
                <span className="text-ink-2 tabular">{day(soonest)}</span>
                <div className="flex items-center gap-2 justify-end">
                  {flagCount > 0 && <StatusPill tone="bad">{flagCount} to fix</StatusPill>}
                  <StatusPill tone={s.tone}>{s.label}</StatusPill>
                </div>
              </Link>
            );
          })
        )}
      </Card>
    </div>
  );
}
