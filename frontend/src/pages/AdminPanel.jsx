import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/TopBar.jsx';
import { Icon } from '../components/icons.jsx';
import {
  adminMe,
  adminLogout,
  adminRooms,
  adminParticipants,
  adminChangePassword,
  createRoom,
} from '../lib/api.js';

const fmtDate = (v) =>
  v ? new Date(v).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const roomLink = (id) => `${window.location.origin}/room/${id}`;

export function AdminPanel() {
  const navigate = useNavigate();
  const [admin, setAdmin] = useState(null);
  const [rooms, setRooms] = useState(null);
  const [newRoomId, setNewRoomId] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    adminMe()
      .then((a) => {
        if (!a) return navigate('/admin/login', { replace: true });
        setAdmin(a);
        return adminRooms().then(setRooms);
      })
      .catch((err) => setError(err.message));
  }, []);

  async function logout() {
    await adminLogout().catch(() => {});
    navigate('/admin/login', { replace: true });
  }

  // Panelden host olarak derse gir: Room sayfası host token'ı sessionStorage'dan okur
  function enterRoom(room) {
    sessionStorage.setItem('zoomtr:name', admin.name);
    sessionStorage.setItem(`zoomtr:host:${room.id}`, room.hostToken);
    navigate(`/room/${room.id}`);
  }

  if (!admin) {
    return (
      <>
        <TopBar />
        <div className="centered-screen">
          {error ? <p className="error-text">{error}</p> : <div className="spinner" />}
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        right={
          <>
            <span className="admin-who">{admin.name}</span>
            <button type="button" className="btn sm" onClick={() => setShowPassword((v) => !v)}>
              Şifre değiştir
            </button>
            <button type="button" className="btn sm" onClick={logout}>
              <Icon.Logout width="14" height="14" /> Çıkış
            </button>
          </>
        }
      />
      <div className="container">
        <div className="page-header">
          <span className="icon-box"><Icon.Shield /></span>
          <div>
            <h1>Yönetim paneli</h1>
            <p className="subtitle">Ders odası oluşturun, linki paylaşın ve katılım kayıtlarını görün.</p>
          </div>
        </div>

        {showPassword && <ChangePasswordCard onDone={() => setShowPassword(false)} />}

        <div className="admin-grid">
          <CreateRoomCard
            adminName={admin.name}
            onCreated={(room) => {
              setRooms((prev) => [room, ...(prev || [])]);
              setNewRoomId(room.id);
            }}
          />

          <section className="card">
            <h2 className="card-title">Odalar</h2>
            <p className="card-desc">Tüm yöneticilerin açtığı odalar, en yeniden eskiye.</p>
            {rooms === null && <div className="spinner" />}
            {rooms?.length === 0 && <p className="note">Henüz oda yok. Soldan ilk odayı oluşturun.</p>}
            <div className="admin-rooms">
              {rooms?.map((room) => (
                <RoomRow
                  key={room.id}
                  room={room}
                  highlight={room.id === newRoomId}
                  onEnter={() => enterRoom(room)}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function CreateRoomCard({ adminName, onCreated }) {
  const [title, setTitle] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [lobbyEnabled, setLobbyEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleCreate(e) {
    e.preventDefault();
    if (usePassword && !password.trim()) return setError('Parola girin veya parolayı kapatın');
    setBusy(true);
    setError(null);
    try {
      const room = await createRoom({
        name: title.trim() || `${adminName} - Ders`,
        password: usePassword ? password.trim() : null,
        lobbyEnabled,
      });
      onCreated({
        id: room.id,
        name: room.name,
        hostToken: room.hostToken,
        hasPassword: room.hasPassword,
        lobbyEnabled: room.lobbyEnabled,
        createdAt: new Date().toISOString(),
        createdBy: adminName,
        verifiedCount: 0,
      });
      setTitle('');
      setPassword('');
      setUsePassword(false);
      setLobbyEnabled(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card admin-create" onSubmit={handleCreate}>
      <h2 className="card-title">Yeni ders odası</h2>
      <p className="card-desc">Oluşturulan odanın linkini öğrencilerle paylaşın.</p>
      <div className="auth-tab-body">
        <div className="field">
          <label className="field-label" htmlFor="room-title">
            Oda başlığı <span className="optional">(opsiyonel)</span>
          </label>
          <input
            id="room-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Örn. Matematik 101"
          />
        </div>

        <div className="hero-toggles">
          <div className={`switch-group ${usePassword ? 'open' : ''}`}>
            <label className="switch-row">
              <span className="switch-row-text">
                <span className="switch-row-title">Parola ile katılım</span>
                <span className="switch-row-desc">Girerken paylaştığın parolayı isteyelim</span>
              </span>
              <span className="switch">
                <input type="checkbox" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
                <span className="switch-track"><span className="switch-thumb" /></span>
              </span>
            </label>
            {usePassword && (
              <div className="switch-extra">
                <label className="field-label" htmlFor="room-password">Oda parolası</label>
                <input
                  id="room-password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="En az 4 karakter"
                  autoFocus
                />
              </div>
            )}
          </div>

          <label className="switch-row">
            <span className="switch-row-text">
              <span className="switch-row-title">Onaylı katılım</span>
              <span className="switch-row-desc">Her katılımcıyı tek tek host onaylasın</span>
            </span>
            <span className="switch">
              <input type="checkbox" checked={lobbyEnabled} onChange={(e) => setLobbyEnabled(e.target.checked)} />
              <span className="switch-track"><span className="switch-thumb" /></span>
            </span>
          </label>
        </div>

        <button type="submit" className="btn primary full lg" disabled={busy}>
          <Icon.Plus /> {busy ? 'Oluşturuluyor…' : 'Oda oluştur'}
        </button>
        {error && <p className="error-text" role="alert">{error}</p>}
      </div>
    </form>
  );
}

function RoomRow({ room, highlight, onEnter }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState(null);
  const [error, setError] = useState(null);

  function copy() {
    navigator.clipboard.writeText(roomLink(room.id));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      setError(null);
      adminParticipants(room.id).then(setPeople).catch((err) => setError(err.message));
    }
  }

  return (
    <div className={`admin-room ${highlight ? 'new' : ''}`}>
      <div className="admin-room-head">
        <div className="admin-room-meta">
          <strong>{room.name}</strong>
          <span>
            <code>{room.id}</code> · {fmtDate(room.createdAt)}
            {room.createdBy && ` · ${room.createdBy}`}
          </span>
          <span className="admin-room-tags">
            {room.hasPassword && <span className="pill">🔒 Parolalı</span>}
            {room.lobbyEnabled && <span className="pill">🚪 Onaylı</span>}
          </span>
        </div>
        <div className="admin-room-actions">
          <button type="button" className="btn sm" onClick={copy}>
            <Icon.Copy width="14" height="14" /> {copied ? 'Kopyalandı' : 'Linki kopyala'}
          </button>
          <button type="button" className="btn sm" onClick={toggle} aria-expanded={open}>
            <Icon.Users width="14" height="14" /> Katılımcılar ({room.verifiedCount})
          </button>
          <button type="button" className="btn sm primary" onClick={onEnter}>
            <Icon.Door width="14" height="14" /> Derse gir
          </button>
        </div>
      </div>

      {open && (
        <div className="admin-people">
          {error && <p className="error-text">{error}</p>}
          {!error && people === null && <div className="spinner" />}
          {people?.length === 0 && <p className="note">Bu odada henüz doğrulama yapan katılımcı yok.</p>}
          {people?.length > 0 && (
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Ad Soyad</th>
                    <th>T.C. Kimlik No</th>
                    <th>Telefon</th>
                    <th>Konum</th>
                    <th>Doğrulama</th>
                    <th>Son giriş</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p, i) => (
                    <tr key={i}>
                      <td>{p.name}</td>
                      <td className="mono">{p.tcNo}</td>
                      <td className="mono">{p.phone || '—'}</td>
                      <td>
                        {p.latitude != null ? (
                          <a
                            href={`https://www.google.com/maps?q=${p.latitude},${p.longitude}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Haritada aç{p.accuracy ? ` (±${Math.round(p.accuracy)} m)` : ''}
                          </a>
                        ) : '—'}
                      </td>
                      <td>{p.completedAt ? fmtDate(p.completedAt) : <span className="muted">Tamamlanmadı</span>}</td>
                      <td>{fmtDate(p.lastJoinedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChangePasswordCard({ onDone }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await adminChangePassword(current, next);
      setMsg({ ok: true, text: 'Şifreniz değiştirildi.' });
      setCurrent('');
      setNext('');
      setTimeout(onDone, 1200);
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card admin-password" onSubmit={submit}>
      <h2 className="card-title">Şifre değiştir</h2>
      <div className="verify-row">
        <div className="field">
          <label className="field-label" htmlFor="pw-current">Mevcut şifre</label>
          <input id="pw-current" className="input" type="password" value={current}
            onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="pw-new">Yeni şifre (en az 10 karakter)</label>
          <input id="pw-new" className="input" type="password" value={next}
            onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required />
        </div>
      </div>
      <button type="submit" className="btn primary" disabled={busy}>
        {busy ? 'Kaydediliyor…' : 'Şifreyi değiştir'}
      </button>
      {msg && <p className={msg.ok ? 'note text-success' : 'error-text'}>{msg.text}</p>}
    </form>
  );
}
