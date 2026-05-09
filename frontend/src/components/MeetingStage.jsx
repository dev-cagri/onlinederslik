import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  TrackToggle,
  DisconnectButton,
  useTracks,
  useRoomContext,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { io } from 'socket.io-client';
import { Icon } from './icons.jsx';
import { SharedContent } from './SharedContent.jsx';
import { getRoom, uploadShare, clearShare } from '../lib/api.js';

const screenShareSupported =
  typeof navigator !== 'undefined' &&
  navigator.mediaDevices &&
  typeof navigator.mediaDevices.getDisplayMedia === 'function';

export function MeetingStage({ roomId, displayName, isHost, hostToken }) {
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
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [reactions, setReactions] = useState([]);
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
    socketRef.current?.emit('reaction:send', { emoji });
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
        isHost={isHost}
        canScreenShare={canScreenShare}
        share={share}
        uploading={uploading}
        uploadProgress={uploadProgress}
        onPickFile={() => fileInputRef.current?.click()}
        onStopShare={handleStopShare}
        onSendReaction={sendReaction}
      />
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

function ReactionPicker({ onSend }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Dışına tıklanınca kapan
  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [open]);

  return (
    <div className="reaction-picker" ref={containerRef}>
      <button
        type="button"
        className="ctl"
        onClick={() => setOpen((v) => !v)}
        aria-label="Tepki gönder"
      >
        <Icon.Smile />
        <span className="ctl-label">Tepki</span>
      </button>
      {open && (
        <div className="reaction-popover" role="menu">
          {REACTION_EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              className="reaction-emoji-btn"
              onClick={() => { onSend(e); setOpen(false); }}
              aria-label={`Tepki: ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MeetingControls({
  isHost,
  canScreenShare,
  share,
  uploading,
  uploadProgress,
  onPickFile,
  onStopShare,
  onSendReaction,
}) {
  return (
    <div className="meeting-controls">
      <TrackToggle source={Track.Source.Microphone} showIcon={false} className="ctl">
        <Icon.Mic />
        <span className="ctl-label">Mikrofon</span>
      </TrackToggle>
      <TrackToggle source={Track.Source.Camera} showIcon={false} className="ctl">
        <Icon.Video />
        <span className="ctl-label">Kamera</span>
      </TrackToggle>
      {canScreenShare && screenShareSupported && (
        <TrackToggle source={Track.Source.ScreenShare} showIcon={false} className="ctl">
          <Icon.Spark />
          <span className="ctl-label">Ekran paylaş</span>
        </TrackToggle>
      )}
      <ReactionPicker onSend={onSendReaction} />
      {isHost && (
        share ? (
          <button type="button" className="ctl ctl-danger" onClick={onStopShare}>
            <Icon.X />
            <span className="ctl-label">Paylaşımı durdur</span>
          </button>
        ) : (
          <button type="button" className="ctl" onClick={onPickFile} disabled={uploading}>
            <Icon.Image />
            <span className="ctl-label">
              {uploading ? `Yükleniyor… ${Math.round(uploadProgress * 100)}%` : 'Dosya paylaş'}
            </span>
          </button>
        )
      )}
      <StartAudioButton />
      <DisconnectButton className="ctl ctl-danger">
        <Icon.Logout />
        <span className="ctl-label">Ayrıl</span>
      </DisconnectButton>
    </div>
  );
}
