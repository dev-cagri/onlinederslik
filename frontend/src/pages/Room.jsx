import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LiveKitRoom } from '@livekit/components-react';
import { VideoPresets } from 'livekit-client';

// Performans optimizasyonları:
// - adaptiveStream: alıcı bant genişliğine/ekran boyutuna göre simulcast katmanı seçer
// - dynacast: kimsenin görmediği yüksek katmanları yayınlamayı durdurur (CPU + bw kazancı)
// - simulcast 3 katman (180p/360p/720p) — düşük internetli öğrenciler 180p alır
// - VP9: VP8'e göre %30-50 daha iyi sıkıştırma; encoder yoksa LiveKit VP8'e fallback eder
// - DTX: konuşulmayan ses paketlerini iletmez; RED: ses paket kaybına dayanıklılık
const livekitOptions = {
  adaptiveStream: true,
  dynacast: true,
  publishDefaults: {
    simulcast: true,
    videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360, VideoPresets.h720],
    videoCodec: 'vp9',
    dtx: true,
    red: true,
  },
  videoCaptureDefaults: {
    resolution: VideoPresets.h720.resolution,
  },
};
import { getRoom, requestToken } from '../lib/api.js';
import { io } from 'socket.io-client';
import { ChatPanel } from '../components/ChatPanel.jsx';
import { ParticipantList } from '../components/ParticipantList.jsx';
import { SettingsPanel } from '../components/SettingsPanel.jsx';
import { LobbyWaiting } from '../components/LobbyWaiting.jsx';
import { VerificationFlow, verificationKey } from '../components/VerificationFlow.jsx';
import { TopBar } from '../components/TopBar.jsx';
import { Icon } from '../components/icons.jsx';
import { MeetingStage } from '../components/MeetingStage.jsx';
import { getActiveRecording } from '../lib/api.js';
import { BrowserRecorder, isBrowserRecordingSupported } from '../lib/browserRecorder.js';

export function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [step, setStep] = useState('loading');
  const [roomMeta, setRoomMeta] = useState(null);
  const [displayName, setDisplayName] = useState(() => sessionStorage.getItem('zoomtr:name') || '');
  const [nameInput, setNameInput] = useState('');
  const [password, setPassword] = useState(() => sessionStorage.getItem(`zoomtr:pwd:${roomId}`) || '');
  const [pwInput, setPwInput] = useState('');
  const [verificationId, setVerificationId] = useState(() => sessionStorage.getItem(verificationKey(roomId)));
  const [token, setToken] = useState(null);
  const [serverUrl, setServerUrl] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  const hostToken = sessionStorage.getItem(`zoomtr:host:${roomId}`) || null;

  useEffect(() => {
    getRoom(roomId)
      .then((room) => {
        setRoomMeta(room);
        // Host doğrudan girer; katılımcılar parola (varsa) → kimlik doğrulaması → bağlantı
        if (hostToken) setStep(displayName ? 'connecting' : 'ask-name');
        else if (room.hasPassword && !password) setStep('ask-password');
        else setStep(verificationId ? 'connecting' : 'verify');
      })
      .catch((e) => {
        setErrorMsg(e.message);
        setStep('error');
      });
  }, [roomId]);

  useEffect(() => {
    if (step !== 'connecting') return;
    let cancelled = false;
    requestToken({
      roomId,
      displayName,
      hostToken: hostToken || undefined,
      password: password || undefined,
      verificationId: verificationId || undefined,
    })
      .then((res) => {
        if (cancelled) return;
        if (res.needPassword) {
          setStep('ask-password');
          setErrorMsg('Parola gerekli veya yanlış');
          return;
        }
        if (res.needVerification) {
          sessionStorage.removeItem(verificationKey(roomId));
          setVerificationId(null);
          setStep('verify');
          return;
        }
        if (res.lobby) {
          setStep('lobby-waiting');
          return;
        }
        setToken(res.token);
        setServerUrl(res.url);
        setIsHost(!!res.isHost);
        if (res.displayName) setDisplayName(res.displayName);
        setStep('connected');
      })
      .catch((e) => {
        setErrorMsg(e.message);
        setStep('error');
      });
    return () => { cancelled = true; };
  }, [step, roomId, displayName, password, hostToken, verificationId]);

  if (step === 'error') {
    return (
      <>
        <TopBar />
        <div className="centered-screen">
          <div className="card">
            <h2 className="card-title">Hata</h2>
            <p className="card-desc">{errorMsg}</p>
            <button className="btn full" onClick={() => navigate('/')}>Ana sayfa</button>
          </div>
        </div>
      </>
    );
  }

  if (step === 'loading') {
    return (
      <>
        <TopBar />
        <CenteredCard title="Yükleniyor…" />
      </>
    );
  }

  if (step === 'ask-name') {
    return (
      <>
        <TopBar />
        <div className="centered-screen">
          <div className="card">
            <h2 className="card-title">{roomMeta?.name || 'Toplantıya katıl'}</h2>
            <p className="card-desc">Devam etmek için adınızı girin.</p>
            <div className="field">
              <label className="field-label">Ad Soyad</label>
              <input
                className="input"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Örn. Ahmet Yılmaz"
                autoFocus
              />
            </div>
            <button
              className="btn primary full"
              onClick={() => {
                const t = nameInput.trim();
                if (!t) return;
                sessionStorage.setItem('zoomtr:name', t);
                setDisplayName(t);
                setStep(roomMeta?.hasPassword && !hostToken ? 'ask-password' : 'connecting');
              }}
            >
              Devam et
            </button>
          </div>
        </div>
      </>
    );
  }

  if (step === 'ask-password') {
    return (
      <>
        <TopBar />
        <div className="centered-screen">
          <div className="card">
            <h2 className="card-title">{roomMeta?.name}</h2>
            <p className="card-desc">Bu oda parola ile korunuyor.</p>
            <div className="field">
              <label className="field-label">Oda parolası</label>
              <input
                className="input"
                type="text"
                value={pwInput}
                onChange={(e) => setPwInput(e.target.value)}
                placeholder="Parolayı girin"
                autoFocus
              />
            </div>
            <button
              className="btn primary full"
              onClick={() => {
                const t = pwInput.trim();
                if (!t) return;
                sessionStorage.setItem(`zoomtr:pwd:${roomId}`, t);
                setPassword(t);
                setErrorMsg(null);
                setStep(verificationId ? 'connecting' : 'verify');
              }}
            >
              <Icon.Lock /> Gir
            </button>
            {errorMsg && <p className="error-text">{errorMsg}</p>}
          </div>
        </div>
      </>
    );
  }

  if (step === 'verify') {
    return (
      <>
        <TopBar />
        <VerificationFlow
          roomId={roomId}
          roomName={roomMeta?.name}
          password={password}
          onComplete={(vid) => {
            setVerificationId(vid);
            setStep('connecting');
          }}
          onPasswordRequired={() => {
            sessionStorage.removeItem(`zoomtr:pwd:${roomId}`);
            setPassword('');
            setErrorMsg('Parola gerekli veya yanlış');
            setStep('ask-password');
          }}
        />
      </>
    );
  }

  if (step === 'lobby-waiting') {
    return (
      <>
        <TopBar />
        <LobbyWaiting
          roomId={roomId}
          verificationId={verificationId}
          password={password}
          onApproved={({ token, url, displayName: verifiedName }) => {
            setToken(token);
            setServerUrl(url);
            if (verifiedName) setDisplayName(verifiedName);
            setIsHost(false);
            setStep('connected');
          }}
          onRejected={(reason) => {
            setErrorMsg(reason);
            setStep('error');
          }}
        />
      </>
    );
  }

  if (step === 'connecting') {
    return (
      <>
        <TopBar />
        <CenteredCard title="Bağlanıyor…" subtitle={roomMeta?.name} />
      </>
    );
  }

  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect
      video
      audio
      data-lk-theme="default"
      options={livekitOptions}
      onDisconnected={() => navigate('/')}
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <RoomLayout
        roomId={roomId}
        displayName={displayName}
        roomName={roomMeta?.name}
        isHost={isHost}
        hostToken={hostToken}
        onLeave={() => navigate('/')}
      />
    </LiveKitRoom>
  );
}

function CenteredCard({ title, subtitle }) {
  return (
    <div className="centered-screen">
      <div className="card" style={{ textAlign: 'center' }}>
        <h2 className="card-title" style={{ marginBottom: subtitle ? 4 : 0 }}>{title}</h2>
        {subtitle && <p className="card-desc" style={{ marginBottom: 0 }}>{subtitle}</p>}
        <div className="spinner" />
      </div>
    </div>
  );
}

function RoomLayout({ roomId, displayName, roomName, isHost, hostToken, onLeave }) {
  const [tab, setTab] = useState('chat');
  const [linkCopied, setLinkCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [recordingActive, setRecordingActive] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const videoAreaRef = useRef(null);
  const recorderRef = useRef(null);
  const openedRecordings = useRef(new Set());

  // Kayıt durumu — başlangıçta API'den, sonra socket event'leriyle
  useEffect(() => {
    let cancelled = false;
    getActiveRecording(roomId).then((r) => {
      if (!cancelled) setRecordingActive(!!r);
    }).catch(() => {});

    const socket = io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      socket.emit('room:join', { roomId, name: displayName });
    });
    socket.on('recording:started', () => setRecordingActive(true));
    socket.on('recording:stopped', () => setRecordingActive(false));
    socket.on('recording:ready', ({ id, url }) => {
      if (!isHost || !url) return;
      if (id && openedRecordings.current.has(id)) return;
      if (id) openedRecordings.current.add(id);
      try { window.open(url, '_blank', 'noopener'); } catch { /* yoksay */ }
    });

    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, [roomId, displayName, isHost]);

  async function toggleRecording() {
    if (recordingBusy) return;

    // Aktif kayıt varsa durdur
    if (recordingActive && recorderRef.current) {
      setRecordingBusy(true);
      recorderRef.current.stop();
      // Onaylama recorder.onCompleted/onError'da
      return;
    }

    if (!isBrowserRecordingSupported()) {
      alert('Tarayıcınız ekran kaydını desteklemiyor (iOS Safari). Production ortamında server-side kayıt aktiftir.');
      return;
    }

    setRecordingBusy(true);
    const recorder = new BrowserRecorder({
      roomId,
      hostToken,
      onStarted: () => {
        setRecordingActive(true);
        setRecordingBusy(false);
      },
      onUploading: () => {
        setRecordingBusy(true);
      },
      onCompleted: ({ id, url }) => {
        setRecordingActive(false);
        setRecordingBusy(false);
        recorderRef.current = null;
        if (id) openedRecordings.current.add(id); // dedupe socket dup
        if (url) {
          try { window.open(url, '_blank', 'noopener'); } catch { /* yoksay */ }
        }
      },
      onError: (err) => {
        setRecordingActive(false);
        setRecordingBusy(false);
        recorderRef.current = null;
        alert(`Kayıt hatası: ${err?.message || err}`);
      },
    });
    recorderRef.current = recorder;
    const ok = await recorder.start();
    if (!ok) {
      // Start zaten onError tetikledi
      recorderRef.current = null;
    }
  }

  // Sayfa kapatılırsa stream'leri serbest bırak
  useEffect(() => {
    return () => {
      if (recorderRef.current) {
        try { recorderRef.current.stop(); } catch {}
      }
    };
  }, []);

  // Derslik açıkken sayfa viewport'a sabitlenir; belge scroll olmaz,
  // sadece sohbet/katılımcı/ayar listeleri kendi içinde kayar.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('room-locked');
    return () => html.classList.remove('room-locked');
  }, []);

  function openPanel(targetTab) {
    if (targetTab) setTab(targetTab);
    setPanelOpen(true);
  }

  useEffect(() => {
    const handler = () =>
      setIsFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, []);

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  }

  function toggleFullscreen() {
    const el = videoAreaRef.current;
    if (!el) return;
    const inFs = document.fullscreenElement || document.webkitFullscreenElement;
    if (inFs) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      req?.call(el);
    }
  }

  return (
    <div className="room">
      <div className="video-area" ref={videoAreaRef}>
        <div className="room-banner">
          <span className="room-name">{roomName}</span>
          <code>{roomId}</code>
          {isHost && <span className="badge">HOST</span>}
          {recordingActive && (
            <span className="rec-badge" title="Bu oda kaydediliyor">
              <span className="rec-dot" /> KAYIT
            </span>
          )}
          {isHost && hostToken && (
            <button
              type="button"
              className={`btn sm ${recordingActive ? 'rec-btn active' : 'rec-btn'}`}
              onClick={toggleRecording}
              disabled={recordingBusy}
              title={recordingActive ? 'Kaydı durdur' : 'Kaydı başlat'}
            >
              <span className={`rec-dot-mini ${recordingActive ? '' : 'off'}`} />
              <span className="banner-label">
                {recordingActive ? 'Kaydı durdur' : 'Kaydı başlat'}
              </span>
            </button>
          )}
          <button className="btn sm" onClick={copyLink}>
            <Icon.Copy width="14" height="14" />
            <span className="banner-label">{linkCopied ? 'Kopyalandı' : 'Linki kopyala'}</span>
          </button>
          <button className="btn sm" onClick={toggleFullscreen}>
            {isFullscreen ? <Icon.Minimize width="14" height="14" /> : <Icon.Maximize width="14" height="14" />}
            <span className="banner-label">{isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}</span>
          </button>
          <span className="spacer" />
          <button className="btn sm danger" onClick={onLeave}>
            <Icon.Logout width="14" height="14" />
            <span className="banner-label">Ayrıl</span>
          </button>
        </div>
        <MeetingStage
          roomId={roomId}
          displayName={displayName}
          isHost={isHost}
          hostToken={hostToken}
        />
      </div>

      {!panelOpen && (
        <button
          type="button"
          className="panel-fab"
          onClick={() => openPanel('chat')}
          aria-label="Yan paneli aç"
        >
          <Icon.Chat />
        </button>
      )}

      {panelOpen && (
        <div
          className="panel-backdrop"
          onClick={() => setPanelOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`side ${panelOpen ? 'open' : ''}`}>
        <div className="panel-handle" aria-hidden="true" />
        <button
          type="button"
          className="panel-close"
          onClick={() => setPanelOpen(false)}
          aria-label="Paneli kapat"
        >
          <Icon.X />
        </button>
        <div className="tabs">
          <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
            <Icon.Chat width="14" height="14" /> Sohbet
          </button>
          <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>
            <Icon.Users width="14" height="14" /> Katılımcılar
          </button>
          {isHost && hostToken && (
            <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
              <Icon.Spark width="14" height="14" /> Ayarlar
            </button>
          )}
        </div>
        {tab === 'chat' && (
          <ChatPanel
            roomId={roomId}
            displayName={displayName}
            isHost={isHost}
            hostToken={hostToken}
          />
        )}
        {tab === 'people' && <ParticipantList isHost={isHost} roomId={roomId} hostToken={hostToken} />}
        {tab === 'settings' && isHost && hostToken && (
          <SettingsPanel roomId={roomId} hostToken={hostToken} />
        )}
      </aside>
    </div>
  );
}
