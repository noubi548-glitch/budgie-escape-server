// =====================================================================
// BUDGIE ESCAPE — tiny multiplayer relay server (prototype)
// ---------------------------------------------------------------------
// What it does: lets several copies of the game talk to each other.
// It does NOT run the game world. Each player's own game still does its
// physics; this server just passes around "where is everyone" messages.
//
// Run it:   node server.js
//           (uses PORT from the environment when a host sets one,
//            otherwise port 3000)
//
// No npm install needed — uses only Node.js built-ins.
// =====================================================================

const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 50;        // safety cap for a free-tier box
const RELAY_MS = 50;           // 20 updates per second max per player
const HEARTBEAT_MS = 30000;    // ping clients every 30s, drop the dead ones
const MAX_MSG = 4096;          // ignore anything bigger (anti-spam)
const NAME_LEN = 16;

// id -> { id, name, socket, lastRelay, alive }
const players = new Map();
let nextNum = 1;

// ---------------------------------------------------------------- helpers
function makeId() {
  let id;
  do { id = 'p' + (nextNum++) + Math.random().toString(36).slice(2, 6); }
  while (players.has(id));
  return id;
}

function cleanName(raw) {
  let n = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_LEN);
  if (!n) n = 'Budgie';
  // keep gamertags unique: "NobleVR", "NobleVR-2", ...
  let out = n, i = 2;
  const taken = new Set([...players.values()].map(p => p.name.toLowerCase()));
  while (taken.has(out.toLowerCase())) out = n + '-' + (i++);
  return out;
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------- WebSocket framing (no libraries — done by hand)
// Sending: server -> client frames are never masked.
// Receiving: browsers MUST mask their frames; we unmask them.
function sendFrame(socket, data) {
  const payload = Buffer.from(data);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

function sendJson(socket, obj) {
  try { sendFrame(socket, JSON.stringify(obj)); } catch { /* dead socket */ }
}

// Parse as many complete frames as possible out of `buf`.
// Returns { frames:[{opcode, text}], rest }.
function parseFrames(buf) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off], b1 = buf[off + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f, hlen = 2;
    if (len === 126) {
      if (buf.length - off < 4) break;
      len = buf.readUInt16BE(off + 2); hlen = 4;
    } else if (len === 127) {
      if (buf.length - off < 10) break;
      const big = buf.readBigUInt64BE(off + 2);
      if (big > BigInt(MAX_MSG)) break;
      len = Number(big); hlen = 10;
    }
    const mlen = masked ? 4 : 0;
    if (buf.length - off < hlen + mlen + len) break; // wait for more data
    let payload = buf.subarray(off + hlen + mlen, off + hlen + mlen + len);
    if (masked) {
      const key = buf.subarray(off + hlen, off + hlen + 4);
      const out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) out[i] = payload[i] ^ key[i % 4];
      payload = out;
    }
    frames.push({ opcode, fin, text: payload.toString('utf8') });
    off += hlen + mlen + len;
  }
  return { frames, rest: buf.subarray(off) };
}

function acceptKey(key) {
  return crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

// ---------------------------------------------------------------- broadcasting
function broadcast(obj, exceptId) {
  const msg = JSON.stringify(obj);
  for (const p of players.values()) {
    if (p.id === exceptId) continue;
    sendFrame(p.socket, msg);
  }
}

function roster() {
  return [...players.values()].map(p => ({ id: p.id, name: p.name }));
}

// ---------------------------------------------------------------- message handling
function onText(player, socket, text) {
  let m;
  try { m = JSON.parse(text); } catch { return; }
  if (!m || typeof m.t !== 'string') return;

  if (m.t === 'hello') {
    if (player.joined) return; // one hello per connection
    player.joined = true;
    player.name = cleanName(m.name);
    players.set(player.id, player);
    console.log(`join  ${player.id} "${player.name}"  (${players.size} online)`);
    sendJson(socket, { t: 'welcome', id: player.id, name: player.name });
    sendJson(socket, { t: 'roster', players: roster().filter(p => p.id !== player.id) });
    broadcast({ t: 'join', id: player.id, name: player.name }, player.id);
    return;
  }

  if (!player.joined) return; // must say hello first

  if (m.t === 'state') {
    // throttle: at most one relay per player per RELAY_MS
    const now = Date.now();
    if (now - player.lastRelay < RELAY_MS) return;
    player.lastRelay = now;
    const p = Array.isArray(m.p) ? m.p : [0, 0, 0];
    const s = ['walk', 'air', 'perch', 'drive'].includes(m.s) ? m.s : 'walk';
    broadcast({
      t: 'state', id: player.id,
      p: [num(p[0], 0), num(p[1], 0), num(p[2], 0)],
      y: num(m.y, 0), pi: num(m.pi, 0), r: num(m.r, 0),
      s, v: typeof m.v === 'string' ? m.v.slice(0, 24) : null,
      spd: num(m.spd, 0),
    }, player.id);
    return;
  }

  if (m.t === 'ping') { sendJson(socket, { t: 'pong' }); }
}

// ---------------------------------------------------------------- connection lifecycle
function closePlayer(player, reason) {
  if (!player) return;
  if (player.joined && players.has(player.id)) {
    players.delete(player.id);
    console.log(`leave ${player.id} "${player.name}" (${reason}, ${players.size} online)`);
    broadcast({ t: 'bye', id: player.id });
  }
  try { player.socket.destroy(); } catch { /* already gone */ }
}

const httpServer = http.createServer((req, res) => {
  // A tiny status page — also what free hosts ping for health checks.
  const body = JSON.stringify({
    ok: true, game: 'budgie-escape-mp-prototype',
    players: players.size, maxPlayers: MAX_PLAYERS,
    uptimeSec: Math.floor(process.uptime()),
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(body);
});

httpServer.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  if (players.size >= MAX_PLAYERS) { socket.destroy(); return; }

  const resKey = acceptKey(key.trim());
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${resKey}\r\n\r\n`
  );

  const player = {
    id: makeId(), name: 'Budgie', socket,
    joined: false, lastRelay: 0, alive: true, buf: Buffer.alloc(0),
  };

  socket.on('data', (chunk) => {
    player.buf = Buffer.concat([player.buf, chunk]);
    if (player.buf.length > MAX_MSG * 4) { closePlayer(player, 'oversize'); return; }
    const { frames, rest } = parseFrames(player.buf);
    player.buf = rest;
    for (const f of frames) {
      if (f.opcode === 0x8) { closePlayer(player, 'client-close'); return; }
      if (f.opcode === 0x9) { sendFrame(socket, ''); player.alive = true; continue; } // ping -> (pong-ish)
      if (f.opcode === 0xA) { player.alive = true; continue; }
      if (f.opcode === 0x1 || f.opcode === 0x0) onText(player, socket, f.text);
    }
  });

  // NOTE: on a bare FIN (process exit, network drop) the socket only fires
  // 'end' and would otherwise linger half-open — treat 'end' as a leave too.
  socket.on('end', () => closePlayer(player, 'ended'));
  socket.on('close', () => closePlayer(player, 'closed'));
  socket.on('error', () => closePlayer(player, 'error'));
});

// heartbeat: ping everyone, drop anyone silent twice in a row
setInterval(() => {
  for (const p of [...players.values()]) {
    if (!p.alive) { closePlayer(p, 'heartbeat-timeout'); continue; }
    p.alive = false;
    try {
      const h = Buffer.alloc(2); h[0] = 0x89; h[1] = 0; // ping frame
      p.socket.write(h);
    } catch { closePlayer(p, 'ping-failed'); }
  }
}, HEARTBEAT_MS);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Budgie Escape MP prototype listening on 0.0.0.0:${PORT}`);
  console.log(`Status page: http://localhost:${PORT}/`);
});

process.on('SIGTERM', () => { console.log('shutting down'); process.exit(0); });
