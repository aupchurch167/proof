import { useState, useEffect } from 'react';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

function dollarsFromCents(cents) {
  return cents != null ? (cents / 100).toString() : '';
}

function centsToDollars(dollars) {
  const num = parseFloat(dollars);
  return isNaN(num) ? 0 : Math.round(num * 100);
}

export default function Settings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get('/settings')
      .then((s) => {
        setSettings(s);
        setForm({
          minGeneralLiability: dollarsFromCents(s.minGeneralLiability),
          minWorkersComp: dollarsFromCents(s.minWorkersComp),
          minUmbrella: dollarsFromCents(s.minUmbrella),
          minAutomobile: dollarsFromCents(s.minAutomobile),
          reminderDaysBefore: (s.reminderDaysBefore || [30, 14, 7, 0]).join(', '),
          notifyOnUpload: s.notifyOnUpload,
          notifyOnExpiration: s.notifyOnExpiration,
        });
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const data = {
        minGeneralLiability: centsToDollars(form.minGeneralLiability),
        minWorkersComp: centsToDollars(form.minWorkersComp),
        minUmbrella: centsToDollars(form.minUmbrella),
        minAutomobile: centsToDollars(form.minAutomobile),
        reminderDaysBefore: form.reminderDaysBefore.split(',').map(d => parseInt(d.trim())).filter(n => !isNaN(n)),
        notifyOnUpload: form.notifyOnUpload,
        notifyOnExpiration: form.notifyOnExpiration,
      };
      await api.put('/settings', data);
      setMessage('Settings saved!');
    } catch (err) {
      setMessage('Error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;
  if (user?.role !== 'ADMIN') return <div className="text-center py-12 text-gray-500">Admin access required</div>;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Organization Settings</h1>

      <form onSubmit={handleSave}>
        {message && (
          <div className={`px-4 py-3 rounded-lg mb-6 text-sm ${message.startsWith('Error') ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
            {message}
          </div>
        )}

        {/* Coverage Requirements */}
        <div className="bg-white rounded-xl border p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Minimum Coverage Requirements</h2>
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
                  <input type="number" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
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
              <input value={form.reminderDaysBefore} onChange={(e) => setForm({ ...form, reminderDaysBefore: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" placeholder="30, 14, 7, 0" />
              <p className="text-xs text-gray-500 mt-1">Comma-separated list of days. Use 0 for expiration day.</p>
            </div>
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={form.notifyOnUpload} onChange={(e) => setForm({ ...form, notifyOnUpload: e.target.checked })}
                className="rounded" />
              <span className="text-sm">Notify admins when a vendor uploads a new COI</span>
            </label>
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={form.notifyOnExpiration} onChange={(e) => setForm({ ...form, notifyOnExpiration: e.target.checked })}
                className="rounded" />
              <span className="text-sm">Send expiration reminders to vendors</span>
            </label>
          </div>
        </div>

        <button type="submit" disabled={saving}
          className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </form>
    </div>
  );
}
