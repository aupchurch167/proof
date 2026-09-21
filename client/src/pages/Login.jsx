import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import GoogleSignInButton from '../components/GoogleSignInButton';

export default function Login() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const resetSuccess = searchParams.get('reset') === 'success';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async (credential) => {
    setError('');
    try {
      await loginWithGoogle(credential);
      navigate('/');
    } catch (err) {
      setError(err.message);
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
          <h2 className="text-xl font-semibold mb-6">Sign in</h2>
          {resetSuccess && <div className="bg-ok-bg text-ok-text px-4 py-3 rounded-control mb-4 text-sm">Password reset successfully. Please sign in.</div>}
          {error && <div className="bg-bad-bg text-bad-text px-4 py-3 rounded-control mb-4 text-sm">{error}</div>}
          <div className="mb-4">
            <label className="block text-sm font-medium text-ink-2 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full px-3 py-2 border rounded-control focus:ring-2 focus:ring-navy focus:border-transparent" />
          </div>
          <div className="mb-6">
            <div className="flex justify-between items-center mb-1">
              <label className="block text-sm font-medium text-ink-2">Password</label>
              <Link to="/forgot-password" className="text-sm text-navy hover:underline">Forgot password?</Link>
            </div>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="w-full px-3 py-2 border rounded-control focus:ring-2 focus:ring-navy focus:border-transparent" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full bg-amber text-white py-2.5 rounded-control hover:bg-amber-hover disabled:opacity-50 font-medium">
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
          <GoogleSignInButton onCredential={handleGoogle} onError={(err) => setError(err.message)} text="signin_with" />
          <p className="text-center mt-4 text-sm text-muted">
            Don't have an account? <Link to="/signup" className="text-navy hover:underline">Sign up</Link>
          </p>
          <p className="text-center mt-2 text-xs text-faint">
            <Link to="/terms" className="hover:underline">Terms</Link>
            {' · '}
            <Link to="/privacy" className="hover:underline">Privacy</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
