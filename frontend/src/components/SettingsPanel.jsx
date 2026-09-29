import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  hostAction, getRoom, updateRoomSettings,
  getActiveRecording, listRecordings, recordingFileUrl,
} from '../lib/api.js';
import { Icon } from './icons.jsx';
import { useToast } from './Toasts.jsx';

// Katılımcı izinleri: açıklama, açma/kapama sonrası hosta gösterilen bildirim.
// invert: ayar "kilitli" anlamındaysa (chatLocked) anahtar tersini gösterir.
const PERMISSIONS = [
  { key: 'allowMic', title: 'Mikrofonlarını açabilir', desc: 'Kapalıyken katılımcıların mikrofonu kapatılır ve açamazlar.', on: 'Katılımcılar mikrofon açabilir', off: 'Katılımcı mikrofonları kapatıldı' },
  { key: 'allowCamera', title: 'Kameralarını açabilir', desc: 'Kapalıyken katılımcıların kamerası kapatılır ve açamazlar.', on: 'Katılımcılar kamera açabilir', off: 'Katılımcı kameraları kapatıldı' },
  { key: 'allowScreenShare', title: 'Ekran paylaşabilir', desc: 'Kapalıyken yalnızca siz ekran paylaşabilirsiniz.', on: 'Katılımcılar ekran paylaşabilir', off: 'Ekran paylaşımı yalnız sizde' },
  { key: 'chatLocked', invert: true, title: 'Sohbete yazabilir', desc: 'Kapalıyken sohbete yalnızca siz yazabilirsiniz.', on: 'Sohbet kilitlendi', off: 'Sohbet açıldı' },
  { key: 'allowReactions', title: 'Tepki gönderebilir', desc: 'Emoji tepkileri (👍 ✋ …) ekranda görünür.', on: 'Tepkiler açıldı', off: 'Tepkiler kapatıldı' },
];

export function SettingsPanel({ roomId, hostToken }) {
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [nameDraft, setNameDraft] = useState('');
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(null);
  const [activeRecording, setActiveRecording] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const socketRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getRoom(roomId).then((r) => {
      if (cancelled) return;
      setSettings(r);
      setNameDraft(r.name);
    }).catch(() => {});
    getActiveRecording(roomId).then((rec) => { if (!cancelled) setActiveRecording(rec || null); }).catch(() => {});
    listRecordings(roomId).then((rows) => { if (!cancelled) setRecordings(rows || []); }).catch(() => {});
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
      toast(`${entry.name} katılmak istiyor`);
    });
    socket.on('lobby:resolved', ({ requestId }) => {
      setPending((prev) => prev.filter((p) => p.requestId !== requestId));
    });
    socket.on('room:settings', (s) => setSettings((prev) => (prev ? { ...prev, ...s } : prev)));
    socket.on('recording:started', (rec) => setActiveRecording(rec));
    socket.on('recording:stopped', () => {
      setActiveRecording(null);
      listRecordings(roomId).then(setRecordings).catch(() => {});
    });
    return () => socket.disconnect();
  }, [roomId, hostToken, toast]);

  async function save(key, patch, message) {
    const prev = settings;
    setBusy(key);
    setSettings((s) => ({ ...s, ...patch }));
    try {
      await updateRoomSettings(roomId, hostToken, patch);
      if (message) toast(message, { tone: 'success' });
    } catch (err) {
      setSettings(prev);
      toast(`Kaydedilemedi: ${err.message}`, { tone: 'warning' });
    } finally {
      setBusy(null);
    }
  }

  async function muteAll(source) {
    setBusy(`mute-${source}`);
    try {
      const r = await hostAction(roomId, 'mute-all', { hostToken, source });
      const what = source === 'camera' ? 'kamerası' : 'mikrofonu';
      toast(r.muted ? `${r.muted} katılımcının ${what} kapatıldı` : `Açık ${what === 'kamerası' ? 'kamera' : 'mikrofon'} yok`, { tone: 'success' });
    } catch (err) {
      toast(`Hata: ${err.message}`, { tone: 'warning' });
    } finally {
      setBusy(null);
    }
  }

  async function endMeeting() {
    if (!window.confirm('Toplantı herkes için bitirilsin mi? Tüm katılımcılar çıkarılır ve toplantı yeni girişlere kapanır.')) return;
    setBusy('end');
    try {
      await hostAction(roomId, 'end', { hostToken });
    } catch (err) {
      toast(`Hata: ${err.message}`, { tone: 'warning' });
      setBusy(null);
    }
  }

  const approve = (requestId) => socketRef.current?.emit('lobby:approve', { roomId, requestId });
  const reject = (requestId) => socketRef.current?.emit('lobby:reject', { roomId, requestId, reason: 'Host isteğinizi reddetti' });

  if (!settings) return <div className="settings-panel"><div className="spinner" /></div>;

  const nameChanged = nameDraft.trim() && nameDraft.trim() !== settings.name;

  return (
    <div className="settings-panel">
      <h3 className="set-label">Hızlı işlemler</h3>
      <div className="set-actions">
        <button type="button" className="set-action" onClick={() => muteAll('microphone')} disabled={busy === 'mute-microphone'}>
          <span className="set-action-icon"><Icon.MicOff width="18" height="18" /></span>
          Tüm mikrofonları kapat
        </button>
        <button type="button" className="set-action" onClick={() => muteAll('camera')} disabled={busy === 'mute-camera'}>
          <span className="set-action-icon"><Icon.VideoOff width="18" height="18" /></span>
          Tüm kameraları kapat
        </button>
      </div>
      <p className="set-footnote">Sizin mikrofonunuz ve kameranız etkilenmez; katılımcılara bildirim gider.</p>

      <h3 className="set-label">Katılımcılar neleri yapabilir</h3>
      <div className="set-group">
        {PERMISSIONS.map((p) => {
          const checked = p.invert ? !settings[p.key] : settings[p.key];
          return (
            <SwitchRow
              key={p.key}
              title={p.title}
              desc={p.desc}
              checked={checked}
              disabled={busy === p.key}
              onChange={(v) => {
                const value = p.invert ? !v : v;
                save(p.key, { [p.key]: value }, value ? p.on : p.off);
              }}
            />
          );
        })}
      </div>

      <h3 className="set-label">Görünüm</h3>
      <div className="set-group">
        <SwitchRow
          title="Yalnız host görünsün"
          desc="Ekranda yalnızca siz görünürsünüz; katılımcıların kameraları kapatılır."
          checked={settings.hostOnlyVideo}
          disabled={busy === 'hostOnlyVideo'}
          onChange={(v) => save('hostOnlyVideo', { hostOnlyVideo: v }, v ? 'Yalnız host görünüyor' : 'Herkes görünebilir')}
        />
      </div>

      <h3 className="set-label">Katılım</h3>
      <div className="set-group">
        <SwitchRow
          title="Bekleme odası"
          desc="Katılımcılar içeri girmeden önce sizin onayınızı bekler."
          checked={settings.lobbyEnabled}
          disabled={busy === 'lobbyEnabled'}
          onChange={(v) => save('lobbyEnabled', { lobbyEnabled: v }, v ? 'Bekleme odası açıldı' : 'Bekleme odası kapatıldı')}
        />
        <SwitchRow
          title="Toplantıyı kilitle"
          desc="Yeni kimse katılamaz; içeridekiler kalır."
          checked={settings.locked}
          disabled={busy === 'locked'}
          onChange={(v) => save('locked', { locked: v }, v ? 'Toplantı yeni katılımlara kapatıldı' : 'Toplantı yeni katılımlara açıldı')}
        />
      </div>
      {(settings.lobbyEnabled || pending.length > 0) && (
        <div className="set-group set-pending">
          <div className="set-pending-head">
            Bekleyenler {pending.length > 0 && <span className="count-pill">{pending.length}</span>}
          </div>
          {pending.length === 0 && <p className="set-empty">Şu an bekleyen kimse yok.</p>}
          {pending.map((p) => (
            <div key={p.requestId} className="set-pending-row">
              <span className="set-pending-name">{p.name}</span>
              <button type="button" className="btn sm" onClick={() => reject(p.requestId)}>Reddet</button>
              <button type="button" className="btn sm primary" onClick={() => approve(p.requestId)}>
                <Icon.Check width="13" height="13" /> Al
              </button>
            </div>
          ))}
        </div>
      )}

      <h3 className="set-label">Toplantı adı</h3>
      <form
        className="set-group set-name"
        onSubmit={(e) => { e.preventDefault(); if (nameChanged) save('name', { name: nameDraft.trim() }, 'Toplantı adı güncellendi'); }}
      >
        <input
          className="set-name-input"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          maxLength={255}
          aria-label="Toplantı adı"
        />
        <button type="submit" className="btn sm primary" disabled={!nameChanged || busy === 'name'}>Kaydet</button>
      </form>

      <h3 className="set-label">Kayıtlar</h3>
      <div className="set-group">
        {activeRecording && (
          <div className="set-row">
            <span className="rec-dot-live" aria-hidden="true" />
            <span className="set-row-text"><strong>Şu an kaydediliyor</strong></span>
          </div>
        )}
        {recordings.length === 0 && !activeRecording && (
          <p className="set-empty">Henüz kayıt yok. Kaydı ⋯ menüsünden başlatabilirsiniz; kayıtlar sunucuda saklanır ve yönetim panelindeki Kayıtlar bölümünde de listelenir.</p>
        )}
        {recordings.map((rec) => (
          <div key={rec.id} className="set-row">
            <span className="set-row-text">
              <strong>
                {new Date(rec.started_at).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </strong>
              <span>
                {rec.status === 'processing'
                  ? 'Hazırlanıyor…'
                  : `${formatDuration(rec.duration_sec)} · ${formatBytes(rec.size_bytes)}`}
              </span>
            </span>
            {rec.status === 'completed' && (
              <a className="btn sm" href={recordingFileUrl(rec.id, true)} download>İndir</a>
            )}
          </div>
        ))}
      </div>

      <button type="button" className="set-end" onClick={endMeeting} disabled={busy === 'end'}>
        Toplantıyı herkes için bitir
      </button>
    </div>
  );
}

function SwitchRow({ title, desc, checked, disabled, onChange }) {
  return (
    <label className="set-row set-switch">
      <span className="set-row-text">
        <strong>{title}</strong>
        <span>{desc}</span>
      </span>
      <span className="switch">
        <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="switch-track"><span className="switch-thumb" /></span>
      </span>
    </label>
  );
}

function formatBytes(b) {
  if (!b) return '—';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(s) {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  return m ? `${m} dk ${s % 60} sn` : `${s} sn`;
}
