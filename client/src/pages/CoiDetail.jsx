import { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { COVERAGES } from '../constants/status';
import { Button, StatusPill, Eyebrow } from '../components/ui';

const VERDICT_TONE = { Meets: 'ok', Expiring: 'warn', 'Under limit': 'bad', Missing: 'bad', Expired: 'bad', 'Not required': 'none' };

const money = (cents) => (cents == null ? null : `$${Math.round(cents / 100).toLocaleString()}`);
const shortMoney = (cents) => {
  if (cents == null) return null;
  const d = Math.round(cents / 100);
  if (d >= 1000000) return `$${(d / 1000000).toString().replace(/\.0$/, '')}M`;
  if (d >= 1000) return `$${Math.round(d / 1000)}K`;
  return `$${d}`;
};
const day = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

// One coverage row in the read-out. Limits and dates are click-to-edit so a
// misread value can be corrected without leaving the screen.
function ExtractedRow({ line, coi, required, onSave, canEdit }) {
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');

  const amount = coi[`${line.key}CoverageAmount`];
  const expires = coi[`${line.key}ExpirationDate`];

  let verdict;
  if (!required) verdict = 'Not required';
  else if (amount == null && !expires) verdict = 'Missing';
  else if (expires && new Date(expires) < new Date()) verdict = 'Expired';
  else if (amount == null || amount < required) verdict = 'Under limit';
  else verdict = 'Meets';

  const begin = (field, value) => {
    if (!canEdit) return;
    setEditing(field);
    setDraft(field === 'amount' ? (amount == null ? '' : String(Math.round(amount / 100))) : (expires ? new Date(expires).toISOString().slice(0, 10) : ''));
  };

  const commit = async () => {
    const field = editing;
    setEditing(null);
    if (field === 'amount') {
      const dollars = Number(draft);
      if (draft !== '' && !Number.isFinite(dollars)) return;
      await onSave({ [`${line.key}CoverageAmount`]: draft === '' ? null : Math.round(dollars * 100) });
    } else {
      await onSave({ [`${line.key}ExpirationDate`]: draft || null });
    }
  };

  const cell = (label, node) => (
    <div className="flex flex-col gap-px min-w-0">
      <span className="text-faint text-[10px] uppercase tracking-[0.05em]">{label}</span>
      {node}
    </div>
  );

  const editable = 'text-ink font-semibold text-left hover:text-amber truncate';

  return (
    <div className="px-[22px] py-3.5 border-b border-line-divider flex flex-col gap-1.5">
      <div className="flex justify-between items-center gap-2.5">
        <span className="text-[13px] font-bold text-navy">{line.label}</span>
        <StatusPill tone={VERDICT_TONE[verdict]}>{verdict}</StatusPill>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {cell('Limit', editing === 'amount' ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null); }}
            className="w-full px-1 py-0.5 border border-amber rounded-chip text-xs bg-amber-bg focus:outline-none"
          />
        ) : (
          <button type="button" onClick={() => begin('amount')} className={editable} disabled={!canEdit}>
            {money(amount) || '—'}
          </button>
        ))}
        {cell('Required', <span className="text-ink-2">{required ? shortMoney(required) : 'Not required'}</span>)}
        {cell('Expires', editing === 'expires' ? (
          <input
            autoFocus
            type="date"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null); }}
            className="w-full px-1 py-0.5 border border-amber rounded-chip text-xs bg-amber-bg focus:outline-none"
          />
        ) : (
          <button type="button" onClick={() => begin('expires')} className={`${editable} text-ink-2 !font-normal`} disabled={!canEdit}>
            {expires ? day(expires) : '—'}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CoiDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const toast = useToast();

  const [coi, setCoi] = useState(null);
  const [settings, setSettings] = useState(null);
  const [org, setOrg] = useState(null);
  const [queue, setQueue] = useState([]);
  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const inQueue = searchParams.get('queue') === 'pending';
  const canReview = ['ADMIN', 'MEMBER', 'REVIEWER'].includes(user?.role);

  const load = useCallback(async () => {
    try {
      const [c, s, o] = await Promise.all([
        api.get(`/cois/${id}`),
        api.get('/settings').catch(() => null),
        api.get('/organization').catch(() => null),
      ]);
      setCoi(c);
      setSettings(s);
      setOrg(o);
      api.get(`/cois/${id}/pdf`).then(({ url }) => setPdfUrl(url)).catch(() => {});
      if (inQueue) api.get('/cois?status=PENDING_REVIEW').then(setQueue).catch(() => {});
    } catch (err) {
      toast.error("Couldn't load this certificate");
    } finally {
      setLoading(false);
    }
  }, [id, inQueue]);

  useEffect(() => { load(); }, [load]);

  const saveField = async (patch) => {
    try {
      const updated = await api.put(`/cois/${id}`, patch);
      setCoi(updated);
      toast.success('Corrected');
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Approve/reject walk the queue rather than dumping the reviewer back to a list.
  const advance = () => {
    const next = queue.find((c) => c.id !== id);
    if (inQueue && next) navigate(`/cois/${next.id}?queue=pending`);
    else navigate('/cois');
  };

  const approve = async () => {
    setBusy(true);
    try {
      await api.post(`/cois/${id}/approve`);
      toast.success('Approved');
      advance();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!rejectReason.trim()) return;
    setBusy(true);
    try {
      await api.post(`/cois/${id}/reject`, { reason: rejectReason });
      toast.success('Changes requested — the vendor and their agent have been emailed');
      advance();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
      setRejecting(false);
    }
  };

  // A / R shortcuts, but never while the reviewer is typing a reason.
  useEffect(() => {
    if (!canReview || !coi || coi.status !== 'PENDING_REVIEW') return;
    const onKey = (e) => {
      if (e.target.matches('input, textarea, select')) return;
      if (e.key.toLowerCase() === 'a') approve();
      if (e.key.toLowerCase() === 'r') setRejecting(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canReview, coi, queue]);

  if (loading) return <div className="p-9 text-[13px] text-muted">Loading…</div>;
  if (!coi) return <div className="p-9 text-[13px] text-muted">Certificate not found.</div>;

  const requiredFor = (key) => {
    const map = { gl: 'minGeneralLiability', auto: 'minAutomobile', wc: 'minWorkersComp', umb: 'minUmbrella' };
    const value = settings?.[map[key]];
    return value > 0 ? value : null;
  };

  const problems = COVERAGES.map((line) => {
    const required = requiredFor(line.key);
    if (!required) return null;
    const amount = coi[`${line.key}CoverageAmount`];
    const expires = coi[`${line.key}ExpirationDate`];
    if (amount == null && !expires) return `${line.label} is not on the certificate`;
    if (expires && new Date(expires) < new Date()) return `${line.label} expired ${day(expires)}`;
    if (amount == null || amount < required) return `${line.label} is ${money(amount) || 'unstated'}; you require ${shortMoney(required)}`;
    return null;
  }).filter(Boolean);

  const holderMatches = !org?.name || !coi.certificateHolderName
    ? null
    : coi.certificateHolderName.toLowerCase().includes(org.name.toLowerCase())
      || org.name.toLowerCase().includes(coi.certificateHolderName.toLowerCase());

  const coverThrough = COVERAGES
    .map((l) => coi[`${l.key}ExpirationDate`])
    .filter(Boolean)
    .sort()[0];

  const isPending = coi.status === 'PENDING_REVIEW';
  const queuePosition = queue.findIndex((c) => c.id === id);

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <div className="px-9 py-[18px] bg-white border-b border-line flex justify-between items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3.5 min-w-0">
          <Link to={inQueue ? '/' : '/cois'} className="text-[13px] text-muted hover:text-navy whitespace-nowrap">
            ← {inQueue ? 'Dashboard' : 'Certificates'}
          </Link>
          <span className="w-px h-[18px] bg-line" />
          <div className="flex flex-col min-w-0">
            <span className="text-base font-bold text-navy truncate">
              {coi.vendor?.name} — {coi.vendor?.cois?.length > 1 ? 'renewal' : 'new'} certificate
            </span>
            <span className="text-xs text-muted">
              Uploaded {day(coi.submittedAt)}
              {coi.aiExtractedData ? ' · read by Proof' : ' · not yet read'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {inQueue && queue.length > 0 && (
            <span className="text-xs text-muted whitespace-nowrap">
              {queuePosition >= 0 ? queuePosition + 1 : 1} of {queue.length} in queue
            </span>
          )}
          {inQueue && queue.length > 1 && <Button size="sm" onClick={advance}>Skip →</Button>}
        </div>
      </div>

      <div className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_440px]">
        <div className="bg-warm p-7 flex items-start justify-center min-h-[400px]">
          {pdfUrl ? (
            <iframe
              title="Certificate"
              src={pdfUrl}
              className="w-full max-w-[620px] bg-white rounded border-0"
              style={{ aspectRatio: '8.5 / 11', boxShadow: '0 10px 40px rgba(15,32,66,.15)' }}
            />
          ) : (
            <div
              className="w-full max-w-[620px] bg-white rounded flex items-center justify-center text-[13px] text-muted"
              style={{ aspectRatio: '8.5 / 11', boxShadow: '0 10px 40px rgba(15,32,66,.15)' }}
            >
              Loading the certificate…
            </div>
          )}
        </div>

        <div className="bg-white border-l border-line flex flex-col">
          <div className="px-[22px] py-[18px] border-b border-line-divider flex flex-col gap-1.5">
            <Eyebrow tone="amber" dot>What Proof read</Eyebrow>
            <span className="text-[13px] text-ink-2 leading-[1.5]">
              Compared against your <b className="text-navy">Default</b> requirement template.
              {canReview && ' Click any value to correct it.'}
            </span>
          </div>

          <div className="flex-1 overflow-auto">
            {COVERAGES.map((line) => (
              <ExtractedRow
                key={line.key}
                line={line}
                coi={coi}
                required={requiredFor(line.key)}
                onSave={saveField}
                canEdit={canReview}
              />
            ))}

            <div className="px-[22px] py-3.5 border-b border-line-divider flex flex-col gap-1.5">
              <div className="flex justify-between items-center gap-2.5">
                <span className="text-[13px] font-bold text-navy">Certificate holder</span>
                {holderMatches === null ? (
                  <StatusPill tone="none">Not stated</StatusPill>
                ) : (
                  <StatusPill tone={holderMatches ? 'ok' : 'bad'}>{holderMatches ? 'Matches' : 'Mismatch'}</StatusPill>
                )}
              </div>
              <span className="text-xs text-ink-2">
                {coi.certificateHolderName || 'No certificate holder on the document'}
              </span>
              {holderMatches === false && (
                <span className="text-xs text-bad-text">Expected: {org?.name}</span>
              )}
            </div>

            {(coi.agentName || coi.agentEmail || coi.insuranceCompany) && (
              <div className="px-[22px] py-3.5 flex flex-col gap-1 text-xs text-ink-2">
                <span className="text-[10px] uppercase tracking-[0.05em] text-faint">Agent</span>
                <span>{[coi.agentName, coi.insuranceCompany, coi.agentEmail].filter(Boolean).join(' · ')}</span>
              </div>
            )}
          </div>

          {canReview && isPending && (
            <div className="px-[22px] py-4 border-t border-line bg-card-alt flex flex-col gap-2.5">
              {problems.length === 0 ? (
                <div className="flex gap-2.5 items-start px-3 py-2.5 bg-ok-bg rounded-control text-[13px] text-ok-text leading-[1.45]">
                  <span className="font-extrabold">✓</span>
                  <span>
                    All required coverage meets your template. Approving marks{' '}
                    <b>{coi.vendor?.name}</b> covered{coverThrough ? ` through ${day(coverThrough)}` : ''}.
                  </span>
                </div>
              ) : (
                <div className="flex gap-2.5 items-start px-3 py-2.5 bg-bad-bg rounded-control text-[13px] text-bad-text leading-[1.45]">
                  <span className="font-extrabold">!</span>
                  <div className="flex flex-col gap-1">
                    {problems.map((p, i) => <span key={i}>{p}</span>)}
                  </div>
                </div>
              )}

              {rejecting ? (
                <div className="flex flex-col gap-2">
                  <textarea
                    autoFocus
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="What does the vendor need to fix? This is emailed to them and their agent."
                    className="w-full px-3 py-2 rounded-control border border-line-strong text-[13px] focus:outline-none focus:border-navy"
                  />
                  <div className="flex gap-2">
                    <Button variant="danger" onClick={reject} disabled={busy || !rejectReason.trim()} className="flex-1">
                      {busy ? 'Sending…' : 'Send request'}
                    </Button>
                    <Button onClick={() => setRejecting(false)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button variant="approve" onClick={approve} disabled={busy} className="flex-1 !py-[11px] !text-sm !font-bold">
                    {busy ? 'Approving…' : 'Approve'}
                  </Button>
                  <Button variant="danger" onClick={() => setRejecting(true)} disabled={busy} className="!py-[11px] !text-sm">
                    Request changes
                  </Button>
                </div>
              )}
              <span className="text-[11px] text-faint text-center">A to approve · R to request changes</span>
            </div>
          )}

          {!isPending && (
            <div className="px-[22px] py-4 border-t border-line bg-card-alt text-[13px] text-muted">
              This certificate has already been reviewed.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
