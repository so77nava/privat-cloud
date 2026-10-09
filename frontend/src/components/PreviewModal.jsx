import { useEffect, useState } from 'react';
import { downloadFile, files } from '../api.js';
import { fileKind, formatDate, formatSize } from '../utils.js';
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, XIcon } from './Icons.jsx';

const MAX_TEXT_CHARS = 500_000;

function TextPreview({ file }) {
  const [text, setText] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError('');
    fetch(files.previewUrl(file.id), { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`Fehler ${res.status}`))))
      .then((t) => !cancelled && setText(t))
      .catch((err) => !cancelled && setError(err.message));
    return () => { cancelled = true; };
  }, [file.id]);

  if (error) return <p className="form-error">{error}</p>;
  if (text === null) return <div className="spinner" />;
  return (
    <pre className="text-preview">
      {text.slice(0, MAX_TEXT_CHARS)}
      {text.length > MAX_TEXT_CHARS && '\n\n… (gekürzt – für den vollständigen Inhalt bitte herunterladen)'}
    </pre>
  );
}

export default function PreviewModal({ file, siblings, onNavigate, onClose }) {
  const index = siblings.findIndex((f) => f.id === file.id);
  const prev = index > 0 ? siblings[index - 1] : null;
  const next = index < siblings.length - 1 ? siblings[index + 1] : null;
  const kind = fileKind(file.name);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && prev) onNavigate(prev);
      else if (e.key === 'ArrowRight' && next) onNavigate(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onNavigate, onClose]);

  let body;
  if (kind === 'image') body = <img className="image-preview" src={files.previewUrl(file.id)} alt={file.name} />;
  else if (kind === 'pdf') body = <iframe className="pdf-preview" src={files.previewUrl(file.id)} title={file.name} />;
  else body = <TextPreview file={file} />;

  return (
    <div className="preview-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="preview" role="dialog" aria-modal="true" aria-label={`Vorschau: ${file.name}`}>
        <div className="preview-header">
          <div className="preview-title">
            <strong title={file.name}>{file.name}</strong>
            <span className="muted small">{formatSize(file.size)} · {formatDate(file.createdAt)}</span>
          </div>
          <div className="preview-actions">
            <button className="icon-btn" disabled={!prev} onClick={() => onNavigate(prev)} aria-label="Vorherige Datei">
              <ChevronLeftIcon />
            </button>
            <span className="muted small">{index + 1} / {siblings.length}</span>
            <button className="icon-btn" disabled={!next} onClick={() => onNavigate(next)} aria-label="Nächste Datei">
              <ChevronRightIcon />
            </button>
            <button className="icon-btn" onClick={() => downloadFile(file.id)} aria-label="Herunterladen">
              <DownloadIcon />
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="Schließen"><XIcon /></button>
          </div>
        </div>
        <div className="preview-body" key={file.id}>{body}</div>
      </div>
    </div>
  );
}
