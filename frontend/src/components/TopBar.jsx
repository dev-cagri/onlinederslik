import { Link } from 'react-router-dom';
import { useBranding } from '../lib/branding.js';

export function TopBar({ children, right }) {
  const { siteName, logoUrl, loaded } = useBranding();
  return (
    // Yalnız marka gösteren bar (giriş/bekleme ekranları) mobilde gizlenir; ekran tam sayfa olur
    <header className={`topbar ${children || right ? '' : 'topbar-plain'}`}>
      <Link to="/" className="brand" style={{ textDecoration: 'none' }}>
        {loaded && <img className="brand-logo" src={logoUrl} alt="" />}
        <span>{loaded ? siteName : ''}</span>
      </Link>
      {children && <nav>{children}</nav>}
      {right && <div className="topbar-right">{right}</div>}
    </header>
  );
}
