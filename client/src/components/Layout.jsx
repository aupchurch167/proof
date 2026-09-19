import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../utils/api';
import EmailVerificationBanner from './EmailVerificationBanner';

// Badge counts come from the compliance summary so the sidebar always agrees
// with the dashboard. Gaps = the vendors a person has to chase; review = the
// queue waiting on someone here.
const NAV = [
  { path: '/', label: 'Dashboard' },
  { path: '/vendors', label: 'Vendors', badge: 'gaps' },
  { path: '/cois', label: 'Review queue', badge: 'review' },
  { path: '/requirements', label: 'Requirements' },
  { path: '/reminders', label: 'Reminders' },
  { path: '/audit', label: 'Audit log' },
  { path: '/import', label: 'Import' },
  { path: '/settings', label: 'Settings' },
];

function Logo({ orgName }) {
  return (
    <div className="px-5 pt-[22px] pb-[18px] flex items-center gap-2.5">
      <span className="w-7 h-7 rounded-[7px] bg-amber flex items-center justify-center text-white font-extrabold text-[15px] flex-none">
        P
      </span>
      <div className="flex flex-col min-w-0">
        <span className="font-extrabold text-[17px] tracking-[-0.02em] leading-[1.1] text-white">Proof</span>
        {orgName && <span className="text-[11px] text-on-navy-4 truncate">{orgName}</span>}
      </div>
    </div>
  );
}

function initials(first, last) {
  return `${(first || '')[0] || ''}${(last || '')[0] || ''}`.toUpperCase() || '?';
}

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [counts, setCounts] = useState({ gaps: 0, review: 0 });
  const [plan, setPlan] = useState(null);
  const [portalToken, setPortalToken] = useState(null);

  // Badges and the plan meter are ambient — a failure here must never take the
  // shell down with it. They load once and refresh on a slow timer rather than
  // on every navigation, which would otherwise add two requests to every click.
  useEffect(() => {
    let cancelled = false;

    const load = () => {
      api.get('/reports/compliance')
        .then((s) => {
          if (cancelled) return;
          setCounts({ gaps: (s.nonCompliant || 0) + (s.expired || 0), review: s.pending || 0 });
        })
        .catch(() => {});
      api.get('/organization/usage')
        .then((u) => {
          if (cancelled) return;
          setPlan(u);
          setPortalToken(u.portalPreviewToken);
        })
        .catch(() => {});
    };

    load();
    const timer = setInterval(load, 120000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const isActive = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <div className="min-h-screen flex bg-canvas">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-navy-deep/60 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-56 flex-none bg-navy text-white flex flex-col
          transform transition-transform duration-200 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          md:sticky md:top-0 md:h-screen md:translate-x-0 md:z-auto`}
      >
        <div className="flex items-start justify-between">
          <Logo orgName={user?.orgName} />
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden text-on-navy-3 hover:text-white p-4"
            aria-label="Close menu"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="px-3 py-1.5 flex flex-col gap-0.5 flex-1 overflow-y-auto">
          {NAV.map((item) => {
            const active = isActive(item.path);
            const badge = item.badge ? counts[item.badge] : 0;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-2 px-3 py-[9px] rounded-control text-sm transition-colors duration-150
                  ${active
                    ? 'bg-white/[.12] text-white font-bold'
                    : 'text-on-navy-3 font-medium hover:bg-white/[.08] hover:text-white'}`}
              >
                <span className="flex-1 text-left">{item.label}</span>
                {badge > 0 && (
                  <span className="text-[11px] font-bold bg-amber text-white px-[7px] py-px rounded-pill">{badge}</span>
                )}
              </Link>
            );
          })}
          {portalToken && (
            <a
              href={`/portal/${portalToken}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-3 py-[9px] rounded-control text-sm font-medium
                text-on-navy-3 hover:bg-white/[.08] hover:text-white transition-colors duration-150"
            >
              <span className="flex-1 text-left">Vendor portal ↗</span>
            </a>
          )}
        </nav>

        <div className="px-5 py-3.5 border-t border-white/10 flex flex-col gap-2">
          {plan && (
            <>
              <div className="flex justify-between items-center text-xs whitespace-nowrap">
                <span className="text-on-navy-3">{plan.planLabel} plan</span>
                <span className="text-on-navy-4">
                  {plan.vendors.used} / {plan.vendors.limit ?? '∞'} vendors
                </span>
              </div>
              <div className="h-1 rounded-sm bg-white/[.12]">
                <div
                  className="h-full rounded-sm bg-amber transition-[width] duration-300"
                  style={{ width: `${Math.min(100, plan.vendors.percent || 0)}%` }}
                />
              </div>
            </>
          )}
          <div className="flex items-center gap-2.5 mt-1.5">
            <span className="w-7 h-7 rounded-full bg-navy-hover flex items-center justify-center text-[11px] font-bold flex-none">
              {initials(user?.firstName, user?.lastName)}
            </span>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[13px] font-semibold truncate" title={`${user?.firstName || ''} ${user?.lastName || ''}`}>
                {user?.firstName} {user?.lastName}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-on-navy-4 capitalize">{(user?.role || '').toLowerCase()}</span>
                <button onClick={logout} className="text-[11px] text-on-navy-4 hover:text-white underline-offset-2 hover:underline">
                  Log out
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden bg-white border-b border-line px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
          <button onClick={() => setSidebarOpen(true)} className="p-2 -ml-2 text-muted hover:text-navy" aria-label="Open menu">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="w-7 h-7 rounded-[7px] bg-amber flex items-center justify-center text-white font-extrabold text-[15px]">
            P
          </span>
        </header>

        {user && !user.emailVerified && <EmailVerificationBanner />}
        <main className="flex-1 min-w-0 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
