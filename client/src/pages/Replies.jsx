import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import ReplyList from '../components/ReplyList';

export default function Replies() {
  const [replies, setReplies] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/replies')
      .then(setReplies)
      .catch((err) => setError(err.message || 'Failed to load replies'));
  }, []);

  if (error) return <div className="text-red-600 text-sm">{error}</div>;
  if (replies === null) return <div className="text-gray-500 text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Replies</h1>
        <p className="text-sm text-gray-500 mt-1">
          Vendor replies forwarded into Proof via Resend. The full email is also in the inbox configured in Resend.
        </p>
      </div>
      <ReplyList
        replies={replies}
        showVendor
        emptyText="No vendor replies yet. Replies to outbound Proof emails will appear here."
      />
    </div>
  );
}
