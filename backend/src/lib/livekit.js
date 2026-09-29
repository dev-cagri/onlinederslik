import { AccessToken, RoomServiceClient, EgressClient, TrackSource, DataPacket_Kind } from 'livekit-server-sdk';
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

// Oda satırındaki (rooms) katılımcı izinleri
export function roomPermissions(room) {
  return {
    hostOnlyVideo: !!room?.host_only_video,
    allowScreenShare: !!room?.allow_screen_share,
    allowMic: room?.allow_mic === undefined ? true : !!room.allow_mic,
    allowCamera: room?.allow_camera === undefined ? true : !!room.allow_camera,
  };
}

// Host olmayan katılımcı için izinli yayın kaynaklarını oda ayarlarına göre üret.
// Boş dizi dönebilir: LiveKit'te boş canPublishSources "hepsine izin" demek olduğundan
// çağıran taraf bu durumda canPublish=false vermeli.
export function buildSourcesFor({ isHost, hostOnlyVideo, allowScreenShare, allowMic = true, allowCamera = true }) {
  if (isHost) return undefined; // host her şeyi yayınlayabilir
  const sources = [];
  if (allowMic) sources.push(TrackSource.MICROPHONE);
  if (allowCamera && !hostOnlyVideo) sources.push(TrackSource.CAMERA);
  if (allowScreenShare) {
    sources.push(TrackSource.SCREEN_SHARE);
    sources.push(TrackSource.SCREEN_SHARE_AUDIO);
  }
  return sources;
}

// Katılımcı yayın izni (LiveKit ParticipantPermission): kaynak listesi boşsa hiç yayın yok
export function publishPermission(sources) {
  return sources && sources.length === 0
    ? { canPublish: false }
    : { canPublish: true, ...(sources ? { canPublishSources: sources } : {}) };
}

// Sunucudan katılımcılara bildirim (istemcide toast). identities boşsa odadaki herkese.
export async function sendNotice(roomId, message, identities) {
  if (identities && identities.length === 0) return;
  const data = new TextEncoder().encode(JSON.stringify({ message }));
  await roomService.sendData(roomId, data, DataPacket_Kind.RELIABLE, {
    topic: 'notice',
    ...(identities ? { destinationIdentities: identities } : {}),
  }).catch(() => {});
}

// memberId: üyenin kimliği (metadata'da); host katılımcı listesinden onu yönetici yapabilsin diye
export async function issueToken({ roomId, displayName, isHost, room, memberId = null }) {
  const safeName = displayName.toString().slice(0, 60);
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: `${safeName}-${Math.random().toString(36).slice(2, 8)}`,
    name: safeName,
    metadata: JSON.stringify({ isHost: !!isHost, ...(memberId ? { memberId } : {}) }),
  });

  const sources = buildSourcesFor({ isHost, ...roomPermissions(room) });
  const grant = {
    roomJoin: true,
    room: roomId,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: !!isHost,
    ...publishPermission(sources),
  };

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
