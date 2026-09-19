import { useState, useRef } from 'react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailTagInput({ value = [], onChange, placeholder = 'Add email...' }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  function addEmail(raw) {
    const email = raw.trim();
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      setError(`"${email}" is not a valid email`);
      return;
    }
    if (value.some(e => e.toLowerCase() === email.toLowerCase())) {
      setError(`"${email}" is already added`);
      return;
    }
    setError('');
    onChange([...value, email]);
    setInput('');
  }

  function removeEmail(index) {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',') {
      e.preventDefault();
      addEmail(input);
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeEmail(value.length - 1);
    }
  }

  function handlePaste(e) {
    e.preventDefault();
    const text = e.clipboardData.getData('text');
    const emails = text.split(/[,;\s]+/).filter(Boolean);
    const newEmails = [];
    for (const raw of emails) {
      const email = raw.trim();
      if (EMAIL_RE.test(email) && !value.some(e => e.toLowerCase() === email.toLowerCase()) && !newEmails.some(e => e.toLowerCase() === email.toLowerCase())) {
        newEmails.push(email);
      }
    }
    if (newEmails.length > 0) {
      onChange([...value, ...newEmails]);
      setInput('');
      setError('');
    }
  }

  function handleBlur() {
    if (input.trim()) {
      addEmail(input);
    }
  }

  return (
    <div>
      <div
        className="flex flex-wrap gap-1.5 px-3 py-2 border rounded-control min-h-[42px] cursor-text bg-white"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((email, i) => (
          <span key={i} className="inline-flex items-center gap-1 bg-info-bg text-info-text px-2 py-0.5 rounded text-sm">
            {email}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeEmail(i); }}
              className="text-faint hover:text-navy text-xs leading-none"
            >
              &times;
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(''); }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={handleBlur}
          placeholder={value.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] outline-none text-sm py-0.5 bg-transparent"
        />
      </div>
      {error && <p className="text-xs text-bad-text mt-1">{error}</p>}
    </div>
  );
}
