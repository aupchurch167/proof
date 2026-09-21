import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import GoogleSignInButton from '../components/GoogleSignInButton';

export default function Signup() {
  const [form, setForm] = useState({ orgName: '', email: '', password: '', firstName: '', lastName: '' });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { signup, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (!acceptTerms) {
        setError('You must accept the Terms of Service and Privacy Policy');
        setLoading(false);
        return;
      }
      const data = await signup({ ...form, acceptTerms: true });
      if (data.accessToken) {
        navigate('/');
      } else {
        setError('');
        setSubmitted(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async (credential) => {
    setError('');
    if (!acceptTerms) {
      setError('You must accept the Terms of Service and Privacy Policy');
      return;
    }
    try {
      await loginWithGoogle(credential, form.orgName, { acceptTerms: true });
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
          <h2 className="text-xl font-semibold mb-1">Create your account</h2>
          <p className="text-sm text-muted mb-6">You'll be the admin for your organization. You can invite team members later.</p>
          {submitted && (
            <div className="bg-ok-bg text-ok-text px-4 py-3 rounded-control mb-4 text-sm">
              If this address is new, we sent a verification email.
            </div>
          )}
          {error && <div className="bg-bad-bg text-bad-text px-4 py-3 rounded-control mb-4 text-sm">{error}</div>}
          <div className="mb-4">
            <label className="block text-sm font-medium text-ink-2 mb-1">Company Name</label>
            <input name="orgName" value={form.orgName} onChange={handleChange} required
              className="w-full px-3 py-2 border rounded-control focus:ring-2 focus:ring-navy focus:border-transparent" />
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">First Name</label>
              <input name="firstName" value={form.firstName} onChange={handleChange} required
                className="w-full px-3 py-2 border rounded-control focus:ring-2 focus:ring-navy focus:border-transparent" />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-2 mb-1">Last Name</label>
              <input name="lastName" value={form.lastName} onChange={handleChange} required
                className="w-full px-3 py-2 border rounded-control focus:ring-2 focus:ring-navy focus:border-transparent" />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-ink-2 mb-1">Email</label>
            <input name="email" type="email" value={form.email} onChange={handleChange} required
              className="w-full px-3 py-2 border rounded-control focus:ring-2 focus:ring-navy focus:border-transparent" />
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-ink-2 mb-1">Password</label>
            <input name="password" type="password" value={form.password} onChange={handleChange} required minLength={8}
              className="w-full px-3 py-2 border rounded-control focus:ring-2 focus:ring-navy focus:border-transparent" />
          </div>
          <label className="flex items-start gap-2 mb-6 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={acceptTerms}
              onChange={(e) => setAcceptTerms(e.target.checked)}
              className="mt-1"
              required
            />
            <span>
              I accept the{' '}
              <Link to="/terms" target="_blank" className="text-navy hover:underline">Terms of Service</Link>
              {' '}and{' '}
              <Link to="/privacy" target="_blank" className="text-navy hover:underline">Privacy Policy</Link>
              {' '}
              <span className="text-muted">(draft — not counsel-approved)</span>.
            </span>
          </label>
          <button type="submit" disabled={loading}
            className="w-full bg-amber text-white py-2.5 rounded-control hover:bg-amber-hover disabled:opacity-50 font-medium">
            {loading ? 'Creating account...' : 'Create account'}
          </button>
          <GoogleSignInButton onCredential={handleGoogle} onError={(err) => setError(err.message)} text="signup_with" />
          <p className="text-center mt-4 text-sm text-muted">
            Already have an account? <Link to="/login" className="text-navy hover:underline">Sign in</Link>
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
