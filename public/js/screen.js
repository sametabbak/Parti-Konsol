// Büyük ekran: oda açar, lobiyi gösterir, oyunları yükler ve telefonlardan gelen girdileri oyuna iletir.
import { GAMES } from '/js/games.js';
import { sfx, unlockAudio } from '/js/sfx.js';

const $ = (id) => document.getElementById(id);
const socket = io({ transports: ['websocket'] });

let code = null;
let players = [];          // [{id,name,color,slot}] slot sırasına göre
let game = null;           // çalışan oyun örneği
let gameId = null;

const master = () => players[0] || null;

// ---------- Oda / bağlantı ----------
socket.on('connect', () => {
  socket.emit('screen:create', null, async ({ code: c }) => {
    code = c;
    players = [];
    if (game) backToLobby();
    $('code').textContent = code;
    $('cornerCode').textContent = `Kod: ${code}`;
    $('status').textContent = 'Bağlandı · oyuncular bekleniyor';
    await renderJoinInfo();
    renderPlayers();
  });
});
socket.on('disconnect', () => { $('status').textContent = 'Sunucu bağlantısı koptu, yeniden deneniyor…'; });

async function renderJoinInfo() {
  let base = location.origin;
  if (['localhost', '127.0.0.1', '::1'].includes(location.hostname)) {
    try { const info = await (await fetch('/api/info')).json(); if (info.lanUrl) base = info.lanUrl; } catch {}
  }
  const joinUrl = `${base}/katil?code=${code}`;
  $('qr').src = `/api/qr?text=${encodeURIComponent(joinUrl)}`;
  $('joinUrl').textContent = `${base.replace(/^https?:\/\//, '')}/katil`;
}

socket.on('players', (list) => {
  const prevIds = new Set(players.map((p) => p.id));
  players = list;
  renderPlayers();
  const joined = list.filter((p) => !prevIds.has(p.id));
  if (joined.length) sfx.join();
  if (game) {
    game.onPlayersChanged(players);
  } else {
    sendMenu();
  }
});

socket.on('input', ({ from, data }) => {
  if (!data) return;
  const isMaster = master() && master().id === from;
  if (data.type === 'menu') {
    if (!game && isMaster) startGame(data.game);
    return;
  }
  if (data.type === 'action') {
    if (!isMaster) return;
    if (data.name === 'menu') backToLobby();
    if (data.name === 'restart' && game) game.restart();
    return;
  }
  if (game) game.onInput(from, data);
});

// ---------- Telefonlara mesaj ----------
const api = {
  canvas: $('canvas'),
  sfx,
  players: () => players,
  send: (to, data) => socket.emit('toController', { to, data }),
  sendAll: (data) => socket.emit('toController', { to: 'all', data }),
  vibrate: (to, pattern) => socket.emit('toController', { to, data: { vibrate: pattern } }),
  backToLobby: () => backToLobby(),
};

function sendMenu() {
  api.sendAll({ view: 'menu', games: GAMES.map(({ id, name, icon, players, min, max, available }) => ({ id, name, icon, players, min, max, available })) });
}

// ---------- Lobi arayüzü ----------
function renderPlayers() {
  $('pcount').textContent = players.length ? `(${players.length})` : '';
  $('plist').innerHTML = players.length
    ? players.map((p, i) => `
        <div class="pchip"><div class="av" style="background:${p.color}">${escapeHtml(p.name[0] || '?').toUpperCase()}</div>
        ${escapeHtml(p.name)} ${i === 0 ? '<span class="crown" title="Yönetici">👑</span>' : ''}</div>`).join('')
    : '<span class="muted">Henüz kimse bağlanmadı. Telefonlar kodu girdikçe burada görünecek.</span>';
}

function renderGames() {
  $('games').innerHTML = GAMES.map((g) => `
    <div class="card game-card ${g.available ? 'selectable' : 'soon'}" data-id="${g.id}">
      <div class="thumb" style="background:${g.bg}">${g.icon}</div>
      ${g.available ? '' : '<span class="tag">Yakında</span>'}
      <div class="info"><h3>${g.name}</h3><div class="muted">${g.players}</div></div>
    </div>`).join('');
  $('games').querySelectorAll('.selectable').forEach((el) => (el.onclick = () => startGame(el.dataset.id)));
}

function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = 0; setTimeout(() => t.remove(), 400); }, ms);
}

// ---------- Oyun yönetimi ----------
async function startGame(id) {
  const meta = GAMES.find((g) => g.id === id);
  if (!meta || !meta.available || game) return;
  if (players.length < meta.min) {
    toast(`${meta.name} için en az ${meta.min} oyuncu gerekli.`);
    api.sendAll({ toast: `${meta.name} için en az ${meta.min} oyuncu gerekli.` });
    return;
  }
  const mod = await import(`/games/${id}.js`);
  gameId = id;
  $('lobby').style.display = 'none';
  $('gameLayer').style.display = 'block';
  $('cornerCode').style.display = 'block';
  game = new mod.default(api);
  window.__game = game; // hata ayıklama için
  game.start(players);
}

function backToLobby() {
  if (game) { game.stop(); game = null; gameId = null; }
  $('gameLayer').style.display = 'none';
  $('cornerCode').style.display = 'none';
  $('lobby').style.display = 'grid';
  sendMenu();
}

// ---------- Diğer ----------
$('fsBtn').onclick = () => {
  unlockAudio();
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
};
addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', (e) => {
  unlockAudio();
  if (e.key === 'Escape' && game) backToLobby();
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

renderGames();
