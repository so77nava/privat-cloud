import { formatSize } from '../utils.js';
import { XIcon } from './Icons.jsx';

const STATUS_LABEL = {
  queued: 'Wartet',
  uploading: 'Lädt hoch',
  done: 'Fertig',
  error: 'Fehler',
};

export default function UploadPanel({ uploads, onCancel, onClear }) {
  if (uploads.length === 0) return null;
  const finished = uploads.filter((u) => u.status === 'done' || u.status === 'error').length;
  const running = uploads.length - finished;

  return (
    <section className="upload-panel card" aria-label="Uploads">
      <div className="upload-panel-header">
        <strong>{running > 0 ? `${running} Upload(s) aktiv` : 'Uploads abgeschlossen'}</strong>
        {finished > 0 && <button className="btn btn-small" onClick={onClear}>Erledigte ausblenden</button>}
      </div>
      <ul className="upload-list">
        {uploads.map((u) => (
          <li key={u.key} className={`upload-item upload-${u.status}`}>
            <div className="upload-info">
              <span className="upload-name" title={u.name}>{u.name}</span>
              <span className="muted small">
                {u.status === 'error' ? u.error : `${STATUS_LABEL[u.status]} · ${formatSize(u.size)}`}
              </span>
            </div>
            {(u.status === 'uploading' || u.status === 'queued') && (
              <>
                <progress max="1" value={u.progress} aria-label={`Fortschritt ${u.name}`} />
                <button className="icon-btn" onClick={() => onCancel(u.key)} aria-label="Abbrechen"><XIcon size={16} /></button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
