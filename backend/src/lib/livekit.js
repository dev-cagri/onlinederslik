import { AccessToken, RoomServiceClient, EgressClient, TrackSource } from 'livekit-server-sdk';
import { config } from '../config.js';

const httpUrl = config.livekit.url
  .replace(/^ws:\/\//, 'http://')
  .replace(/^wss:\/\//, 'https://');

export const roomService = new RoomServiceClient(
  httpUrl,
  config.livekit.apiKey,
  config.livekit.apiSecret
);

export const egressClient = new EgressClient(
  httpUrl,
  config.livekit.apiKey,
  config.livekit.apiSecret
);

// Host olmayan katılımcı için izinli yayın kaynaklarını oda ayarlarına göre üret.
export function buildSourcesFor({ isHost, hostOnlyVideo, allowScreenShare }) {
  if (isHost) return undefined; // host her şeyi yayınlayabilir
  const sources = [TrackSource.MICROPHONE];
  if (!hostOnlyVideo) sources.push(TrackSource.CAMERA);
  if (allowScreenShare) {
    sources.push(TrackSource.SCREEN_SHARE);
    sources.push(TrackSource.SCREEN_SHARE_AUDIO);
  }
  return sources;
}

export async function issueToken({
  roomId,
  displayName,
  isHost,
  hostOnlyVideo,
  allowScreenShare,
}) {
  const safeName = displayName.toString().slice(0, 60);
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: `${safeName}-${Math.random().toString(36).slice(2, 8)}`,
    name: safeName,
    metadata: JSON.stringify({ isHost: !!isHost }),
  });

  const grant = {
    roomJoin: true,
    room: roomId,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: !!isHost,
  };

  const sources = buildSourcesFor({ isHost, hostOnlyVideo, allowScreenShare });
  if (sources) grant.canPublishSources = sources;

  at.addGrant(grant);
  return { token: await at.toJwt(), url: config.livekit.publicUrl };
}

// Belirli bir katılımcının LiveKit metadata'sından host olup olmadığını oku.
export function isParticipantHost(participant) {
  try {
    const meta = JSON.parse(participant.metadata || '{}');
    return meta.isHost === true;
  } catch {
    return false;
  }
}
