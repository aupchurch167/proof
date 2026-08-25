import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../contexts/ToastContext';

const SCOPE_PRESETS = {
  full: { label: 'Read & request COIs', scopes: ['vendors:read', 'coi-requests:read', 'coi-requests:write'] },
  read: { label: 'Read only', scopes: ['vendors:read', 'coi-requests:read'] },
};

// A one-time reveal box for a freshly created secret (token / signing secret).
function SecretReveal({ label, value, onDismiss }) {
  const toast = useToast();
  return (
    <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4">
      <p className="text-sm font-medium text-amber-900 mb-1">{label}</p>
      <p className="text-xs text-amber-700 mb-3">
        Copy it now — for your security it won’t be shown again.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <code className="flex-1 text-xs sm:text-sm bg-white border px-3 py-2.5 rounded-lg overflow-x-auto break-all">
          {value}
        </code>
        <button
          onClick={() => { navigator.clipboard.writeText(value); toast.success('Copied'); }}
          className="bg-amber-600 text-white px-4 py-2.5 rounded-lg hover:bg-amber-700 text-sm font-medium whitespace-nowrap">
          Copy
        </button>
        <button onClick={onDismiss} className="border px-4 py-2.5 rounded-lg text-sm whitespace-nowrap">
          Done
        </button>
      </div>
    </div>
  );
}

export default function Integrations() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [orgSlug, setOrgSlug] = useState('');
  const [keys, setKeys] = useState([]);
  const [webhooks, setWebhooks] = useState([]);

  const [keyName, setKeyName] = useState('');
  const [keyScope, setKeyScope] = useState('full');
  const [creatingKey, setCreatingKey] = useState(false);
  const [newToken, setNewToken] = useState(null);

  const [whName, setWhName] = useState('');
  const [whUrl, setWhUrl] = useState('');
  const [creatingWh, setCreatingWh] = useState(false);
  const [newSecret, setNewSecret] = useState(null);

  const apiRoot = import.meta.env.VITE_API_BASE_URL || window.location.origin;

  const loadLists = () =>
    Promise.all([api.get('/integrations/api-keys'), api.get('/integrations/webhooks')])
      .then(([k, w]) => { setKeys(k); setWebhooks(w); })
      .catch(console.error);

  useEffect(() => {
    Promise.all([api.get('/organization'), api.get('/integrations/api-keys'), api.get('/integrations/webhooks')])
      .then(([org, k, w]) => { setOrgSlug(org.slug || org.id); setKeys(k); setWebhooks(w); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const createKey = async (e) => {
    e.preventDefault();
    setCreatingKey(true);
    try {
      const { token } = await api.post('/integrations/api-keys', {
        name: keyName,
        scopes: SCOPE_PRESETS[keyScope].scopes,
      });
      setNewToken(token);
      setKeyName('');
      await loadLists();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreatingKey(false);
    }
  };

  const revokeKey = async (id, name) => {
    if (!confirm(`Revoke "${name}"? Apps using this key will immediately lose access.`)) return;
    try {
      await api.delete(`/integrations/api-keys/${id}`);
      await loadLists();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const createWebhook = async (e) => {
    e.preventDefault();
    setCreatingWh(true);
    try {
      const { secret } = await api.post('/integrations/webhooks', { name: whName, url: whUrl });
      setNewSecret(secret);
      setWhName('');
      setWhUrl('');
      await loadLists();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreatingWh(false);
    }
  };

  const toggleWebhook = async (wh) => {
    try {
      await api.put(`/integrations/webhooks/${wh.id}`, { active: !wh.active });
      await loadLists();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteWebhook = async (id, name) => {
    if (!confirm(`Delete webhook "${name}"?`)) return;
    try {
      await api.delete(`/integrations/webhooks/${id}`);
      await loadLists();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Settings</h1>

      <div className="flex border-b mb-6">
        <Link to="/settings" className="px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">General</Link>
        <Link to="/settings/users" className="px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300">Users</Link>
        <Link to="/settings/integrations" className="px-4 py-2.5 text-sm font-medium border-b-2 border-blue-600 text-blue-600">Integrations</Link>
      </div>

      {/* Connection details */}
      <div className="bg-white rounded-xl border p-6 mb-6">
        <h2 className="text-lg font-semibold mb-1">Connection details</h2>
        <p className="text-sm text-gray-500 mb-4">Give these to the app you’re connecting (e.g. in its Proof integration settings).</p>
        <div className="space-y-3 text-sm">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Organization slug</label>
            <code className="block bg-gray-100 px-3 py-2 rounded-lg break-all">{orgSlug}</code>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">API base URL</label>
            <code className="block bg-gray-100 px-3 py-2 rounded-lg break-all">{`${apiRoot}/api/v1/orgs/${orgSlug}`}</code>
          </div>
        </div>
      </div>

      {/* API keys */}
      <div className="bg-white rounded-xl border p-6 mb-6">
        <h2 className="text-lg font-semibold mb-1">API keys</h2>
        <p className="text-sm text-gray-500 mb-4">
          A key lets another application read your vendors and request COIs on your behalf. Keys are scoped to this organization only.
        </p>

        {newToken && (
          <SecretReveal label="New API key" value={newToken} onDismiss={() => setNewToken(null)} />
        )}

        <form onSubmit={createKey} className="flex flex-col sm:flex-row gap-2 mb-5">
          <input
            placeholder="Name (e.g. Scheduled, Quill)"
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            className="flex-1 px-3 py-2.5 border rounded-lg text-base sm:text-sm"
            required
          />
          <select value={keyScope} onChange={(e) => setKeyScope(e.target.value)}
            className="px-3 py-2.5 border rounded-lg text-base sm:text-sm">
            <option value="full">{SCOPE_PRESETS.full.label}</option>
            <option value="read">{SCOPE_PRESETS.read.label}</option>
          </select>
          <button type="submit" disabled={creatingKey}
            className="bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium whitespace-nowrap">
            {creatingKey ? 'Creating…' : 'Create key'}
          </button>
        </form>

        {keys.length === 0 ? (
          <p className="text-sm text-gray-400">No API keys yet.</p>
        ) : (
          <div className="divide-y border rounded-lg">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {k.name}
                    {k.revokedAt && <span className="ml-2 text-xs text-red-600 font-normal">Revoked</span>}
                  </p>
                  <p className="text-xs text-gray-500 font-mono truncate">{k.tokenPrefix}…</p>
                  <p className="text-xs text-gray-400">
                    Created {new Date(k.createdAt).toLocaleDateString()}
                    {k.lastUsedAt ? ` · Last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : ' · Never used'}
                  </p>
                </div>
                {!k.revokedAt && (
                  <button onClick={() => revokeKey(k.id, k.name)}
                    className="text-red-600 hover:underline text-sm whitespace-nowrap">Revoke</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Webhooks */}
      <div className="bg-white rounded-xl border p-6 mb-6">
        <h2 className="text-lg font-semibold mb-1">Webhooks</h2>
        <p className="text-sm text-gray-500 mb-4">
          Get a signed <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">coi.updated</code> callback whenever a vendor’s COI status changes, so the other app stays in sync without polling.
        </p>

        {newSecret && (
          <SecretReveal label="Webhook signing secret" value={newSecret} onDismiss={() => setNewSecret(null)} />
        )}

        <form onSubmit={createWebhook} className="flex flex-col gap-2 mb-5">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              placeholder="Name"
              value={whName}
              onChange={(e) => setWhName(e.target.value)}
              className="sm:w-48 px-3 py-2.5 border rounded-lg text-base sm:text-sm"
              required
            />
            <input
              placeholder="https://your-app.com/api/webhooks/proof/coi"
              value={whUrl}
              onChange={(e) => setWhUrl(e.target.value)}
              type="url"
              className="flex-1 px-3 py-2.5 border rounded-lg text-base sm:text-sm"
              required
            />
            <button type="submit" disabled={creatingWh}
              className="bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium whitespace-nowrap">
              {creatingWh ? 'Adding…' : 'Add webhook'}
            </button>
          </div>
        </form>

        {webhooks.length === 0 ? (
          <p className="text-sm text-gray-400">No webhooks yet.</p>
        ) : (
          <div className="divide-y border rounded-lg">
            {webhooks.map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {w.name}
                    {!w.active && <span className="ml-2 text-xs text-gray-500 font-normal">Disabled</span>}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{w.url}</p>
                  <p className="text-xs text-gray-400">
                    {w.events.join(', ')}
                    {w.lastDeliveryStatus ? ` · Last: ${w.lastDeliveryStatus}` : ' · No deliveries yet'}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <button onClick={() => toggleWebhook(w)} className="text-sm text-gray-600 hover:underline">
                    {w.active ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => deleteWebhook(w.id, w.name)} className="text-red-600 hover:underline text-sm">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
