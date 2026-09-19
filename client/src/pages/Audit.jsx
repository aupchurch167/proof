import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, API_BASE } from '../utils/api';
import { useToast } from '../contexts/ToastContext';
import { Button, Card, Chip, Input, PageTitle, StatusPill, Eyebrow, Toggle } from '../components/ui';

const RANGES = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['all', 'All time']];
const ACTORS = ['Anyone', 'Team', 'Proof (automatic)', 'Vendors'];
const COV_TYPES = [['all', 'All coverage'], ['gl', 'GL'], ['auto', 'Auto'], ['wc', 'WC'], ['umb', 'Umbrella']];

const iso = (d) => d.toISOString().slice(0, 10);
const longDate = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const shortDate = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

const SEG_COLOR = { covered: '#1a8a5a', gap: '#c0392b', inactive: '#e0dbd2' };

// The coverage bar: one flex segment per interval, sized by its share of the
// window so the bar reads as a proportional calendar.
function CoverageBar({ segments }) {
  return (
    <div className="flex h-2.5 rounded-[5px] overflow-hidden bg-none-chip-bg gap-px">
      {segments.map((s, i) => (
        <span
          key={i}
          title={`${shortDate(s.from)} – ${shortDate(s.to)} · ${s.state === 'inactive' ? 'not active' : s.state}`}
          style={{ flex: s.fraction, background: SEG_COLOR[s.state] }}
        />
      ))}
    </div>
  );
}

function CoveragePanel({ onClose }) {
  const [searchParams] = useSearchParams();
  const toast = useToast();

  const today = iso(new Date());
  const yearStart = `${new Date().getFullYear()}-01-01`;

  const [from, setFrom] = useState(searchParams.get('from') || yearStart);
  const [to, setTo] = useState(searchParams.get('to') || today);
  const [type, setType] = useState('all');
  const [showGaps, setShowGaps] = useState(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!from || !to || to <= from) { setData(null); setLoading(false); return; }
    setLoading(true);
    api.get(`/reports/coverage?from=${from}&to=${to}&type=${type}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [from, to, type]);

  const presets = [
    ['Year to date', yearStart, today],
    ['Q2', `${new Date().getFullYear()}-04-01`, `${new Date().getFullYear()}-06-30`],
    ['Q3', `${new Date().getFullYear()}-07-01`, `${new Date().getFullYear()}-09-30`],
    ['12 months', iso(new Date(Date.now() - 365 * 86400000)), today],
  ];

  const rows = data ? (showGaps ? data.rows : data.rows.filter((r) => r.full)) : [];

  const exportCsv = () => {
    if (!data) return;
    const header = 'Vendor,Trade,Active days,Gap days,Result\n';
    const body = rows
      .map((r) => `"${r.name}","${r.trade || ''}",${r.activeDays},${r.gapDays},"${r.full ? 'Full coverage' : `${r.gapDays}d gap`}"`)
      .join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `coverage-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-[22px] py-4 border-b border-line-divider flex justify-between items-center gap-4">
        <div className="flex flex-col gap-0.5">
          <Eyebrow tone="amber" dot>Insurance audit</Eyebrow>
          <span className="text-base font-bold text-navy">Who was covered during the audit period</span>
        </div>
        <button onClick={onClose} className="px-2 py-1 text-[13px] font-semibold text-muted hover:text-navy">Close</button>
      </div>

      <div className="px-[22px] py-4 flex gap-5 items-end flex-wrap border-b border-line-divider bg-card-alt">
        <div className="flex gap-2.5 items-end">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Period start</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-[150px] px-3 py-2 rounded-control border border-line-strong text-[13px] bg-white focus:outline-none focus:border-navy"
            />
          </div>
          <span className="pb-[9px] text-faint">–</span>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Period end</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-[150px] px-3 py-2 rounded-control border border-line-strong text-[13px] bg-white focus:outline-none focus:border-navy"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Presets</span>
          <div className="flex gap-1.5 flex-wrap">
            {presets.map(([label, f, t]) => (
              <Chip key={label} size="sm" active={from === f && to === t} onClick={() => { setFrom(f); setTo(t); }}>
                {label}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 border-b border-line-divider">
        {[
          ['Days in period', data?.days ?? '—', 'text-navy'],
          ['Vendors active', rows.length, 'text-navy'],
          ['Covered every day', data?.fullCoverage ?? '—', 'text-ok'],
          showGaps
            ? ['With a gap', data?.withGap ?? '—', 'text-bad']
            : ['Excluded from packet', data?.withGap ?? '—', 'text-faint'],
        ].map(([label, value, color], i) => (
          <div key={label} className={`flex flex-col gap-1 px-[18px] py-3.5 ${i < 3 ? 'border-r border-line-divider' : ''}`}>
            <span className={`text-2xl font-extrabold tracking-[-0.02em] leading-none ${color}`}>{value}</span>
            <span className={`text-[11px] font-bold uppercase tracking-[0.06em] ${label === 'Excluded from packet' ? 'text-faint' : 'text-muted'}`}>
              {label}
            </span>
          </div>
        ))}
      </div>

      <div className="px-[22px] py-3 flex justify-between items-center gap-4 border-b border-line-divider flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted">Coverage</span>
          <div className="flex gap-1">
            {COV_TYPES.map(([key, label]) => (
              <Chip key={key} size="sm" active={type === key} onClick={() => setType(key)}>{label}</Chip>
            ))}
          </div>
        </div>
        <div className="flex gap-3.5 text-xs text-muted items-center">
          {[['Covered', '#1a8a5a'], ...(showGaps ? [['Gap', '#c0392b']] : []), ['Not active', '#e0dbd2']].map(([label, bg]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: bg }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[200px_minmax(0,1fr)_120px] gap-5 px-[22px] py-2 bg-card-alt border-b border-line-divider text-[11px] font-bold uppercase tracking-[0.06em] text-muted">
        <span>Vendor</span>
        <div className="flex justify-between whitespace-nowrap">
          <span>{longDate(from)}</span>
          <span>{longDate(to)}</span>
        </div>
        <span className="text-right">Result</span>
      </div>

      {loading ? (
        <p className="px-[22px] py-10 text-center text-[13px] text-muted">Working out who was covered…</p>
      ) : rows.length === 0 ? (
        <p className="px-[22px] py-10 text-center text-[13px] text-muted">
          {!data ? 'Pick a valid start and end date.' : 'No vendors were active in this period.'}
        </p>
      ) : (
        rows.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[200px_minmax(0,1fr)_120px] gap-5 items-center px-[22px] py-3
              border-b border-line-divider last:border-0 text-[13px] hover:bg-card-alt transition-colors duration-150"
          >
            <div className="flex flex-col gap-px min-w-0">
              <Link to={`/vendors/${r.id}`} className="text-sm font-semibold text-navy hover:text-amber truncate">
                {r.name}
              </Link>
              <span className="text-xs text-muted truncate">{r.trade || '—'}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <CoverageBar segments={r.segments} />
              <span className="text-[11px] text-muted">
                {r.full
                  ? `Covered all ${r.activeDays} active days`
                  : `${r.gapDays} day gap · ${shortDate(r.firstGap?.from)} – ${shortDate(r.firstGap?.to)}`}
              </span>
            </div>
            <div className="flex justify-end">
              <StatusPill tone={r.full ? 'ok' : 'bad'}>{r.full ? 'Full coverage' : `${r.gapDays}d gap`}</StatusPill>
            </div>
          </div>
        ))
      )}

      <div className="px-[22px] py-3.5 flex justify-between items-center gap-4 bg-card-alt flex-wrap">
        <button
          onClick={() => setShowGaps(!showGaps)}
          className="flex items-center gap-2.5 text-[13px] font-semibold text-navy"
        >
          <Toggle size="sm" checked={showGaps} onChange={setShowGaps} label="Include vendors with gaps" />
          {showGaps ? 'Include vendors with gaps in packet' : 'Gaps hidden from packet'}
        </button>
        <div className="flex gap-2">
          <Button onClick={exportCsv} disabled={!data}>Coverage report (CSV)</Button>
          <Button
            variant="navy"
            disabled={!data || rows.length === 0}
            onClick={() => toast.info('The audit packet export needs the PDF merge endpoint wired to this date range')}
          >
            Export audit packet · {rows.length} vendors
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function Audit() {
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  const [showCoverage, setShowCoverage] = useState(searchParams.get('coverage') === '1');
  const [range, setRange] = useState('30');
  const [actor, setActor] = useState('Anyone');
  const [type, setType] = useState('All');
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ range, actor, type, search });
      setData(await api.get(`/audit?${params}`));
    } catch {
      toast.error("Couldn't load the audit log");
    } finally {
      setLoading(false);
    }
  }, [range, actor, type, search]);

  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const clearFilters = () => {
    setRange('30'); setActor('Anyone'); setType('All'); setSearch(''); setOpen(null);
  };

  const TYPE_TILES = ['All', ...(data?.types || [])];
  const ROW = 'grid grid-cols-[140px_110px_minmax(0,1fr)_150px_16px] gap-4';

  return (
    <div className="px-9 py-8 max-w-content w-full flex flex-col gap-6">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div className="flex flex-col gap-1.5">
          <PageTitle>Audit log</PageTitle>
          <span className="text-sm text-ink-2">
            Every certificate, reminder, and decision — timestamped and exportable.
          </span>
        </div>
        <div className="flex gap-2">
          <Button as="a" href={`${API_BASE}/reports/cois?format=csv`}>Export CSV</Button>
          <Button
            variant="amber"
            onClick={() => {
              const next = !showCoverage;
              setShowCoverage(next);
              const p = new URLSearchParams(searchParams);
              next ? p.set('coverage', '1') : p.delete('coverage');
              setSearchParams(p);
            }}
            className={showCoverage ? '!bg-amber-hover !border-amber-hover' : ''}
          >
            Coverage dates for audit
          </Button>
        </div>
      </div>

      {showCoverage && <CoveragePanel onClose={() => setShowCoverage(false)} />}

      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-center gap-4 flex-wrap">
          <div className="flex gap-4 items-center flex-wrap">
            <div className="flex gap-1">
              {RANGES.map(([key, label]) => (
                <Chip key={key} size="sm" active={range === key} onClick={() => { setRange(key); setOpen(null); }}>
                  {label}
                </Chip>
              ))}
            </div>
            <span className="w-px h-5 bg-line" />
            <div className="flex gap-1 flex-wrap">
              {ACTORS.map((a) => (
                <Chip key={a} size="sm" active={actor === a} onClick={() => { setActor(a); setOpen(null); }}>
                  {a}
                </Chip>
              ))}
            </div>
          </div>
          <Input
            placeholder="Search events…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOpen(null); }}
            className="w-[220px]"
          />
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {TYPE_TILES.map((t) => {
            const active = type === t;
            const count = data?.counts?.[t] ?? 0;
            return (
              <button
                key={t}
                onClick={() => { setType(t); setOpen(null); }}
                className={`flex flex-col gap-1.5 items-start px-3 py-[11px] rounded-[10px] border text-left
                  transition-colors duration-150
                  ${active ? 'border-navy bg-info-bg text-navy ring-2 ring-inset ring-navy' : 'border-line bg-white text-navy hover:border-navy'}`}
              >
                <span className="text-xl font-extrabold leading-none tracking-[-0.02em]">{count}</span>
                <span className="text-[11px] font-bold uppercase tracking-[0.05em] opacity-75">
                  {t === 'All' ? 'All events' : t}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className={`${ROW} px-5 py-2 bg-card-alt border-b border-line-divider text-[11px] font-bold uppercase tracking-[0.06em] text-muted`}>
          <span>When</span><span>Event</span><span>Detail</span><span>By</span><span />
        </div>

        {loading ? (
          <p className="px-5 py-9 text-center text-[13px] text-muted">Loading…</p>
        ) : (data?.events || []).length === 0 ? (
          <p className="px-5 py-9 text-center text-[13px] text-muted">
            No events match these filters.{' '}
            <button onClick={clearFilters} className="font-semibold text-navy hover:text-amber">Clear filters</button>
          </p>
        ) : (
          data.events.map((e) => {
            const isOpen = open === e.id;
            const fields = e.fields && typeof e.fields === 'object' ? Object.entries(e.fields) : [];
            return (
              <div key={e.id} className="border-b border-line-divider last:border-0">
                <button
                  onClick={() => setOpen(isOpen ? null : e.id)}
                  className={`${ROW} w-full items-center px-5 py-3 text-[13px] text-left hover:bg-card-alt transition-colors duration-150`}
                >
                  <span className="text-muted tabular whitespace-nowrap">
                    {new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <span><StatusPill tone={e.tone}>{e.type}</StatusPill></span>
                  <span className="text-ink truncate">{e.detail}</span>
                  <span className="text-muted truncate">{e.by}</span>
                  <span className="text-faint text-[11px] text-right">{isOpen ? '▴' : '▾'}</span>
                </button>

                {isOpen && (
                  <div className="grid grid-cols-[140px_minmax(0,1fr)_auto] gap-4 px-5 pt-1.5 pb-4 bg-card-alt border-t border-line-divider">
                    <span />
                    <div className="flex flex-col gap-2">
                      {fields.length === 0 ? (
                        <span className="text-xs text-muted">No further detail recorded.</span>
                      ) : (
                        fields.map(([k, v]) => (
                          <div key={k} className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 text-xs">
                            <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-muted pt-0.5">{k}</span>
                            <span className="text-ink leading-[1.5] break-words">
                              {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 items-end">
                      {e.entity === 'vendor' && e.entityId && (
                        <Button size="sm" as={Link} to={`/vendors/${e.entityId}`}>Open vendor →</Button>
                      )}
                      {e.entity === 'coi' && e.entityId && (
                        <Button size="sm" as={Link} to={`/cois/${e.entityId}`}>View certificate</Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}

        <div className="px-5 py-2.5 text-xs text-muted flex justify-between">
          <span>{data ? `${data.events.length} of ${data.total} events` : ''}</span>
          <span>Times shown in your local timezone</span>
        </div>
      </Card>
    </div>
  );
}
