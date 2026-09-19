import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button, Card, Eyebrow, EmptyState, PageTitle, StatusPill, Toggle } from '../components/ui';

const dayLabel = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (d.getTime() === today.getTime()) return 'Today';
  return d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
};

export default function Reminders() {
  const { user } = useAuth();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(null);
  const [editingCadence, setEditingCadence] = useState(false);
  const [draftDays, setDraftDays] = useState('');

  const isAdmin = user?.role === 'ADMIN';

  const load = async () => {
    try {
      const [upcoming, s] = await Promise.all([
        api.get('/reminders/upcoming'),
        api.get('/settings').catch(() => null),
      ]);
      setData(upcoming);
      setSettings(s);
      setDraftDays((upcoming.reminderDays || []).join(', '));
    } catch (err) {
      toast.error("Couldn't load reminders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const sendNow = async (vendorId) => {
    setSending(vendorId);
    try {
      await api.post(`/vendors/${vendorId}/request-coi`);
      toast.success('Sent');
      await load();
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      if (msg.includes('deliverable')) toast.error('No deliverable email on file — fix the address first');
      else if (msg.includes('recently')) toast.info('Already sent in the last 24 hours');
      else toast.error(err.message);
    } finally {
      setSending(null);
    }
  };

  const saveSetting = async (patch) => {
    try {
      const updated = await api.put('/settings', patch);
      setSettings(updated);
      toast.success('Saved');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const saveCadence = async () => {
    const days = draftDays.split(',').map((d) => parseInt(d.trim(), 10)).filter((n) => !Number.isNaN(n));
    if (days.length === 0) return toast.error('Give at least one day');
    await saveSetting({ reminderDaysBefore: days });
    setEditingCadence(false);
  };

  if (loading) return <div className="p-9 text-[13px] text-muted">Loading…</div>;
  if (!data) return <div className="p-9 text-[13px] text-muted">Couldn't load reminders.</div>;

  const { scheduled, notResponding, handsOffPercent, sendsAt } = data;

  return (
    <div className="px-9 py-8 max-w-content w-full flex flex-col gap-[22px]">
      <div className="flex flex-col gap-1.5">
        <PageTitle>Reminders</PageTitle>
        <span className="text-sm text-ink-2">
          Proof emails vendors before coverage lapses. You only step in when someone doesn't respond.
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          <Card className="overflow-hidden">
            <div className="px-5 py-3.5 border-b border-line-divider flex justify-between items-center">
              <span className="text-[15px] font-bold text-navy">Scheduled</span>
              <span className="text-xs text-muted">Sends at {sendsAt} CT</span>
            </div>
            {scheduled.length === 0 ? (
              <EmptyState>Nothing queued to send. Every vendor is current.</EmptyState>
            ) : (
              scheduled.slice(0, 20).map((s, i) => (
                <div
                  key={`${s.vendorId}-${s.kind}-${i}`}
                  className="grid grid-cols-[90px_minmax(0,1fr)_auto_auto] gap-3.5 items-center px-5 py-[13px]
                    border-b border-line-divider last:border-0 text-[13px]"
                >
                  <span className="font-bold text-navy tabular">{dayLabel(s.sendsAt)}</span>
                  <div className="flex flex-col gap-px min-w-0">
                    <Link to={`/vendors/${s.vendorId}`} className="font-semibold text-ink hover:text-amber truncate">
                      {s.vendorName}
                    </Link>
                    <span className="text-xs text-muted truncate">{s.what}</span>
                  </div>
                  <StatusPill tone={s.badEmail ? 'bad' : s.stage.tone}>
                    {s.badEmail ? 'No valid email' : s.stage.label}
                  </StatusPill>
                  <Button size="sm" onClick={() => sendNow(s.vendorId)} disabled={sending === s.vendorId || s.badEmail}>
                    {sending === s.vendorId ? 'Sending…' : 'Send now'}
                  </Button>
                </div>
              ))
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="px-5 py-3.5 border-b border-line-divider flex justify-between items-center">
              <span className="text-[15px] font-bold text-navy">Not responding</span>
              {notResponding.length > 0 && <StatusPill tone="bad">Needs a human</StatusPill>}
            </div>
            {notResponding.length === 0 ? (
              <EmptyState>Everyone has replied. Nothing needs chasing by hand.</EmptyState>
            ) : (
              notResponding.map((v) => (
                <div
                  key={v.vendorId}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-3.5 items-center px-5 py-[13px]
                    border-b border-line-divider last:border-0 text-[13px]"
                >
                  <div className="flex flex-col gap-px min-w-0">
                    <Link to={`/vendors/${v.vendorId}`} className="font-semibold text-ink hover:text-amber truncate">
                      {v.vendorName}
                    </Link>
                    <span className="text-xs text-muted truncate">
                      {v.chasesSent} reminder{v.chasesSent === 1 ? '' : 's'} · no reply in {v.daysSinceRequest} days
                      {v.badEmail ? ' · no valid email on file' : ''}
                    </span>
                  </div>
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {v.phone && <Button size="sm" as="a" href={`tel:${v.phone}`}>Call {v.phone}</Button>}
                    <Button size="sm" as={Link} to={`/vendors/${v.vendorId}`}>
                      {v.badEmail ? 'Fix email' : 'Open vendor'}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card className="p-5 flex flex-col gap-3.5">
            <div className="flex justify-between items-center gap-2">
              <span className="text-[15px] font-bold text-navy">Cadence</span>
              {isAdmin && (
                <button
                  onClick={() => setEditingCadence(!editingCadence)}
                  className="text-xs font-semibold text-navy hover:text-amber"
                >
                  {editingCadence ? 'Cancel' : 'Edit'}
                </button>
              )}
            </div>

            {editingCadence ? (
              <div className="flex flex-col gap-2">
                <label className="text-xs text-muted">Days before expiry, comma separated</label>
                <input
                  value={draftDays}
                  onChange={(e) => setDraftDays(e.target.value)}
                  className="px-3 py-2 rounded-control border border-line-strong text-[13px] focus:outline-none focus:border-navy"
                  placeholder="30, 14, 7, 0"
                />
                <Button variant="navy" onClick={saveCadence}>Save cadence</Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {(data.reminderDays || []).map((d) => (
                  <div key={d} className="flex justify-between items-center px-3 py-2.5 border border-line rounded-control text-[13px]">
                    <span className="font-semibold text-navy">
                      {d === 0 ? 'Day of expiry' : `${d} days before`}
                    </span>
                    <span className="text-muted">
                      {settings?.notifyOnUpload ? 'Vendor + agent' : 'Vendor'}
                    </span>
                  </div>
                ))}
                {data.chaseDays?.length > 0 && (
                  <>
                    <Eyebrow className="mt-1">If they never upload</Eyebrow>
                    {data.chaseDays.map((d, i) => (
                      <div key={d} className="flex justify-between items-center px-3 py-2.5 border border-line rounded-control text-[13px]">
                        <span className="font-semibold text-navy">{d} days after asking</span>
                        <span className="text-muted">
                          {i === data.chaseDays.length - 1 ? 'Vendor · escalates to you' : 'Vendor'}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            <div className="flex flex-col gap-3 pt-1.5 border-t border-line-divider">
              <label className="flex items-center gap-3 text-[13px]">
                <Toggle
                  checked={Boolean(settings?.notifyOnExpiration)}
                  disabled={!isAdmin}
                  label="Send expiration reminders"
                  onChange={(v) => saveSetting({ notifyOnExpiration: v })}
                />
                <span>Email vendors before coverage lapses</span>
              </label>
              <label className="flex items-center gap-3 text-[13px]">
                <Toggle
                  checked={Boolean(settings?.chaseNonResponders)}
                  disabled={!isAdmin}
                  label="Chase non-responders"
                  onChange={(v) => saveSetting({ chaseNonResponders: v })}
                />
                <span>Follow up when a vendor ignores a request</span>
              </label>
              <label className="flex items-center gap-3 text-[13px]">
                <Toggle
                  checked={Boolean(settings?.notifyOnUpload)}
                  disabled={!isAdmin}
                  label="Notify on upload"
                  onChange={(v) => saveSetting({ notifyOnUpload: v })}
                />
                <span>Email me when a vendor uploads a certificate</span>
              </label>
            </div>
          </Card>

          <div className="bg-navy text-white rounded-card p-5 flex flex-col gap-2">
            <Eyebrow tone="on-navy">Last 30 days</Eyebrow>
            <span className="text-[32px] font-extrabold tracking-[-0.03em] leading-none">
              {handsOffPercent == null ? '—' : `${handsOffPercent}%`}
            </span>
            <span className="text-[13px] text-on-navy-2 leading-[1.5]">
              {handsOffPercent == null
                ? 'No renewals yet this month — this fills in once certificates start arriving.'
                : 'of vendors renewed without anyone from your team getting involved.'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
