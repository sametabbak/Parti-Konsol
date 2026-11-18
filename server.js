// Oyun Konsolu — "ekran konsol, telefon kumanda" sunucusu
// Express statik dosyaları sunar, Socket.IO ekran ile telefonlar arasında mesaj taşır.
const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 8;
const PLAYER_COLORS = ['#ff3b6b', '#2ec5ff', '#ffd23f', '#52e07c', '#b06bff', '#ff8c2e', '#ff6bd6', '#9aa4b2'];

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, pingInterval: 5000, pingTimeout: 8000 });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/katil', (req, res) => res.sendFile(path.join(__dirname, 'public', 'controller.html')));

// Yerel ağ IP'si: ekran localhost'tan açıldığında QR kodu telefonların erişebileceği adresi göstersin
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

app.get('/api/info', (req, res) => {
  const ip = lanAddress();
  res.json({ lanUrl: ip ? `http://${ip}:${PORT}` : null });
});

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 300);
  if (!text) return res.status(400).end();
  const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#0b0f1a', light: '#ffffff' } });
  res.type('image/svg+xml').send(svg);
});

// ---- Odalar ----
// rooms: code -> { screenId, players: Map(socketId -> {id, name, color, slot}) }
const rooms = new Map();

function newCode() {
  let code;
  do { code = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(code));
  return code;
}

function playerList(room) {
  return [...room.players.values()].sort((a, b) => a.slot - b.slot);
}

function broadcastPlayers(code) {
  const room = rooms.get(code);
  if (!room) return;
  const list = playerList(room);
  io.to(room.screenId).emit('players', list);
  // Telefonlara: kim yönetici (ilk sıradaki oyuncu menüyü yönetir)
  const masterId = list.length ? list[0].id : null;
  for (const p of list) io.to(p.id).emit('role', { master: p.id === masterId, slot: p.slot, color: p.color, name: p.name });
}

io.on('connection', (socket) => {
  socket.data.room = null;
  socket.data.kind = null;

  // Ekran yeni oda açar
  socket.on('screen:create', (_, ack) => {
    const code = newCode();
    rooms.set(code, { screenId: socket.id, players: new Map() });
    socket.data.room = code;
    socket.data.kind = 'screen';
    socket.join(code);
    if (typeof ack === 'function') ack({ code });
  });

  // Telefon odaya katılır
  socket.on('controller:join', ({ code, name } = {}, ack) => {
    code = String(code || '').trim();
    const room = rooms.get(code);
    if (!room) return typeof ack === 'function' && ack({ ok: false, error: 'Bu kodla açık bir ekran yok.' });
    if (room.players.size >= MAX_PLAYERS) return typeof ack === 'function' && ack({ ok: false, error: 'Oda dolu.' });

    const used = new Set([...room.players.values()].map((p) => p.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const player = {
      id: socket.id,
      name: String(name || '').trim().slice(0, 14) || `Oyuncu ${slot + 1}`,
      color: PLAYER_COLORS[slot % PLAYER_COLORS.length],
      slot,
    };
    room.players.set(socket.id, player);
    socket.data.room = code;
    socket.data.kind = 'controller';
    socket.join(code);
    if (typeof ack === 'function') ack({ ok: true, player });
    broadcastPlayers(code);
  });

  // Telefon -> ekran (dokunma, düğme vb.). volatile: geç kalan konum paketleri biriktirilmez
  socket.on('input', (data) => {
    const room = socket.data.kind === 'controller' && rooms.get(socket.data.room);
    if (!room) return;
    const msg = { from: socket.id, data };
    if (data && data.type === 'move') io.to(room.screenId).volatile.emit('input', msg);
    else io.to(room.screenId).emit('input', msg);
  });

  // Ekran -> telefon(lar). to: socketId ya da 'all'
  socket.on('toController', ({ to, data } = {}) => {
    const room = socket.data.kind === 'screen' && rooms.get(socket.data.room);
    if (!room) return;
    if (to === 'all') {
      for (const id of room.players.keys()) io.to(id).emit('screen', data);
    } else if (room.players.has(to)) {
      io.to(to).emit('screen', data);
    }
  });

  socket.on('disconnect', () => {
    const code = socket.data.room;
    const room = code && rooms.get(code);
    if (!room) return;
    if (socket.data.kind === 'screen') {
      for (const id of room.players.keys()) io.to(id).emit('screenLost');
      rooms.delete(code);
    } else {
      room.players.delete(socket.id);
      broadcastPlayers(code);
    }
  });
});

server.listen(PORT, () => {
  const ip = lanAddress();
  console.log(`Oyun Konsolu çalışıyor:  http://localhost:${PORT}`);
  if (ip) console.log(`Aynı Wi-Fi'deki telefonlar için:  http://${ip}:${PORT}`);
});
