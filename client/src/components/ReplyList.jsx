import { useState } from 'react';
import { Link } from 'react-router-dom';

function ReplyRow({ reply, showVendor }) {
  const [open, setOpen] = useState(false);
  const subject = reply.subject || '(no subject)';
  const received = new Date(reply.receivedAt).toLocaleString();
  const preview = (reply.preview || '').trim();
  const truncated = preview.length > 160;
  const shortPreview = truncated ? preview.slice(0, 160) + '…' : preview;

  return (
    <div className="bg-white rounded-xl border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left p-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-baseline gap-1">
          <div className="flex-1 min-w-0">
            {showVendor && reply.vendor && (
              <Link
                to={`/vendors/${reply.vendor.id}`}
                onClick={(e) => e.stopPropagation()}
                className="text-sm font-medium text-blue-600 hover:underline"
              >
                {reply.vendor.name}
              </Link>
            )}
            {showVendor && !reply.vendor && (
              <span className="text-sm font-medium text-gray-400">Unknown vendor</span>
            )}
            <p className="text-sm font-medium truncate">{subject}</p>
            <p className="text-xs text-gray-500 truncate">{reply.from}</p>
          </div>
          <p className="text-xs text-gray-500 whitespace-nowrap">{received}</p>
        </div>
        {!open && shortPreview && (
          <p className="text-sm text-gray-600 mt-2 line-clamp-2 whitespace-pre-wrap">{shortPreview}</p>
        )}
      </button>
      {open && (
        <div className="px-4 pb-4 border-t pt-3">
          <p className="text-sm whitespace-pre-wrap text-gray-800">{preview}</p>
          {truncated && (
            <p className="text-xs text-gray-400 mt-2">
              (preview truncated to 1000 characters; full email is in your forwarding inbox)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReplyList({ replies, showVendor = true, emptyText = 'No replies yet.' }) {
  if (!replies || replies.length === 0) {
    return <p className="text-sm text-gray-500">{emptyText}</p>;
  }
  return (
    <div className="space-y-2">
      {replies.map((r) => (
        <ReplyRow key={r.id} reply={r} showVendor={showVendor} />
      ))}
    </div>
  );
}
