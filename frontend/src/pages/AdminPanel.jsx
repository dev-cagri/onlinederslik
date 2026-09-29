import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/icons.jsx';
import {
  adminMe,
  adminLogout,
  adminRooms,
  adminParticipants,
  adminChangePassword,
  adminMembers,
  adminSetMemberStatus,
  adminApprovePending,
  adminDeleteMember,
  adminSetMemberHost,
  adminAccessCodes,
  adminCreateAccessCode,
  adminDeleteAccessCode,
  adminDeleteRoom,
  adminCleanupRooms,
  adminUploadLogo,
  adminRemoveLogo,
  adminUpdateSiteSettings,
  adminSiteSettings,
  adminSmsTest,
  adminAdmins,
  adminCreateAdmin,
  adminDeleteAdmin,
  adminRecordings,
  adminDeleteRecording,
  recordingFileUrl,
  createRoom,
} from '../lib/api.js';
import {
  useBranding, setBrandingLogo, setSmsEnabled, setApprovalRequired, setAppearance, useDocumentTitle, isLightColor,
} from '../lib/branding.js';

const fmtDate = (v) =>
  v ? new Date(v).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

const roomLink = (id) => `${window.location.origin}/room/${id}`;

// +905447419232 → +90 544 741 92 32 (diğer ülkeler olduğu gibi)
const fmtPhone = (p) => (p?.startsWith('+90') && p.length === 13
  ? `+90 ${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9, 11)} ${p.slice(11)}`
  : p);

const initials = (name) => name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toLocaleUpperCase('tr-TR');

// Yeni kayıtlar panel açıkken de görünsün (kenar çubuğu rozeti + üye listesi)
const MEMBERS_POLL_MS = 20_000;

const SECTIONS = [
  { key: 'uyeler', label: 'Üyeler', icon: Icon.Users },
  { key: 'toplantilar', label: 'Toplantılar', icon: Icon.Video },
  { key: 'kodlar', label: 'Giriş kodları', short: 'Kodlar', icon: Icon.Key },
  { key: 'kayitlar', label: 'Kayıtlar', icon: Icon.Record },
  { key: 'ayarlar', label: 'Ayarlar', icon: Icon.Settings },
];

export function AdminPanel() {
  const navigate = useNavigate();
  const { section = 'uyeler' } = useParams();
  const [admin, setAdmin] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState(null);
  const branding = useBranding();
  useDocumentTitle(SECTIONS.find((s) => s.key === section)?.label || 'Yönetim paneli');

  useEffect(() => {
    adminMe()
      .then((a) => {
        if (!a) return navigate('/admin/login', { replace: true });
        setAdmin(a);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!admin) return;
    const load = () => adminMembers('pending').then((d) => setPendingCount(d.counts.pending)).catch(() => {});
    load();
    const t = setInterval(load, MEMBERS_POLL_MS);
    return () => clearInterval(t);
  }, [admin]);

  useEffect(() => {
    if (!SECTIONS.some((s) => s.key === section)) navigate('/admin', { replace: true });
  }, [section]);

  async function logout() {
    await adminLogout().catch(() => {});
    navigate('/admin/login', { replace: true });
  }

  if (!admin) {
    return (
      <div className="centered-screen">
        {error ? <p className="error-text">{error}</p> : <div className="spinner" />}
      </div>
    );
  }

  const badge = (key) => (key === 'uyeler' && pendingCount > 0 ? pendingCount : null);

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          {branding.loaded && <img src={branding.logoUrl} alt="Logo" />}
        </div>
        <nav className="admin-nav" aria-label="Yönetim bölümleri">
          {SECTIONS.filter((s) => s.key !== 'ayarlar').map((s) => (
            <NavLink key={s.key} to={`/admin/${s.key}`} className={() => (section === s.key ? 'active' : '')}>
              <s.icon width="18" height="18" /> {s.label}
              {badge(s.key) && <span className="admin-badge" aria-label={`${badge(s.key)} onay bekliyor`}>{badge(s.key)}</span>}
            </NavLink>
          ))}
        </nav>
        <NavLink to="/admin/ayarlar" className={`admin-account-link ${section === 'ayarlar' ? 'active' : ''}`}>
          <span className="avatar sm">{initials(admin.name)}</span>
          <span className="admin-account-text">
            <strong>{admin.name}</strong>
            <span>{admin.email}</span>
          </span>
          <Icon.Settings width="16" height="16" className="admin-account-gear" />
        </NavLink>
      </aside>

      <main className="admin-main">
        {section === 'uyeler' && <MembersSection onCounts={(c) => setPendingCount(c.pending)} />}
        {section === 'toplantilar' && <RoomsSection admin={admin} />}
        {section === 'kodlar' && <CodesSection />}
        {section === 'kayitlar' && <RecordingsSection />}
        {section === 'ayarlar' && <SettingsSection admin={admin} onLogout={logout} />}
      </main>

      <nav className="admin-tabbar" aria-label="Yönetim bölümleri">
        {SECTIONS.map((s) => (
          <NavLink key={s.key} to={`/admin/${s.key}`} className={() => (section === s.key ? 'active' : '')}>
            <span className="admin-tab-icon">
              <s.icon width="22" height="22" />
              {badge(s.key) && <span className="admin-badge">{badge(s.key)}</span>}
            </span>
            {s.short || s.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function SectionHeader({ title, desc, action }) {
  return (
    <header className="admin-section-head">
      <div>
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {action}
    </header>
  );
}

// === Üyeler ===

const MEMBER_TABS = [
  { key: 'pending', label: 'Onay bekleyen', short: 'Bekleyen' },
  { key: 'approved', label: 'Onaylı' },
  { key: 'rejected', label: 'Reddedilen' },
];

const EMPTY_MEMBERS = {
  pending: 'Onay bekleyen üye yok. Yeni biri telefonuyla giriş yapıp adını girdiğinde burada görünür.',
  approved: 'Henüz onaylı üye yok. Onay bekleyenleri onaylayın ya da Giriş kodları bölümünden kod verin.',
  rejected: 'Reddedilen üye yok.',
};

// SMS ile giriş yapıp ad/soyadını girmiş katılımcılar; toplantılara girebilmeleri için onay gerekir
function MembersSection({ onCounts }) {
  const { approvalRequired } = useBranding();
  const [tab, setTab] = useState('pending');
  const [data, setData] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  function load(status = tab) {
    return adminMembers(status)
      .then((d) => { setData(d); onCounts(d.counts); setError(null); })
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    setData(null);
    load(tab);
    const t = setInterval(() => load(tab), MEMBERS_POLL_MS);
    return () => clearInterval(t);
  }, [tab]);

  async function act(id, fn) {
    setBusyId(id);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const setStatus = (m, status) => act(m.id, () => adminSetMemberStatus(m.id, status));
  const setHost = (m, isHost) => {
    if (isHost && !window.confirm(`${m.name} toplantı yöneticisi olsun mu? Tüm toplantılara host yetkisiyle girer (yönetim paneline erişemez).`)) return;
    act(m.id, () => adminSetMemberHost(m.id, isHost));
  };
  const remove = (m) => {
    if (!window.confirm(`${m.name} üyeliği ve tüm yoklama kayıtları silinsin mi?`)) return;
    act(m.id, () => adminDeleteMember(m.id));
  };
  const approveAll = () => {
    if (!window.confirm(`Onay bekleyen ${data.counts.pending} üyenin tamamı onaylansın mı?`)) return;
    act('all', adminApprovePending);
  };

  const members = data?.members;

  return (
    <>
      <SectionHeader
        title="Üyeler"
        desc="Telefonla giriş yapan katılımcılar burada onayınızı bekler; onaylananlar tüm toplantılara katılabilir. Giriş koduyla gelenler otomatik onaylanır."
        action={tab === 'pending' && data?.counts.pending > 1 && (
          <button type="button" className="btn primary" onClick={approveAll} disabled={!!busyId}>
            <Icon.Check /> Tümünü onayla
          </button>
        )}
      />

      {!approvalRequired && (
        <p className="admin-notice">
          Onay kapalı: yeni üyeler kayıt olur olmaz toplantılara katılabilir.
          Açmak için <NavLink to="/admin/ayarlar?sekme=sms">Ayarlar → Giriş</NavLink>.
        </p>
      )}

      <div className="segmented" role="tablist">
        {MEMBER_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'active' : ''}
            onClick={() => setTab(t.key)}
          >
            <span className={t.short ? 'seg-long' : undefined}>{t.label}</span>
            {t.short && <span className="seg-short">{t.short}</span>}
            {data && (
              <span className={`count ${t.key === 'pending' && data.counts.pending ? 'alert' : ''}`}>
                {data.counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && <p className="error-text" role="alert">{error}</p>}
      {!members && !error && <div className="spinner" />}
      {members?.length === 0 && <p className="admin-empty">{EMPTY_MEMBERS[tab]}</p>}
      {members?.length > 0 && (
        <ul className="admin-list">
          {members.map((m) => (
            <li key={m.id} className="member-row">
              <span className={`avatar ${m.status}`}>{initials(m.name)}</span>
              <div className="row-main">
                <strong>
                  {m.name}
                  {m.isHost && <span className="tag success">Toplantı yöneticisi</span>}
                </strong>
                <span className="row-meta">
                  <span className="tnum">{m.phone ? fmtPhone(m.phone) : `Giriş kodu: ${m.viaCode || '—'}`}</span>
                  {m.phone && m.viaCode && <span>Giriş kodu: {m.viaCode}</span>}
                  <span>Kayıt {fmtDate(m.registeredAt)}</span>
                  {m.roomCount > 0 && <span>{m.roomCount} toplantıya katıldı</span>}
                  {tab !== 'pending' && m.reviewedBy && (
                    <span>{tab === 'approved' ? 'Onaylayan' : 'Reddeden'}: {m.reviewedBy}</span>
                  )}
                </span>
              </div>
              <div className="row-actions">
                {m.status !== 'approved' && (
                  <button type="button" className="btn primary sm" disabled={!!busyId}
                    onClick={() => setStatus(m, 'approved')}>
                    <Icon.Check width="14" height="14" /> Onayla
                  </button>
                )}
                {m.status === 'approved' && (
                  <button type="button" className="btn sm" disabled={!!busyId} onClick={() => setHost(m, !m.isHost)}
                    title={m.isHost ? 'Toplantı yöneticiliğini kaldır' : 'Tüm toplantılarda host yetkisi ver'}>
                    <Icon.Shield width="14" height="14" /> {m.isHost ? 'Yöneticiliği kaldır' : 'Toplantı yöneticisi yap'}
                  </button>
                )}
                {m.status !== 'rejected' && (
                  <button type="button" className="btn sm" disabled={!!busyId}
                    onClick={() => setStatus(m, 'rejected')}>
                    {m.status === 'approved' ? 'Onayı kaldır' : 'Reddet'}
                  </button>
                )}
                <button type="button" className="btn sm icon-only danger-ghost" disabled={!!busyId}
                  onClick={() => remove(m)} title="Üyeliği sil" aria-label={`${m.name} üyeliğini sil`}>
                  <Icon.Trash width="15" height="15" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// === Toplantılar ===

// Link ömrü seçenekleri (yeni toplantı)
const ROOM_VALIDITY = [
  { days: '1', label: '1 gün' },
  { days: '7', label: '7 gün' },
  { days: '30', label: '30 gün' },
  { days: '', label: 'Süresiz' },
];

// Toplantının durumu: bitti / süresi doldu / kalan süre
function roomStatus(room) {
  if (room.endedAt) return { label: 'Bitti', tone: 'muted', stale: true };
  if (room.expiresAt) {
    const ms = new Date(room.expiresAt) - Date.now();
    if (ms <= 0) return { label: 'Süresi doldu', tone: 'muted', stale: true };
    const hours = Math.ceil(ms / 3_600_000);
    return { label: hours < 48 ? `${hours} saat kaldı` : `${Math.ceil(hours / 24)} gün kaldı`, tone: hours < 24 ? 'warning' : '' };
  }
  return { label: 'Süresiz', tone: '' };
}

function RoomsSection({ admin }) {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState(null);
  const [newRoomId, setNewRoomId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    adminRooms().then(setRooms).catch((err) => setError(err.message));
  }, []);

  // Panelden host olarak toplantıya gir: Room sayfası host token'ı sessionStorage'dan okur
  function enterRoom(room) {
    sessionStorage.setItem('zoomtr:name', admin.name);
    sessionStorage.setItem(`zoomtr:host:${room.id}`, room.hostToken);
    navigate(`/room/${room.id}`);
  }

  async function remove(room) {
    if (!window.confirm(`"${room.name}" silinsin mi? Linki çalışmaz; katılım listesi, paylaşılan dosyalar ve kayıtları da silinir.`)) return;
    setBusy(room.id);
    try {
      await adminDeleteRoom(room.id);
      setRooms((prev) => prev.filter((r) => r.id !== room.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const staleCount = rooms?.filter((r) => roomStatus(r).stale).length || 0;

  async function cleanup() {
    if (!window.confirm(`Süresi dolmuş ya da bitmiş ${staleCount} toplantı; katılım listesi, dosyaları ve kayıtlarıyla birlikte silinsin mi?`)) return;
    setBusy('cleanup');
    try {
      await adminCleanupRooms();
      setRooms(await adminRooms());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <SectionHeader
        title="Toplantılar"
        desc="Toplantı açın, linkini paylaşın, kimlerin katıldığını görün. Süresi dolan linkle kimse giremez; bu toplantılar 30 gün sonra kendiliğinden silinir."
        action={(
          <div className="admin-head-actions">
            {staleCount > 0 && (
              <button type="button" className="btn" onClick={cleanup} disabled={!!busy}>
                <Icon.Trash /> Süresi dolanları temizle ({staleCount})
              </button>
            )}
            <button type="button" className="btn primary" onClick={() => setCreating(true)}>
              <Icon.Plus /> Yeni toplantı
            </button>
          </div>
        )}
      />

      {error && <p className="error-text" role="alert">{error}</p>}
      {rooms === null && !error && <div className="spinner" />}
      {rooms?.length === 0 && (
        <p className="admin-empty">Henüz toplantı yok. İlk toplantıyı “Yeni toplantı” ile açın.</p>
      )}
      {rooms?.length > 0 && (
        <ul className="admin-list">
          {rooms.map((room) => (
            <RoomRow
              key={room.id}
              room={room}
              highlight={room.id === newRoomId}
              busy={busy === room.id}
              onEnter={() => enterRoom(room)}
              onDelete={() => remove(room)}
            />
          ))}
        </ul>
      )}

      {creating && (
        <Sheet title="Yeni toplantı" onClose={() => setCreating(false)}>
          <CreateRoomForm
            adminName={admin.name}
            onCreated={(room) => {
              setRooms((prev) => [room, ...(prev || [])]);
              setNewRoomId(room.id);
              setCreating(false);
            }}
          />
        </Sheet>
      )}
    </>
  );
}

function CreateRoomForm({ adminName, onCreated }) {
  const [title, setTitle] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [lobbyEnabled, setLobbyEnabled] = useState(false);
  const [validDays, setValidDays] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleCreate(e) {
    e.preventDefault();
    if (usePassword && !password.trim()) return setError('Parola girin veya parolayı kapatın');
    setBusy(true);
    setError(null);
    try {
      const room = await createRoom({
        name: title.trim() || `${adminName} - Toplantı`,
        password: usePassword ? password.trim() : null,
        lobbyEnabled,
        validDays: validDays ? Number(validDays) : null,
      });
      onCreated({
        id: room.id,
        name: room.name,
        hostToken: room.hostToken,
        hasPassword: room.hasPassword,
        lobbyEnabled: room.lobbyEnabled,
        createdAt: new Date().toISOString(),
        expiresAt: room.expiresAt,
        endedAt: null,
        createdBy: adminName,
        attendeeCount: 0,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-tab-body" onSubmit={handleCreate}>
      <div className="field">
        <label className="field-label" htmlFor="room-title">
          Toplantı adı <span className="optional">(opsiyonel)</span>
        </label>
        <input
          id="room-title"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={`${adminName} - Toplantı`}
          autoFocus
        />
      </div>

      <div className="field">
        <span className="field-label" id="room-validity-label">Link geçerliliği</span>
        <div className="segmented segmented-full" role="radiogroup" aria-labelledby="room-validity-label">
          {ROOM_VALIDITY.map((v) => (
            <button
              key={v.days}
              type="button"
              role="radio"
              aria-checked={validDays === v.days}
              className={validDays === v.days ? 'active' : ''}
              onClick={() => setValidDays(v.days)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="hero-toggles">
        <div className={`switch-group ${usePassword ? 'open' : ''}`}>
          <label className="switch-row">
            <span className="switch-row-text">
              <span className="switch-row-title">Parola ile katılım</span>
              <span className="switch-row-desc">Girerken paylaştığınız parola istensin</span>
            </span>
            <span className="switch">
              <input type="checkbox" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
              <span className="switch-track"><span className="switch-thumb" /></span>
            </span>
          </label>
          {usePassword && (
            <div className="switch-extra">
              <label className="field-label" htmlFor="room-password">Toplantı parolası</label>
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
            <span className="switch-row-title">Bekleme odası</span>
            <span className="switch-row-desc">Her katılımcıyı toplantıya siz alın</span>
          </span>
          <span className="switch">
            <input type="checkbox" checked={lobbyEnabled} onChange={(e) => setLobbyEnabled(e.target.checked)} />
            <span className="switch-track"><span className="switch-thumb" /></span>
          </span>
        </label>
      </div>

      <button type="submit" className="btn primary full lg" disabled={busy}>
        <Icon.Plus /> {busy ? 'Açılıyor…' : 'Toplantıyı aç'}
      </button>
      {error && <p className="error-text" role="alert">{error}</p>}
    </form>
  );
}

function RoomRow({ room, highlight, busy, onEnter, onDelete }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState(null);
  const [error, setError] = useState(null);
  const status = roomStatus(room);

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
    <li className={`room-row ${highlight ? 'new' : ''} ${status.stale ? 'stale' : ''}`}>
      <div className="room-row-head">
        <div className="row-main">
          <strong>
            {room.name}
            {highlight && <span className="tag success">Yeni</span>}
          </strong>
          <span className="row-meta">
            <span className={`tag ${status.tone}`}>{status.label}</span>
            <span className="tnum">{room.id}</span>
            <span>{fmtDate(room.createdAt)}</span>
            {room.createdBy && <span>{room.createdBy}</span>}
            {room.hasPassword && <span className="tag"><Icon.Lock width="11" height="11" /> Parolalı</span>}
            {room.lobbyEnabled && <span className="tag">Bekleme odası</span>}
          </span>
        </div>
        <div className="row-actions">
          <button type="button" className="btn sm" onClick={toggle} aria-expanded={open}>
            <Icon.Users width="14" height="14" /> Katılım <span className="tnum">{room.attendeeCount}</span>
          </button>
          {!status.stale && (
            <>
              <button type="button" className="btn sm" onClick={copy}>
                <Icon.Copy width="14" height="14" /> {copied ? 'Kopyalandı' : 'Link'}
              </button>
              <button type="button" className="btn sm primary" onClick={onEnter}>
                <Icon.Door width="14" height="14" /> Katıl
              </button>
            </>
          )}
          <button type="button" className="btn sm icon-only danger-ghost" onClick={onDelete} disabled={busy}
            title="Toplantıyı sil" aria-label={`${room.name} toplantısını sil`}>
            <Icon.Trash width="15" height="15" />
          </button>
        </div>
      </div>

      {open && (
        <div className="room-attendance">
          {error && <p className="error-text">{error}</p>}
          {!error && people === null && <div className="spinner" />}
          {people?.length === 0 && <p className="note">Bu toplantıya henüz giren üye yok.</p>}
          {people?.length > 0 && (
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Ad soyad</th>
                    <th>Telefon</th>
                    <th>İlk giriş</th>
                    <th>Son giriş</th>
                    <th>Giriş sayısı</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.memberId}>
                      <td>{p.name}</td>
                      <td className="tnum">{p.phone ? fmtPhone(p.phone) : '—'}</td>
                      <td>{fmtDate(p.firstJoinedAt)}</td>
                      <td>{fmtDate(p.lastJoinedAt)}</td>
                      <td className="tnum">{p.joinCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// === Giriş kodları ===

const CODE_VALIDITY = [
  { days: '', label: 'Süresiz' },
  { days: '1', label: '1 gün' },
  { days: '7', label: '7 gün' },
  { days: '30', label: '30 gün' },
];

// Giriş kodu: katılımcı bu kodla SMS ve onay beklemeden üye olur
function CodesSection() {
  const [codes, setCodes] = useState(null);
  const [label, setLabel] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [validDays, setValidDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [newId, setNewId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    adminAccessCodes().then(setCodes).catch((err) => setError(err.message));
  }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const code = await adminCreateAccessCode({
        label: label.trim() || null,
        maxUses: maxUses ? Number(maxUses) : null,
        validDays: validDays ? Number(validDays) : null,
      });
      setCodes((prev) => [code, ...(prev || [])]);
      setNewId(code.id);
      setLabel('');
      setMaxUses('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(c) {
    if (!window.confirm(`${c.code} kodu silinsin mi? Bu kodla girmiş üyeler üye olarak kalır.`)) return;
    try {
      await adminDeleteAccessCode(c.id);
      setCodes((prev) => prev.filter((x) => x.id !== c.id));
    } catch (err) {
      setError(err.message);
    }
  }

  function copy(c) {
    navigator.clipboard.writeText(c.code);
    setCopiedId(c.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <>
      <SectionHeader
        title="Giriş kodları"
        desc="Kodu giren katılımcı SMS ve onay beklemeden toplantılara katılır. Kodu çok kişiyle paylaşacaksanız kullanım sınırı koyun."
      />

      <form className="code-form" onSubmit={create}>
        <div className="field">
          <label className="field-label" htmlFor="code-label">
            Etiket <span className="optional">(opsiyonel)</span>
          </label>
          <input id="code-label" className="input" value={label}
            onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="code-max">Kullanım sınırı</label>
          <input id="code-max" className="input" type="number" min="1" inputMode="numeric"
            value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Sınırsız" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="code-days">Geçerlilik</label>
          <select id="code-days" className="input" value={validDays} onChange={(e) => setValidDays(e.target.value)}>
            {CODE_VALIDITY.map((v) => <option key={v.days} value={v.days}>{v.label}</option>)}
          </select>
        </div>
        <button type="submit" className="btn primary" disabled={busy}>
          <Icon.Key /> {busy ? 'Oluşturuluyor…' : 'Kod oluştur'}
        </button>
      </form>
      {error && <p className="error-text" role="alert">{error}</p>}

      {codes === null && !error && <div className="spinner" />}
      {codes?.length === 0 && (
        <p className="admin-empty">Henüz giriş kodu yok. Yukarıdan ilk kodu oluşturun.</p>
      )}
      {codes?.length > 0 && (
        <ul className="admin-list">
          {codes.map((c) => (
            <li key={c.id} className={`code-row ${c.active ? '' : 'inactive'} ${c.id === newId ? 'new' : ''}`}>
              <div className="row-main">
                <strong className="code-value">{c.code}</strong>
                <span className="row-meta">
                  {c.label && <span className="row-meta-strong">{c.label}</span>}
                  <span className="tnum">{c.maxUses ? `${c.uses} / ${c.maxUses} kullanım` : `${c.uses} kullanım`}</span>
                  <span>{c.expiresAt ? `Son gün ${fmtDate(c.expiresAt)}` : 'Süresiz'}</span>
                  {!c.active && <span className="tag">Kullanılamaz</span>}
                </span>
              </div>
              <div className="row-actions">
                <button type="button" className="btn sm" onClick={() => copy(c)} disabled={!c.active}>
                  <Icon.Copy width="14" height="14" /> {copiedId === c.id ? 'Kopyalandı' : 'Kopyala'}
                </button>
                <button type="button" className="btn sm icon-only danger-ghost" onClick={() => remove(c)}
                  title="Kodu sil" aria-label={`${c.code} kodunu sil`}>
                  <Icon.Trash width="15" height="15" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// === Kayıtlar ===

const fmtBytes = (b) => {
  if (!b) return '—';
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(b / 1024 ** 3).toFixed(1)} GB`;
};
const fmtDuration = (s) => {
  if (!s) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} sa ${m} dk` : `${m || 1} dk`;
};
const RECORDING_STATUS = {
  starting: { label: 'Başlıyor', tone: 'warning' },
  active: { label: 'Kaydediliyor', tone: 'danger' },
  processing: { label: 'Hazırlanıyor', tone: 'warning' },
  completed: null,
  failed: { label: 'Başarısız', tone: 'muted' },
  aborted: { label: 'İptal edildi', tone: 'muted' },
};

// Sunucuda saklanan toplantı kayıtları: izle, indir, sil
function RecordingsSection() {
  const [data, setData] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  function load() {
    return adminRecordings().then(setData).catch((err) => setError(err.message));
  }

  // Süren/hazırlanan kayıt varsa durumu kendiliğinden güncellensin
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  async function remove(rec) {
    if (!window.confirm(`"${rec.roomName}" kaydı kalıcı olarak silinsin mi?`)) return;
    setBusyId(rec.id);
    try {
      await adminDeleteRecording(rec.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const recordings = data?.recordings;

  return (
    <>
      <SectionHeader
        title="Kayıtlar"
        desc={`Toplantılar sunucuda kaydedilir; yer kaplamasın diye sıkıştırılmıştır (720p, saatte yaklaşık 290 MB). Kaydı toplantıda ⋯ menüsünden başlatın.${data ? ` Toplam kullanılan alan: ${fmtBytes(data.totalBytes)}.` : ''}`}
      />
      {error && <p className="error-text" role="alert">{error}</p>}
      {!recordings && !error && <div className="spinner" />}
      {recordings?.length === 0 && (
        <p className="admin-empty">Henüz kayıt yok. Bir toplantıda ⋯ → “Kaydı başlat” ile ilk kaydı alın.</p>
      )}
      {recordings?.length > 0 && (
        <ul className="admin-list">
          {recordings.map((rec) => {
            const status = RECORDING_STATUS[rec.status];
            const ready = rec.status === 'completed';
            return (
              <li key={rec.id} className="code-row recording-row">
                <button
                  type="button"
                  className="recording-thumb"
                  onClick={() => ready && setPlaying(rec)}
                  disabled={!ready}
                  aria-label={ready ? `${rec.roomName} kaydını izle` : undefined}
                >
                  <Icon.Play width="18" height="18" />
                </button>
                <div className="row-main">
                  <strong>{rec.roomName}</strong>
                  <span className="row-meta">
                    {status && <span className={`tag ${status.tone}`}>{status.label}</span>}
                    <span>{fmtDate(rec.startedAt)}</span>
                    {ready && <span className="tnum">{fmtDuration(rec.durationSec)}</span>}
                    {ready && <span className="tnum">{fmtBytes(rec.sizeBytes)}</span>}
                  </span>
                </div>
                <div className="row-actions">
                  {ready && (
                    <a className="btn sm" href={recordingFileUrl(rec.id, true)} download>
                      <Icon.Download width="14" height="14" /> İndir
                    </a>
                  )}
                  <button type="button" className="btn sm icon-only danger-ghost" onClick={() => remove(rec)}
                    disabled={busyId === rec.id} title="Kaydı sil" aria-label={`${rec.roomName} kaydını sil`}>
                    <Icon.Trash width="15" height="15" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {playing && (
        <Sheet title={playing.roomName} onClose={() => setPlaying(null)} wide>
          <video className="recording-player" src={recordingFileUrl(playing.id)} controls autoPlay playsInline />
          <p className="note">{fmtDate(playing.startedAt)} · {fmtDuration(playing.durationSec)} · {fmtBytes(playing.sizeBytes)}</p>
        </Sheet>
      )}
    </>
  );
}

// === Ayarlar (sekmeli) ===

const SETTINGS_TABS = [
  { key: 'genel', label: 'Genel' },
  { key: 'sms', label: 'Giriş' },
  { key: 'yoneticiler', label: 'Yöneticiler' },
  { key: 'hesap', label: 'Hesabım' },
];

function SettingsSection({ admin, onLogout }) {
  const [params, setParams] = useSearchParams();
  const tab = SETTINGS_TABS.some((t) => t.key === params.get('sekme')) ? params.get('sekme') : 'genel';

  return (
    <>
      <SectionHeader title="Ayarlar" />
      <div className="segmented settings-tabs" role="tablist">
        {SETTINGS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? 'active' : ''}
            onClick={() => setParams({ sekme: t.key }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'genel' && (
        <>
          <AppearanceCard />
          <LogoCard />
        </>
      )}
      {tab === 'sms' && <SmsSettings />}
      {tab === 'yoneticiler' && <AdminsSettings me={admin} />}
      {tab === 'hesap' && <AccountSettings admin={admin} onLogout={onLogout} />}
    </>
  );
}

// SMS doğrulaması aç/kapat + NETGSM bilgileri + test SMS'i
function SmsSettings() {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({ usercode: '', password: '', msgheader: '' });
  const [testPhone, setTestPhone] = useState('');
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    adminSiteSettings().then((s) => {
      setSettings(s);
      setForm({ usercode: s.netgsm.usercode, password: '', msgheader: s.netgsm.msgheader });
    }).catch((err) => setMsg({ ok: false, text: err.message }));
  }, []);

  async function run(key, fn, okText) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      if (okText) setMsg({ ok: true, text: okText });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(null);
    }
  }

  const toggleApproval = (next) => {
    if (!next && !window.confirm('Yeni üyeler onay beklemeden katılabilsin mi? Şu an onay bekleyen üyeler de onaylanır.')) return;
    run('approval', async () => {
      const s = await adminUpdateSiteSettings({ approvalRequired: next });
      setSettings(s);
      setApprovalRequired(s.approvalRequired);
      if (s.autoApproved) setMsg({ ok: true, text: `Onay bekleyen ${s.autoApproved} üye onaylandı.` });
    });
  };

  const toggle = (next) => {
    if (!next && !window.confirm('SMS doğrulaması kapatılsın mı? Kapalıyken telefon numarası doğrulanmaz; bir üyenin numarasını bilen biri onun adına giriş yapabilir.')) return;
    run('toggle', async () => {
      const s = await adminUpdateSiteSettings({ smsEnabled: next });
      setSettings(s);
      setSmsEnabled(s.smsEnabled);
    });
  };

  const save = (e) => {
    e.preventDefault();
    run('save', async () => {
      const s = await adminUpdateSiteSettings({ netgsm: form });
      setSettings(s);
      setForm((f) => ({ ...f, password: '' }));
    }, 'NETGSM bilgileri kaydedildi.');
  };

  const test = (e) => {
    e.preventDefault();
    run('test', () => adminSmsTest({ dialCode: '90', phone: testPhone }), 'Test SMS\'i gönderildi. Telefonunuzu kontrol edin.');
  };

  if (!settings) return <div className="spinner" />;

  return (
    <>
      <section className="settings-card">
        <label className="switch-row settings-switch">
          <span className="switch-row-text">
            <span className="switch-row-title">Yeni üyeler onay beklesin</span>
            <span className="switch-row-desc">
              {settings.approvalRequired
                ? 'Açık: kayıt olan kişi, siz Üyeler bölümünden onaylayınca toplantılara katılabilir.'
                : 'Kapalı: kayıt olan kişi ad-soyadını girip doğrudan toplantıya katılır. İstemediğiniz üyeleri Üyeler bölümünden reddedebilirsiniz.'}
            </span>
          </span>
          <span className="switch">
            <input type="checkbox" checked={settings.approvalRequired} disabled={busy === 'approval'}
              onChange={(e) => toggleApproval(e.target.checked)} />
            <span className="switch-track"><span className="switch-thumb" /></span>
          </span>
        </label>
      </section>

      <section className="settings-card">
        <label className="switch-row settings-switch">
          <span className="switch-row-text">
            <span className="switch-row-title">SMS doğrulaması</span>
            <span className="switch-row-desc">
              {settings.smsEnabled
                ? 'Açık: katılımcılar telefonlarına gelen 6 haneli kodla giriş yapar.'
                : 'Kapalı: katılımcılar yalnızca telefon numarası ve adıyla giriş yapar; SMS gönderilmez. Numara doğrulanmadığı için yeni üyeleri onaylarken dikkatli olun.'}
            </span>
          </span>
          <span className="switch">
            <input type="checkbox" checked={settings.smsEnabled} disabled={busy === 'toggle'} onChange={(e) => toggle(e.target.checked)} />
            <span className="switch-track"><span className="switch-thumb" /></span>
          </span>
        </label>
      </section>

      <form className="account-form settings-form" onSubmit={save}>
        <h2>NETGSM hesabı</h2>
        <p className="note">SMS'ler bu hesaptan gönderilir. Bilgiler NETGSM panelindeki API kullanıcısından alınır.</p>
        <div className="settings-grid">
          <div className="field">
            <label className="field-label" htmlFor="ng-user">Kullanıcı kodu</label>
            <input id="ng-user" className="input tnum" inputMode="numeric" value={form.usercode}
              onChange={(e) => setForm({ ...form, usercode: e.target.value.replace(/\D/g, '') })} placeholder="850XXXXXXX" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ng-pass">Şifre</label>
            <input id="ng-pass" className="input" type="password" autoComplete="new-password" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={settings.netgsm.passwordSet ? 'Kayıtlı — değiştirmek için yazın' : 'API şifresi'} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ng-header">Mesaj başlığı</label>
            <input id="ng-header" className="input" value={form.msgheader} maxLength={11}
              onChange={(e) => setForm({ ...form, msgheader: e.target.value })} placeholder="Örn. FIRMAADI" />
          </div>
        </div>
        <button type="submit" className="btn primary" disabled={busy === 'save'}>
          {busy === 'save' ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </form>

      <form className="account-form settings-form" onSubmit={test}>
        <h2>Test SMS'i</h2>
        <p className="note">Kayıtlı bilgilerle bir deneme mesajı gönderir; ayarların çalıştığını buradan doğrulayın.</p>
        <div className="settings-inline">
          <input className="input tnum" type="tel" inputMode="tel" value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)} placeholder="5XX XXX XX XX" aria-label="Test için cep telefonu" />
          <button type="submit" className="btn" disabled={busy === 'test' || testPhone.replace(/\D/g, '').length < 10}>
            {busy === 'test' ? 'Gönderiliyor…' : 'Gönder'}
          </button>
        </div>
      </form>

      {msg && <p className={msg.ok ? 'note text-success settings-msg' : 'error-text settings-msg'} role="status">{msg.text}</p>}
    </>
  );
}

// Yöneticiler: listele, ekle, sil
function AdminsSettings({ me }) {
  const [admins, setAdmins] = useState(null);
  const [form, setForm] = useState({ email: '', name: '', password: '' });
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = () => adminAdmins().then(setAdmins).catch((err) => setError(err.message));
  useEffect(() => { load(); }, []);

  async function add(e) {
    e.preventDefault();
    setBusy('add');
    setError(null);
    setCreated(null);
    try {
      const a = await adminCreateAdmin(form);
      setCreated(a);
      setForm({ email: '', name: '', password: '' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(a) {
    if (!window.confirm(`${a.name} (${a.email}) yöneticilikten çıkarılsın mı?`)) return;
    setBusy(a.id);
    setError(null);
    try {
      await adminDeleteAdmin(a.id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {admins === null && !error && <div className="spinner" />}
      {admins?.length > 0 && (
        <ul className="admin-list">
          {admins.map((a) => (
            <li key={a.id} className="member-row">
              <span className="avatar">{initials(a.name)}</span>
              <div className="row-main">
                <strong>{a.name}{a.id === me.id && <span className="tag">Siz</span>}</strong>
                <span className="row-meta">
                  <span>{a.email}</span>
                  <span>Son giriş {fmtDate(a.lastLoginAt)}</span>
                </span>
              </div>
              {a.id !== me.id && (
                <div className="row-actions">
                  <button type="button" className="btn sm icon-only danger-ghost" onClick={() => remove(a)}
                    disabled={busy === a.id} title="Yöneticiyi çıkar" aria-label={`${a.name} yöneticisini çıkar`}>
                    <Icon.Trash width="15" height="15" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="account-form settings-form" onSubmit={add}>
        <h2>Yönetici ekle</h2>
        <div className="settings-grid">
          <div className="field">
            <label className="field-label" htmlFor="ad-name">Ad soyad</label>
            <input id="ad-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ad-email">E-posta</label>
            <input id="ad-email" className="input" type="email" value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="ad-pass">Şifre <span className="optional">(boş bırakılırsa üretilir)</span></label>
            <input id="ad-pass" className="input" type="password" autoComplete="new-password" minLength={10} value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
        </div>
        <button type="submit" className="btn primary" disabled={busy === 'add'}>
          <Icon.Plus /> {busy === 'add' ? 'Ekleniyor…' : 'Yönetici ekle'}
        </button>
        {created && (
          <div className="created-admin" role="status">
            <strong>{created.name} eklendi.</strong>
            {created.password
              ? <span>Giriş şifresi (yalnız şimdi gösterilir): <code>{created.password}</code></span>
              : <span>Belirlediğiniz şifreyle giriş yapabilir.</span>}
          </div>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
      </form>
    </>
  );
}

function AccountSettings({ admin, onLogout }) {
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
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="account-card">
        <span className="avatar lg">{initials(admin.name)}</span>
        <div className="row-main">
          <strong>{admin.name}</strong>
          <span className="row-meta"><span>{admin.email}</span></span>
        </div>
      </div>

      <form className="account-form" onSubmit={submit}>
        <h2>Şifre değiştir</h2>
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
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Kaydediliyor…' : 'Şifreyi değiştir'}
        </button>
        {msg && <p className={msg.ok ? 'note text-success' : 'error-text'}>{msg.text}</p>}
      </form>

      <button type="button" className="btn account-logout" onClick={onLogout}>
        <Icon.Logout /> Çıkış yap
      </button>
    </>
  );
}

// Görünüm: site adı (sekme başlığı, SMS, ana sayfa), ana sayfa alt yazısı ve ana renk
const COLOR_PRESETS = [
  { hex: '#1d2e27', name: 'Koyu yeşil' },
  { hex: '#09090b', name: 'Siyah' },
  { hex: '#1e3a5f', name: 'Lacivert' },
  { hex: '#6b1d2a', name: 'Bordo' },
  { hex: '#4c2a70', name: 'Mor' },
  { hex: '#8a5a1c', name: 'Toprak' },
];

function AppearanceCard() {
  const branding = useBranding();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // Ayarlar yüklenince formu doldur
  useEffect(() => {
    if (branding.loaded && !form) {
      setForm({ siteName: branding.siteName, tagline: branding.tagline, brandColor: branding.brandColor || '' });
    }
  }, [branding.loaded]);

  if (!form) return <div className="spinner" />;

  const color = form.brandColor || '#1d2e27';
  const validColor = !form.brandColor || /^#[0-9a-f]{6}$/i.test(form.brandColor);
  const changed = form.siteName !== branding.siteName || form.tagline !== branding.tagline
    || (form.brandColor || null) !== (branding.brandColor || null);

  async function save(e, patch = form) {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminUpdateSiteSettings({
        siteName: patch.siteName,
        tagline: patch.tagline,
        brandColor: patch.brandColor || null,
      });
      setAppearance(r);
      setForm({ siteName: r.siteName, tagline: r.tagline || branding.tagline, brandColor: r.brandColor || '' });
      setMsg({ ok: true, text: 'Görünüm kaydedildi.' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="account-form settings-form appearance-form" onSubmit={save}>
      <h2>Görünüm</h2>
      <div className="settings-grid appearance-grid">
        <div className="field">
          <label className="field-label" htmlFor="ap-name">Site adı</label>
          <input id="ap-name" className="input" value={form.siteName} maxLength={60}
            onChange={(e) => setForm({ ...form, siteName: e.target.value })} />
          <span className="field-hint">Ana sayfada, tarayıcı sekmesinde ve giriş SMS'inde görünür.</span>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="ap-tag">Ana sayfa alt yazısı</label>
          <input id="ap-tag" className="input" value={form.tagline} maxLength={120}
            onChange={(e) => setForm({ ...form, tagline: e.target.value })} />
          <span className="field-hint">Ana sayfadaki renkli panelde, site adının altında.</span>
        </div>
      </div>

      <div className="field">
        <span className="field-label">Ana renk</span>
        <div className="color-row">
          {COLOR_PRESETS.map((c) => (
            <button key={c.hex} type="button" title={c.name} aria-label={c.name}
              className={`color-swatch ${color.toLowerCase() === c.hex ? 'active' : ''}`}
              style={{ background: c.hex }}
              onClick={() => setForm({ ...form, brandColor: c.hex })} />
          ))}
          <label className="color-custom" title="Özel renk">
            <input type="color" value={color} onChange={(e) => setForm({ ...form, brandColor: e.target.value })} />
            <span>Özel</span>
          </label>
          <input className="input color-hex tnum" value={form.brandColor} placeholder="#1d2e27" maxLength={7}
            onChange={(e) => setForm({ ...form, brandColor: e.target.value.trim() })} aria-label="Renk kodu" />
        </div>
        <span className="field-hint">Ana sayfa paneline ve tüm ana düğmelere uygulanır.</span>
      </div>

      {/* Canlı önizleme: kaydetmeden önce panel ve düğme nasıl görünecek */}
      <div className="appearance-preview" style={{ '--pv': validColor ? color : '#1d2e27' }}>
        <div className="appearance-preview-panel">
          <strong>{form.siteName || '…'}</strong>
          <span>{form.tagline}</span>
        </div>
        <div className="appearance-preview-body">
          <span className="appearance-preview-btn" style={{ color: validColor && isLightColor(color) ? '#09090b' : '#fff' }}>
            Toplantıya katıl
          </span>
        </div>
      </div>

      <div className="appearance-actions">
        <button type="submit" className="btn primary" disabled={busy || !changed || !validColor || form.siteName.trim().length < 2}>
          {busy ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
        {branding.brandColor && (
          <button type="button" className="btn" disabled={busy}
            onClick={() => save(null, { ...form, brandColor: null })}>
            Varsayılan renge dön
          </button>
        )}
      </div>
      {msg && <p className={msg.ok ? 'note text-success' : 'error-text'} role="status">{msg.text}</p>}
    </form>
  );
}

const LOGO_MAX_MB = 2;

// Site logosu: kenar çubuğu, katılımcı giriş ekranı ve ana sayfada görünür
function LogoCard() {
  const { logoUrl, custom, loaded } = useBranding();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function upload(file) {
    if (!file) return;
    if (file.size > LOGO_MAX_MB * 1024 * 1024) {
      setMsg({ ok: false, text: `Logo en fazla ${LOGO_MAX_MB} MB olabilir.` });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await adminUploadLogo(file);
      setBrandingLogo(r.logoUrl);
      setMsg({ ok: true, text: 'Logo güncellendi.' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function reset() {
    if (!window.confirm('Yüklenen logo kaldırılıp varsayılan logoya dönülsün mü?')) return;
    setBusy(true);
    setMsg(null);
    try {
      await adminRemoveLogo();
      setBrandingLogo(null);
      setMsg({ ok: true, text: 'Varsayılan logoya dönüldü.' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="logo-card">
      <div
        className={`logo-preview ${busy ? 'busy' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files?.[0]); }}
      >
        {loaded && <img src={logoUrl} alt="Site logosu" />}
      </div>
      <div className="logo-card-body">
        <h2>Logo</h2>
        <p>
          Kenar çubuğunda, katılımcı giriş ekranında ve ana sayfada görünür. PNG, JPG ya da WEBP,
          en fazla {LOGO_MAX_MB} MB. Şeffaf arka planlı yatay bir logo en iyi sonucu verir.
        </p>
        <div className="logo-card-actions">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <button type="button" className="btn primary" onClick={() => inputRef.current?.click()} disabled={busy}>
            <Icon.Image /> {busy ? 'Yükleniyor…' : custom ? 'Logoyu değiştir' : 'Logo yükle'}
          </button>
          {custom && (
            <button type="button" className="btn" onClick={reset} disabled={busy}>
              Varsayılana dön
            </button>
          )}
        </div>
        {msg && <p className={msg.ok ? 'note text-success' : 'error-text'} role="status">{msg.text}</p>}
      </div>
    </section>
  );
}

// Masaüstünde ortalı pencere, mobilde alttan açılan sayfa
function Sheet({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={`sheet ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="btn ghost icon" onClick={onClose} aria-label="Kapat">
            <Icon.X />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
