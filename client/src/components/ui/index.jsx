// Shared primitives for the Proof UI. Every screen composes these so the
// palette, radii and type scale live in one place rather than in a hundred
// class strings.

const TONE_PILL = {
  ok: 'bg-ok-bg text-ok-text',
  warn: 'bg-warn-bg text-warn-text',
  bad: 'bg-bad-bg text-bad-text',
  info: 'bg-info-bg text-info-text',
  none: 'bg-none-bg text-none-text',
};

const TONE_CHIP = {
  ok: 'bg-ok-bg text-ok-text',
  warn: 'bg-warn-bg text-warn-text',
  bad: 'bg-bad-bg text-bad-text',
  none: 'bg-none-chip-bg text-none-chip-text',
};

const TONE_DOT = {
  ok: 'bg-ok',
  warn: 'bg-amber',
  bad: 'bg-bad',
  info: 'bg-navy',
  none: 'bg-[#c9c3b8]',
};

export function StatusPill({ tone = 'none', children, className = '' }) {
  return (
    <span className={`inline-block rounded-pill px-[9px] py-[3px] text-[11px] font-bold whitespace-nowrap ${TONE_PILL[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function CoverageChip({ tone = 'none', children, title }) {
  return (
    <span title={title} className={`inline-block rounded-chip px-1.5 py-0.5 text-[10px] font-bold ${TONE_CHIP[tone]}`}>
      {children}
    </span>
  );
}

export function Dot({ tone = 'none', className = '' }) {
  return <span className={`block w-2 h-2 rounded-full flex-none ${TONE_DOT[tone]} ${className}`} />;
}

const BUTTON_VARIANTS = {
  amber: 'bg-amber text-white border border-amber hover:bg-amber-hover hover:border-amber-hover',
  navy: 'bg-navy text-white border border-navy hover:bg-navy-hover hover:border-navy-hover',
  secondary: 'bg-white text-navy border border-line-strong hover:border-navy',
  danger: 'bg-white text-bad-text border border-bad-line hover:bg-bad-bg',
  approve: 'bg-ok text-white border border-ok hover:bg-ok-text hover:border-ok-text',
  ghost: 'bg-transparent text-muted border border-transparent hover:text-navy',
};

export function Button({ variant = 'secondary', size = 'md', className = '', as: As = 'button', ...props }) {
  const sizing = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-3.5 py-[9px] text-[13px]';
  return (
    <As
      className={`inline-flex items-center justify-center gap-1.5 rounded-control font-semibold whitespace-nowrap
        transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed
        ${sizing} ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

// 36x20 pill with a 16px knob, per the design tokens.
export function Toggle({ checked, onChange, disabled = false, label, size = 'md' }) {
  const w = size === 'sm' ? 'w-8 h-[18px]' : 'w-9 h-5';
  const knob = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const travel = size === 'sm' ? 'translate-x-[14px]' : 'translate-x-4';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative flex-none rounded-full transition-colors duration-150 disabled:opacity-50
        ${w} ${checked ? 'bg-ok' : 'bg-line-strong'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 rounded-full bg-white transition-transform duration-150
          ${knob} ${checked ? travel : 'translate-x-0'}`}
      />
    </button>
  );
}

export function Card({ className = '', children, ...props }) {
  return (
    <div className={`bg-white border border-line rounded-card ${className}`} {...props}>
      {children}
    </div>
  );
}

// Card header with an optional right-hand slot — the pattern every section uses.
export function CardHeader({ title, note, action, className = '' }) {
  return (
    <div className={`flex items-center justify-between gap-4 px-5 py-4 ${className}`}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold text-navy truncate">{title}</h2>
        {note && <p className="text-xs text-muted mt-0.5">{note}</p>}
      </div>
      {action}
    </div>
  );
}

export function Eyebrow({ children, tone = 'muted', dot = false, pulse = false, className = '' }) {
  const color = tone === 'amber' ? 'text-amber-text' : tone === 'on-navy' ? 'text-amber-light' : 'text-muted';
  return (
    <span className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] ${color} ${className}`}>
      {dot && (
        <span className={`w-[7px] h-[7px] rounded-full flex-none ${tone === 'on-navy' ? 'bg-amber-light' : 'bg-amber'} ${pulse ? 'animate-proof-pulse' : ''}`} />
      )}
      {children}
    </span>
  );
}

export function Input({ className = '', ...props }) {
  return (
    <input
      className={`px-3 py-2 rounded-control border border-line-strong bg-white text-[13px] text-ink
        placeholder:text-faint focus:outline-none focus:border-navy transition-colors duration-150 ${className}`}
      {...props}
    />
  );
}

export function Select({ className = '', children, ...props }) {
  return (
    <select
      className={`px-3 py-2 rounded-control border border-line-strong bg-white text-[13px] text-ink
        focus:outline-none focus:border-navy transition-colors duration-150 ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

// Filter chip — the selected one goes solid navy.
export function Chip({ active, className = '', size = 'md', ...props }) {
  const sizing = size === 'sm' ? 'px-2.5 py-[5px] text-xs rounded-[6px]' : 'px-3 py-2 text-[13px] rounded-control';
  return (
    <button
      type="button"
      className={`font-semibold whitespace-nowrap border transition-colors duration-150 ${sizing}
        ${active ? 'bg-navy border-navy text-white' : 'bg-white border-line-strong text-ink-2 hover:border-navy'}
        ${className}`}
      {...props}
    />
  );
}

export function PageTitle({ children, count, className = '' }) {
  return (
    <h1 className={`text-[28px] font-extrabold tracking-[-0.03em] text-navy ${className}`}>
      {children}
      {count != null && <span className="text-faint font-extrabold"> {count}</span>}
    </h1>
  );
}

// Column header row used by every table.
export function Th({ children, className = '' }) {
  return (
    <th className={`text-left px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-muted ${className}`}>
      {children}
    </th>
  );
}

export function EmptyState({ children, action }) {
  return (
    <div className="px-5 py-14 text-center">
      <p className="text-[13px] text-muted">{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
