import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button, Card, Dot, Eyebrow } from '../components/ui';

const DATE_LINE = { weekday: 'long', month: 'long', day: 'numeric' };

function greeting(now = new Date()) {
  const h = now.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// Clickable stat, one per bucket. Colour carries the urgency; the label carries
// the meaning.
function Stat({ value, label, tone, to }) {
  const color = {
    ok: 'text-ok',
    warn: 'text-warn',
    bad: 'text-bad',
    navy: 'text-navy',
    muted: 'text-muted',
  }[tone];
  return (
    <Link
      to={to}
      className="flex flex-col gap-1.5 rounded-stat bg-white border border-line px-[18px] py-4
        hover:border-navy transition-colors duration-150"
    >
      <span className={`text-[30px] font-extrabold leading-none tracking-[-0.03em] ${color}`}>{value}</span>
      <span className="text-xs font-semibold uppercase tracking-[0.05em] text-muted">{label}</span>
    </Link>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(null);

  const load = async () => {
    try {
      const [stats, overview, week, expiring] = await Promise.all([
        api.get('/reports/compliance'),
        api.get('/compliance/overview'),
        api.get('/audit/week').catch(() => null),
        api.get('/reports/expiring?days=30').catch(() => []),
      ]);
      setData({ stats, overview, week, expiring });
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleSendNow = async (vendorId) => {
    setSending(vendorId);
    try {
      await api.post(`/vendors/${vendorId}/request-coi`);
      toast.success('Reminder sent');
      await load();
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('deliverable')) toast.error('No deliverable email on file — fix the address first');
      else if (msg.includes('recently')) toast.info('Already sent in the last 24 hours');
      else toast.error(`Couldn't send: ${err.message}`);
    } finally {
      setSending(null);
    }
  };

  if (loading) return <div className="p-9 text-[13px] text-muted">Loading…</div>;
  if (error) {
    return (
      <div className="p-9">
        <p className="text-bad-text text-sm mb-2">Couldn't load your dashboard.</p>
        <Button onClick={() => { setLoading(true); load(); }}>Try again</Button>
      </div>
    );
  }

  const { stats, overview, week, expiring } = data;
  const gaps = (stats.nonCompliant || 0) + (stats.expired || 0);

  // The headline count is the work, not the vendor list: things that will not
  // resolve themselves unless someone acts.
  const needsYou = gaps + (stats.pending || 0) + (overview.counts.ignoredRequests || 0);

  // Risk order: gaps that have gone unanswered, then the review queue, then
  // coverage about to lapse.
  const queue = [
    ...overview.buckets.expired.map((v) => ({
      id: v.id, tone: 'bad', vendor: v.name,
      issue: v.statusReason || `Coverage lapsed ${Math.abs(v.daysUntilExpiration)} days ago`
        + (v.chaseCount ? ` · ${v.chaseCount} reminders unanswered` : ''),
      action: v.badEmail ? 'Fix email' : 'Send now',
      onAct: v.badEmail ? () => navigate(`/vendors/${v.id}`) : () => handleSendNow(v.id),
    })),
    ...overview.buckets.ignoredRequests
      .filter((v) => !overview.buckets.expired.some((e) => e.id === v.id))
      .map((v) => ({
        id: v.id, tone: 'bad', vendor: v.name,
        issue: `No certificate ${v.daysSinceRequest} days after we asked`
          + (v.chaseCount ? ` · ${v.chaseCount} reminders unanswered` : ''),
        action: 'Call vendor',
        onAct: () => navigate(`/vendors/${v.id}`),
      })),
    ...overview.buckets.pendingReview.map((v) => ({
      id: v.id, tone: 'info', vendor: v.name,
      issue: 'New certificate uploaded — Proof read it, ready to approve',
      action: 'Review',
      onAct: () => navigate(`/cois/${v.pendingCoiId}?queue=pending`),
    })),
    ...overview.buckets.expiringSoon.map((v) => ({
      id: v.id, tone: 'warn', vendor: v.name,
      issue: v.statusReason || `Coverage expires in ${v.daysUntilExpiration} days`,
      action: 'Send now',
      onAct: () => handleSendNow(v.id),
    })),
  ].slice(0, 8);

  const renewals = (expiring || []).slice(0, 5).map((coi) => {
    const soonest = [coi.glExpirationDate, coi.wcExpirationDate, coi.umbExpirationDate, coi.autoExpirationDate]
      .filter(Boolean).sort()[0];
    return { name: coi.vendor?.name, when: soonest };
  });

  return (
    <div className="px-9 py-8 max-w-content w-full flex flex-col gap-7">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <span className="text-[13px] text-muted">
            {new Date().toLocaleDateString('en-US', DATE_LINE)}
          </span>
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-navy">
            {greeting()}, {user?.firstName}.{' '}
            {needsYou === 0 ? 'Nothing needs you.' : `${needsYou} thing${needsYou === 1 ? '' : 's'} need you.`}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button as={Link} to="/import">Import vendors</Button>
          <Button as={Link} to="/vendors" variant="amber">Request COI</Button>
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Stat value={stats.compliant} label="Covered" tone="ok" to="/vendors?status=COMPLIANT" />
        <Stat value={stats.expiringSoon} label="Expiring ≤30d" tone="warn" to="/vendors?status=EXPIRING_SOON" />
        <Stat value={gaps} label="Gaps" tone="bad" to="/vendors?status=NON_COMPLIANT" />
        <Stat value={stats.pending} label="To review" tone="navy" to="/cois?status=PENDING_REVIEW" />
        <Stat value={stats.noCoi} label="No COI" tone="muted" to="/vendors?status=NO_COI" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-line-divider flex justify-between items-center">
            <span className="text-[15px] font-bold text-navy">Needs your attention</span>
            <span className="text-xs text-muted">Sorted by risk</span>
          </div>
          {queue.length === 0 ? (
            <p className="px-5 py-12 text-center text-[13px] text-muted">
              Nothing outstanding. Every vendor is covered and nothing is waiting on review.
            </p>
          ) : (
            queue.map((q) => (
              <div
                key={`${q.tone}-${q.id}`}
                className="grid grid-cols-[8px_minmax(0,1fr)_auto] gap-3.5 items-center px-5 py-3.5
                  border-b border-line-divider last:border-0 hover:bg-card-alt transition-colors duration-150"
              >
                <Dot tone={q.tone} />
                <div className="flex flex-col gap-0.5 min-w-0">
                  {/* Wraps rather than truncating: at phone width the vendor's
                      name is the one thing that must stay readable. */}
                  <Link to={`/vendors/${q.id}`} className="text-sm font-semibold text-navy hover:text-amber">
                    {q.vendor}
                  </Link>
                  <span className="text-[13px] text-ink-2">{q.issue}</span>
                </div>
                <Button size="sm" onClick={q.onAct} disabled={sending === q.id}>
                  {sending === q.id ? 'Sending…' : q.action}
                </Button>
              </div>
            ))
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <div className="bg-navy text-white rounded-card p-5 flex flex-col gap-3">
            <Eyebrow tone="on-navy" dot pulse>Proof did this week</Eyebrow>
            <div className="flex flex-col gap-2.5 text-sm leading-[1.45]">
              {[
                ['Certificates read', week?.certificatesRead],
                ['Reminders sent', week?.remindersSent],
                ['Renewals received', week?.renewalsReceived],
                ['Issues caught', week?.issuesCaught],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <span className="text-on-navy-2">{label}</span>
                  <span className="font-bold">{value ?? '—'}</span>
                </div>
              ))}
            </div>
            <Link to="/audit" className="mt-1 self-start text-[13px] font-semibold text-amber-light hover:text-white">
              View activity →
            </Link>
          </div>

          <Card className="px-5 py-[18px] flex flex-col gap-3">
            <span className="text-sm font-bold text-navy">Upcoming renewals</span>
            {renewals.length === 0 ? (
              <p className="text-[13px] text-muted">Nothing expiring in the next 30 days.</p>
            ) : (
              renewals.map((r, i) => (
                <div key={i} className="flex justify-between gap-3 text-[13px] py-1.5 border-b border-line-divider last:border-0">
                  <span className="text-ink font-medium truncate">{r.name}</span>
                  <span className="text-muted whitespace-nowrap tabular">
                    {r.when ? new Date(r.when).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                  </span>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
