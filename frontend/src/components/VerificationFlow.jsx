import { useEffect, useState } from 'react';
import { Icon } from './icons.jsx';
import { KVKK_VERSION, KVKK_SECTIONS, KVKK_CONSENT_TEXT } from '../lib/kvkk.js';
import { COUNTRIES } from '../lib/countries.js';
import {
  startVerification,
  getVerification,
  submitIdentity,
  sendOtp,
  verifyOtp,
  submitLocation,
} from '../lib/api.js';

export const verificationKey = (roomId) => `zoomtr:verify:${roomId}`;

const STEPS = [
  { key: 'kvkk', label: 'KVKK', icon: Icon.Shield },
  { key: 'identity', label: 'Kimlik', icon: Icon.IdCard },
  { key: 'phone', label: 'Telefon', icon: Icon.Phone },
  { key: 'location', label: 'Konum', icon: Icon.MapPin },
];

// Host dışındaki katılımcılar odaya girmeden önce: KVKK onayı → ad/soyad/TC → SMS kodu → konum.
// Adım sırası sunucuda da zorunlu; burası sadece arayüz.
export function VerificationFlow({ roomId, roomName, password, onComplete, onPasswordRequired }) {
  const [step, setStep] = useState('loading');
  const [vid, setVid] = useState(() => sessionStorage.getItem(verificationKey(roomId)));
  const [error, setError] = useState(null);

  // Yarım kalan doğrulamayı (sayfa yenilendi vb.) kaldığı yerden sürdür
  useEffect(() => {
    if (!vid) { setStep('kvkk'); return; }
    getVerification(roomId, vid)
      .then((v) => {
        if (v.complete) return onComplete(vid);
        setStep(!v.steps.identity ? 'identity' : !v.steps.phone ? 'phone' : 'location');
      })
      .catch(() => restart());
  }, []);

  function restart(message) {
    sessionStorage.removeItem(verificationKey(roomId));
    setVid(null);
    setError(message || null);
    setStep('kvkk');
  }

  // Doğrulama oturumu süresi dolduysa (404) baştan başlat; diğer hataları göster
  function handleError(err) {
    if (err.status === 404) return restart('Doğrulama oturumunuzun süresi doldu, lütfen tekrar başlayın.');
    setError(err.message);
  }

  function go(next) {
    setError(null);
    setStep(next);
  }

  const currentIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="centered-screen">
      <div className="card verify-card">
        <h2 className="card-title">{roomName || 'Derse katıl'}</h2>
        <p className="card-desc">Derse girmeden önce kimliğinizi doğrulamanız gerekiyor.</p>

        <ol className="verify-steps">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              className={i < currentIndex ? 'done' : i === currentIndex ? 'active' : ''}
            >
              <span className="verify-step-dot">
                {i < currentIndex ? <Icon.Check width="12" height="12" /> : i + 1}
              </span>
              <span className="verify-step-label">{s.label}</span>
            </li>
          ))}
        </ol>

        {step === 'loading' && <div className="spinner" />}
        {step === 'kvkk' && (
          <KvkkStep
            onAccept={async () => {
              try {
                const { verificationId } = await startVerification(roomId, {
                  kvkkVersion: KVKK_VERSION,
                  password,
                });
                sessionStorage.setItem(verificationKey(roomId), verificationId);
                setVid(verificationId);
                go('identity');
              } catch (err) {
                if (err.status === 401) return onPasswordRequired();
                handleError(err);
              }
            }}
          />
        )}
        {step === 'identity' && (
          <IdentityStep
            onSubmit={async (identity) => {
              try {
                await submitIdentity(roomId, vid, identity);
                go('phone');
              } catch (err) { handleError(err); }
            }}
          />
        )}
        {step === 'phone' && (
          <PhoneStep
            roomId={roomId}
            vid={vid}
            onError={handleError}
            clearError={() => setError(null)}
            onVerified={() => go('location')}
          />
        )}
        {step === 'location' && (
          <LocationStep
            onError={setError}
            onLocation={async (coords) => {
              try {
                await submitLocation(roomId, vid, coords);
                onComplete(vid);
              } catch (err) { handleError(err); }
            }}
          />
        )}

        {error && <p className="error-text" role="alert">{error}</p>}
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

function KvkkStep({ onAccept }) {
  const [read, setRead] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, run] = useBusy();

  return (
    <form className="verify-body" onSubmit={run(onAccept)}>
      <div className="kvkk-text" tabIndex={0}>
        <strong className="kvkk-title">Kişisel Verilerin Korunması Aydınlatma Metni</strong>
        {KVKK_SECTIONS.map((s) => (
          <div key={s.title}>
            <h4>{s.title}</h4>
            <p>{s.body}</p>
          </div>
        ))}
      </div>
      <label className="verify-check">
        <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
        <span>Aydınlatma metnini okudum ve anladım.</span>
      </label>
      <label className="verify-check">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{KVKK_CONSENT_TEXT}</span>
      </label>
      <button type="submit" className="btn primary full" disabled={!read || !consent || busy}>
        {busy ? 'Kaydediliyor…' : 'Onaylıyorum, devam et'}
      </button>
    </form>
  );
}

function IdentityStep({ onSubmit }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [tcNo, setTcNo] = useState('');
  const [busy, run] = useBusy();

  const valid = firstName.trim() && lastName.trim() && tcNo.length === 11;

  return (
    <form className="verify-body" onSubmit={run(() => onSubmit({ firstName, lastName, tcNo }))}>
      <div className="verify-row">
        <div className="field">
          <label className="field-label" htmlFor="v-first">Ad</label>
          <input
            id="v-first"
            className="input"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            autoFocus
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="v-last">Soyad</label>
          <input
            id="v-last"
            className="input"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
          />
        </div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="v-tc">T.C. Kimlik No</label>
        <input
          id="v-tc"
          className="input"
          value={tcNo}
          onChange={(e) => setTcNo(e.target.value.replace(/\D/g, '').slice(0, 11))}
          inputMode="numeric"
          autoComplete="off"
          placeholder="11 haneli numara"
        />
      </div>
      <p className="note">Derste adınız bu bilgilere göre görünecek.</p>
      <div className="verify-privacy">
        <Icon.Shield width="18" height="18" />
        <p>
          Bilgileriniz SSL ile şifrelenmiş güvenli bağlantı üzerinden iletilir. T.C. kimlik
          numaranız yalnızca kimlik doğrulaması ve yoklama amacıyla kullanılır; ticari amaçla
          üçüncü kişilerle paylaşılmaz.
        </p>
      </div>
      <button type="submit" className="btn primary full" disabled={!valid || busy}>
        {busy ? 'Kontrol ediliyor…' : 'Devam et'}
      </button>
    </form>
  );
}

function PhoneStep({ roomId, vid, onError, clearError, onVerified }) {
  const [dialCode, setDialCode] = useState('90');
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState(null);
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [busy, run] = useBusy();

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const send = run(async () => {
    clearError();
    try {
      const r = await sendOtp(roomId, vid, { dialCode, phone });
      setSentTo(`+${dialCode} ${phone}`);
      setCode('');
      setResendIn(r.resendIn || 60);
    } catch (err) {
      if (err.data?.retryAfter) {
        setSentTo(`+${dialCode} ${phone}`);
        setResendIn(err.data.retryAfter);
      }
      onError(err);
    }
  });

  const verify = run(async () => {
    clearError();
    try {
      await verifyOtp(roomId, vid, code);
      onVerified();
    } catch (err) { onError(err); }
  });

  const country = COUNTRIES.find((c) => c.code === dialCode);

  if (!sentTo) {
    return (
      <form className="verify-body" onSubmit={send}>
        <div className="field">
          <label className="field-label" htmlFor="v-phone">Cep telefonu</label>
          <div className="phone-row">
            <select
              className="input phone-country"
              value={dialCode}
              onChange={(e) => setDialCode(e.target.value)}
              aria-label="Ülke kodu"
            >
              {COUNTRIES.map((c) => (
                <option key={`${c.code}-${c.name}`} value={c.code}>
                  {c.flag} +{c.code} {c.name}
                </option>
              ))}
            </select>
            <input
              id="v-phone"
              className="input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel-national"
              placeholder={country?.placeholder || 'Telefon numarası'}
              autoFocus
            />
          </div>
        </div>
        <p className="note">
          Bu numaraya 6 haneli bir doğrulama kodu göndereceğiz.
          {dialCode !== '90' && ' Yurt dışı SMS\'lerinin ulaşması biraz daha uzun sürebilir.'}
        </p>
        <button type="submit" className="btn primary full" disabled={phone.replace(/\D/g, '').length < 6 || busy}>
          {busy ? 'Gönderiliyor…' : 'Kod gönder'}
        </button>
      </form>
    );
  }

  return (
    <form className="verify-body" onSubmit={verify}>
      <div className="field">
        <label className="field-label" htmlFor="v-code">
          {sentTo} numarasına gönderilen kod
        </label>
        <input
          id="v-code"
          className="input otp-input"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="••••••"
          autoFocus
        />
      </div>
      <button type="submit" className="btn primary full" disabled={code.length !== 6 || busy}>
        {busy ? 'Doğrulanıyor…' : 'Doğrula'}
      </button>
      <div className="verify-links">
        <button type="button" className="btn ghost sm" onClick={() => { clearError(); setSentTo(null); }}>
          Numarayı değiştir
        </button>
        <button type="button" className="btn ghost sm" onClick={send} disabled={resendIn > 0 || busy}>
          {resendIn > 0 ? `Tekrar gönder (${resendIn} sn)` : 'Kodu tekrar gönder'}
        </button>
      </div>
    </form>
  );
}

const GEO_ERRORS = {
  1: 'Konum izni verilmedi. Adres çubuğundaki konum simgesinden izni açıp tekrar deneyin.',
  2: 'Konumunuz belirlenemedi. Cihazınızın konum servislerinin açık olduğundan emin olun.',
  3: 'Konum alınırken zaman aşımı oldu. Lütfen tekrar deneyin.',
};

function LocationStep({ onLocation, onError }) {
  const [busy, setBusy] = useState(false);

  function share() {
    onError(null);
    if (!window.isSecureContext || !navigator.geolocation) {
      onError('Bu tarayıcı konum paylaşımını desteklemiyor ya da sayfa güvenli (HTTPS) bağlantıyla açılmamış.');
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await onLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setBusy(false);
      },
      (err) => {
        setBusy(false);
        onError(GEO_ERRORS[err.code] || 'Konum alınamadı.');
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  return (
    <div className="verify-body">
      <div className="verify-location-hint">
        <Icon.MapPin width="20" height="20" />
        <p>
          Derse katılımınızı kaydetmek için konumunuz bir kez alınacak. Tarayıcı izin
          istediğinde <strong>İzin ver</strong>'i seçin. Konum paylaşılmadan derse girilemez.
        </p>
      </div>
      <button type="button" className="btn primary full" onClick={share} disabled={busy}>
        <Icon.MapPin /> {busy ? 'Konum alınıyor…' : 'Konumumu paylaş ve derse gir'}
      </button>
    </div>
  );
}
