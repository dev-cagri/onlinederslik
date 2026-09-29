import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { memberMe, memberLogout } from '../lib/api.js';
import { useBranding, useDocumentTitle } from '../lib/branding.js';

const MEMBER_STATUS = {
  approved: 'Toplantılara katılabilirsiniz',
  pending: 'Üyeliğiniz yönetici onayı bekliyor',
  rejected: 'Üyeliğiniz onaylanmadı',
};

const initials = (m) => `${m.firstName?.[0] || ''}${m.lastName?.[0] || ''}`.toLocaleUpperCase('tr-TR');

// Herkese açık giriş sayfası: yalnızca toplantıya katılım. Toplantı açmak yönetim panelinde (/admin).
// Giriş ekranlarıyla aynı iskelet: masaüstünde ortalı kart, mobilde tam sayfa (styles.css).
export function Home() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState(null);
  const [member, setMember] = useState(null);
  const { logoUrl, loaded, siteName, tagline } = useBranding();
  useDocumentTitle();

  useEffect(() => {
    memberMe().then(setMember).catch(() => {});
  }, []);

  async function logoutMember() {
    await memberLogout().catch(() => {});
    setMember(null);
  }

  function handleJoin(e) {
    e.preventDefault();
    const code = joinCode.trim();
    if (!code) return setError('Toplantı kodunu ya da linkini girin.');
    const id = code.includes('/room/') ? code.split('/room/')[1].split(/[?#]/)[0] : code;
    navigate(`/room/${id}`);
  }

  return (
    <div className="join-page">
      {/* Marka paneli: site adı + hat sanatı çerçevelerini anımsatan geometrik desen */}
      <aside className="join-brand">
        <div className="join-brand-inner">
          {/* Ayarlar yüklenmeden varsayılan ad bir an görünüp değişmesin */}
          <p className="join-brand-name">{loaded ? siteName : '\u00a0'}</p>
          <p className="join-brand-tag">{loaded ? tagline : '\u00a0'}</p>
        </div>
      </aside>

      <main className="join-main">
        <div className="join-content">
          {loaded && <img className="join-logo" src={logoUrl} alt="Logo" />}
          <h1 className="join-title">Toplantıya katılın</h1>
          <p className="join-desc">
            Size gönderilen linke tıklayın ya da toplantı kodunu aşağıya yazın.
          </p>

          <form className="auth-form join-form" onSubmit={handleJoin}>
            <div className="field">
              <label className="field-label" htmlFor="join-code">Toplantı kodu ya da link</label>
              <input
                id="join-code"
                className="input"
                value={joinCode}
                onChange={(e) => { setJoinCode(e.target.value); setError(null); }}
                placeholder="Örn. 1NUc3WBTyX"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <button type="submit" className="btn primary full auth-cta join-cta">
              Toplantıya katıl
            </button>
          </form>
          {error && <p className="error-text auth-error" role="alert">{error}</p>}

          {member?.registered && (
            <div className="join-member">
              <span className={`avatar sm ${member.status}`}>{initials(member)}</span>
              <div className="row-main">
                <strong>{member.firstName} {member.lastName}</strong>
                <span className="row-meta"><span>{MEMBER_STATUS[member.status]}</span></span>
              </div>
              <button type="button" className="btn ghost sm" onClick={logoutMember}>Çıkış yap</button>
            </div>
          )}
        </div>

        <footer className="join-footer">
          <span>Çağrı Yılmaz tarafından <span aria-label="kalp" role="img">❤️</span> ile yapıldı</span>
        </footer>
      </main>
    </div>
  );
}
