import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { API_BASE } from '../utils/api';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-card-alt">
        <div className="max-w-md w-full">
          <div className="bg-white p-8 rounded-card shadow-sm border text-center">
            <h2 className="text-xl font-semibold mb-4">Invalid Reset Link</h2>
            <p className="text-muted text-sm mb-4">This password reset link is invalid or missing a token.</p>
            <Link to="/forgot-password" className="text-navy hover:underline text-sm">Request a new reset link</Link>
          </div>
        </div>
      </div>
    );
  }

  const validatePassword = (pw) => {
    if (pw.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(pw)) return 'Password must contain at least one uppercase letter';
    if (!/[0-9]/.test(pw)) return 'Password must contain at least one number';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      return setError('Passwords do not match');
    }

    const pwError = validatePassword(newPassword);
    if (pwError) {
      return setError(pwError);
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }
      navigate('/login?reset=success');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-card-alt">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Proof</h1>
          <p className="text-muted mt-2">COI Management</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white p-8 rounded-card shadow-sm border">
          <h2 className="text-xl font-semibold mb-2">Set new password</h2>
          <p className="text-sm text-muted mb-6">Must be at least 8 characters with one uppercase letter and one number.</p>
          {error && <div className="bg-bad-bg text-bad-text px-4 py-3 rounded-control mb-4 text-sm">{error}</div>}
          <div className="mb-4">
            <label className="block text-sm font-medium text-ink-2 mb-1">New password</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required
              className="w-full px-3 py-2 border rounded-control focus:ring-2 focus:ring-navy focus:border-transparent" />
          </div>
          <div className="mb-6">
            <label className="block text-sm font-medium text-ink-2 mb-1">Confirm password</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required
              className="w-full px-3 py-2 border rounded-control focus:ring-2 focus:ring-navy focus:border-transparent" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-amber text-white py-2.5 rounded-control hover:bg-amber-hover disabled:opacity-50 font-medium">
            {loading ? 'Resetting...' : 'Reset password'}
          </button>
          <p className="text-center mt-4 text-sm text-muted">
            <Link to="/login" className="text-navy hover:underline">Back to sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
