import { useState } from 'react';
import { auth } from '../api.js';
import { CloudIcon, MoonIcon, SunIcon } from './Icons.jsx';

export default function AuthScreen({ mode, theme, onToggleTheme, onSuccess }) {
  const isSetup = mode === 'setup';
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (isSetup) {
      if (password !== repeat) return setError('Die Passwörter stimmen nicht überein.');
    }
    setBusy(true);
    try {
      await (isSetup ? auth.setup(password, setupCode) : auth.login(password));
      onSuccess();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="center-screen">
      <button
        className="icon-btn theme-corner"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
      >
        {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
      </button>
      <form className="card auth-card" onSubmit={submit}>
        <div className="auth-logo"><CloudIcon size={36} /></div>
        <h1>Privat Cloud</h1>
        <p className="muted">
          {isSetup
            ? 'Willkommen! Lege ein Passwort fest, um deine Cloud einzurichten.'
            : 'Bitte gib dein Passwort ein.'}
        </p>

        {isSetup && (
          <label className="field">
            <span>Einrichtungscode</span>
            <input
              autoFocus
              autoComplete="off"
              spellCheck="false"
              placeholder="XXXX-XXXX"
              value={setupCode}
              onChange={(e) => setSetupCode(e.target.value)}
              required
            />
            <small className="muted field-hint">
              Steht beim ersten Start im Server-Log, z.&nbsp;B. über <code>docker compose logs privat-cloud</code>.
            </small>
          </label>
        )}
        <label className="field">
          <span>Passwort</span>
          <input
            type="password"
            autoFocus={!isSetup}
            autoComplete={isSetup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {isSetup && (
          <label className="field">
            <span>Passwort wiederholen</span>
            <input
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
            />
          </label>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}

        <button className="btn btn-primary btn-block" disabled={busy || !password || (isSetup && !setupCode.trim())}>
          {busy ? 'Bitte warten …' : isSetup ? 'Einrichten' : 'Anmelden'}
        </button>
      </form>
    </div>
  );
}
