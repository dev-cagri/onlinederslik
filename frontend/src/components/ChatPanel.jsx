import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { getMessages, getRoom } from '../lib/api.js';

export function ChatPanel({ roomId, displayName, isHost, hostToken }) {
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [chatLocked, setChatLocked] = useState(false);
  const [rejectionMsg, setRejectionMsg] = useState(null);
  const socketRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getMessages(roomId).then((rows) => {
      if (!cancelled) setMessages(rows);
    }).catch(() => {});
    getRoom(roomId).then((r) => {
      if (!cancelled) setChatLocked(!!r.chatLocked);
    }).catch(() => {});

    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('room:join', { roomId, name: displayName });
    });
    socket.on('chat:new', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    socket.on('chat:rejected', ({ reason }) => {
      setRejectionMsg(reason || 'Mesaj gönderilemedi');
      setTimeout(() => setRejectionMsg(null), 2500);
    });
    socket.on('room:settings', (s) => {
      if ('chatLocked' in s) setChatLocked(!!s.chatLocked);
    });

    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, [roomId, displayName]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function send(e) {
    e.preventDefault();
    const text = body.trim();
    if (!text || !socketRef.current) return;
    socketRef.current.emit('chat:send', { body: text, hostToken });
    setBody('');
  }

  const inputDisabled = chatLocked && !isHost;

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <p className="chat-empty">Henüz mesaj yok. İlk mesajı sen yaz!</p>
        )}
        {messages.map((m, i) => (
          <div key={m.id ?? i} className="chat-item">
            <div className="who">
              {m.sender_name} · {new Date(m.created_at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div className="body">{m.body}</div>
          </div>
        ))}
      </div>

      {chatLocked && (
        <div className="chat-locked-banner">
          🔒 Sohbet kilitli{isHost ? ' — yalnızca siz yazabilirsiniz' : ''}
        </div>
      )}
      {rejectionMsg && (
        <div className="chat-locked-banner danger">{rejectionMsg}</div>
      )}

      <form className="chat-form" onSubmit={send}>
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={inputDisabled ? 'Sohbet kilitli' : 'Mesaj yaz…'}
          maxLength={2000}
          disabled={inputDisabled}
        />
        <button type="submit" className="btn primary sm" disabled={inputDisabled}>Gönder</button>
      </form>
    </div>
  );
}
