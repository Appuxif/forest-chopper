// PeerJS only handles signaling and WebRTC transport. Each guest gets their
// own authoritative WebSocket session on the host's Python game server.
let peerLibraryPromise;
async function loadPeer() {
  if (!peerLibraryPromise) peerLibraryPromise = import('https://esm.sh/peerjs@1.5.5').then(m => m.default ?? m.Peer).catch(e => { peerLibraryPromise=null; throw e; });
  return peerLibraryPromise;
}
export async function createPeer(config) {
  const Peer = await loadPeer();
  const options = config.custom ? {
    host: config.host, port: config.port, path: config.path || '/',
    secure: config.secure
  } : {};
  return new Peer(undefined, { ...options, debug: 0 });
}
export function waitForPeer(peer) {
  return new Promise((resolve, reject) => {
    if (peer.open) return resolve(peer.id);
    const open = id => { cleanup(); resolve(id); };
    const error = err => { cleanup(); reject(err); };
    const cleanup = () => { peer.off('open',open); peer.off('error',error); };
    peer.on('open',open); peer.on('error',error);
  });
}
export function bridgeGuest(conn, url, onStatus) {
  let ws;
  let closed = false;
  const pending = [];
  const close = () => {
    if (closed) return;
    closed = true;
    pending.length = 0;
    if (ws) { ws.onclose = null; ws.close(); }
    if (conn.open) conn.close();
  };
  conn.on('data', message => {
    if (closed || typeof message !== 'string' || message.length > 2048) return;
    if (ws?.readyState === WebSocket.OPEN) ws.send(message);
    else if (pending.length < 16) pending.push(message);
  });
  conn.on('close',close);
  conn.on('error',close);
  try { ws = new WebSocket(url); }
  catch (err) { onStatus('Прокси: ошибка адреса сервера: '+err.message); close(); return close; }
  ws.onopen = () => { if (!closed) { for (const message of pending) ws.send(message); pending.length=0; } };
  ws.onmessage = e => { if (!closed && conn.open) conn.send(e.data); };
  ws.onerror = () => { onStatus('Прокси: локальный игровой сервер недоступен'); close(); };
  ws.onclose = close;
  return close;
}
// Minimal WebSocket-compatible endpoint for multiplayer.js.
export function peerSocket(conn) {
  let readyState = WebSocket.CONNECTING;
  const socket = {
    get readyState() { return readyState; },
    onopen:null, onmessage:null, onclose:null, onerror:null,
    send(data) {
      if (readyState !== WebSocket.OPEN) throw Error('Peer connection is not open');
      conn.send(data);
    },
    close() {
      if (readyState === WebSocket.CLOSED) return;
      readyState=WebSocket.CLOSED;
      conn.close();
    }
  };
  conn.on('open', () => { if (readyState !== WebSocket.CONNECTING) return; readyState=WebSocket.OPEN; socket.onopen?.(); });
  conn.on('data', data => { if (readyState===WebSocket.OPEN && typeof data==='string') socket.onmessage?.({data}); });
  const end = err => {
    if (readyState===WebSocket.CLOSED) return;
    readyState=WebSocket.CLOSED;
    if(err) socket.onerror?.(err);
    socket.onclose?.();
  };
  conn.on('close',()=>end());
  conn.on('error',end);
  return socket;
}
