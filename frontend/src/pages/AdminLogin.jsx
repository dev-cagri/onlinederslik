import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TopBar } from '../components/TopBar.jsx';
import { Icon } from '../components/icons.jsx';
import { adminLogin, adminMe } from '../lib/api.js';

export function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

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
    <>
      <TopBar />
      <div className="centered-screen">
        <form className="card" onSubmit={handleSubmit}>
          <h2 className="card-title">Yönetici girişi</h2>
          <p className="card-desc">Ders odalarını yalnızca yöneticiler oluşturabilir.</p>
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
          <button type="submit" className="btn primary full" disabled={busy}>
            <Icon.Lock /> {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
          </button>
          {error && <p className="error-text" role="alert">{error}</p>}
        </form>
      </div>
    </>
  );
}
