// Telefon kumandası: odaya katılır, ekrandan gelen "view" mesajlarına göre arayüzü değiştirir,
// dokunma/düğme girdilerini ekrana gönderir.
(function () {
  const $ = (id) => document.getElementById(id);
  const socket = io({ transports: ['websocket'], autoConnect: true });

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  let joined = null;      // { code, name }
  let role = null;        // { master, slot, color, name }
  let lastMenu = null;    // son menü mesajı
  let lastOver = null;    // son oyun sonu mesajı
  let current = 'join';
  let pad = null;         // { side, color, oppName, oppColor }

  // ---------- Katılım ----------
  const params = new URLSearchParams(location.search);
  $('codeIn').value = (params.get('code') || '').replace(/\D/g, '').slice(0, 4);
  $('nameIn').value = store.get('pk_name') || '';
  if ($('codeIn').value.length === 4 && !$('nameIn').value) setTimeout(() => $('nameIn').focus(), 200);

  $('codeIn').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (e.target.value.length === 4) $('nameIn').focus();
  });
  $('nameIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  $('joinBtn').onclick = join;

  function join() {
    const code = $('codeIn').value.trim();
    const name = $('nameIn').value.trim();
    if (code.length !== 4) { $('joinErr').textContent = 'Ekrandaki 4 haneli kodu gir.'; return; }
    store.set('pk_name', name);
    $('joinErr').textContent = '';
    $('joinBtn').disabled = true;
    // Tam ekran ve ekranın kararmaması (destekleyen cihazlarda)
    try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch {}
    keepAwake();
    socket.emit('controller:join', { code, name }, (res) => {
      $('joinBtn').disabled = false;
      if (!res || !res.ok) { $('joinErr').textContent = (res && res.error) || 'Bağlanılamadı.'; return; }
      joined = { code, name };
      role = { ...res.player, master: false };
      history.replaceState(null, '', `/katil?code=${code}`);
      show('menu');
      renderMenu();
    });
  }

  // Bağlantı koparsa otomatik yeniden katıl
  socket.on('connect', () => {
    if (!joined) return;
    socket.emit('controller:join', joined, (res) => {
      if (!res || !res.ok) { joined = null; show('join'); $('joinErr').textContent = 'Oda kapanmış. Ekrandaki yeni kodu gir.'; }
    });
  });

  // ---------- Sunucu / ekran mesajları ----------
  socket.on('role', (r) => {
    role = r;
    $('meAv').style.background = r.color;
    $('meAv').textContent = (r.name[0] || '?').toUpperCase();
    $('meName').textContent = r.name;
    $('meRole').textContent = r.master ? '👑 Yöneticisin' : `Oyuncu ${r.slot + 1}`;
    if (current === 'menu') renderMenu();
    if (current === 'msg' && lastOver) renderOver(lastOver);
  });

  socket.on('screen', (d) => {
    if (!d) return;
    if (d.vibrate) { try { navigator.vibrate?.(d.vibrate); } catch {} }
    if (d.toast) toast(d.toast);
    if (d.hud) renderHud(d.hud);
    switch (d.view) {
      case 'menu': lastMenu = d; lastOver = null; pad = null; show('menu'); renderMenu(); break;
      case 'airhockey': pad = d; lastOver = null; show('pad'); resizePad(); if (d.hud) renderHud(d.hud); break;
      case 'spectate': pad = null; showMsg('İzleyicisin 🍿', d.text); break;
      case 'gameover': pad = null; lastOver = d; renderOver(d); break;
    }
  });

  socket.on('screenLost', () => {
    joined = null; pad = null;
    showMsg('Ekran bağlantısı koptu', 'Ekranda yeni bir kod çıkınca onunla tekrar katıl.', [
      { text: 'Yeni kodla katıl', cls: 'btn block', onClick: () => { $('codeIn').value = ''; show('join'); } },
    ]);
  });

  // ---------- Görünümler ----------
  function show(name) {
    current = name;
    for (const v of ['join', 'menu', 'pad', 'msg']) $(v + 'View').classList.toggle('on', v === name);
  }

  function renderMenu() {
    const isMaster = role && role.master;
    $('menuTitle').style.display = isMaster ? '' : 'none';
    $('menu').style.display = isMaster ? '' : 'none';
    $('waitBox').style.display = isMaster ? 'none' : 'flex';
    if (!isMaster || !lastMenu) return;
    $('menu').innerHTML = '';
    for (const g of lastMenu.games) {
      const b = document.createElement('button');
      b.disabled = !g.available;
      b.innerHTML = `<span class="ic">${g.icon}</span><span><b style="font-size:18px">${g.name}</b><br><span class="muted">${g.available ? g.players : 'Yakında'}</span></span>`;
      b.onclick = () => { navigator.vibrate?.(15); socket.emit('input', { type: 'menu', game: g.id }); };
      $('menu').appendChild(b);
    }
  }

  function renderOver(d) {
    const btns = role && role.master ? [
      { text: '🔁 Tekrar oyna', cls: 'btn block', onClick: () => socket.emit('input', { type: 'action', name: 'restart' }) },
      { text: '🏠 Menüye dön', cls: 'btn ghost block', onClick: () => socket.emit('input', { type: 'action', name: 'menu' }) },
    ] : [];
    const parts = [];
    if (d.score) parts.push(`Skor ${d.score}`);
    if (!(role && role.master)) parts.push('Yönetici sıradaki adımı seçecek.');
    showMsg(d.text, parts.join(' · '), btns);
  }

  function showMsg(title, text, buttons = []) {
    $('msgTitle').textContent = title;
    $('msgText').textContent = text || '';
    $('msgButtons').innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = b.cls;
      el.style.padding = '18px';
      el.textContent = b.text;
      el.onclick = b.onClick;
      $('msgButtons').appendChild(el);
    }
    show('msg');
  }

  function renderHud(h) {
    $('hudScore').textContent = `Sen ${h.you} – ${h.opp} Rakip`;
    if (pad) $('hudOpp').textContent = `Rakip: ${pad.oppName}`;
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = 0; setTimeout(() => t.remove(), 400); }, 2500);
  }

  // ---------- Masa hokeyi dokunmatik pad ----------
  const canvas = $('pad');
  const ctx = canvas.getContext('2d');
  let rect = null;            // pad'in ekrandaki çizim alanı (CSS px)
  let finger = null;          // {x,y} 0..1
  let dirty = false;
  let activePointer = null;

  function resizePad() {
    if (current !== 'pad') return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Pad tüm alanı kullanır: büyük alan = daha hassas kontrol
    const topPad = 70, side = 14, bottom = 20;
    rect = { x: side, y: topPad, w: innerWidth - side * 2, h: innerHeight - topPad - bottom };
    drawPad();
  }
  addEventListener('resize', resizePad);

  function toNorm(e) {
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.x) / rect.w)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.y) / rect.h)),
    };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (activePointer !== null) return;
    activePointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    finger = toNorm(e); dirty = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer) return;
    // Birleştirilmiş olaylar yerine en son konumu kullan
    finger = toNorm(e); dirty = true;
  });
  const release = (e) => { if (e.pointerId === activePointer) activePointer = null; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  // Her karede en fazla bir konum paketi gönder (~60 Hz)
  function tick() {
    if (current === 'pad' && dirty && finger) {
      dirty = false;
      socket.volatile.emit('input', { type: 'move', x: +finger.x.toFixed(4), y: +finger.y.toFixed(4) });
      drawPad();
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function drawPad() {
    if (!rect || !pad) return;
    const { x, y, w, h } = rect;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    // Zemin
    ctx.fillStyle = '#0d1f38';
    roundRect(ctx, x, y, w, h, 22); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 3;
    roundRect(ctx, x, y, w, h, 22); ctx.stroke();
    // Kale (kendi kalen) ve orta çizgi
    const goalH = h * (290 / 900);
    const myGoalX = pad.side === 'left' ? x : x + w;
    const midX = pad.side === 'left' ? x + w : x;
    ctx.fillStyle = pad.color;
    ctx.fillRect(myGoalX - 4, y + h / 2 - goalH / 2, 8, goalH);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 4;
    ctx.setLineDash([10, 10]);
    ctx.beginPath(); ctx.moveTo(midX, y + 8); ctx.lineTo(midX, y + h - 8); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(midX, y + h / 2, w * 0.17, pad.side === 'left' ? Math.PI / 2 : -Math.PI / 2, pad.side === 'left' ? Math.PI * 1.5 : Math.PI / 2);
    ctx.stroke();
    // Yazılar
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('SENİN KALEN', myGoalX + (pad.side === 'left' ? 52 : -52), y + h / 2 + goalH / 2 + 20);
    ctx.fillText('ORTA ÇİZGİ', midX + (pad.side === 'left' ? -48 : 48), y + 26);
    // Tokaç
    const f = finger || { x: pad.side === 'left' ? 0.25 : 0.75, y: 0.5 };
    const r = Math.min(w, h) * 0.09;
    const mx = x + r + f.x * (w - 2 * r), my = y + r + f.y * (h - 2 * r);
    ctx.shadowColor = pad.color; ctx.shadowBlur = 24;
    ctx.fillStyle = pad.color;
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.beginPath(); ctx.arc(mx, my, r * 0.6, 0, Math.PI * 2); ctx.fill();
    if (!finger) {
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.fillText('Parmağını sürükle', x + w / 2, y + h - 24);
    }
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ---------- Ekranın kararmasını engelle ----------
  let wakeLock = null;
  async function keepAwake() {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && joined) keepAwake(); });
})();
