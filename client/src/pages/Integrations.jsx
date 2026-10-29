import { useState, useEffect } from 'react';
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
    <div className="bg-amber-50 border border-amber-300 rounded-control p-4 mb-4">
      <p className="text-sm font-medium text-amber-900 mb-1">{label}</p>
      <p className="text-xs text-amber-700 mb-3">
        Copy it now — for your security it won’t be shown again.
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <code className="flex-1 text-xs sm:text-sm bg-white border px-3 py-2.5 rounded-control overflow-x-auto break-all">
          {value}
        </code>
        <button
          onClick={() => { navigator.clipboard.writeText(value); toast.success('Copied'); }}
          className="bg-amber-600 text-white px-4 py-2.5 rounded-control hover:bg-amber-700 text-sm font-medium whitespace-nowrap">
          Copy
        </button>
        <button onClick={onDismiss} className="border px-4 py-2.5 rounded-control text-sm whitespace-nowrap">
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

  if (loading) return <div className="text-[13px] text-muted">Loading…</div>;

  return (
    <div className="flex flex-col gap-4">

      {/* Connection details */}
      <div className="bg-white rounded-card border p-6 mb-6">
        <h2 className="text-lg font-semibold mb-1">Connection details</h2>
        <p className="text-sm text-muted mb-4">Give these to the app you’re connecting (e.g. in its Proof integration settings).</p>
        <div className="space-y-3 text-sm">
          <div>
            <span className="block text-xs font-semibold text-ink-2 mb-1">Organization slug</span>
            <code className="block bg-warm px-3 py-2 rounded-control break-all">{orgSlug}</code>
          </div>
          <div>
            <span className="block text-xs font-semibold text-ink-2 mb-1">API base URL</span>
            <code className="block bg-warm px-3 py-2 rounded-control break-all">{`${apiRoot}/api/v1/orgs/${orgSlug}`}</code>
          </div>
        </div>
      </div>

      {/* API keys */}
      <div className="bg-white rounded-card border p-6 mb-6">
        <h2 className="text-lg font-semibold mb-1">API keys</h2>
        <p className="text-sm text-muted mb-4">
          A key lets another application read your vendors and request COIs on your behalf. Keys are scoped to this organization only.
        </p>

        {newToken && (
          <SecretReveal label="New API key" value={newToken} onDismiss={() => setNewToken(null)} />
        )}

        <form onSubmit={createKey} className="flex flex-col sm:flex-row gap-2 mb-5 sm:items-end">
          <div className="flex-1">
            <label htmlFor="settings-api-key-name" className="block text-xs font-semibold text-ink-2 mb-1">Key name</label>
            <input
              id="settings-api-key-name"
              placeholder="Name (e.g. Scheduled, Quill)"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              className="w-full px-3 py-2.5 border rounded-control text-base sm:text-sm"
              required
            />
          </div>
          <div>
            <label htmlFor="settings-api-key-scope" className="block text-xs font-semibold text-ink-2 mb-1">Access</label>
            <select id="settings-api-key-scope" value={keyScope} onChange={(e) => setKeyScope(e.target.value)}
              className="px-3 py-2.5 border rounded-control text-base sm:text-sm">
            <option value="full">{SCOPE_PRESETS.full.label}</option>
            <option value="read">{SCOPE_PRESETS.read.label}</option>
            </select>
          </div>
          <button type="submit" disabled={creatingKey}
            className="bg-amber text-white px-4 py-2.5 rounded-control hover:bg-amber-hover disabled:opacity-50 text-sm font-medium whitespace-nowrap">
            {creatingKey ? 'Creating…' : 'Create key'}
          </button>
        </form>

        {keys.length === 0 ? (
          <p className="text-sm text-faint">No API keys yet.</p>
        ) : (
          <div className="divide-y border rounded-control">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {k.name}
                    {k.revokedAt && <span className="ml-2 text-xs text-bad-text font-normal">Revoked</span>}
                  </p>
                  <p className="text-xs text-muted font-mono truncate">{k.tokenPrefix}…</p>
                  <p className="text-xs text-faint">
                    Created {new Date(k.createdAt).toLocaleDateString()}
                    {k.lastUsedAt ? ` · Last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : ' · Never used'}
                  </p>
                </div>
                {!k.revokedAt && (
                  <button onClick={() => revokeKey(k.id, k.name)}
                    className="text-bad-text hover:underline text-sm whitespace-nowrap">Revoke</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Webhooks */}
      <div className="bg-white rounded-card border p-6 mb-6">
        <h2 className="text-lg font-semibold mb-1">Webhooks</h2>
        <p className="text-sm text-muted mb-4">
          Get a signed <code className="text-xs bg-warm px-1 py-0.5 rounded">coi.updated</code> callback whenever a vendor’s COI status changes, so the other app stays in sync without polling.
        </p>

        {newSecret && (
          <SecretReveal label="Webhook signing secret" value={newSecret} onDismiss={() => setNewSecret(null)} />
        )}

        <form onSubmit={createWebhook} className="flex flex-col gap-2 mb-5">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
            <div className="sm:w-48">
              <label htmlFor="settings-webhook-name" className="block text-xs font-semibold text-ink-2 mb-1">Name</label>
              <input
                id="settings-webhook-name"
                placeholder="Name"
                value={whName}
                onChange={(e) => setWhName(e.target.value)}
                className="w-full px-3 py-2.5 border rounded-control text-base sm:text-sm"
                required
              />
            </div>
            <div className="flex-1">
              <label htmlFor="settings-webhook-url" className="block text-xs font-semibold text-ink-2 mb-1">URL</label>
              <input
                id="settings-webhook-url"
                placeholder="https://your-app.com/api/webhooks/proof/coi"
                value={whUrl}
                onChange={(e) => setWhUrl(e.target.value)}
                type="url"
                className="w-full px-3 py-2.5 border rounded-control text-base sm:text-sm"
                required
              />
            </div>
            <button type="submit" disabled={creatingWh}
              className="bg-amber text-white px-4 py-2.5 rounded-control hover:bg-amber-hover disabled:opacity-50 text-sm font-medium whitespace-nowrap">
              {creatingWh ? 'Adding…' : 'Add webhook'}
            </button>
          </div>
        </form>

        {webhooks.length === 0 ? (
          <p className="text-sm text-faint">No webhooks yet.</p>
        ) : (
          <div className="divide-y border rounded-control">
            {webhooks.map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">
                    {w.name}
                    {!w.active && <span className="ml-2 text-xs text-muted font-normal">Disabled</span>}
                  </p>
                  <p className="text-xs text-muted truncate">{w.url}</p>
                  <p className="text-xs text-faint">
                    {w.events.join(', ')}
                    {w.lastDeliveryStatus ? ` · Last: ${w.lastDeliveryStatus}` : ' · No deliveries yet'}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <button onClick={() => toggleWebhook(w)} className="text-sm text-muted hover:underline">
                    {w.active ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => deleteWebhook(w.id, w.name)} className="text-bad-text hover:underline text-sm">
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
