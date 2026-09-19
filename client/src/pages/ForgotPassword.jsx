import { useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE } from '../utils/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Request failed');
      }
      setSubmitted(true);
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
        <div className="bg-white p-8 rounded-card shadow-sm border">
          <h2 className="text-xl font-semibold mb-2">Reset your password</h2>
          <p className="text-sm text-muted mb-6">Enter your email and we'll send you a reset link.</p>

          {submitted ? (
            <div>
              <div className="bg-ok-bg text-ok-text px-4 py-3 rounded-control mb-4 text-sm">
                If that email exists, you'll receive a reset link shortly.
              </div>
              <Link to="/login" className="text-sm text-navy hover:underline">Back to sign in</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {error && <div className="bg-bad-bg text-bad-text px-4 py-3 rounded-control mb-4 text-sm">{error}</div>}
              <div className="mb-6">
                <label className="block text-sm font-medium text-ink-2 mb-1">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                  className="w-full px-3 py-2 border rounded-control focus:ring-2 focus:ring-navy focus:border-transparent" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-amber text-white py-2.5 rounded-control hover:bg-amber-hover disabled:opacity-50 font-medium">
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
              <p className="text-center mt-4 text-sm text-muted">
                <Link to="/login" className="text-navy hover:underline">Back to sign in</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
