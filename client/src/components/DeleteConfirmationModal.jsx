import { useState } from 'react';

export default function DeleteConfirmationModal({
  isOpen,
  itemCount = 1,
  itemLabel = 'item',
  onConfirm,
  onCancel,
  loading = false,
}) {
  const [confirmText, setConfirmText] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleConfirm = async () => {
    if (confirmText !== 'DELETE') return;
    setError('');
    try {
      await onConfirm();
    } catch (err) {
      setError(err.message || 'Failed to delete');
    }
  };

  const handleCancel = () => {
    setConfirmText('');
    setError('');
    onCancel();
  };

  const pluralLabel = itemCount !== 1 ? `${itemLabel}s` : itemLabel;
  const countText = itemCount > 1 ? `${itemCount} ${pluralLabel}` : pluralLabel;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Delete {countText}?
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          This will permanently remove {itemCount > 1 ? 'these' : 'this'} {pluralLabel} and all associated data. This action cannot be undone.
        </p>
        <p className="text-sm font-medium text-gray-700 mb-2">
          Type <span className="font-mono font-bold text-red-600">DELETE</span> to confirm:
        </p>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="DELETE"
          className="w-full px-3 py-2 border rounded-lg text-sm mb-4 font-mono"
          autoFocus
          disabled={loading}
        />
        {error && (
          <div className="bg-red-50 text-red-600 px-3 py-2 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button
            onClick={handleCancel}
            className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirmText !== 'DELETE' || loading}
            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Deleting...' : `Delete ${countText}`}
          </button>
        </div>
      </div>
    </div>
  );
}
