import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export function LobbyWaiting({ roomId, verificationId, password, onApproved, onRejected }) {
  const [status, setStatus] = useState('connecting');
  const [errorMsg, setErrorMsg] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatus('waiting');
      socket.emit('lobby:request', { roomId, verificationId, password }, (ack) => {
        if (!ack?.ok) {
          if (ack?.error === 'password') return onRejected?.('Parola yanlış');
          if (ack?.error === 'no_lobby') return onRejected?.('Bu odada bekleme odası yok');
          if (ack?.error === 'not_found') return onRejected?.('Oda bulunamadı');
          if (ack?.error === 'verification_required') return onRejected?.('Kimlik doğrulaması tamamlanmamış');
          return onRejected?.('Bekleme odasına alınamadı');
        }
      });
    });

    socket.on('lobby:approved', ({ token, url, displayName }) => onApproved?.({ token, url, displayName }));
    socket.on('lobby:rejected', ({ reason }) => onRejected?.(reason || 'Host isteğinizi reddetti'));
    socket.on('connect_error', (err) => setErrorMsg(err.message));

    return () => socket.disconnect();
  }, [roomId, verificationId, password]);

  return (
    <div className="centered-screen">
      <div className="card" style={{ textAlign: 'center' }}>
        <h2 className="card-title">Bekleme odası</h2>
        <p className="card-desc" style={{ marginBottom: 0 }}>
          {status === 'connecting'
            ? 'Bağlanılıyor…'
            : 'Host onayınızı bekliyor. Lütfen bu sekmeyi kapatmayın.'}
        </p>
        <div className="spinner" />
        {errorMsg && <p className="error-text">{errorMsg}</p>}
      </div>
    </div>
  );
}
