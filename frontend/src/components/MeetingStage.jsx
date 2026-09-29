import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  TrackToggle,
  DisconnectButton,
  useTracks,
  useTrackToggle,
  useRoomContext,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { io } from 'socket.io-client';
import { Icon } from './icons.jsx';
import { SharedContent } from './SharedContent.jsx';
import { useToast } from './Toasts.jsx';
import { getRoom, uploadShare, clearShare } from '../lib/api.js';

const screenShareSupported =
  typeof navigator !== 'undefined' &&
  navigator.mediaDevices &&
  typeof navigator.mediaDevices.getDisplayMedia === 'function';

// moreActions: RoomLayout'tan gelen oda eylemleri (kayıt, link, katılımcılar…);
// "Daha fazla" menüsünde tepkiler ve dosya paylaşımıyla birlikte listelenir.
export function MeetingStage({
  roomId, displayName, isHost, hostToken,
  unreadChat = 0, chatOpen = false, onToggleChat, moreActions = [],
}) {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const [share, setShare] = useState(null);
  const [viewport, setViewport] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [allowScreenShare, setAllowScreenShare] = useState(false);
  const [hostOnlyVideo, setHostOnlyVideo] = useState(false);
  const [allowMic, setAllowMic] = useState(true);
  const [allowCamera, setAllowCamera] = useState(true);
  const [allowReactions, setAllowReactions] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [reactions, setReactions] = useState([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const fileInputRef = useRef(null);
  const socketRef = useRef(null);
  const viewportEmitRaf = useRef(null);

  // "Sadece host görünür" aktifken grid'de yalnız host'un tile'ı kalır.
  // Host metadata'sı token üretiminde JSON olarak set edildi: { isHost: true }
  const visibleTracks = useMemo(() => {
    if (!hostOnlyVideo) return tracks;
    return tracks.filter((t) => {
      try {
        const meta = JSON.parse(t.participant?.metadata || '{}');
        return meta.isHost === true;
      } catch {
        return false;
      }
    });
  }, [tracks, hostOnlyVideo]);

  useEffect(() => {
    let cancelled = false;
    getRoom(roomId).then((r) => {
      if (cancelled) return;
      setAllowScreenShare(!!r.allowScreenShare);
      setHostOnlyVideo(!!r.hostOnlyVideo);
      setAllowMic(r.allowMic !== false);
      setAllowCamera(r.allowCamera !== false);
      setAllowReactions(r.allowReactions !== false);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [roomId]);

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('room:join', { roomId, name: displayName });
    });
    socket.on('share:show', (s) => {
      setShare(s);
      if (s.viewport) setViewport(s.viewport);
      else setViewport({ zoom: 1, panX: 0, panY: 0 });
    });
    socket.on('share:hide', () => {
      setShare(null);
      setViewport({ zoom: 1, panX: 0, panY: 0 });
    });
    socket.on('share:viewport', (v) => setViewport(v));
    socket.on('room:settings', (s) => {
      if ('allowScreenShare' in s) setAllowScreenShare(!!s.allowScreenShare);
      if ('hostOnlyVideo' in s) setHostOnlyVideo(!!s.hostOnlyVideo);
      if ('allowMic' in s) setAllowMic(!!s.allowMic);
      if ('allowCamera' in s) setAllowCamera(!!s.allowCamera);
      if ('allowReactions' in s) setAllowReactions(!!s.allowReactions);
    });
    socket.on('reaction:new', (r) => {
      // Random pozisyon kayması — birden fazla tepki üst üste binmesin
      const decorated = { ...r, jitter: Math.random() * 60 - 30 };
      setReactions((prev) => [...prev, decorated]);
      setTimeout(() => {
        setReactions((prev) => prev.filter((x) => x.id !== r.id));
      }, 3500);
    });

    return () => socket.disconnect();
  }, [roomId, displayName]);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      await uploadShare(roomId, hostToken, file, (p) => setUploadProgress(p));
    } catch (err) {
      alert(`Yükleme hatası: ${err.message}`);
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleStopShare() {
    if (!confirm('Paylaşımı durdurmak istediğinize emin misiniz?')) return;
    try {
      await clearShare(roomId, hostToken);
    } catch { /* yoksay */ }
  }

  function sendReaction(emoji) {
    socketRef.current?.emit('reaction:send', { emoji, hostToken });
  }

  // Host'un viewport değişikliklerini optimistik olarak uygula + socket'e raf ile gönder
  function handleViewportChange(next) {
    setViewport(next); // local optimistic update
    if (viewportEmitRaf.current) cancelAnimationFrame(viewportEmitRaf.current);
    viewportEmitRaf.current = requestAnimationFrame(() => {
      socketRef.current?.emit('share:set-viewport', {
        roomId,
        hostToken,
        viewport: next,
      });
    });
  }

  const canScreenShare = isHost || allowScreenShare;
  // Host'un kapattığı kaynaklar: düğme kilitli görünür, dokununca açıklama çıkar
  const micLocked = !isHost && !allowMic;
  const camLocked = !isHost && (!allowCamera || hostOnlyVideo);

  return (
    <>
      {share ? (
        <SharedContent
          share={share}
          viewport={viewport}
          isHost={isHost}
          hostToken={hostToken}
          roomId={roomId}
          onViewportChange={handleViewportChange}
        />
      ) : (
        <div className="stage-grid">
          <GridLayout tracks={visibleTracks} style={{ height: '100%' }}>
            <ParticipantTile />
          </GridLayout>
        </div>
      )}
      <RoomAudioRenderer />

      <div className="reaction-layer" aria-live="polite">
        {reactions.map((r) => (
          <span
            key={r.id}
            className="reaction-bubble"
            style={{ '--jitter-x': `${r.jitter}px` }}
            title={r.senderName}
          >
            {r.emoji}
          </span>
        ))}
      </div>

      <MeetingControls
        canScreenShare={canScreenShare}
        micLocked={micLocked}
        camLocked={camLocked}
        unreadChat={unreadChat}
        chatOpen={chatOpen}
        onToggleChat={onToggleChat}
        moreOpen={moreOpen}
        onOpenMore={() => setMoreOpen(true)}
      />
      {moreOpen && (
        <MoreSheet
          onClose={() => setMoreOpen(false)}
          onSendReaction={isHost || allowReactions ? sendReaction : null}
          actions={[
            ...(isHost ? [share
              ? { key: 'stop-share', label: 'Paylaşımı durdur', icon: Icon.X, danger: true, onClick: handleStopShare }
              : {
                key: 'share',
                label: uploading ? `Yükleniyor %${Math.round(uploadProgress * 100)}` : 'Dosya paylaş',
                icon: Icon.Image,
                disabled: uploading,
                onClick: () => fileInputRef.current?.click(),
              }] : []),
            ...moreActions,
          ]}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />
    </>
  );
}

function StartAudioButton() {
  const room = useRoomContext();
  const [needsStart, setNeedsStart] = useState(false);

  useEffect(() => {
    if (!room) return;
    const update = () => setNeedsStart(!room.canPlaybackAudio);
    update();
    room.on('audioPlaybackChanged', update);
    return () => { room.off('audioPlaybackChanged', update); };
  }, [room]);

  if (!needsStart) return null;

  return (
    <button
      type="button"
      className="ctl ctl-info"
      onClick={() => room.startAudio().catch(() => {})}
    >
      <Icon.Volume />
      <span className="ctl-label">Sesi başlat</span>
    </button>
  );
}

const REACTION_EMOJIS = ['👍', '❤️', '👏', '🎉', '😂', '😮', '❓', '✋'];

// Açıkken koyu (yarı saydam), kapalıyken beyaz zemin + üstü çizili ikon (iOS arama ekranı gibi)
function MediaToggle({ source, label, OnIcon, OffIcon, locked, lockedMessage }) {
  const { buttonProps, enabled } = useTrackToggle({ source });
  const toast = useToast();
  if (locked && !enabled) {
    return (
      <button
        type="button"
        className="ctl ctl-media off locked"
        aria-label={`${label} (host kapattı)`}
        title={lockedMessage}
        onClick={() => toast(lockedMessage)}
      >
        <OffIcon />
        <span className="ctl-lock" aria-hidden="true"><Icon.Lock width="10" height="10" /></span>
      </button>
    );
  }
  return (
    <button {...buttonProps} className={`ctl ctl-media ${enabled ? '' : 'off'}`} aria-label={label} title={label}>
      {enabled ? <OnIcon /> : <OffIcon />}
      <span className="ctl-label">{label}</span>
    </button>
  );
}

// Alt kontrol çubuğu (tüm ekran boyutlarında aynı): yuvarlak düğmeler, ikincil
// eylemler "Daha fazla" menüsünde. Etiketler ekran okuyucu ve ipucu (title) için.
function MeetingControls({ canScreenShare, micLocked, camLocked, unreadChat, chatOpen, onToggleChat, moreOpen, onOpenMore }) {
  return (
    <div className="meeting-controls">
      <MediaToggle
        source={Track.Source.Microphone} label="Mikrofon" OnIcon={Icon.Mic} OffIcon={Icon.MicOff}
        locked={micLocked} lockedMessage="Host mikrofonları kapattı; şu an açamazsınız"
      />
      <MediaToggle
        source={Track.Source.Camera} label="Kamera" OnIcon={Icon.Video} OffIcon={Icon.VideoOff}
        locked={camLocked} lockedMessage="Host kameraları kapattı; şu an açamazsınız"
      />
      {canScreenShare && screenShareSupported && (
        <TrackToggle source={Track.Source.ScreenShare} showIcon={false} className="ctl" title="Ekran paylaş" aria-label="Ekran paylaş">
          <Icon.Screen />
          <span className="ctl-label">Ekran paylaş</span>
        </TrackToggle>
      )}
      <button
        type="button"
        className="ctl"
        onClick={onToggleChat}
        aria-pressed={chatOpen}
        aria-label="Sohbet"
        title="Sohbet"
      >
        <Icon.Chat />
        {unreadChat > 0 && <span className="ctl-badge">{unreadChat > 9 ? '9+' : unreadChat}</span>}
      </button>
      <button
        type="button"
        className="ctl"
        onClick={onOpenMore}
        aria-pressed={moreOpen}
        aria-haspopup="dialog"
        aria-label="Daha fazla"
        title="Daha fazla"
      >
        <Icon.More />
      </button>
      <StartAudioButton />
      <DisconnectButton className="ctl ctl-danger ctl-leave" aria-label="Toplantıdan ayrıl" title="Toplantıdan ayrıl">
        <Icon.Logout />
        <span className="ctl-label">Ayrıl</span>
      </DisconnectButton>
    </div>
  );
}

// "Daha fazla": üstte tepki emojileri, altta eylem kutuları. Telefonda alttan açılan
// sayfa, geniş ekranda kontrol çubuğunun üstünde yüzen kart.
function MoreSheet({ onClose, onSendReaction, actions }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="more-backdrop" onClick={onClose}>
      <div className="more-sheet" role="dialog" aria-modal="true" aria-label="Daha fazla" onClick={(e) => e.stopPropagation()}>
        <div className="more-grabber" aria-hidden="true" />
        {onSendReaction && (
          <div className="more-reactions" role="group" aria-label="Tepki gönder">
            {REACTION_EMOJIS.map((e) => (
              <button key={e} type="button" onClick={() => { onSendReaction(e); onClose(); }} aria-label={`Tepki: ${e}`}>
                {e}
              </button>
            ))}
          </div>
        )}
        <div className="more-actions">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              className={a.danger ? 'danger' : a.active ? 'active' : ''}
              disabled={a.disabled}
              onClick={() => { a.onClick(); if (!a.keepOpen) onClose(); }}
            >
              <span className="more-icon"><a.icon width="22" height="22" /></span>
              <span className="more-label">{a.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="more-close" onClick={onClose}>Kapat</button>
      </div>
    </div>
  );
}
