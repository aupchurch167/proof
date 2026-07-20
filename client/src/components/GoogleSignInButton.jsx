import { useEffect, useRef } from 'react';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GIS_SRC = 'https://accounts.google.com/gsi/client';

let scriptPromise = null;

// Load the Google Identity Services script once and resolve when window.google
// is available.
function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Sign-In')));
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Sign-In'));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

/**
 * Renders the official "Sign in with Google" button. Calls onCredential with the
 * returned ID token (JWT). Renders nothing when VITE_GOOGLE_CLIENT_ID is unset.
 */
export default function GoogleSignInButton({ onCredential, onError, text = 'continue_with' }) {
  const containerRef = useRef(null);
  const callbackRef = useRef(onCredential);
  callbackRef.current = onCredential;

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;

    loadGis()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => {
            if (response?.credential) callbackRef.current(response.credential);
          },
        });
        containerRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(containerRef.current, {
          theme: 'outline',
          size: 'large',
          text,
          width: 320,
          logo_alignment: 'center',
        });
      })
      .catch((err) => {
        if (!cancelled && onError) onError(err);
      });

    return () => { cancelled = true; };
  }, [text, onError]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <div className="my-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-px bg-gray-200 flex-1" />
        <span className="text-xs uppercase tracking-wide text-gray-400">or</span>
        <div className="h-px bg-gray-200 flex-1" />
      </div>
      <div ref={containerRef} className="flex justify-center" />
    </div>
  );
}
