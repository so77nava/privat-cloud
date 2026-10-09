import { useEffect, useRef, useState } from 'react';
import { auth, files } from '../api.js';
import { folderPaths } from '../utils.js';
import { FolderIcon, HomeIcon, XIcon } from './Icons.jsx';

export function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal card ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen"><XIcon /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Führt eine async Aktion aus und zeigt Fehler direkt im Dialog an. */
function useSubmit(action, onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (...args) => {
    setBusy(true);
    setError('');
    try {
      await action(...args);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export function PromptDialog({ title, label, initialValue = '', confirmLabel, selectBaseName, onSubmit, onClose }) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef(null);
  const { busy, error, run } = useSubmit(onSubmit, onClose);

  useEffect(() => {
    const input = inputRef.current;
    input.focus();
    // Beim Umbenennen nur den Namen ohne Endung markieren.
    const dot = initialValue.lastIndexOf('.');
    if (selectBaseName && dot > 0) input.setSelectionRange(0, dot);
    else input.select();
  }, [initialValue, selectBaseName]);

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); run(value.trim()); }}>
        <label className="field">
          <span>{label}</span>
          <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} maxLength={255} required />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" disabled={busy || !value.trim()}>{confirmLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmDialog({ title, message, confirmLabel = 'Löschen', onConfirm, onClose }) {
  const { busy, error, run } = useSubmit(onConfirm, onClose);
  return (
    <Modal title={title} onClose={onClose}>
      <p>{message}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose} autoFocus>Abbrechen</button>
        <button className="btn btn-danger" disabled={busy} onClick={() => run()}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}

/**
 * Zielordner wählen. Beim Verschieben eines Ordners werden er selbst und seine
 * Unterordner ausgeblendet (das Backend prüft das zusätzlich).
 */
export function MoveDialog({ item, isFolder, currentFolderId, onSubmit, onClose }) {
  const [folders, setFolders] = useState(null);
  const [target, setTarget] = useState(currentFolderId ?? 'root');
  const { busy, error, setError, run } = useSubmit(onSubmit, onClose);

  useEffect(() => {
    files.allFolders()
      .then((list) => {
        let candidates = list;
        if (isFolder) {
          const excluded = new Set([item.id]);
          let grew = true;
          while (grew) {
            grew = false;
            for (const f of list) {
              if (!excluded.has(f.id) && excluded.has(f.parentId)) {
                excluded.add(f.id);
                grew = true;
              }
            }
          }
          candidates = list.filter((f) => !excluded.has(f.id));
        }
        setFolders(folderPaths(candidates));
      })
      .catch((err) => setError(err.message));
  }, [item.id, isFolder, setError]);

  const unchanged = String(target) === String(currentFolderId ?? 'root');

  return (
    <Modal title={`„${item.name}“ verschieben`} onClose={onClose}>
      <div className="folder-picker" role="listbox" aria-label="Zielordner">
        <button
          type="button"
          role="option"
          aria-selected={target === 'root'}
          className={`folder-option ${target === 'root' ? 'selected' : ''}`}
          onClick={() => setTarget('root')}
        >
          <HomeIcon size={16} /> Hauptverzeichnis
        </button>
        {folders === null && !error && <p className="muted small">Lädt …</p>}
        {folders?.map((f) => (
          <button
            key={f.id}
            type="button"
            role="option"
            aria-selected={target === f.id}
            className={`folder-option ${target === f.id ? 'selected' : ''}`}
            onClick={() => setTarget(f.id)}
          >
            <FolderIcon size={16} /> {f.path}
          </button>
        ))}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button
          className="btn btn-primary"
          disabled={busy || unchanged}
          onClick={() => run(target === 'root' ? null : target)}
        >
          Hierher verschieben
        </button>
      </div>
    </Modal>
  );
}

export function PasswordDialog({ onDone, onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const { busy, error, setError, run } = useSubmit(
    () => auth.changePassword(current, next),
    () => { onDone(); onClose(); },
  );

  const submit = (e) => {
    e.preventDefault();
    if (next !== repeat) return setError('Die neuen Passwörter stimmen nicht überein.');
    run();
  };

  return (
    <Modal title="Passwort ändern" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field">
          <span>Aktuelles Passwort</span>
          <input type="password" autoComplete="current-password" autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="field">
          <span>Neues Passwort</span>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        <label className="field">
          <span>Neues Passwort wiederholen</span>
          <input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
        </label>
        <p className="muted small">Alle anderen Sitzungen werden dabei abgemeldet.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn btn-primary" disabled={busy}>Passwort ändern</button>
        </div>
      </form>
    </Modal>
  );
}
