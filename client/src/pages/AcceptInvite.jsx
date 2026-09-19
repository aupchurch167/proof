import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

export default function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const token = searchParams.get('token');

  const [inviteInfo, setInviteInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ firstName: '', lastName: '', password: '', confirmPassword: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) {
      navigate('/');
      return;
    }
    if (!token) {
      setError('No invite token provided');
      setLoading(false);
      return;
    }
    api.get(`/auth/invite-info?token=${token}`)
      .then(setInviteInfo)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token, user, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setSubmitting(true);
    try {
      const data = await api.post('/auth/accept-invite', {
        token,
        firstName: form.firstName,
        lastName: form.lastName,
        password: form.password,
      });
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      window.location.href = '/';
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-card-alt">
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  if (error && !inviteInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-card-alt">
        <div className="max-w-md w-full bg-white rounded-card border p-8 text-center">
          <h1 className="text-2xl font-bold mb-4">Invalid Invite</h1>
          <p className="text-muted mb-6">{error}</p>
          <a href="/login" className="text-navy hover:underline">Go to login</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-card-alt px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Proof</h1>
          <p className="text-muted mt-2">Join <strong>{inviteInfo?.orgName}</strong></p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-card border p-6">
          <h2 className="text-lg font-semibold mb-1">Set up your account</h2>
          <p className="text-sm text-muted mb-4">You're joining as <strong>{inviteInfo?.email}</strong></p>

          {error && (
            <div className="bg-bad-bg text-bad-text px-4 py-3 rounded-control mb-4 text-sm">{error}</div>
          )}

          <div className="space-y-4 mb-6">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-1">First Name</label>
                <input
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  className="w-full px-3 py-2.5 border rounded-control"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-1">Last Name</label>
                <input
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  className="w-full px-3 py-2.5 border rounded-control"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full px-3 py-2.5 border rounded-control"
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">Confirm Password</label>
              <input
                type="password"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                className="w-full px-3 py-2.5 border rounded-control"
                required
                minLength={8}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-amber text-white py-2.5 rounded-control hover:bg-amber-hover disabled:opacity-50 font-medium"
          >
            {submitting ? 'Setting up...' : 'Join Organization'}
          </button>
        </form>
      </div>
    </div>
  );
}
