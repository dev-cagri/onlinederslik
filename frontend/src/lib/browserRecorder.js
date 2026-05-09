// Browser-side recording: getDisplayMedia + MediaRecorder
// Host'un sekmesini yakalar, WebM olarak yerelde encode eder, durunca server'a yükler.
// iOS Safari getDisplayMedia desteklemez — production'da iPad host'lar için
// server-side LiveKit Egress kullanılır.

const MIME_PREFERENCES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=h264,opus',
  'video/webm',
];

export function isBrowserRecordingSupported() {
  return (
    typeof navigator !== 'undefined' &&
    navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === 'function' &&
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined'
  );
}

export class BrowserRecorder {
  constructor({ roomId, hostToken, onStarted, onUploading, onCompleted, onError }) {
    this.roomId = roomId;
    this.hostToken = hostToken;
    this.onStarted = onStarted;
    this.onUploading = onUploading;
    this.onCompleted = onCompleted;
    this.onError = onError;
    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    this.startedAt = null;
  }

  async start() {
    if (!isBrowserRecordingSupported()) {
      this.onError?.(new Error('Tarayıcı ekran kaydını desteklemiyor (iOS Safari?)'));
      return false;
    }

    try {
      // Sekme tercihen mevcut tab — Chrome 109+
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } },
        audio: { echoCancellation: true, noiseSuppression: true },
        // @ts-ignore — non-standard
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        systemAudio: 'include',
      });

      // Sekme video dışı bir şey seçildiyse uyar (yine de devam et)
      const videoTrack = stream.getVideoTracks()[0];
      this.stream = stream;

      const mimeType = MIME_PREFERENCES.find((t) => MediaRecorder.isTypeSupported(t)) || 'video/webm';
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 800_000, // 800 kbps — düşük MB
        audioBitsPerSecond: 64_000,
      });

      this.chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };
      recorder.onstop = () => this._handleStop();
      recorder.onerror = (e) => this.onError?.(e.error || new Error('MediaRecorder hatası'));

      // Kullanıcı tarayıcının "Paylaşmayı bırak" düğmesine basarsa otomatik durdur
      videoTrack.onended = () => {
        if (this.recorder?.state === 'recording') this.recorder.stop();
      };

      recorder.start(2000); // 2 saniyelik chunklar
      this.recorder = recorder;
      this.startedAt = new Date();

      // Backend'e başladığını bildir (badge yayınlamak için)
      fetch(`/api/rooms/${this.roomId}/recordings/announce-start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hostToken: this.hostToken }),
      }).catch(() => {});

      this.onStarted?.();
      return true;
    } catch (err) {
      // Kullanıcı iptal etti veya izin reddedildi
      if (err?.name === 'NotAllowedError') {
        this.onError?.(new Error('Ekran paylaşımı izni reddedildi'));
      } else {
        this.onError?.(err);
      }
      return false;
    }
  }

  stop() {
    if (this.recorder?.state === 'recording') {
      this.recorder.stop();
    }
  }

  async _handleStop() {
    this.onUploading?.();

    // Stream'i kapat
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;

    const blob = new Blob(this.chunks, { type: this.chunks[0]?.type || 'video/webm' });
    this.chunks = [];

    if (blob.size === 0) {
      this.onError?.(new Error('Kayıt boş'));
      return;
    }

    try {
      const fd = new FormData();
      fd.append('hostToken', this.hostToken);
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      fd.append('file', blob, `recording-${Date.now()}.${ext}`);
      if (this.startedAt) {
        fd.append('startedAt', this.startedAt.toISOString());
        const dur = Math.round((Date.now() - this.startedAt.getTime()) / 1000);
        fd.append('durationSec', String(dur));
      }

      const r = await fetch(`/api/rooms/${this.roomId}/recordings/upload`, {
        method: 'POST',
        body: fd,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);

      this.onCompleted?.(data);
    } catch (err) {
      this.onError?.(err);
    } finally {
      this.recorder = null;
      this.startedAt = null;
    }
  }
}
