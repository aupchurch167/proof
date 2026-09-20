import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useUsage } from '../contexts/UsageContext';
import { Button, Card, PageTitle } from '../components/ui';

const TABS = ['Company', 'Team', 'Plan & billing', 'Vendor portal', 'Profile'];

function Field({ label, hint, children, className = '' }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-semibold text-ink-2">
        {label}
        {hint && <span className="text-faint font-normal"> ({hint})</span>}
      </span>
      {children}
    </div>
  );
}

const input = 'px-3 py-2.5 rounded-control border border-line-strong bg-white text-sm text-ink focus:outline-none focus:border-navy transition-colors duration-150';

// Usage meter on the navy plan card.
function Meter({ label, used, limit }) {
  const percent = limit == null ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-[13px]">
        <span className="text-on-navy-2">{label}</span>
        <span>{used} / {limit ?? '∞'}</span>
      </div>
      <div className="h-1.5 rounded-[3px] bg-white/[.12]">
        <div className="h-full rounded-[3px] bg-amber transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const toast = useToast();
  const { usage } = useUsage();

  const [tab, setTab] = useState('Company');
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState(null);
  const [orgForm, setOrgForm] = useState({ name: '', email: '', phone: '', address: '', additionalInsuredNote: '' });
  const [team, setTeam] = useState([]);
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', email: '' });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [saving, setSaving] = useState('');

  const isAdmin = user?.role === 'ADMIN';
  const applyUrl = org ? `${window.location.origin}/apply/${org.slug || org.id}` : null;

  useEffect(() => {
    Promise.all([
      api.get('/organization'),
      api.get('/auth/me'),
      api.get('/users').catch(() => []),
    ])
      .then(([o, me, t]) => {
        setOrg(o);
        setOrgForm({
          name: o.name || '', email: o.email || '', phone: o.phone || '',
          address: o.address || '', additionalInsuredNote: o.additionalInsuredNote || '',
        });
        setProfileForm({ firstName: me.firstName, lastName: me.lastName, email: me.email });
        setTeam(Array.isArray(t) ? t : []);
      })
      .catch(() => toast.error("Couldn't load settings"))
      .finally(() => setLoading(false));
  }, []);

  const saveOrg = async () => {
    setSaving('org');
    try {
      await api.put('/organization', orgForm);
      toast.success('Company details saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving('');
    }
  };

  const saveProfile = async () => {
    setSaving('profile');
    try {
      await api.put('/auth/me', profileForm);
      toast.success('Profile saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving('');
    }
  };

  const savePassword = async () => {
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      return toast.error("The new passwords don't match");
    }
    setSaving('password');
    try {
      await api.put('/auth/me', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast.success('Password changed');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving('');
    }
  };

  if (loading) return <div className="p-9 text-[13px] text-muted">Loading…</div>;

  return (
    <div className="px-9 py-8 max-w-settings w-full flex flex-col gap-[22px]">
      <PageTitle>Settings</PageTitle>

      <div className="flex gap-1 border-b border-line overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3.5 py-2.5 text-[13px] whitespace-nowrap border-b-2 -mb-px transition-colors duration-150
              ${tab === t ? 'font-bold text-navy border-amber' : 'font-semibold text-muted border-transparent hover:text-navy'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
        <div className="flex flex-col gap-5">
          {tab === 'Company' && (
            <Card className="p-[22px] flex flex-col gap-4">
              <span className="text-[15px] font-bold text-navy">Company</span>
              <div className="grid sm:grid-cols-2 gap-3.5">
                <Field label="Legal name">
                  <input value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })} className={input} disabled={!isAdmin} />
                </Field>
                <Field label="Notification email">
                  <input value={orgForm.email} onChange={(e) => setOrgForm({ ...orgForm, email: e.target.value })} className={input} disabled={!isAdmin} />
                </Field>
                <Field label="Address" hint="appears as certificate holder" className="sm:col-span-2">
                  <input value={orgForm.address} onChange={(e) => setOrgForm({ ...orgForm, address: e.target.value })} className={input} disabled={!isAdmin} />
                </Field>
                <Field label="Note shown to vendors on the upload page" className="sm:col-span-2">
                  <textarea
                    rows={3}
                    value={orgForm.additionalInsuredNote}
                    onChange={(e) => setOrgForm({ ...orgForm, additionalInsuredNote: e.target.value })}
                    className={`${input} leading-[1.5]`}
                    disabled={!isAdmin}
                  />
                </Field>
              </div>
              {isAdmin && (
                <div className="flex justify-end">
                  <Button variant="navy" onClick={saveOrg} disabled={saving === 'org'}>
                    {saving === 'org' ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted border-t border-line-divider pt-3">
                Coverage minimums moved to <Link to="/requirements" className="font-semibold text-navy hover:text-amber">Requirements</Link>,
                and reminder settings to <Link to="/reminders" className="font-semibold text-navy hover:text-amber">Reminders</Link>.
              </p>
            </Card>
          )}

          {tab === 'Team' && (
            <Card className="p-[22px] flex flex-col gap-3.5">
              <span className="text-[15px] font-bold text-navy">Team · {team.length}</span>
              {team.map((m) => (
                <div key={m.id} className="flex justify-between items-center text-[13px] py-1.5 border-b border-line-divider last:border-0">
                  <span className="text-ink">{m.firstName} {m.lastName}</span>
                  <span className="text-muted capitalize">{(m.role || '').toLowerCase()}</span>
                </div>
              ))}
              {isAdmin && (
                <Button as={Link} to="/settings/users" variant="secondary" className="!border-dashed justify-center">
                  + Invite teammate
                </Button>
              )}
            </Card>
          )}

          {tab === 'Plan & billing' && (
            <Card className="p-[22px] flex flex-col gap-3">
              <span className="text-[15px] font-bold text-navy">Plan & billing</span>
              <p className="text-[13px] text-ink-2 leading-[1.55]">
                You're on the <b className="text-navy">{usage?.planLabel}</b> plan.
                Billing is not yet self-serve — to change plans, contact us and we'll move you over.
              </p>
              {isAdmin && (
                <Button as={Link} to="/settings/integrations" className="self-start">
                  API keys & webhooks →
                </Button>
              )}
            </Card>
          )}

          {tab === 'Vendor portal' && (
            <Card className="p-[22px] flex flex-col gap-3.5">
              <span className="text-[15px] font-bold text-navy">Vendor portal</span>
              <p className="text-[13px] text-ink-2 leading-[1.55]">
                Anyone with this link can apply to become one of your vendors. Each vendor also gets
                their own private upload link in every certificate request.
              </p>
              {applyUrl && (
                <div className="flex gap-2 items-center flex-wrap">
                  <code className="px-3 py-2 bg-card-alt border border-line rounded-control text-xs text-ink break-all">
                    {applyUrl}
                  </code>
                  <Button onClick={() => { navigator.clipboard.writeText(applyUrl); toast.success('Link copied'); }}>
                    Copy
                  </Button>
                  <Button as="a" href={applyUrl} target="_blank" rel="noreferrer">Preview ↗</Button>
                </div>
              )}
              {usage?.portalPreviewToken && (
                <p className="text-xs text-muted">
                  <a href={`/portal/${usage.portalPreviewToken}`} target="_blank" rel="noreferrer" className="font-semibold text-navy hover:text-amber">
                    See what a vendor sees ↗
                  </a>
                </p>
              )}
            </Card>
          )}

          {tab === 'Profile' && (
            <>
              <Card className="p-[22px] flex flex-col gap-4">
                <span className="text-[15px] font-bold text-navy">Your profile</span>
                <div className="grid sm:grid-cols-2 gap-3.5">
                  <Field label="First name">
                    <input value={profileForm.firstName} onChange={(e) => setProfileForm({ ...profileForm, firstName: e.target.value })} className={input} />
                  </Field>
                  <Field label="Last name">
                    <input value={profileForm.lastName} onChange={(e) => setProfileForm({ ...profileForm, lastName: e.target.value })} className={input} />
                  </Field>
                  <Field label="Email" className="sm:col-span-2">
                    <input value={profileForm.email} onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })} className={input} />
                  </Field>
                </div>
                <div className="flex justify-end">
                  <Button variant="navy" onClick={saveProfile} disabled={saving === 'profile'}>
                    {saving === 'profile' ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </Card>

              <Card className="p-[22px] flex flex-col gap-4">
                <span className="text-[15px] font-bold text-navy">Change password</span>
                <div className="grid sm:grid-cols-2 gap-3.5">
                  <Field label="Current password" className="sm:col-span-2">
                    <input type="password" value={passwordForm.currentPassword} onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} className={input} />
                  </Field>
                  <Field label="New password">
                    <input type="password" value={passwordForm.newPassword} onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })} className={input} />
                  </Field>
                  <Field label="Confirm new password">
                    <input type="password" value={passwordForm.confirmPassword} onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })} className={input} />
                  </Field>
                </div>
                <div className="flex justify-end">
                  <Button variant="navy" onClick={savePassword} disabled={saving === 'password'}>
                    {saving === 'password' ? 'Saving…' : 'Change password'}
                  </Button>
                </div>
              </Card>
            </>
          )}
        </div>

        <div className="flex flex-col gap-5">
          {usage && (
            <div className="bg-navy text-white rounded-card p-5 flex flex-col gap-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-amber-light">
                  {usage.planLabel} plan
                </span>
              </div>
              <Meter label="Vendors" used={usage.vendors.used} limit={usage.vendors.limit} />
              <Meter label="Certificates read" used={usage.cois.used} limit={usage.cois.limit} />
              {usage.plan !== 'UNLIMITED' && (
                <button className="mt-1 py-2.5 rounded-control bg-white text-navy text-[13px] font-semibold hover:bg-amber-light transition-colors duration-150">
                  Upgrade to Unlimited
                </button>
              )}
            </div>
          )}

          <Card className="p-5 flex flex-col gap-2.5">
            <span className="text-sm font-bold text-navy">Team · {team.length}</span>
            {team.slice(0, 5).map((m) => (
              <div key={m.id} className="flex justify-between text-[13px]">
                <span className="text-ink truncate">{m.firstName} {m.lastName}</span>
                <span className="text-muted capitalize">{(m.role || '').toLowerCase()}</span>
              </div>
            ))}
            {isAdmin && (
              <Link
                to="/settings/users"
                className="mt-1 py-2 text-center text-[13px] font-semibold text-navy border border-dashed border-line-strong
                  rounded-control hover:border-navy transition-colors duration-150"
              >
                + Invite teammate
              </Link>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
