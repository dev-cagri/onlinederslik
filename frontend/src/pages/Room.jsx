import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LiveKitRoom, useParticipants, useRoomContext } from '@livekit/components-react';
import { VideoPresets, RoomEvent, DisconnectReason } from 'livekit-client';
import { ToastProvider, useToast } from '../components/Toasts.jsx';
import { useDocumentTitle } from '../lib/branding.js';

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
import { MemberGate } from '../components/MemberGate.jsx';
import { TopBar } from '../components/TopBar.jsx';
import { Icon } from '../components/icons.jsx';
import { MeetingStage } from '../components/MeetingStage.jsx';
import { getActiveRecording, startRecording, stopRecording } from '../lib/api.js';

export function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();

  const [step, setStep] = useState('loading');
  const [roomMeta, setRoomMeta] = useState(null);
  const [displayName, setDisplayName] = useState(() => sessionStorage.getItem('zoomtr:name') || '');
  const [nameInput, setNameInput] = useState('');
  const [password, setPassword] = useState(() => sessionStorage.getItem(`zoomtr:pwd:${roomId}`) || '');
  const [pwInput, setPwInput] = useState('');
  const [token, setToken] = useState(null);
  const [serverUrl, setServerUrl] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  useDocumentTitle(roomMeta?.name);

  const hostToken = sessionStorage.getItem(`zoomtr:host:${roomId}`) || null;

  useEffect(() => {
    getRoom(roomId)
      .then((room) => {
        setRoomMeta(room);
        // Host doğrudan girer; katılımcılar parola (varsa) → SMS ile üye girişi + onay → bağlantı
        if (hostToken) setStep(displayName ? 'connecting' : 'ask-name');
        else if (room.hasPassword && !password) setStep('ask-password');
        else setStep('member');
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
    })
      .then((res) => {
        if (cancelled) return;
        if (res.needPassword) {
          setStep('ask-password');
          setErrorMsg('Parola gerekli veya yanlış');
          return;
        }
        if (res.needMember) {
          setStep('member');
          return;
        }
        if (res.locked || res.expired) {
          setStep(res.expired ? 'expired' : 'locked');
          return;
        }
        if (res.lobby) {
          setStep('lobby-waiting');
          return;
        }
        setToken(res.token);
        setServerUrl(res.url);
        // Toplantı yöneticisi üye: sunucu host anahtarını verir; host kontrolleri bununla çalışır
        if (res.hostToken) {
          sessionStorage.setItem(`zoomtr:host:${roomId}`, res.hostToken);
          sessionStorage.setItem('zoomtr:name', res.displayName);
        }
        setIsHost(!!res.isHost);
        if (res.displayName) setDisplayName(res.displayName);
        setStep('connected');
      })
      .catch((e) => {
        setErrorMsg(e.message);
        setStep('error');
      });
    return () => { cancelled = true; };
  }, [step, roomId, displayName, password, hostToken]);

  // Toplantı dışı durum ekranları: bitti / çıkarıldı / kilitli / link süresi doldu
  if (step === 'locked' || step === 'expired' || step === 'ended' || step === 'removed') {
    const info = {
      locked: ['Toplantı şu an kapalı', 'Host bu toplantıyı yeni katılımlara kapattı. Toplantı sahibinden haber bekleyin.'],
      expired: ['Linkin süresi doldu', 'Bu toplantı linki artık geçerli değil. Toplantı sahibinden yeni bir link isteyin.'],
      ended: ['Toplantı sona erdi', 'Host toplantıyı herkes için bitirdi. Katıldığınız için teşekkürler.'],
      removed: ['Toplantıdan çıkarıldınız', 'Host sizi bu toplantıdan çıkardı.'],
    }[step];
    return (
      <>
        <TopBar />
        <div className="centered-screen auth-screen">
          <div className="card auth-card">
            <h1 className="auth-title">{info[0]}</h1>
            <p className="auth-desc">{info[1]}</p>
            <button className="btn primary full auth-cta" onClick={() => navigate(hostToken ? '/admin/toplantilar' : '/')}>
              {hostToken ? 'Yönetim paneline dön' : 'Ana sayfaya dön'}
            </button>
          </div>
        </div>
      </>
    );
  }

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
                setStep('member');
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

  if (step === 'member') {
    return (
      <>
        <TopBar />
        <MemberGate
          title={roomMeta?.name}
          onApproved={() => setStep('connecting')}
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
      onDisconnected={(reason) => {
        // Host toplantıyı bitirdiyse ya da katılımcıyı çıkardıysa açıklama ekranı; kendi ayrıldıysa ana sayfa
        if (reason === DisconnectReason.ROOM_DELETED) setStep('ended');
        else if (reason === DisconnectReason.PARTICIPANT_REMOVED) setStep('removed');
        else navigate(isHost ? '/admin/toplantilar' : '/');
      }}
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <ToastProvider>
        <RoomLayout
          roomId={roomId}
          displayName={displayName}
          roomName={roomMeta?.name}
          isHost={isHost}
          hostToken={hostToken}
          onPromoted={() => setIsHost(true)}
        />
      </ToastProvider>
    </LiveKitRoom>
  );
}

function CenteredCard({ title, subtitle }) {
  return (
    <div className="centered-screen">
      <div className="card status-card" style={{ textAlign: 'center' }}>
        <h2 className="card-title" style={{ marginBottom: subtitle ? 4 : 0 }}>{title}</h2>
        {subtitle && <p className="card-desc" style={{ marginBottom: 0 }}>{subtitle}</p>}
        <div className="spinner" />
      </div>
    </div>
  );
}

// Geniş masaüstünde sohbet paneli açık başlar; tablet ve telefonda video tüm alanı kaplar
const PANEL_OPEN_BY_DEFAULT = '(min-width: 1200px)';

const fullscreenSupported = typeof document !== 'undefined'
  && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

// Katılımcıya gösterilen ayar değişikliği bildirimleri (host kendi değişikliğini panelde görür)
const SETTING_NOTICES = {
  allowMic: ['Mikrofonunuzu yeniden açabilirsiniz', 'Host mikrofonları kapattı; şu an konuşamazsınız'],
  allowCamera: ['Kameranızı yeniden açabilirsiniz', 'Host kameraları kapattı'],
  hostOnlyVideo: ['Host katılımcı kameralarını kapattı; yalnız host görünüyor', 'Kameranızı yeniden açabilirsiniz'],
  allowScreenShare: ['Artık ekran paylaşabilirsiniz', 'Host ekran paylaşımını kapattı'],
  chatLocked: ['Host sohbeti kilitledi', 'Sohbet yeniden açıldı'],
  allowReactions: ['Tepkiler yeniden açık', 'Host tepkileri kapattı'],
};

function RoomLayout({ roomId, displayName, roomName: initialRoomName, isHost, hostToken, onPromoted }) {
  const toast = useToast();
  const room = useRoomContext();
  const [roomName, setRoomName] = useState(initialRoomName);
  const settingsRef = useRef(null);
  const [tab, setTab] = useState('chat');
  const participants = useParticipants();
  const [unreadChat, setUnreadChat] = useState(0);
  const chatVisibleRef = useRef(true);
  const [linkCopied, setLinkCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia(PANEL_OPEN_BY_DEFAULT).matches);
  const [recordingActive, setRecordingActive] = useState(false);
  const [recordingBusy, setRecordingBusy] = useState(false);
  const videoAreaRef = useRef(null);

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
    // Sohbet görünmüyorken gelen mesajlar sohbet düğmesinde rozet olarak sayılır
    socket.on('chat:new', () => {
      if (!chatVisibleRef.current) setUnreadChat((n) => n + 1);
    });
    // Ayar değişiklikleri: ad güncellenir; katılımcıya yalnız gerçekten değişen ayar bildirilir
    socket.on('room:settings', (next) => {
      if (next.name) setRoomName(next.name);
      const prev = settingsRef.current;
      settingsRef.current = { ...prev, ...next };
      if (isHost || !prev) return;
      for (const [key, [onMsg, offMsg]] of Object.entries(SETTING_NOTICES)) {
        if (key in next && next[key] !== prev[key]) toast(next[key] ? onMsg : offMsg);
      }
    });
    getRoom(roomId).then((r) => { settingsRef.current = { ...r, ...settingsRef.current }; }).catch(() => {});
    // Kayıt başlayınca herkese bildirilir (katılımcı kaydedildiğini bilmeli)
    socket.on('recording:started', () => {
      setRecordingActive(true);
      if (!isHost) toast('Bu toplantı kaydediliyor');
    });
    socket.on('recording:stopped', () => setRecordingActive(false));

    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, [roomId, displayName, isHost]);

  // Sunucu tarafı kayıt (LiveKit Egress): başlat/durdur; dosya Kayıtlar bölümünde listelenir
  async function toggleRecording() {
    if (recordingBusy) return;
    setRecordingBusy(true);
    try {
      if (recordingActive) {
        await stopRecording(roomId, hostToken);
        setRecordingActive(false);
        toast('Kayıt durduruldu. Birkaç dakika içinde Kayıtlar bölümünde hazır olur.', { tone: 'success' });
      } else {
        await startRecording(roomId, hostToken);
        setRecordingActive(true);
        toast('Kayıt başladı', { tone: 'success' });
      }
    } catch (err) {
      toast(err.message, { tone: 'warning' });
    } finally {
      setRecordingBusy(false);
    }
  }

  // Sunucudan gelen bildirimler (host mikrofonunuzu kapattı vb.) → toast
  useEffect(() => {
    if (!room) return;
    const onData = (payload, participant, _kind, topic) => {
      if (participant) return; // yalnız sunucudan gelenler
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (topic === 'notice') toast(data.message);
        // Host bu katılımcıyı toplantı yöneticisi yaptı: host kontrolleri açılır
        if (topic === 'promote' && data.hostToken) {
          sessionStorage.setItem(`zoomtr:host:${roomId}`, data.hostToken);
          onPromoted?.();
        }
      } catch { /* yoksay */ }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); };
  }, [room, toast]);

  const chatVisible = tab === 'chat' && panelOpen;
  useEffect(() => {
    chatVisibleRef.current = chatVisible;
    if (chatVisible) setUnreadChat(0);
  }, [chatVisible]);

  // Derslik açıkken sayfa viewport'a sabitlenir; belge scroll olmaz,
  // sadece sohbet/katılımcı/ayar listeleri kendi içinde kayar.
  // Tarayıcı/durum çubuğu rengi de koyu video alanına uyar.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('room-locked');
    const meta = document.querySelector('meta[name="theme-color"]');
    const prevTheme = meta?.getAttribute('content');
    meta?.setAttribute('content', '#09090b');
    return () => {
      html.classList.remove('room-locked');
      if (meta && prevTheme) meta.setAttribute('content', prevTheme);
    };
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

  // Sohbet düğmesi: sohbet açıksa paneli kapatır, değilse sohbeti açar
  function toggleChat() {
    if (panelOpen && tab === 'chat') setPanelOpen(false);
    else openPanel('chat');
  }

  // "Daha fazla" menüsündeki oda eylemleri
  const moreActions = [
    // Katılımcı listesi ve kişi sayısı yalnız hosta gösterilir
    isHost && { key: 'people', label: 'Katılımcılar', icon: Icon.Users, onClick: () => openPanel('people') },
    isHost && hostToken && { key: 'settings', label: 'Toplantı ayarları', icon: Icon.Settings, onClick: () => openPanel('settings') },
    isHost && hostToken && {
      key: 'record',
      label: recordingActive ? 'Kaydı durdur' : 'Kaydı başlat',
      icon: Icon.Record,
      danger: recordingActive,
      disabled: recordingBusy,
      onClick: toggleRecording,
    },
    { key: 'link', label: linkCopied ? 'Kopyalandı' : 'Linki kopyala', icon: Icon.Copy, onClick: copyLink, keepOpen: true },
    fullscreenSupported && {
      key: 'fullscreen',
      label: isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran',
      icon: isFullscreen ? Icon.Minimize : Icon.Maximize,
      onClick: toggleFullscreen,
    },
  ].filter(Boolean);

  return (
    <div className={`room ${panelOpen ? 'panel-open' : ''}`}>
      <div className="video-area" ref={videoAreaRef}>
        <div className="room-banner">
          <span className="room-name">{roomName}</span>
          {isHost && <span className="room-code" title="Toplantı kodu">{roomId}</span>}
          {isHost && (
            <span className="room-count" title="Bağlı kişi sayısı">
              <Icon.Users width="13" height="13" /> {participants.length}
            </span>
          )}
          {recordingActive && (
            <span className="rec-badge" title="Bu toplantı kaydediliyor">
              <span className="rec-dot" /> Kayıt
            </span>
          )}
          {isHost && <span className="badge">Host</span>}
        </div>
        <MeetingStage
          roomId={roomId}
          displayName={displayName}
          isHost={isHost}
          hostToken={hostToken}
          unreadChat={unreadChat}
          chatOpen={panelOpen && tab === 'chat'}
          onToggleChat={toggleChat}
          moreActions={moreActions}
        />
      </div>

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
        {isHost ? (
          <div className="tabs">
            <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
              <Icon.Chat width="14" height="14" /> Sohbet
            </button>
            <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>
              <Icon.Users width="14" height="14" /> Katılımcılar
            </button>
            {hostToken && (
              <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
                <Icon.Settings width="14" height="14" /> Ayarlar
              </button>
            )}
          </div>
        ) : (
          // Katılımcı yalnız sohbeti görür; sekme yerine başlık
          <h2 className="side-title"><Icon.Chat width="16" height="16" /> Sohbet</h2>
        )}
        {tab === 'chat' && (
          <ChatPanel
            roomId={roomId}
            displayName={displayName}
            isHost={isHost}
            hostToken={hostToken}
          />
        )}
        {tab === 'people' && isHost && <ParticipantList isHost={isHost} roomId={roomId} hostToken={hostToken} />}
        {tab === 'settings' && isHost && hostToken && (
          <SettingsPanel roomId={roomId} hostToken={hostToken} />
        )}
      </aside>
    </div>
  );
}
