import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { API_BASE } from '../utils/api';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState('verifying');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setError('No verification token provided');
      return;
    }

    fetch(`${API_BASE}/auth/verify-email?token=${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Verification failed');
        }
        setStatus('success');
      })
      .catch((err) => {
        setStatus('error');
        setError(err.message);
      });
  }, [token]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Proof</h1>
          <p className="text-gray-500 mt-2">COI Management</p>
        </div>
        <div className="bg-white p-8 rounded-xl shadow-sm border text-center">
          {status === 'verifying' && (
            <p className="text-gray-500">Verifying your email...</p>
          )}
          {status === 'success' && (
            <div>
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-green-600 text-xl">✓</span>
              </div>
              <h2 className="text-xl font-semibold mb-2">Email Verified</h2>
              <p className="text-gray-500 text-sm mb-4">Your email has been verified successfully.</p>
              <Link to="/" className="text-blue-600 hover:underline text-sm">Go to Dashboard</Link>
            </div>
          )}
          {status === 'error' && (
            <div>
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-red-600 text-xl">✕</span>
              </div>
              <h2 className="text-xl font-semibold mb-2">Verification Failed</h2>
              <p className="text-gray-500 text-sm mb-4">{error}</p>
              <Link to="/" className="text-blue-600 hover:underline text-sm">Go to Dashboard</Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
