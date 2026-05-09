import { Link } from 'react-router-dom';

export function TopBar({ children, right }) {
  return (
    <header className="topbar">
      <Link to="/" className="brand" style={{ textDecoration: 'none' }}>
        <span className="brand-mark">OD</span>
        <span>Online Derslik</span>
      </Link>
      {children && <nav>{children}</nav>}
      {right && <div className="topbar-right">{right}</div>}
    </header>
  );
}
