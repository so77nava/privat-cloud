// Zentrale API-Schicht. Die Tokens liegen in HttpOnly-Cookies (für JavaScript unsichtbar)
// und werden vom Browser automatisch mitgeschickt. Bei 401 wird einmalig per
// Refresh-Token eine neue Sitzung geholt und die Anfrage wiederholt.

const CSRF_HEADER = { 'X-Requested-With': 'privat-cloud' };

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let unauthorizedHandler = () => {};
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

function send(path, { method = 'GET', body } = {}) {
  const headers = { ...CSRF_HEADER };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function parse(res) {
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error || `Fehler ${res.status}`);
  return data;
}

let refreshing = null;
/** Holt per Refresh-Token neue Cookies. Parallele Aufrufe teilen sich einen Request. */
export function refreshSession() {
  refreshing ??= send('/auth/refresh', { method: 'POST' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

export async function api(path, options = {}) {
  let res = await send(path, options);
  if (res.status === 401 && !options.skipRefresh) {
    if (await refreshSession()) res = await send(path, options);
    if (res.status === 401) unauthorizedHandler();
  }
  return parse(res);
}

/** Stellt sicher, dass ein gültiges Access-Token-Cookie existiert (z. B. vor Downloads). */
export const ensureSession = () => api('/auth/me');

export const auth = {
  status: () => api('/auth/status', { skipRefresh: true }),
  setup: (password, setupCode) =>
    api('/auth/setup', { method: 'POST', body: { password, setupCode }, skipRefresh: true }),
  login: (password) => api('/auth/login', { method: 'POST', body: { password }, skipRefresh: true }),
  logout: () => api('/auth/logout', { method: 'POST', skipRefresh: true }),
  changePassword: (currentPassword, newPassword) =>
    api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
};

const folderParam = (folderId) => (folderId == null ? '' : `?folderId=${encodeURIComponent(folderId)}`);

export const files = {
  config: () => api('/config'),
  stats: () => api('/stats'),
  browse: (folderId) => api(`/browse${folderParam(folderId)}`),
  allFolders: () => api('/folders'),
  createFolder: (name, parentId) => api('/folders', { method: 'POST', body: { name, parentId } }),
  updateFolder: (id, changes) => api(`/folders/${id}`, { method: 'PATCH', body: changes }),
  deleteFolder: (id) => api(`/folders/${id}`, { method: 'DELETE' }),
  updateFile: (id, changes) => api(`/files/${id}`, { method: 'PATCH', body: changes }),
  deleteFile: (id) => api(`/files/${id}`, { method: 'DELETE' }),
  previewUrl: (id) => `/api/files/${id}/preview`,
  downloadUrl: (id) => `/api/files/${id}/download`,
};

export async function downloadFile(id) {
  await ensureSession();
  const link = document.createElement('a');
  link.href = files.downloadUrl(id);
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Lädt eine Datei per XHR hoch (für Fortschrittsanzeige).
 * Gibt { promise, abort } zurück.
 */
export function uploadFile(file, folderId, onProgress) {
  let xhr;
  let aborted = false;

  const attempt = () => new Promise((resolve, reject) => {
    xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/files${folderParam(folderId)}`);
    xhr.setRequestHeader('X-Requested-With', CSRF_HEADER['X-Requested-With']);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* leer */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error || `Upload fehlgeschlagen (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Netzwerkfehler beim Upload'));
    xhr.onabort = () => reject(new ApiError(0, 'Abgebrochen'));
    const form = new FormData();
    form.append('files', file);
    xhr.send(form);
  });

  const promise = attempt().catch(async (err) => {
    if (err.status !== 401 || aborted) throw err;
    if (!(await refreshSession())) {
      unauthorizedHandler();
      throw err;
    }
    onProgress?.(0);
    return attempt();
  });

  return {
    promise,
    abort: () => {
      aborted = true;
      xhr?.abort();
    },
  };
}
