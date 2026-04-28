import { useState } from 'react';
import { api } from '../utils/api';
import { useToast } from '../contexts/ToastContext';

export default function EmailVerificationBanner() {
  const toast = useToast();
  const [sending, setSending] = useState(false);

  const handleResend = async () => {
    setSending(true);
    try {
      await api.post('/auth/resend-verification');
      toast.success('Verification email sent! Check your inbox.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-2.5 text-sm text-yellow-800 flex items-center justify-between gap-3">
      <span>Please verify your email address to unlock all features.</span>
      <button
        onClick={handleResend}
        disabled={sending}
        className="text-yellow-900 font-medium hover:underline whitespace-nowrap disabled:opacity-50"
      >
        {sending ? 'Sending...' : 'Resend email'}
      </button>
    </div>
  );
}
