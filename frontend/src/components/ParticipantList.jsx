import { useEffect, useMemo, useState } from 'react';
import { useParticipants } from '@livekit/components-react';
import { hostAction } from '../lib/api.js';
import { Icon } from './icons.jsx';
import { useToast } from './Toasts.jsx';

function displayNameFor(p) {
  if (p.name && p.name.trim()) return p.name.trim();
  if (p.identity) {
    return p.identity.replace(/-[a-z0-9]{4,}$/i, '') || p.identity;
  }
  return 'İsimsiz';
}

function initialsFor(name) {
  return (name || '?')
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function useParticipantTrackState(participant) {
  const [, force] = useState(0);

  useEffect(() => {
    if (!participant) return;
    const update = () => force((n) => n + 1);
    const events = [
      'trackMuted', 'trackUnmuted',
      'trackPublished', 'trackUnpublished',
      'trackSubscribed', 'trackUnsubscribed',
      'isSpeakingChanged',
    ];
    events.forEach((e) => participant.on(e, update));
    return () => events.forEach((e) => participant.off(e, update));
  }, [participant]);

  return {
    micEnabled: !!participant?.isMicrophoneEnabled,
    camEnabled: !!participant?.isCameraEnabled,
  };
}

function metaOf(p) {
  try { return JSON.parse(p.metadata || '{}'); } catch { return {}; }
}

function ParticipantRow({ p, isHost, roomId, hostToken }) {
  const { micEnabled, camEnabled } = useParticipantTrackState(p);
  const toast = useToast();
  const name = displayNameFor(p);
  const meta = metaOf(p);

  const [choosing, setChoosing] = useState(false);

  // scope 'room' → yalnız bu toplantı; 'all' → tüm toplantılar (yönetim panelinden kaldırılır)
  async function promote(scope) {
    setChoosing(false);
    try {
      await hostAction(roomId, 'promote', { hostToken, identity: p.identity, scope });
      toast(scope === 'all' ? `${name} artık tüm toplantıların yöneticisi` : `${name} artık bu toplantının yöneticisi`, { tone: 'success' });
    } catch (err) {
      toast(err.message, { tone: 'warning' });
    }
  }

  async function setMute(source, currentlyOn) {
    try {
      await hostAction(roomId, 'mute', {
        hostToken, identity: p.identity, source, muted: currentlyOn,
      });
    } catch { /* yoksay */ }
  }

  async function kick() {
    if (!confirm(`${name} toplantıdan çıkarılsın mı?`)) return;
    try {
      await hostAction(roomId, 'kick', { hostToken, identity: p.identity });
    } catch { /* yoksay */ }
  }

  return (
    <div className="participant-block">
    <div className="item">
      <div className="avatar">{initialsFor(name)}</div>
      <div className="name" title={name}>
        {name}
        {p.isLocal && <span className="you"> (siz)</span>}
        {meta.isHost && <span className="participant-role">Yönetici</span>}
      </div>
      {isHost && !p.isLocal && (
        <div className="actions">
          <button
            className={`icon-btn ${micEnabled ? '' : 'off'}`}
            title={micEnabled ? 'Mikrofonu kapat' : 'Mikrofonu aç'}
            onClick={() => setMute('microphone', micEnabled)}
          >
            {micEnabled ? <Icon.Mic /> : <Icon.MicOff />}
          </button>
          <button
            className={`icon-btn ${camEnabled ? '' : 'off'}`}
            title={camEnabled ? 'Kamerayı kapat' : 'Kamerayı aç'}
            onClick={() => setMute('camera', camEnabled)}
          >
            {camEnabled ? <Icon.Video /> : <Icon.VideoOff />}
          </button>
          {meta.memberId && !meta.isHost && (
            <button className={`icon-btn ${choosing ? 'active' : ''}`} title="Toplantı yöneticisi yap"
              aria-label={`${name} toplantı yöneticisi yap`} aria-expanded={choosing} onClick={() => setChoosing((v) => !v)}>
              <Icon.Shield />
            </button>
          )}
          <button className="icon-btn danger" title="Toplantıdan çıkar" onClick={kick}>
            <Icon.Logout />
          </button>
        </div>
      )}
    </div>
    {choosing && (
      <div className="promote-choice" role="group" aria-label={`${name} için yönetici yetkisi`}>
        <button type="button" onClick={() => promote('room')}>
          <strong>Bu toplantıda yönetici yap</strong>
          <span>Yalnız bu toplantıda host yetkisi alır</span>
        </button>
        <button type="button" onClick={() => promote('all')}>
          <strong>Tüm toplantılarda yönetici yap</strong>
          <span>Sonraki toplantılara da host girer; yönetim panelinden kaldırılır</span>
        </button>
        <button type="button" className="promote-cancel" onClick={() => setChoosing(false)}>Vazgeç</button>
      </div>
    )}
    </div>
  );
}

export function ParticipantList({ isHost, roomId, hostToken }) {
  const participants = useParticipants();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return participants;
    return participants.filter((p) =>
      displayNameFor(p).toLowerCase().includes(q)
    );
  }, [participants, search]);

  return (
    <div className="participants">
      <div className="participant-search">
        <Icon.Search width="14" height="14" />
        <input
          type="search"
          placeholder="Katılımcılarda ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="header">
        <span>
          {filtered.length === participants.length
            ? `${participants.length} kişi bağlı`
            : `${filtered.length} / ${participants.length} eşleşme`}
        </span>
      </div>

      {filtered.length === 0 && participants.length > 0 && (
        <p className="muted" style={{ fontSize: 12, padding: '8px 0' }}>
          Eşleşen katılımcı yok.
        </p>
      )}

      {filtered.map((p) => (
        <ParticipantRow
          key={p.identity}
          p={p}
          isHost={isHost}
          roomId={roomId}
          hostToken={hostToken}
        />
      ))}
    </div>
  );
}
