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

export async function createRoom({ name, password, lobbyEnabled, validDays }) {
  const { data } = await jsonFetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, password: password || null, lobbyEnabled: !!lobbyEnabled, validDays: validDays || null }),
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
//   403 → { needMember: true } (SMS girişi / ad-soyad / yönetici onayı eksik)
//         { locked: true } (host toplantıyı yeni katılımlara kapattı ya da bitirdi)
//         { expired: true } (toplantı linkinin süresi doldu)
export async function requestToken({ roomId, displayName, hostToken, password }) {
  const r = await fetch('/api/tokens', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ roomId, displayName, hostToken, password }),
  });
  if (r.status === 401) return { needPassword: true };
  if (r.status === 403) {
    const data = await r.json().catch(() => ({}));
    if (data.error === 'room_locked') return { locked: true };
    if (data.error === 'room_expired') return { expired: true };
    return { needMember: true };
  }
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

// Toplantı ayarlarını kısmen güncelle: { allowMic: false, name: '…', … } → { settings }
export const updateRoomSettings = (roomId, hostToken, patch) =>
  hostAction(roomId, 'settings', { hostToken, ...patch });

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

// === Üye girişi (SMS) — oturum HttpOnly çerezde ===
function postJson(url, body) {
  return jsonFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then((r) => r.data);
}

// Oturum yoksa null döner (401 hata sayılmaz)
export async function memberMe() {
  try {
    return (await jsonFetch('/api/member/me')).data;
  } catch (err) {
    if (err.status === 401) return null;
    throw err;
  }
}
export const sendLoginCode = ({ dialCode, phone, kvkkVersion }) =>
  postJson('/api/member/otp', { dialCode, phone, kvkkAccepted: true, kvkkVersion });
export const verifyLoginCode = ({ dialCode, phone, code, kvkkVersion }) =>
  postJson('/api/member/otp/verify', { dialCode, phone, code, kvkkVersion });
export const codeLogin = ({ code, kvkkVersion }) =>
  postJson('/api/member/code-login', { code, kvkkAccepted: true, kvkkVersion });
// SMS doğrulaması kapalıyken kodsuz telefonla giriş
export const phoneLogin = ({ dialCode, phone, kvkkVersion }) =>
  postJson('/api/member/phone-login', { dialCode, phone, kvkkAccepted: true, kvkkVersion });
export const registerMember = ({ firstName, lastName }) =>
  postJson('/api/member/register', { firstName, lastName });
export const memberLogout = () => postJson('/api/member/logout');

// === Yönetici (oturum HttpOnly çerezde; aynı origin'de fetch çerezi kendisi gönderir) ===
const adminPost = (path, body) => postJson(`/api/admin${path}`, body);

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

// Üye yönetimi: status = pending | approved | rejected
export async function adminMembers(status) {
  return (await jsonFetch(`/api/admin/members?status=${status}`)).data;
}
export const adminSetMemberStatus = (id, status) => adminPost(`/members/${id}/status`, { status });
export const adminSetMemberHost = (id, isHost) => adminPost(`/members/${id}/host`, { isHost });
export const adminApprovePending = () => adminPost('/members/approve-pending');
export async function adminDeleteMember(id) {
  return (await jsonFetch(`/api/admin/members/${id}`, { method: 'DELETE' })).data;
}

// Giriş kodları (SMS ve onay olmadan üyelik)
export async function adminAccessCodes() {
  return (await jsonFetch('/api/admin/access-codes')).data;
}
export const adminCreateAccessCode = ({ label, maxUses, validDays }) =>
  adminPost('/access-codes', { label, maxUses, validDays });
export async function adminDeleteAccessCode(id) {
  return (await jsonFetch(`/api/admin/access-codes/${id}`, { method: 'DELETE' })).data;
}

// Site logosu (multipart). Yanıt: { logoUrl }
export async function adminUploadLogo(file) {
  const fd = new FormData();
  fd.append('logo', file);
  return (await jsonFetch('/api/branding/logo', { method: 'POST', body: fd })).data;
}
export async function adminRemoveLogo() {
  return (await jsonFetch('/api/branding/logo', { method: 'DELETE' })).data;
}

// Toplantı silme: tek tek ya da süresi dolmuş/bitmiş olanların hepsi
export async function adminDeleteRoom(id) {
  return (await jsonFetch(`/api/admin/rooms/${id}`, { method: 'DELETE' })).data;
}
export const adminCleanupRooms = () => adminPost('/rooms/cleanup');

// Site ayarları (SMS doğrulaması aç/kapat) → { smsEnabled }
export const adminUpdateSiteSettings = (patch) => adminPost('/settings', patch);

// Site ayarları (SMS + NETGSM; şifre geri gelmez) ve test SMS'i
export async function adminSiteSettings() {
  return (await jsonFetch('/api/admin/settings')).data;
}
export const adminSmsTest = ({ dialCode, phone }) => adminPost('/settings/sms-test', { dialCode, phone });

// Yöneticiler
export async function adminAdmins() {
  return (await jsonFetch('/api/admin/admins')).data;
}
export const adminCreateAdmin = ({ email, name, password }) => adminPost('/admins', { email, name, password });
export async function adminDeleteAdmin(id) {
  return (await jsonFetch(`/api/admin/admins/${id}`, { method: 'DELETE' })).data;
}

// Sunucu tarafı kayıtlar
export async function adminRecordings() {
  return (await jsonFetch('/api/admin/recordings')).data;
}
export async function adminDeleteRecording(id) {
  return (await jsonFetch(`/api/admin/recordings/${id}`, { method: 'DELETE' })).data;
}
export const recordingFileUrl = (id, download = false) =>
  `/api/admin/recordings/${id}/file${download ? '?download=1' : ''}`;
