import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBranding, useDocumentTitle } from '../lib/branding.js';
import { adminLogin, adminMe } from '../lib/api.js';

export function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { logoUrl, loaded } = useBranding();
  useDocumentTitle('Yönetici girişi');

  // Zaten giriş yapılmışsa doğrudan panele
  useEffect(() => {
    adminMe().then((a) => { if (a) navigate('/admin', { replace: true }); }).catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await adminLogin(email.trim(), password);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="centered-screen auth-screen">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <div className="auth-nav">
          {loaded && <img className="auth-logo" src={logoUrl} alt="Logo" />}
        </div>
        <h1 className="auth-title">Yönetim paneli</h1>
        <p className="auth-desc">Toplantıları ve üyeleri yönetmek için giriş yapın.</p>
        <div className="auth-form">
          <div className="field">
            <label className="field-label" htmlFor="admin-email">E-posta</label>
            <input
              id="admin-email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="admin-password">Şifre</label>
            <input
              id="admin-password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <button type="submit" className="btn primary full auth-cta" disabled={busy}>
            {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
          </button>
        </div>
        {error && <p className="error-text auth-error" role="alert">{error}</p>}
      </form>
    </div>
  );
}
