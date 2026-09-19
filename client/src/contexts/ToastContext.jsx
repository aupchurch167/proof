import { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext();

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const toast = {
    success: (msg) => addToast(msg, 'success'),
    error: (msg) => addToast(msg, 'error'),
    info: (msg) => addToast(msg, 'info'),
    warning: (msg) => addToast(msg, 'warning'),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-2.5 px-4 py-3 rounded-control shadow-lg
              bg-navy text-white text-[13px] font-medium animate-slide-in"
          >
            {/* A single amber accent carries the kind; the surface stays navy so
                toasts read as the app speaking, not as four different alerts. */}
            <span
              className={`w-1 self-stretch rounded-full flex-none ${
                t.type === 'success' ? 'bg-ok'
                  : t.type === 'error' ? 'bg-bad'
                  : t.type === 'warning' ? 'bg-amber'
                  : 'bg-amber-light'
              }`}
            />
            <span className="leading-[1.45]">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
