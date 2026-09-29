import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext(() => {});
const TOAST_MS = 3800;
const MAX_TOASTS = 3;

// Toplantı ekranı bildirimleri: üstte ortada, iOS bildirim bandı gibi koyu hap.
// toast('Metin') ya da toast('Metin', { tone: 'warning' | 'success' })
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const toast = useCallback((message, { tone = 'info' } = {}) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.filter((t) => t.message !== message), { id, message, tone }].slice(-MAX_TOASTS));
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), TOAST_MS);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <span className="toast-dot" aria-hidden="true" />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
