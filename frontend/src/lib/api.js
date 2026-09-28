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
//   403 → { needVerification: true } (KVKK/TC/SMS/konum doğrulaması eksik)
export async function requestToken({ roomId, displayName, hostToken, password, verificationId }) {
  const r = await fetch('/api/tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomId, displayName, hostToken, password, verificationId }),
  });
  if (r.status === 401) return { needPassword: true };
  if (r.status === 403) return { needVerification: true };
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

// === Katılımcı doğrulaması (KVKK → kimlik → SMS OTP → konum) ===
function verificationPost(roomId, path, body) {
  return jsonFetch(`/api/rooms/${roomId}/verification${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.data);
}

export function startVerification(roomId, { kvkkVersion, password }) {
  return verificationPost(roomId, '', { kvkkAccepted: true, kvkkVersion, password });
}
export async function getVerification(roomId, vid) {
  const { data } = await jsonFetch(`/api/rooms/${roomId}/verification/${vid}`);
  return data;
}
export function submitIdentity(roomId, vid, { firstName, lastName, tcNo }) {
  return verificationPost(roomId, `/${vid}/identity`, { firstName, lastName, tcNo });
}
export function sendOtp(roomId, vid, { dialCode, phone }) {
  return verificationPost(roomId, `/${vid}/otp`, { dialCode, phone });
}
export function verifyOtp(roomId, vid, code) {
  return verificationPost(roomId, `/${vid}/otp/verify`, { code });
}
export function submitLocation(roomId, vid, { latitude, longitude, accuracy }) {
  return verificationPost(roomId, `/${vid}/location`, { latitude, longitude, accuracy });
}

// === Yönetici (oturum HttpOnly çerezde; aynı origin'de fetch çerezi kendisi gönderir) ===
function adminPost(path, body) {
  return jsonFetch(`/api/admin${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then((r) => r.data);
}

export const adminLogin = (email, password) => adminPost('/login', { email, password });
export const adminLogout = () => adminPost('/logout');
export const adminChangePassword = (currentPassword, newPassword) =>
  adminPost('/password', { currentPassword, newPassword });

// Oturum yoksa null döner (401 hata sayılmaz)
export async function adminMe() {
  try {
    return (await jsonFetch('/api/admin/me')).data;
  } catch (err) {
    if (err.status === 401) return null;
    throw err;
  }
}
export async function adminRooms() {
  return (await jsonFetch('/api/admin/rooms')).data;
}
export async function adminParticipants(roomId) {
  return (await jsonFetch(`/api/admin/rooms/${roomId}/participants`)).data;
}
