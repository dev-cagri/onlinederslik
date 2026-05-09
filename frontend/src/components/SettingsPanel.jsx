import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  hostAction, getRoom,
  startRecording, stopRecording, getActiveRecording, listRecordings,
} from '../lib/api.js';
import { Icon } from './icons.jsx';

export function SettingsPanel({ roomId, hostToken }) {
  const [hostOnlyVideo, setHostOnlyVideo] = useState(false);
  const [allowScreenShare, setAllowScreenShare] = useState(false);
  const [chatLocked, setChatLocked] = useState(false);
  const [pending, setPending] = useState([]);
  const [share, setShare] = useState(null);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const [activeRecording, setActiveRecording] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const socketRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getRoom(roomId).then((r) => {
      if (cancelled) return;
      setHostOnlyVideo(!!r.hostOnlyVideo);
      setAllowScreenShare(!!r.allowScreenShare);
      setChatLocked(!!r.chatLocked);
    }).catch(() => {});
    getActiveRecording(roomId).then((rec) => {
      if (!cancelled) setActiveRecording(rec || null);
    }).catch(() => {});
    listRecordings(roomId).then((rows) => {
      if (!cancelled) setRecordings(rows || []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [roomId]);

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('host:auth', { roomId, hostToken }, (ack) => {
        if (ack?.ok) setPending(ack.pending || []);
      });
    });
    socket.on('lobby:pending', (entry) => {
      setPending((prev) => [...prev, entry]);
    });
    socket.on('lobby:resolved', ({ requestId }) => {
      setPending((prev) => prev.filter((p) => p.requestId !== requestId));
    });
    socket.on('share:show', (s) => setShare(s));
    socket.on('share:hide', () => setShare(null));
    socket.on('room:settings', (s) => {
      if ('hostOnlyVideo' in s) setHostOnlyVideo(!!s.hostOnlyVideo);
      if ('allowScreenShare' in s) setAllowScreenShare(!!s.allowScreenShare);
      if ('chatLocked' in s) setChatLocked(!!s.chatLocked);
    });
    socket.on('recording:started', (rec) => setActiveRecording(rec));
    socket.on('recording:stopped', () => {
      setActiveRecording(null);
      // Liste güncel
      listRecordings(roomId).then(setRecordings).catch(() => {});
    });

    return () => socket.disconnect();
  }, [roomId, hostToken]);

  function flash(message) {
    setNote(message);
    setTimeout(() => setNote(null), 2400);
  }

  async function muteAll(source) {
    setBusy(source === 'camera' ? 'mute-cam' : 'mute-mic');
    try {
      const r = await hostAction(roomId, 'mute-all', { hostToken, source });
      flash(`${r.muted ?? 0} ${source === 'camera' ? 'kamera kapatıldı' : 'mikrofon susturuldu'}`);
    } catch (err) {
      flash(`Hata: ${err.message}`);
    } finally {
      setBusy(null);
    }
  }

  // Genel tek-tuş toggle helper
  async function applyToggle({ key, action, payloadKey, value, label }) {
    setBusy(key);
    const prevState = { hostOnlyVideo, allowScreenShare, chatLocked };
    if (key === 'host-only') setHostOnlyVideo(value);
    if (key === 'allow-ss') setAllowScreenShare(value);
    if (key === 'chat-lock') setChatLocked(value);
    try {
      await hostAction(roomId, action, { hostToken, [payloadKey]: value });
      flash(label);
    } catch (err) {
      // rollback
      setHostOnlyVideo(prevState.hostOnlyVideo);
      setAllowScreenShare(prevState.allowScreenShare);
      setChatLocked(prevState.chatLocked);
      flash(`Hata: ${err.message}`);
    } finally {
      setBusy(null);
    }
  }

  function approve(requestId) {
    socketRef.current?.emit('lobby:approve', { roomId, requestId });
  }
  function reject(requestId) {
    socketRef.current?.emit('lobby:reject', { roomId, requestId, reason: 'Reddedildi' });
  }

  async function handleStartRecording() {
    setBusy('rec-start');
    try {
      await startRecording(roomId, hostToken);
      flash('Kayıt başlatıldı');
    } catch (err) {
      flash(`Hata: ${err.message}`);
    } finally {
      setBusy(null);
    }
  }
  async function handleStopRecording() {
    setBusy('rec-stop');
    try {
      await stopRecording(roomId, hostToken);
      flash('Kayıt durduruldu');
    } catch (err) {
      flash(`Hata: ${err.message}`);
    } finally {
      setBusy(null);
    }
  }

  function formatBytes(b) {
    if (!b) return '—';
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  function formatDuration(s) {
    if (!s) return '—';
    const m = Math.floor(s / 60), ss = s % 60;
    return `${m}dk ${ss}sn`;
  }

  return (
    <div className="settings-panel">
      <p className="section-label">Hızlı işlemler</p>

      <button
        type="button"
        className="btn full"
        onClick={() => muteAll('microphone')}
        disabled={busy === 'mute-mic'}
      >
        <Icon.MicOff /> Tüm mikrofonları kapat
      </button>
      <button
        type="button"
        className="btn full"
        onClick={() => muteAll('camera')}
        disabled={busy === 'mute-cam'}
        style={{ marginTop: 6 }}
      >
        <Icon.Video /> Tüm kameraları kapat
      </button>

      <p className="section-label" style={{ marginTop: 18 }}>İzinler</p>

      <div className="setting-row">
        <div className="setting-text">
          <strong>Sadece host görünür</strong>
          <p>Açıkken yalnız host ekranda görünür; katılımcıların kamerası kapatılır ve açamazlar.</p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={hostOnlyVideo}
            onChange={() => applyToggle({
              key: 'host-only',
              action: 'host-only-video',
              payloadKey: 'enabled',
              value: !hostOnlyVideo,
              label: !hostOnlyVideo ? 'Yalnız host yayını açık' : 'Tüm katılımcılar yayın yapabilir',
            })}
            disabled={busy === 'host-only'}
          />
          <span className="switch-track"><span className="switch-thumb" /></span>
        </label>
      </div>

      <div className="setting-row" style={{ marginTop: 8 }}>
        <div className="setting-text">
          <strong>Katılımcılar ekran paylaşabilir</strong>
          <p>Kapalı olduğunda yalnızca host ekran paylaşımı yapabilir.</p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={allowScreenShare}
            onChange={() => applyToggle({
              key: 'allow-ss',
              action: 'allow-screen-share',
              payloadKey: 'enabled',
              value: !allowScreenShare,
              label: !allowScreenShare ? 'Ekran paylaşımı serbest' : 'Ekran paylaşımı yalnız host',
            })}
            disabled={busy === 'allow-ss'}
          />
          <span className="switch-track"><span className="switch-thumb" /></span>
        </label>
      </div>

      <div className="setting-row" style={{ marginTop: 8 }}>
        <div className="setting-text">
          <strong>Sohbeti kilitle</strong>
          <p>Açıkken katılımcılar mesaj yazamaz; yalnız host yazabilir.</p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={chatLocked}
            onChange={() => applyToggle({
              key: 'chat-lock',
              action: 'lock-chat',
              payloadKey: 'locked',
              value: !chatLocked,
              label: !chatLocked ? 'Sohbet kilitlendi' : 'Sohbet açıldı',
            })}
            disabled={busy === 'chat-lock'}
          />
          <span className="switch-track"><span className="switch-thumb" /></span>
        </label>
      </div>

      {share && (
        <>
          <p className="section-label" style={{ marginTop: 18 }}>Aktif paylaşım</p>
          <div className="share-status">
            <div className="share-status-meta">
              <Icon.Spark width="14" height="14" />
              <span>{share.name}</span>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 11, margin: '6px 0 0' }}>
            Alt kontrollerden değiştirebilir veya durdurabilirsiniz.
          </p>
        </>
      )}

      <p className="section-label" style={{ marginTop: 18 }}>Kayıt</p>
      <p className="muted" style={{ fontSize: 11, margin: '0 0 8px' }}>
        Kayıt sol-üst banner'dan başlatılır · 720p · H.264 · 24fps · ~6 MB / dakika
        {activeRecording && ' · şu an kaydediliyor'}
      </p>

      {recordings.length > 0 && (
        <div className="recording-list">
          {recordings.map((rec) => (
            <div key={rec.id} className="recording-item">
              <div className="recording-meta">
                <strong>
                  {new Date(rec.started_at).toLocaleString('tr-TR', {
                    day: '2-digit', month: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </strong>
                <span>
                  {formatDuration(rec.duration_sec)} · {formatBytes(rec.size_bytes)}
                  {rec.status !== 'completed' && ` · ${rec.status}`}
                </span>
              </div>
              {rec.status === 'completed' && (
                <a
                  className="btn sm"
                  href={`/api/rooms/${roomId}/recordings/${rec.id}/download`}
                  download
                >
                  İndir
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {note && <p className="note" style={{ textAlign: 'center', marginTop: 8 }}>{note}</p>}

      <p className="section-label" style={{ marginTop: 18 }}>
        Bekleyen onaylar {pending.length > 0 && <span className="count-pill">{pending.length}</span>}
      </p>
      {pending.length === 0 ? (
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>Şu an bekleyen kimse yok.</p>
      ) : (
        pending.map((p) => (
          <div key={p.requestId} className="pending-item">
            <span className="name">{p.name}</span>
            <button className="approve" onClick={() => approve(p.requestId)}>
              <Icon.Check width="12" height="12" /> Onayla
            </button>
            <button className="reject" onClick={() => reject(p.requestId)}>
              <Icon.X width="12" height="12" /> Reddet
            </button>
          </div>
        ))
      )}
    </div>
  );
}
