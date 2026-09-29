import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { KVKK_VERSION, KVKK_SECTIONS, KVKK_CONSENT_TEXT, KVKK_CODE_CONSENT_TEXT, KVKK_PHONE_CONSENT_TEXT } from '../lib/kvkk.js';
import { COUNTRIES } from '../lib/countries.js';
import { useBranding } from '../lib/branding.js';
import {
  memberMe,
  sendLoginCode,
  verifyLoginCode,
  phoneLogin,
  codeLogin,
  registerMember,
  memberLogout,
} from '../lib/api.js';

// Onay bekleyen üye bu aralıkla yoklanır; yönetici onaylayınca sayfa kendiliğinden toplantıya geçer
const PENDING_POLL_MS = 10_000;
const OTP_LENGTH = 6;

// Üyenin durumuna göre gösterilecek ekran
function screenFor(member) {
  if (!member) return 'login';
  if (!member.registered) return 'register';
  return member.status; // pending | approved | rejected
}

// Host dışındaki katılımcılar toplantıya girmeden önce: telefon + SMS kodu (ya da yöneticinin verdiği
// giriş kodu) → ilk girişte ad/soyad → yönetici onayı (giriş koduyla gelen doğrudan onaylıdır).
// Kurallar sunucuda da zorunlu; burası sadece arayüz.
export function MemberGate({ title, onApproved }) {
  const [member, setMember] = useState(undefined);
  const [error, setError] = useState(null);
  // Onay beklerken giriş kodu girilebilir
  const [enteringCode, setEnteringCode] = useState(false);
  const screen = member === undefined ? 'loading' : screenFor(member);

  useEffect(() => {
    memberMe().then(setMember).catch((err) => { setMember(null); setError(err.message); });
  }, []);

  useEffect(() => {
    if (screen === 'approved') onApproved(member);
  }, [screen]);

  // Onay beklerken durumu yokla
  useEffect(() => {
    if (screen !== 'pending') return;
    const t = setInterval(() => memberMe().then(setMember).catch(() => {}), PENDING_POLL_MS);
    return () => clearInterval(t);
  }, [screen]);

  function update(m) {
    setError(null);
    setEnteringCode(false);
    setMember(m);
  }

  async function logout() {
    await memberLogout().catch(() => {});
    update(null);
  }

  const shared = { lesson: title, error, onError: setError };

  if (screen === 'loading' || screen === 'approved') {
    return <div className="centered-screen"><div className="spinner" /></div>;
  }
  if (screen === 'login') return <LoginFlow {...shared} onLoggedIn={update} />;
  if (screen === 'register') return <RegisterStep {...shared} member={member} onRegistered={update} onLogout={logout} />;
  if (screen === 'pending' && enteringCode) {
    return (
      <AccessCodeStep
        {...shared}
        consentGiven
        onBack={() => { setError(null); setEnteringCode(false); }}
        onLoggedIn={update}
      />
    );
  }
  if (screen === 'pending') {
    return (
      <AuthScreen
        {...shared}
        title="Onay bekleniyor"
        desc={
          <>
            <strong>{member.firstName} {member.lastName}</strong> olarak kaydınız alındı. Yönetici
            onaylayınca bu sayfa toplantıya kendiliğinden geçer; sayfayı açık tutabilir ya da daha
            sonra linke tekrar tıklayabilirsiniz.
          </>
        }
      >
        <p className="auth-waiting" role="status">
          <span className="auth-waiting-dot" aria-hidden="true" /> Yönetici onayı bekleniyor
        </p>
        <div className="auth-alt">
          <button type="button" className="btn ghost" onClick={() => { setError(null); setEnteringCode(true); }}>
            <Icon.Key /> Giriş kodum var
          </button>
          <button type="button" className="btn ghost" onClick={logout}>Çıkış yap</button>
        </div>
      </AuthScreen>
    );
  }
  return (
    <AuthScreen
      {...shared}
      title="Üyeliğiniz onaylanmadı"
      desc="Bu hesapla toplantılara katılamazsınız. Bir yanlışlık olduğunu düşünüyorsanız toplantı sahibiyle iletişime geçin."
    >
      <div className="auth-alt">
        <button type="button" className="btn ghost" onClick={logout}>Çıkış yap</button>
      </div>
    </AuthScreen>
  );
}

// Tüm giriş ekranlarının ortak iskeleti. Masaüstünde ortalı kart; mobilde üst bar olmadan
// tam sayfa, sola hizalı, büyük başlıklı (styles.css → "Giriş ekranları").
function AuthScreen({ title, desc, onBack, error, children }) {
  const { logoUrl, loaded } = useBranding();
  return (
    <div className="centered-screen auth-screen">
      <div className="card auth-card">
        <div className="auth-nav">
          {onBack ? (
            <button type="button" className="auth-back" onClick={onBack}>
              <Icon.ChevronLeft width="22" height="22" /> Geri
            </button>
          ) : (
            loaded && <img className="auth-logo" src={logoUrl} alt="Logo" />
          )}
        </div>
        <h1 className="auth-title">{title}</h1>
        {desc && <p className="auth-desc">{desc}</p>}
        {children}
        {error && <p className="error-text auth-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}

function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = (fn) => async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };
  return [busy, run];
}

// Türkiye numarasını yazarken "5XX XXX XX XX" biçimine sokar; diğer ülkelerde dokunmaz
function formatPhone(dialCode, value) {
  if (dialCode !== '90') return value;
  const d = value.replace(/\D/g, '').replace(/^0/, '').slice(0, 10);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6, 8), d.slice(8, 10)].filter(Boolean).join(' ');
}

function LoginFlow({ lesson, error, onError, onLoggedIn }) {
  // SMS kapalıysa (yönetim paneli → Ayarlar) numara kodsuz alınır
  const { smsEnabled } = useBranding();
  const [mode, setMode] = useState('phone'); // phone | otp | code
  const [dialCode, setDialCode] = useState('90');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [busy, run] = useBusy();

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  function go(next) {
    onError(null);
    setMode(next);
  }

  const send = run(async () => {
    onError(null);
    if (!smsEnabled) {
      try {
        onLoggedIn(await phoneLogin({ dialCode, phone, kvkkVersion: KVKK_VERSION }));
      } catch (err) { onError(err.message); }
      return;
    }
    try {
      const r = await sendLoginCode({ dialCode, phone, kvkkVersion: KVKK_VERSION });
      setCode('');
      setResendIn(r.resendIn || 60);
      setMode('otp');
    } catch (err) {
      if (err.data?.retryAfter) {
        setResendIn(err.data.retryAfter);
        setMode('otp');
      }
      onError(err.message);
    }
  });

  // Son hane girilince otomatik gönderilir
  const verify = (value) => run(async () => {
    onError(null);
    try {
      onLoggedIn(await verifyLoginCode({ dialCode, phone, code: value, kvkkVersion: KVKK_VERSION }));
    } catch (err) {
      setCode('');
      onError(err.message);
    }
  })();

  if (mode === 'code') {
    return <AccessCodeStep lesson={lesson} error={error} onError={onError} onBack={() => go('phone')} onLoggedIn={onLoggedIn} />;
  }

  if (mode === 'otp') {
    return (
      <AuthScreen
        title="Kodu girin"
        desc={<>+{dialCode} {phone} numarasına gönderdiğimiz {OTP_LENGTH} haneli kodu girin.</>}
        onBack={() => go('phone')}
        error={error}
      >
        <form className="auth-form" onSubmit={(e) => { e.preventDefault(); verify(code); }}>
          <CodeBoxes value={code} onChange={setCode} onComplete={verify} disabled={busy} />
          <button type="submit" className="btn primary full auth-cta" disabled={code.length !== OTP_LENGTH || busy}>
            {busy ? 'Kontrol ediliyor…' : 'Giriş yap'}
          </button>
          <div className="auth-alt">
            <button type="button" className="btn ghost" onClick={send} disabled={resendIn > 0 || busy}>
              {resendIn > 0 ? `Kodu tekrar gönder (${resendIn} sn)` : 'Kodu tekrar gönder'}
            </button>
          </div>
        </form>
      </AuthScreen>
    );
  }

  const country = COUNTRIES.find((c) => c.code === dialCode);

  return (
    <AuthScreen
      title="Giriş yapın"
      desc={lesson
        ? <><strong>{lesson}</strong> toplantısına katılmak için {smsEnabled ? 'cep telefonunuza gelen kodla' : 'cep telefonu numaranızla'} giriş yapın.</>
        : `Toplantıya katılmak için ${smsEnabled ? 'cep telefonunuza gelen kodla' : 'cep telefonu numaranızla'} giriş yapın.`}
      error={error}
    >
      <form className="auth-form" onSubmit={send}>
        <div className="field">
          <label className="field-label" htmlFor="m-phone">Cep telefonu</label>
          <div className="phone-field">
            <span className="country-pick">
              <span aria-hidden="true">{country?.flag} +{dialCode}</span>
              <select
                value={dialCode}
                onChange={(e) => { setDialCode(e.target.value); setPhone(''); }}
                aria-label="Ülke kodu"
              >
                {COUNTRIES.map((c) => (
                  <option key={`${c.code}-${c.name}`} value={c.code}>
                    {c.flag} {c.name} (+{c.code})
                  </option>
                ))}
              </select>
            </span>
            <input
              id="m-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(formatPhone(dialCode, e.target.value))}
              inputMode="tel"
              autoComplete="tel-national"
              placeholder={country?.placeholder || 'Telefon numarası'}
              autoFocus
            />
          </div>
          {smsEnabled && dialCode !== '90' && <p className="note">Yurt dışı SMS'lerinin ulaşması biraz daha uzun sürebilir.</p>}
        </div>
        <Consent text={smsEnabled ? KVKK_CONSENT_TEXT : KVKK_PHONE_CONSENT_TEXT} checked={consent} onChange={setConsent} />
        <button
          type="submit"
          className="btn primary full auth-cta"
          disabled={phone.replace(/\D/g, '').length < 6 || !consent || busy}
        >
          {busy ? (smsEnabled ? 'Gönderiliyor…' : 'Giriş yapılıyor…') : (smsEnabled ? 'Kod gönder' : 'Devam et')}
        </button>
        <div className="auth-alt">
          <button type="button" className="btn ghost" onClick={() => go('code')}>
            <Icon.Key /> Giriş kodum var
          </button>
        </div>
      </form>
    </AuthScreen>
  );
}

// Yöneticinin verdiği giriş kodu: SMS ve onay beklemeden üyelik
function AccessCodeStep({ error, onError, onBack, onLoggedIn, consentGiven }) {
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(!!consentGiven);
  const [busy, run] = useBusy();

  const submit = run(async () => {
    onError(null);
    try {
      onLoggedIn(await codeLogin({ code, kvkkVersion: KVKK_VERSION }));
    } catch (err) { onError(err.message); }
  });

  // XXXX-XXXX; karışan karakterler (O/0, I/1) kodlarda olmadığı için olduğu gibi bırakılır
  function onChange(value) {
    const raw = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    setCode(raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw);
  }

  return (
    <AuthScreen
      title="Giriş kodu"
      desc="Size verilen giriş kodunu girin. Kodla giriş yaptığınızda SMS ve onay beklemeden toplantıya katılırsınız."
      onBack={onBack}
      error={error}
    >
      <form className="auth-form" onSubmit={submit}>
        <div className="field">
          <label className="field-label" htmlFor="m-access">Giriş kodu</label>
          <input
            id="m-access"
            className="input access-code-input"
            value={code}
            onChange={(e) => onChange(e.target.value)}
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="XXXX-XXXX"
            autoFocus
          />
        </div>
        {!consentGiven && <Consent text={KVKK_CODE_CONSENT_TEXT} checked={consent} onChange={setConsent} />}
        <button type="submit" className="btn primary full auth-cta" disabled={code.length < 9 || !consent || busy}>
          {busy ? 'Kontrol ediliyor…' : 'Devam et'}
        </button>
      </form>
    </AuthScreen>
  );
}

function RegisterStep({ member, error, onError, onRegistered, onLogout }) {
  // Onay kapalıysa (yönetim paneli → Ayarlar → Giriş) kayıt olan doğrudan katılır
  const { approvalRequired } = useBranding();
  const direct = member.status === 'approved' || !approvalRequired;
  const [firstName, setFirstName] = useState(member.firstName || '');
  const [lastName, setLastName] = useState(member.lastName || '');
  const [busy, run] = useBusy();

  const submit = run(async () => {
    onError(null);
    try {
      onRegistered(await registerMember({ firstName, lastName }));
    } catch (err) { onError(err.message); }
  });

  return (
    <AuthScreen
      title="Adınız ve soyadınız"
      desc={direct
        ? 'Toplantıda bu adla görüneceksiniz.'
        : 'Toplantıda bu adla görüneceksiniz. Kaydınız yönetici onayından sonra aktif olur.'}
      error={error}
    >
      <form className="auth-form" onSubmit={submit}>
        <div className="verify-row">
          <div className="field">
            <label className="field-label" htmlFor="m-first">Ad</label>
            <input
              id="m-first"
              className="input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
              autoFocus
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="m-last">Soyad</label>
            <input
              id="m-last"
              className="input"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
            />
          </div>
        </div>
        <button type="submit" className="btn primary full auth-cta" disabled={!firstName.trim() || !lastName.trim() || busy}>
          {busy ? 'Kaydediliyor…' : direct ? 'Toplantıya katıl' : 'Kaydı tamamla'}
        </button>
        <div className="auth-alt">
          <button type="button" className="btn ghost" onClick={onLogout}>
            {member.phone ? 'Farklı numarayla giriş yap' : 'Vazgeç'}
          </button>
        </div>
      </form>
    </AuthScreen>
  );
}

function Consent({ text, checked, onChange }) {
  return (
    <div className="auth-consent">
      <label className="verify-check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>{text}</span>
      </label>
      <details className="kvkk-details">
        <summary>KVKK aydınlatma metnini oku</summary>
        <div className="kvkk-text" tabIndex={0}>
          {KVKK_SECTIONS.map((s) => (
            <div key={s.title}>
              <h4>{s.title}</h4>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

// Tek gizli input + 6 görsel kutu: iOS/Android SMS kodu otomatik doldurma (one-time-code) çalışır
function CodeBoxes({ value, onChange, onComplete, disabled }) {
  const ref = useRef(null);
  // Kontrol bitince (hatalı kod temizlendiğinde) klavye tekrar açılsın
  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled]);
  return (
    <div className="otp-boxes" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, OTP_LENGTH);
          onChange(v);
          if (v.length === OTP_LENGTH && v !== value) onComplete(v);
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={OTP_LENGTH}
        disabled={disabled}
        aria-label={`${OTP_LENGTH} haneli doğrulama kodu`}
        autoFocus
      />
      {Array.from({ length: OTP_LENGTH }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`otp-box${value[i] ? ' filled' : ''}${i === Math.min(value.length, OTP_LENGTH - 1) ? ' current' : ''}`}
        >
          {value[i] || ''}
        </span>
      ))}
    </div>
  );
}
