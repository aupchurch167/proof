// In production the frontend is a separate service from the API, so set
// VITE_API_BASE_URL to the backend's public origin at build time. Locally it's
// unset and calls stay same-origin (proxied by Vite / served by the API).
const API_ROOT = import.meta.env.VITE_API_BASE_URL || '';
export const API_BASE = `${API_ROOT}/api`;

async function request(path, options = {}) {
  const token = localStorage.getItem('accessToken');
  const headers = { ...options.headers };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // Try to refresh token on 401
  if (res.status === 401 && !options._retried) {
    const refreshToken = localStorage.getItem('refreshToken');
    if (refreshToken) {
      const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (refreshRes.ok) {
        const data = await refreshRes.json();
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        return request(path, { ...options, _retried: true });
      }
    }

    // Refresh failed, clear auth
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || 'Request failed');
  }

  if (options._raw) return res;

  return res.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  delete: (path, body) => request(path, { method: 'DELETE', ...(body && { body }) }),
  upload: (path, formData) => request(path, { method: 'POST', body: formData }),
  download: async (path, filename) => {
    const res = await request(path, { _raw: true });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
