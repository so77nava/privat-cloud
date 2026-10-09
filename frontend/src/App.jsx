import { useCallback, useEffect, useRef, useState } from 'react';
import { auth, onUnauthorized, refreshSession } from './api.js';
import { ToastContext, useTheme } from './hooks.js';
import AuthScreen from './components/AuthScreen.jsx';
import FileManager from './components/FileManager.jsx';
import { XIcon } from './components/Icons.jsx';

export default function App() {
  // loading | offline | setup | login | ready
  const [view, setView] = useState('loading');
  const [theme, toggleTheme] = useTheme();
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  const notify = useCallback((message, type = 'success') => {
    const id = ++toastId.current;
    setToasts((list) => [...list, { id, message, type }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), type === 'error' ? 6000 : 3500);
  }, []);

  const checkAuth = useCallback(async () => {
    setView('loading');
    try {
      const status = await auth.status();
      if (status.setupRequired) return setView('setup');
      if (status.authenticated || (await refreshSession())) return setView('ready');
      setView('login');
    } catch {
      setView('offline');
    }
  }, []);

  useEffect(() => {
    onUnauthorized(() => {
      setView((current) => {
        if (current === 'ready') notify('Sitzung abgelaufen – bitte erneut anmelden.', 'error');
        return 'login';
      });
    });
    checkAuth();
  }, [checkAuth, notify]);

  const logout = async () => {
    await auth.logout().catch(() => {});
    setView('login');
  };

  let content;
  if (view === 'loading') {
    content = <div className="center-screen"><div className="spinner" aria-label="Lädt" /></div>;
  } else if (view === 'offline') {
    content = (
      <div className="center-screen">
        <div className="card auth-card">
          <h1>Server nicht erreichbar</h1>
          <p className="muted">Läuft das Backend?</p>
          <button className="btn btn-primary" onClick={checkAuth}>Erneut versuchen</button>
        </div>
      </div>
    );
  } else if (view === 'setup' || view === 'login') {
    content = (
      <AuthScreen
        mode={view}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSuccess={() => setView('ready')}
      />
    );
  } else {
    content = <FileManager theme={theme} onToggleTheme={toggleTheme} onLogout={logout} />;
  }

  return (
    <ToastContext.Provider value={notify}>
      {content}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span>{t.message}</span>
            <button
              className="icon-btn"
              aria-label="Schließen"
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
            >
              <XIcon size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
