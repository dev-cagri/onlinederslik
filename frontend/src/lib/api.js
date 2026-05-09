async function jsonFetch(url, options = {}) {
  const r = await fetch(url, options);
  let data = null;
  try { data = await r.json(); } catch { /* yoksay */ }
  if (!r.ok) {
    const err = new Error(data?.error || `HTTP ${r.status}`);
    err.status = r.status;
    err.data = data;
    throw err;
  }
  return { status: r.status, data };
}

export async function createRoom({ name, password, lobbyEnabled }) {
  const { data } = await jsonFetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, password: password || null, lobbyEnabled: !!lobbyEnabled }),
  });
  return data;
}

export async function getRoom(id) {
  const { data } = await jsonFetch(`/api/rooms/${id}`);
  return data;
}

export async function getMessages(id) {
  const { data } = await jsonFetch(`/api/rooms/${id}/messages`);
  return data;
}

// Token isteği. Yanıtın status'una göre arayan farklı akışlara dallanır:
//   200 → { token, url, isHost }
//   202 → { lobby: true } (lobby socket akışı)
//   401 → { needPassword: true }
export async function requestToken({ roomId, displayName, hostToken, password }) {
  const r = await fetch('/api/tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomId, displayName, hostToken, password }),
  });
  if (r.status === 401) return { needPassword: true };
  if (r.status === 202) return { lobby: true };
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${r.status}`);
  }
  return await r.json();
}

export async function hostAction(roomId, action, body) {
  const { data } = await jsonFetch(`/api/rooms/${roomId}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return data;
}

export async function uploadShare(roomId, hostToken, file, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('hostToken', hostToken);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/rooms/${roomId}/share`);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
    }
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `HTTP ${xhr.status}`));
      } catch {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Yükleme başarısız'));
    xhr.send(fd);
  });
}

export async function clearShare(roomId, hostToken) {
  const { data } = await jsonFetch(`/api/rooms/${roomId}/share/clear`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hostToken }),
  });
  return data;
}

// === Kayıt (recording) ===
export async function startRecording(roomId, hostToken) {
  const { data } = await jsonFetch(`/api/rooms/${roomId}/recordings/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hostToken }),
  });
  return data;
}
export async function stopRecording(roomId, hostToken) {
  const { data } = await jsonFetch(`/api/rooms/${roomId}/recordings/stop`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hostToken }),
  });
  return data;
}
export async function getActiveRecording(roomId) {
  const { data } = await jsonFetch(`/api/rooms/${roomId}/recordings/active`);
  return data;
}
export async function listRecordings(roomId) {
  const { data } = await jsonFetch(`/api/rooms/${roomId}/recordings`);
  return data;
}
