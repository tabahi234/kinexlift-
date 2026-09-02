import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type ToastTone = 'ok' | 'error' | 'neutral' | 'warn';

export interface ToastMessage {
  id: string;
  tone: ToastTone;
  text: string;
}

interface ToastContextType {
  showToast: (text: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((text: string, tone: ToastTone = 'neutral') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, text, tone }]);
    // Auto dismiss after 4 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
