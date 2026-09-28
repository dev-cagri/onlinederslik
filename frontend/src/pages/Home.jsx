import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminMe } from '../lib/api.js';
import { Icon } from '../components/icons.jsx';

// Herkese açık giriş sayfası: yalnızca derse katılım. Oda açmak yönetim panelinde (/admin).
export function Home() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState(null);
  const [admin, setAdmin] = useState(null);

  useEffect(() => {
    adminMe().then(setAdmin).catch(() => {});
  }, []);

  function handleJoin(e) {
    e.preventDefault();
    const code = joinCode.trim();
    if (!code) return setError('Oda kodunu veya linkini girin');
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
              Derse katılmak için öğretmeninizin paylaştığı linke tıklayın ya da oda kodunu
              aşağıya girin. Girişte kimliğiniz SMS ile doğrulanır.
            </p>

            <div className="hero-pills">
              <span className="pill">🔐 Kimlik doğrulamalı</span>
              <span className="pill">📍 Yoklama</span>
              <span className="pill">💬 Sohbet</span>
              <span className="pill">🖥️ Ekran paylaşımı</span>
            </div>

            <div className="hero-flow">
              <form className="auth-tab-body" onSubmit={handleJoin}>
                <div className="field">
                  <label className="field-label" htmlFor="join-code">Oda kodu veya link</label>
                  <input
                    id="join-code"
                    className="input"
                    value={joinCode}
                    onChange={(e) => { setJoinCode(e.target.value); setError(null); }}
                    placeholder="Örn. 1NUc3WBTyX veya tam link yapıştır"
                    autoFocus
                  />
                </div>
                <button type="submit" className="btn primary full lg">
                  <Icon.Door /> Derse katıl
                </button>
              </form>

              {error && <p className="error-text">{error}</p>}

              <div className="home-admin-link">
                {admin ? (
                  <Link to="/admin" className="btn full">
                    <Icon.Shield width="14" height="14" /> Yönetim paneline git ({admin.name})
                  </Link>
                ) : (
                  <Link to="/admin/login">Yönetici girişi</Link>
                )}
              </div>
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
