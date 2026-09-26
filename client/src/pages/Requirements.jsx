import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Button, Card, Chip, Dot, PageTitle, Toggle } from '../components/ui';

const PERIOD_MODES = ['Policy year', 'Fiscal year', 'Rolling 12 months', 'Custom'];

const iso = (d) => d.toISOString().slice(0, 10);

// Preset windows. "Custom" keeps whatever dates are already set.
function datesForMode(mode) {
  const now = new Date();
  const year = now.getFullYear();
  if (mode === 'Policy year') return [`${year}-01-01`, `${year}-12-31`];
  if (mode === 'Fiscal year') {
    const startYear = now.getMonth() >= 9 ? year : year - 1;
    return [`${startYear}-10-01`, `${startYear + 1}-09-30`];
  }
  if (mode === 'Rolling 12 months') {
    const from = new Date(now);
    from.setFullYear(from.getFullYear() - 1);
    return [iso(from), iso(now)];
  }
  return [null, null];
}

export default function Requirements() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [template, setTemplate] = useState(null);
  const [period, setPeriod] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [impact, setImpact] = useState(null);
  const [periodStatus, setPeriodStatus] = useState(null);

  const isAdmin = user?.role === 'ADMIN';

  const load = async () => {
    try {
      const d = await api.get('/requirements');
      setData(d);
      setTemplate(structuredClone(d.templates[0]));
      setPeriod({ ...d.coveragePeriod });
    } catch (err) {
      toast.error("Couldn't load your requirements");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Dry-run the edited limits so the footer can warn before anyone saves.
  const refreshImpact = useCallback(async (coverages) => {
    try {
      setImpact(await api.post('/requirements/impact', { coverages }));
    } catch {
      setImpact(null);
    }
  }, []);

  useEffect(() => {
    if (!template) return;
    const t = setTimeout(() => refreshImpact(template.coverages), 400);
    return () => clearTimeout(t);
  }, [template, refreshImpact]);

  // "Right now" box: how coverage looks so far this period, end clamped to today.
  useEffect(() => {
    if (!period?.start) { setPeriodStatus(null); return; }
    const today = iso(new Date());
    const end = period.end && period.end < today ? period.end : today;
    if (end <= period.start) { setPeriodStatus(null); return; }
    api.get(`/reports/coverage?from=${period.start}&to=${end}&type=all`)
      .then((r) => setPeriodStatus(r))
      .catch(() => setPeriodStatus(null));
  }, [period?.start, period?.end]);

  if (loading) return <div className="p-9 text-[13px] text-muted">Loading…</div>;
  if (!template) return <div className="p-9 text-[13px] text-muted">No requirement template found.</div>;

  const setCoverage = (key, patch) => {
    setTemplate((t) => ({
      ...t,
      coverages: t.coverages.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/requirements/${template.id}`, {
        coverages: template.coverages.map((c) => ({ key: c.key, required: c.required, minLimit: c.minLimit })),
        requireHolderMatch: template.requireHolderMatch,
        expiringWindowDays: template.expiringWindowDays,
      });
      toast.success('Template saved — every vendor re-checked');
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const savePeriod = async (patch) => {
    const next = { ...period, ...patch };
    setPeriod(next);
    try {
      await api.put('/requirements/coverage-period/set', next);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const pickMode = (mode) => {
    const [start, end] = datesForMode(mode);
    savePeriod(start ? { mode, start, end } : { mode });
  };

  const ROW = 'grid grid-cols-[minmax(0,1.4fr)_110px_minmax(0,1fr)_60px] gap-3.5 items-center px-[22px]';

  const gapCount = periodStatus ? periodStatus.withGap : null;

  return (
    <div className="px-9 py-8 max-w-content w-full flex flex-col gap-[22px]">
      <div className="flex justify-between items-end gap-4 flex-wrap">
        <div className="flex flex-col gap-1.5">
          <PageTitle>Requirements</PageTitle>
          <span className="text-sm text-ink-2">
            Templates set what each kind of vendor must carry. Proof checks every certificate against them.
          </span>
        </div>
        <Button
          variant="navy"
          disabled={!data.multiTemplateSupported}
          title={data.multiTemplateSupported ? undefined : 'Coming soon — per-trade templates are not built yet'}
        >
          New template · Coming soon
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="overflow-hidden self-start">
          {data.templates.map((t) => (
            <button
              key={t.id}
              className={`w-full flex flex-col gap-0.5 text-left px-[18px] py-3.5 border-b border-line-divider last:border-0
                ${t.id === template.id ? 'bg-navy text-white' : 'text-navy hover:bg-card-alt'}`}
            >
              <span className="text-sm font-semibold">{t.name}</span>
              <span className="text-xs opacity-70">{t.vendorCount} vendors</span>
            </button>
          ))}
          {!data.multiTemplateSupported && (
            <p className="px-[18px] py-3 text-xs text-muted border-t border-line-divider leading-relaxed">
              Coming soon: per-trade templates. Every vendor uses this one default
              template today. The server does not store additional templates.
            </p>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="px-[22px] py-[18px] border-b border-line-divider flex justify-between items-center gap-3 flex-wrap">
            <div className="flex flex-col gap-0.5">
              <span className="text-base font-bold text-navy">{template.name}</span>
              <span className="text-xs text-muted">Applies to all {template.vendorCount} vendors</span>
            </div>
            {template.updatedAt && (
              <span className="text-xs text-muted">
                Last edited {new Date(template.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>

          <div className={`${ROW} py-2.5 bg-card-alt border-b border-line-divider text-[11px] font-bold uppercase tracking-[0.06em] text-muted`}>
            <span>Coverage</span><span>Required</span><span>Minimum limit</span><span />
          </div>

          {template.coverages.map((c) => (
            <div key={c.key} className={`${ROW} py-3.5 border-b border-line-divider text-[13px]`}>
              <div className="flex flex-col gap-px min-w-0">
                <span className="font-semibold text-navy">{c.label}</span>
                <span className="text-xs text-muted">{c.note}</span>
              </div>
              <Toggle
                checked={c.required}
                disabled={!isAdmin}
                label={`${c.label} required`}
                onChange={(next) => setCoverage(c.key, { required: next, minLimit: c.minLimit || 1000000 })}
              />
              <input
                type="text"
                inputMode="numeric"
                disabled={!c.required || !isAdmin}
                value={c.minLimit == null ? '' : `$${Number(c.minLimit).toLocaleString()}`}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^0-9]/g, '');
                  setCoverage(c.key, { minLimit: digits ? Number(digits) : null });
                }}
                className={`px-2.5 py-[7px] rounded-[7px] border text-[13px] focus:outline-none focus:border-navy
                  ${c.required ? 'border-line-strong bg-white text-ink' : 'border-line-divider bg-card-alt text-faint'}`}
              />
              <span className="text-xs text-muted text-right">{c.required ? 'USD' : ''}</span>
            </div>
          ))}

          <div className="px-[22px] py-4 flex flex-col gap-3 border-t border-line-divider">
            <label className="flex items-start gap-3 text-[13px]">
              <Toggle
                checked={template.requireHolderMatch}
                disabled={!isAdmin}
                label="Certificate holder must match"
                onChange={(v) => setTemplate({ ...template, requireHolderMatch: v })}
              />
              <span className="text-ink flex flex-col gap-0.5">
                <span>
                  Certificate holder must match <b>{data.orgName}</b> (additional insured)
                </span>
                <span className="text-xs text-muted">
                  Enforced. On: a missing holder or a name that does not match {data.orgName} marks the vendor non-compliant. Off: the holder name is not checked.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 text-[13px]">
              <Toggle
                checked={template.expiringWindowDays > 0}
                disabled={!isAdmin}
                label="Treat coverage as expiring"
                onChange={(v) => setTemplate({ ...template, expiringWindowDays: v ? 30 : 0 })}
              />
              <span className="text-ink flex flex-col gap-0.5">
                <span>
                  Treat coverage expiring within{' '}
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={!isAdmin}
                    value={template.expiringWindowDays}
                    onChange={(e) => setTemplate({ ...template, expiringWindowDays: Number(e.target.value.replace(/[^0-9]/g, '')) || 0 })}
                    className="w-12 px-1.5 py-0.5 mx-0.5 text-center rounded-chip border border-line-strong text-[13px] font-bold focus:outline-none focus:border-navy"
                  />{' '}
                  days as "Expiring"
                </span>
                <span className="text-xs text-muted">
                  Enforced on the Expiring badge, coverage chips, the dashboard, API coverage status, and the weekly summary. 0 turns Expiring off; a date already past is still Expired. Reminder emails still use Reminder settings.
                </span>
              </span>
            </label>
          </div>

          <div className="px-[22px] py-[18px] border-t border-line-divider flex flex-col gap-3.5">
            <div className="flex justify-between items-start gap-4 flex-wrap">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold text-navy">Coverage period</span>
                <span className="text-xs text-muted leading-[1.5] max-w-[520px]">
                  The window your carrier audits. Proof tracks whether every sub was covered on every
                  day of this period, and pre-fills it in the Audit log.
                </span>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {PERIOD_MODES.map((m) => (
                  <Chip key={m} size="sm" active={period?.mode === m} onClick={() => pickMode(m)} disabled={!isAdmin}>
                    {m}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="flex gap-3 items-end flex-wrap">
              {[['start', 'Period start'], ['end', 'Period end']].map(([key, label]) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-muted">{label}</span>
                  <input
                    type="date"
                    disabled={!isAdmin}
                    value={period?.[key] || ''}
                    onChange={(e) => savePeriod({ [key]: e.target.value, mode: 'Custom' })}
                    className="px-3 py-2 rounded-control border border-line-strong text-[13px] bg-white focus:outline-none focus:border-navy"
                  />
                </div>
              ))}
              <div className="flex flex-col gap-1.5 flex-1 min-w-[220px]">
                <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-muted">Right now</span>
                <div className="flex items-center gap-2.5 px-3 py-2 border border-line rounded-control bg-card-alt text-[13px]">
                  <Dot tone={!periodStatus ? 'none' : gapCount ? 'bad' : 'ok'} />
                  <span className="text-ink truncate">
                    {!period?.start
                      ? 'Pick a start date'
                      : !periodStatus
                        ? 'Pick a valid start and end date'
                        : gapCount
                          ? `${gapCount} of ${periodStatus.vendors} subs have had a gap so far this period`
                          : `All ${periodStatus.vendors} active subs covered every day so far`}
                  </span>
                  {periodStatus && (
                    <button
                      onClick={() => {
                        const today = iso(new Date());
                        const end = period.end && period.end < today ? period.end : today;
                        navigate(`/audit?coverage=1&from=${period.start}&to=${end}`);
                      }}
                      className="ml-auto text-xs font-semibold text-navy hover:text-amber whitespace-nowrap"
                    >
                      Open in Audit log →
                    </button>
                  )}
                </div>
              </div>
            </div>

            {[
              ['warnInPeriod', <>Warn me when a sub's certificate will expire <b>inside</b> the coverage period</>, 'Saved on the coverage period only. Expiration emails still use Reminder settings — this toggle is not enforced.'],
              ['retainForPeriod', <>Keep expired certificates on file for the whole period (needed to prove past coverage)</>, 'Saved on the coverage period only. Soft-delete still follows the product delete path — this toggle does not retain or purge files.'],
            ].map(([key, label, hint]) => (
              <label key={key} className="flex items-start gap-3 text-[13px]">
                <Toggle
                  checked={Boolean(period?.[key])}
                  disabled={!isAdmin}
                  label={key}
                  onChange={(v) => savePeriod({ [key]: v })}
                />
                <span className="text-ink flex flex-col gap-0.5">
                  <span>{label}</span>
                  <span className="text-xs text-muted">{hint}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="px-[22px] py-3.5 bg-card-alt border-t border-line-divider flex justify-between items-center gap-3 flex-wrap">
            <span className="text-xs text-muted">
              {impact
                ? `Changing limits re-checks all ${impact.vendorCount} vendors on save.` +
                  (impact.newlyFailing > 0 ? ` ${impact.newlyFailing} would become non-compliant.` : ' None would become non-compliant.')
                : 'Changing limits re-checks every vendor on save.'}
            </span>
            <Button variant="amber" onClick={save} disabled={saving || !isAdmin}>
              {saving ? 'Saving…' : 'Save template'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
