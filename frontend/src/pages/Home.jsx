import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createRoom } from '../lib/api.js';
import { Icon } from '../components/icons.jsx';

export function Home() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('create'); // 'create' | 'join'
  const [name, setName] = useState(() => sessionStorage.getItem('zoomtr:name') || '');
  const [roomTitle, setRoomTitle] = useState('');
  const [password, setPassword] = useState('');
  const [usePassword, setUsePassword] = useState(false);
  const [lobbyEnabled, setLobbyEnabled] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return setError('Adınızı girin');
    if (usePassword && !password.trim()) return setError('Parola girin veya parolayı kapatın');
    setBusy(true);
    setError(null);
    try {
      const room = await createRoom({
        name: roomTitle.trim() || `${name} - Toplantı`,
        password: usePassword ? password.trim() : null,
        lobbyEnabled,
      });
      sessionStorage.setItem('zoomtr:name', name.trim());
      sessionStorage.setItem(`zoomtr:host:${room.id}`, room.hostToken);
      if (room.hasPassword) {
        sessionStorage.setItem(`zoomtr:pwd:${room.id}`, password.trim());
      }
      navigate(`/room/${room.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleJoin(e) {
    e.preventDefault();
    const code = joinCode.trim();
    if (!code) return setError('Oda kodunu veya linkini girin');
    if (name.trim()) sessionStorage.setItem('zoomtr:name', name.trim());
    // Name yoksa Room sayfası girince soracak.
    const id = code.includes('/room/') ? code.split('/room/')[1].split(/[?#]/)[0] : code;
    navigate(`/room/${id}`);
  }

  return (
    <>
      <main className="home-main">
        <div className="hero">
          <div className="hero-form-side">
            <span className="hero-eyebrow">Online Derslik</span>
            <h1 className="hero-title">Online Eğitim Platformu</h1>
            <p className="hero-subtitle">
              Kayıt yok. Adınızı girin, link oluşturun ve paylaşın. Sınırsız katılımcı,
              canlı sohbet ve ekran paylaşımı dahil.
            </p>

            <div className="hero-pills">
              <span className="pill">🔒 Parola</span>
              <span className="pill">🚪 Bekleme odası</span>
              <span className="pill">🔇 Host kontrolleri</span>
              <span className="pill">💬 Sohbet</span>
            </div>

            <div className="hero-flow">
              <div className="field">
                <label className="field-label">Adınız</label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Örn. Ahmet Yılmaz"
                  autoComplete="name"
                />
              </div>

              <div className="tab-segmented" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'create'}
                  className={mode === 'create' ? 'active' : ''}
                  onClick={() => { setMode('create'); setError(null); }}
                >
                  <Icon.Plus width="14" height="14" /> Yeni oda oluştur
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'join'}
                  className={mode === 'join' ? 'active' : ''}
                  onClick={() => { setMode('join'); setError(null); }}
                >
                  <Icon.Door width="14" height="14" /> Odaya katıl
                </button>
              </div>

              {mode === 'create' ? (
                <form className="auth-tab-body" onSubmit={handleCreate}>
                  <div className="field">
                    <label className="field-label">Oda başlığı <span className="optional">(opsiyonel)</span></label>
                    <input
                      className="input"
                      value={roomTitle}
                      onChange={(e) => setRoomTitle(e.target.value)}
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
                          <input
                            type="checkbox"
                            checked={usePassword}
                            onChange={(e) => setUsePassword(e.target.checked)}
                          />
                          <span className="switch-track"><span className="switch-thumb" /></span>
                        </span>
                      </label>
                      {usePassword && (
                        <div className="switch-extra">
                          <label className="field-label">Oda parolası</label>
                          <input
                            className="input"
                            type="text"
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
                        <input
                          type="checkbox"
                          checked={lobbyEnabled}
                          onChange={(e) => setLobbyEnabled(e.target.checked)}
                        />
                        <span className="switch-track"><span className="switch-thumb" /></span>
                      </span>
                    </label>
                  </div>

                  <button type="submit" className="btn primary full lg" disabled={busy}>
                    <Icon.Plus />
                    {busy ? 'Oluşturuluyor…' : 'Yeni oda oluştur'}
                  </button>
                </form>
              ) : (
                <form className="auth-tab-body" onSubmit={handleJoin}>
                  <div className="field">
                    <label className="field-label">Oda kodu veya link</label>
                    <input
                      className="input"
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value)}
                      placeholder="Örn. 1NUc3WBTyX veya tam link yapıştır"
                      autoFocus
                    />
                  </div>
                  <button type="submit" className="btn primary full lg">
                    <Icon.Door /> Odaya katıl
                  </button>
                </form>
              )}

              {error && <p className="error-text">{error}</p>}
            </div>
          </div>

          <div className="hero-visual-side">
            <div className="hero-glow hero-glow-top" aria-hidden="true" />
            <div className="hero-glow hero-glow-bottom" aria-hidden="true" />
            <img src="/cyikon.png" alt="" className="hero-logo" />
            <div className="hero-visual-caption">
              <strong>Sınırsız · canlı</strong>
              <span>Eğitim için optimize edilmiş video</span>
            </div>
          </div>
        </div>
      </main>

      <footer className="home-footer">
        Çağrı Yılmaz tarafından <span aria-label="kalp" role="img">❤️</span> ile yapıldı.
      </footer>
    </>
  );
}
