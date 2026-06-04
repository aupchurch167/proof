import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

function dollarsFromCents(cents) {
  return cents != null ? (cents / 100).toString() : '';
}

function centsToDollars(dollars) {
  const num = parseFloat(dollars);
  return isNaN(num) ? 0 : Math.round(num * 100);
}

function SectionMessage({ message }) {
  if (!message) return null;
  return (
    <div className={`px-4 py-3 rounded-lg mb-4 text-sm ${message.startsWith('Error') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
      {message}
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);

  // Coverage & notification settings
  const [settingsForm, setSettingsForm] = useState({});
  const [settingsMsg, setSettingsMsg] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  // Organization info
  const [orgForm, setOrgForm] = useState({ name: '', email: '', phone: '', address: '', additionalInsuredNote: '' });
  const [orgSlug, setOrgSlug] = useState(null);
  const [orgMsg, setOrgMsg] = useState('');
  const [savingOrg, setSavingOrg] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // User profile
  const [profileForm, setProfileForm] = useState({ firstName: '', lastName: '', email: '' });
  const [profileMsg, setProfileMsg] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password change
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordMsg, setPasswordMsg] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/settings'),
      api.get('/organization'),
      api.get('/auth/me'),
    ])
      .then(([s, org, me]) => {
        setSettingsForm({
          minGeneralLiability: dollarsFromCents(s.minGeneralLiability),
          minWorkersComp: dollarsFromCents(s.minWorkersComp),
          minUmbrella: dollarsFromCents(s.minUmbrella),
          minAutomobile: dollarsFromCents(s.minAutomobile),
          reminderDaysBefore: (s.reminderDaysBefore || [30, 14, 7, 0]).join(', '),
          notifyOnUpload: s.notifyOnUpload,
          notifyOnExpiration: s.notifyOnExpiration,
        });
        setOrgForm({ name: org.name, email: org.email, phone: org.phone || '', address: org.address || '', additionalInsuredNote: org.additionalInsuredNote || '' });
        setOrgSlug(org.slug || org.id);
        setProfileForm({ firstName: me.firstName, lastName: me.lastName, email: me.email });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsMsg('');
    try {
      await api.put('/settings', {
        minGeneralLiability: centsToDollars(settingsForm.minGeneralLiability),
        minWorkersComp: centsToDollars(settingsForm.minWorkersComp),
        minUmbrella: centsToDollars(settingsForm.minUmbrella),
        minAutomobile: centsToDollars(settingsForm.minAutomobile),
        reminderDaysBefore: settingsForm.reminderDaysBefore.split(',').map(d => parseInt(d.trim())).filter(n => !isNaN(n)),
        notifyOnUpload: settingsForm.notifyOnUpload,
        notifyOnExpiration: settingsForm.notifyOnExpiration,
      });
      setSettingsMsg('Coverage settings saved!');
    } catch (err) {
      setSettingsMsg('Error: ' + err.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveOrg = async (e) => {
    e.preventDefault();
    setSavingOrg(true);
    setOrgMsg('');
    try {
      await api.put('/organization', orgForm);
      setOrgMsg('Company info saved!');
    } catch (err) {
      setOrgMsg('Error: ' + err.message);
    } finally {
      setSavingOrg(false);
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMsg('');
    try {
      const updated = await api.put('/auth/me', profileForm);
      setProfileForm({ firstName: updated.firstName, lastName: updated.lastName, email: updated.email });
      setProfileMsg('Profile updated!');
    } catch (err) {
      setProfileMsg('Error: ' + err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordMsg('');
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordMsg('Error: Passwords do not match');
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      setPasswordMsg('Error: Password must be at least 8 characters');
      return;
    }
    setSavingPassword(true);
    try {
      await api.put('/auth/me', {
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPasswordMsg('Password changed!');
    } catch (err) {
      setPasswordMsg('Error: ' + err.message);
    } finally {
      setSavingPassword(false);
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Settings</h1>

      {isAdmin && (
        <div className="flex border-b mb-6">
          <Link to="/settings"
            className="px-4 py-2.5 text-sm font-medium border-b-2 border-blue-600 text-blue-600">
            General
          </Link>
          <Link to="/settings/users"
            className="px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">
            Users
          </Link>
        </div>
      )}

      {/* User Profile */}
      <form onSubmit={handleSaveProfile} className="bg-white rounded-xl border p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Your Profile</h2>
        <SectionMessage message={profileMsg} />
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
            <input value={profileForm.firstName} onChange={(e) => setProfileForm({ ...profileForm, firstName: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
            <input value={profileForm.lastName} onChange={(e) => setProfileForm({ ...profileForm, lastName: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg" required />
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input type="email" value={profileForm.email} onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg" required />
        </div>
        <button type="submit" disabled={savingProfile}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
          {savingProfile ? 'Saving...' : 'Update Profile'}
        </button>
      </form>

      {/* Change Password */}
      <form onSubmit={handleChangePassword} className="bg-white rounded-xl border p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Change Password</h2>
        <SectionMessage message={passwordMsg} />
        <div className="space-y-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
            <input type="password" value={passwordForm.currentPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input type="password" value={passwordForm.newPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg" required minLength={8} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
            <input type="password" value={passwordForm.confirmPassword}
              onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg" required minLength={8} />
          </div>
        </div>
        <button type="submit" disabled={savingPassword}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
          {savingPassword ? 'Changing...' : 'Change Password'}
        </button>
      </form>

      {isAdmin && (
        <>
          {/* Company Information */}
          <form onSubmit={handleSaveOrg} className="bg-white rounded-xl border p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Company Information</h2>
            <SectionMessage message={orgMsg} />
            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                <input value={orgForm.name} onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Email</label>
                <input type="email" value={orgForm.email} onChange={(e) => setOrgForm({ ...orgForm, email: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input value={orgForm.phone} onChange={(e) => setOrgForm({ ...orgForm, phone: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <input value={orgForm.address} onChange={(e) => setOrgForm({ ...orgForm, address: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Additional Insured Note</label>
              <textarea value={orgForm.additionalInsuredNote}
                onChange={(e) => setOrgForm({ ...orgForm, additionalInsuredNote: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" rows={3}
                placeholder="Please list the above company as Additionally Insured on your Certificate of Insurance." />
              <p className="text-xs text-gray-500 mt-1">This note is shown to vendors on the COI upload portal. Leave blank for the default message.</p>
            </div>
            <button type="submit" disabled={savingOrg}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium">
              {savingOrg ? 'Saving...' : 'Update Company Info'}
            </button>
          </form>

          {/* Vendor Application Link */}
          {orgSlug && (
            <div className="bg-white rounded-xl border p-6 mb-6">
              <h2 className="text-lg font-semibold mb-1">Vendor Application Link</h2>
              <p className="text-sm text-gray-500 mb-4">
                Share this link with subcontractors so they can apply to join your vendor list directly.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <code className="flex-1 text-xs sm:text-sm bg-gray-100 px-3 py-2.5 rounded-lg overflow-x-auto break-all">
                  {`${window.location.origin}/apply/${orgSlug}`}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/apply/${orgSlug}`);
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 1500);
                  }}
                  className="bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 text-sm font-medium whitespace-nowrap"
                >
                  {linkCopied ? 'Copied!' : 'Copy Link'}
                </button>
                <a
                  href={`${window.location.origin}/apply/${orgSlug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border border-gray-300 px-4 py-2.5 rounded-lg hover:bg-gray-50 text-sm font-medium text-center"
                >
                  Preview
                </a>
              </div>
            </div>
          )}

          {/* Coverage Requirements */}
          <form onSubmit={handleSaveSettings}>
            <div className="bg-white rounded-xl border p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4">Minimum Coverage Requirements</h2>
              <SectionMessage message={settingsMsg} />
              <p className="text-sm text-gray-500 mb-4">Enter amounts in dollars. COIs will be flagged if coverage is below these minimums.</p>
              <div className="grid md:grid-cols-2 gap-4">
                {[
                  { key: 'minGeneralLiability', label: 'General Liability' },
                  { key: 'minWorkersComp', label: 'Workers Compensation' },
                  { key: 'minUmbrella', label: 'Umbrella' },
                  { key: 'minAutomobile', label: 'Automobile' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input type="number" value={settingsForm[key]} onChange={(e) => setSettingsForm({ ...settingsForm, [key]: e.target.value })}
                        className="w-full pl-7 pr-3 py-2 border rounded-lg" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Notification Settings */}
            <div className="bg-white rounded-xl border p-6 mb-6">
              <h2 className="text-lg font-semibold mb-4">Notification Settings</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reminder Days Before Expiration</label>
                  <input value={settingsForm.reminderDaysBefore} onChange={(e) => setSettingsForm({ ...settingsForm, reminderDaysBefore: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg" placeholder="30, 14, 7, 0" />
                  <p className="text-xs text-gray-500 mt-1">Comma-separated list of days. Use 0 for expiration day.</p>
                </div>
                <label className="flex items-center gap-3">
                  <input type="checkbox" checked={settingsForm.notifyOnUpload} onChange={(e) => setSettingsForm({ ...settingsForm, notifyOnUpload: e.target.checked })}
                    className="rounded" />
                  <span className="text-sm">Notify admins when a vendor uploads a new COI</span>
                </label>
                <label className="flex items-center gap-3">
                  <input type="checkbox" checked={settingsForm.notifyOnExpiration} onChange={(e) => setSettingsForm({ ...settingsForm, notifyOnExpiration: e.target.checked })}
                    className="rounded" />
                  <span className="text-sm">Send expiration reminders to vendors</span>
                </label>
              </div>
            </div>

            <button type="submit" disabled={savingSettings}
              className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
              {savingSettings ? 'Saving...' : 'Save Coverage & Notification Settings'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
