import { createContext, useCallback, useContext, useEffect, useState } from 'react';

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Hell/Dunkel-Modus: folgt dem System, bis der Nutzer selbst umschaltet. */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    const stored = readStorage('theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('theme', next);
      } catch { /* ignorieren */ }
      return next;
    });
  }, []);

  return [theme, toggle];
}

/** Aktueller Ordner aus der URL (#/ordner/12), damit Zurück-Button und Lesezeichen funktionieren. */
export function useFolderRoute() {
  const parse = () => {
    const match = window.location.hash.match(/^#\/ordner\/(\d+)$/);
    return match ? Number(match[1]) : null;
  };
  const [folderId, setFolderId] = useState(parse);

  useEffect(() => {
    const onChange = () => setFolderId(parse());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((id) => {
    window.location.hash = id == null ? '#/' : `#/ordner/${id}`;
  }, []);

  return [folderId, navigate];
}

export const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);
