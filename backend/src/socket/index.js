import { attachChat } from './chat.js';
import { attachLobby } from './lobby.js';
import { attachShareSocket } from '../routes/share.js';

export function attachSocketHandlers(io) {
  attachShareSocket(io);
  io.on('connection', (socket) => {
    attachChat(socket, io);
    attachLobby(socket, io);
  });
}
