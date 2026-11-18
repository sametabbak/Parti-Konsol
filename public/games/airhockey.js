// Masa Hokeyi — ekranda çalışan oyun. Telefonlar dokunmatik pad gibi davranır:
// parmağın pad üzerindeki konumu, tokacın kendi yarı sahandaki konumuna birebir eşlenir.

const W = 1600, H = 900;          // mantıksal masa boyutu
const GOAL = 290;                 // kale ağzı yüksekliği
const PR = 26;                    // pak yarıçapı
const MR = 48;                    // tokaç yarıçapı
const WIN = 7;                    // kazanma skoru
const MAX_PUCK = 2700;            // pak hız sınırı (px/s)
const MAX_MALLET = 4200;          // tokaç hız sınırı
const FRICTION = 0.42;            // saniyede hız kaybı katsayısı
const SUBSTEPS = 6;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export default class AirHockey {
  constructor(api) {
    this.api = api;
    this.canvas = api.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.raf = null;
    this.onResize = () => this.resize();
    this.lastVibe = {};
  }

  // ---------- Yaşam döngüsü ----------
  start(players) {
    this.left = players[0];
    this.right = players[1];
    addEventListener('resize', this.onResize);
    this.resize();
    this.restart();
    this.last = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.033, (t - this.last) / 1000);
      this.last = t;
      if (dt > 0) this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  restart() {
    this.score = { left: 0, right: 0 };
    this.mallets = {
      left: { x: 220, y: H / 2, tx: 220, ty: H / 2, vx: 0, vy: 0 },
      right: { x: W - 220, y: H / 2, tx: W - 220, ty: H / 2, vx: 0, vy: 0 },
    };
    this.puck = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    this.trail = [];
    this.sparks = [];
    this.shake = 0;
    this.winner = null;
    this.setState('countdown', 3);
    this.sendViews();
  }

  stop() {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.onResize);
    clearTimeout(this.abortTimer);
  }

  setState(name, timer = 0) {
    this.state = name;
    this.timer = timer;
    this.lastCount = Math.ceil(timer);
  }

  sideOf(id) {
    if (this.left && this.left.id === id) return 'left';
    if (this.right && this.right.id === id) return 'right';
    return null;
  }

  sendViews() {
    for (const p of this.api.players()) {
      const side = this.sideOf(p.id);
      if (side) {
        const opp = side === 'left' ? this.right : this.left;
        this.api.send(p.id, {
          view: 'airhockey', side, color: p.color, oppName: opp.name, oppColor: opp.color,
          hud: { you: this.score[side], opp: this.score[side === 'left' ? 'right' : 'left'] },
        });
      } else {
        this.api.send(p.id, { view: 'spectate', text: `${this.left.name} ile ${this.right.name} oynuyor. Sıradaki maçı bekle!` });
      }
    }
  }

  sendHud() {
    for (const side of ['left', 'right']) {
      const p = this[side];
      this.api.send(p.id, { hud: { you: this.score[side], opp: this.score[side === 'left' ? 'right' : 'left'] } });
    }
  }

  onPlayersChanged(players) {
    const ids = new Set(players.map((p) => p.id));
    if (!ids.has(this.left.id) || !ids.has(this.right.id)) {
      if (this.state === 'abort') return;
      const gone = !ids.has(this.left.id) ? this.left : this.right;
      this.abortMsg = `${gone.name} oyundan ayrıldı`;
      this.setState('abort', 3);
      this.abortTimer = setTimeout(() => this.api.backToLobby(), 3000);
      return;
    }
    // Yeni gelenler izleyici olarak bilgilendirilir
    this.sendViews();
  }

  onInput(id, data) {
    const side = this.sideOf(id);
    if (!side || data.type !== 'move') return;
    const x = clamp(+data.x || 0, 0, 1);
    const y = clamp(+data.y || 0, 0, 1);
    const m = this.mallets[side];
    const half = W / 2;
    m.tx = (side === 'left' ? 0 : half) + MR + x * (half - 2 * MR);
    m.ty = MR + y * (H - 2 * MR);
  }

  // ---------- Fizik ----------
  update(dt) {
    this.shake = Math.max(0, this.shake - dt * 30);
    for (const s of this.sparks) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }
    this.sparks = this.sparks.filter((s) => s.life > 0);

    if (this.state === 'countdown') {
      this.timer -= dt;
      const c = Math.ceil(this.timer);
      if (c !== this.lastCount && c > 0) { this.lastCount = c; this.api.sfx.count(); }
      if (this.timer <= 0) this.setState('play');
    } else if (this.state === 'goal') {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.winner) {
          this.setState('over');
          this.api.sfx.win();
          for (const side of ['left', 'right']) {
            const p = this[side];
            const won = this.winner === side;
            this.api.send(p.id, { view: 'gameover', win: won, text: won ? 'Kazandın! 🏆' : 'Kaybettin', score: `${this.score[side]} – ${this.score[side === 'left' ? 'right' : 'left']}` });
            this.api.vibrate(p.id, won ? [80, 60, 80, 60, 200] : [400]);
          }
          for (const p of this.api.players()) {
            if (!this.sideOf(p.id)) this.api.send(p.id, { view: 'gameover', text: `${this[this.winner].name} kazandı!` });
          }
        } else {
          // Golü yiyen taraf servis atar
          this.puck = { x: this.concede === 'left' ? W * 0.3 : W * 0.7, y: H / 2, vx: 0, vy: 0 };
          this.trail = [];
          this.setState('play');
        }
      }
    }

    const h = dt / SUBSTEPS;
    for (let i = 0; i < SUBSTEPS; i++) {
      for (const side of ['left', 'right']) this.stepMallet(side, h);
      if (this.state === 'play' || this.state === 'goal') this.stepPuck(h);
    }

    if (this.state === 'play') {
      this.trail.push({ x: this.puck.x, y: this.puck.y });
      if (this.trail.length > 14) this.trail.shift();
    }
  }

  stepMallet(side, h) {
    const m = this.mallets[side];
    // Kendi yarı sahası dışına çıkamaz
    const minX = side === 'left' ? MR : W / 2 + MR;
    const maxX = side === 'left' ? W / 2 - MR : W - MR;
    const tx = clamp(m.tx, minX, maxX);
    const ty = clamp(m.ty, MR, H - MR);
    let dx = tx - m.x, dy = ty - m.y;
    const dist = Math.hypot(dx, dy);
    const maxStep = MAX_MALLET * h;
    if (dist > maxStep && dist > 0) { dx *= maxStep / dist; dy *= maxStep / dist; }
    m.x += dx; m.y += dy;
    // Hızı yumuşat (titreşen girdide ani sıçramaları azaltır)
    m.vx = m.vx * 0.5 + (dx / h) * 0.5;
    m.vy = m.vy * 0.5 + (dy / h) * 0.5;
    if (this.state === 'play') this.collide(side, m);
  }

  collide(side, m) {
    const p = this.puck;
    const dx = p.x - m.x, dy = p.y - m.y;
    const dist = Math.hypot(dx, dy);
    const minD = PR + MR;
    if (dist >= minD || dist === 0) return;
    const nx = dx / dist, ny = dy / dist;
    // Pakı tokacın dışına it
    p.x = m.x + nx * minD;
    p.y = m.y + ny * minD;
    // Göreli hız normal doğrultusunda içeri doğruysa yansıt (tokaç sonsuz kütleli)
    const rvx = p.vx - m.vx, rvy = p.vy - m.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const e = 0.92;
      p.vx -= (1 + e) * vn * nx;
      p.vy -= (1 + e) * vn * ny;
      const power = Math.min(1, -vn / 2200);
      this.api.sfx.hit(power);
      this.spark(p.x - nx * PR, p.y - ny * PR, this[side].color, 6 + power * 12);
      const now = performance.now();
      if (!this.lastVibe[side] || now - this.lastVibe[side] > 90) {
        this.lastVibe[side] = now;
        this.api.vibrate(this[side].id, Math.round(15 + power * 35));
      }
    }
    this.capPuck();
  }

  capPuck() {
    const p = this.puck;
    const s = Math.hypot(p.vx, p.vy);
    if (s > MAX_PUCK) { p.vx *= MAX_PUCK / s; p.vy *= MAX_PUCK / s; }
  }

  stepPuck(h) {
    const p = this.puck;
    const f = Math.exp(-FRICTION * h);
    p.vx *= f; p.vy *= f;
    p.x += p.vx * h;
    p.y += p.vy * h;

    const mouthTop = H / 2 - GOAL / 2, mouthBot = H / 2 + GOAL / 2;
    const inMouth = p.y > mouthTop + PR * 0.4 && p.y < mouthBot - PR * 0.4;

    // Üst / alt bant
    if (p.y < PR) { p.y = PR; p.vy = Math.abs(p.vy) * 0.9; this.bump(); }
    if (p.y > H - PR) { p.y = H - PR; p.vy = -Math.abs(p.vy) * 0.9; this.bump(); }

    // Sol / sağ bant (kale ağzı hariç)
    if (p.x < PR) {
      if (inMouth && this.state === 'play') {
        p.y = clamp(p.y, mouthTop + PR, mouthBot - PR);
        if (p.x < -PR) this.goal('right');
      } else if (this.state === 'play' || p.x >= 0) {
        p.x = PR; p.vx = Math.abs(p.vx) * 0.9; this.bump();
      }
    }
    if (p.x > W - PR) {
      if (inMouth && this.state === 'play') {
        p.y = clamp(p.y, mouthTop + PR, mouthBot - PR);
        if (p.x > W + PR) this.goal('left');
      } else if (this.state === 'play' || p.x <= W) {
        p.x = W - PR; p.vx = -Math.abs(p.vx) * 0.9; this.bump();
      }
    }
  }

  bump() {
    if (Math.hypot(this.puck.vx, this.puck.vy) > 120) this.api.sfx.wall();
  }

  goal(scorer) {
    this.score[scorer]++;
    this.concede = scorer === 'left' ? 'right' : 'left';
    this.lastScorer = scorer;
    this.puck.vx = this.puck.vy = 0;
    this.puck.x = scorer === 'left' ? W + 200 : -200;
    this.trail = [];
    this.shake = 14;
    this.api.sfx.goal();
    this.api.vibrate(this[scorer].id, [60, 50, 60]);
    this.api.vibrate(this[this.concede].id, [250]);
    if (this.score[scorer] >= WIN) this.winner = scorer;
    this.setState('goal', 1.4);
    this.sendHud();
    const gx = scorer === 'left' ? W : 0;
    for (let i = 0; i < 4; i++) this.spark(gx, H / 2 + (Math.random() - 0.5) * GOAL, this[scorer].color, 14);
  }

  spark(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 150 + Math.random() * 520;
      this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.25 + Math.random() * 0.35, color });
    }
  }

  // ---------- Çizim ----------
  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    this.dpr = dpr;
    this.canvas.width = Math.round(innerWidth * dpr);
    this.canvas.height = Math.round(innerHeight * dpr);
    const top = 110, pad = 40;
    const s = Math.min((innerWidth - pad * 2) / (W + 60), (innerHeight - top - pad) / (H + 60));
    this.view = { s, ox: (innerWidth - W * s) / 2, oy: top + (innerHeight - top - pad - H * s) / 2 };
  }

  draw() {
    const c = this.ctx, { s, ox, oy } = this.view, dpr = this.dpr;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#05070d';
    c.fillRect(0, 0, innerWidth, innerHeight);

    this.drawHud(c);

    const sh = this.shake ? (Math.random() - 0.5) * this.shake : 0;
    c.save();
    c.translate(ox + sh, oy + sh);
    c.scale(s, s);

    // Masa çerçevesi ve zemin
    const rr = 60;
    c.fillStyle = '#1a2440';
    roundRect(c, -26, -26, W + 52, H + 52, rr + 20); c.fill();
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0f2440'); g.addColorStop(1, '#0a1a30');
    c.fillStyle = g;
    roundRect(c, 0, 0, W, H, rr); c.fill();

    // Hava delikleri deseni
    c.fillStyle = 'rgba(255,255,255,0.05)';
    for (let x = 40; x < W; x += 40) for (let y = 40; y < H; y += 40) c.fillRect(x - 1.5, y - 1.5, 3, 3);

    // Çizgiler
    c.lineWidth = 6;
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.stroke();
    c.beginPath(); c.arc(W / 2, H / 2, 120, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 5;
    c.strokeStyle = this.left.color + '66';
    c.beginPath(); c.arc(0, H / 2, GOAL / 2 + 40, -Math.PI / 2, Math.PI / 2); c.stroke();
    c.strokeStyle = this.right.color + '66';
    c.beginPath(); c.arc(W, H / 2, GOAL / 2 + 40, Math.PI / 2, Math.PI * 1.5); c.stroke();

    // Kaleler
    for (const [side, x] of [['left', -26], ['right', W]]) {
      c.fillStyle = '#000';
      c.fillRect(x, H / 2 - GOAL / 2, 26, GOAL);
      c.fillStyle = this[side].color;
      c.shadowColor = this[side].color; c.shadowBlur = 24;
      c.fillRect(side === 'left' ? -4 : W - 2, H / 2 - GOAL / 2, 6, GOAL);
      c.shadowBlur = 0;
    }

    // Pak izi
    for (let i = 0; i < this.trail.length; i++) {
      const t = this.trail[i], a = i / this.trail.length;
      c.fillStyle = `rgba(180,230,255,${a * 0.18})`;
      c.beginPath(); c.arc(t.x, t.y, PR * (0.5 + a * 0.5), 0, Math.PI * 2); c.fill();
    }

    // Pak
    if (this.state === 'play' || this.state === 'countdown') {
      const p = this.puck;
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.beginPath(); c.arc(p.x + 5, p.y + 7, PR, 0, Math.PI * 2); c.fill();
      c.shadowColor = '#bfefff'; c.shadowBlur = 18;
      c.fillStyle = '#e9f6ff';
      c.beginPath(); c.arc(p.x, p.y, PR, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
      c.strokeStyle = '#9fb8cc'; c.lineWidth = 4;
      c.beginPath(); c.arc(p.x, p.y, PR * 0.6, 0, Math.PI * 2); c.stroke();
    }

    // Tokaçlar
    for (const side of ['left', 'right']) {
      const m = this.mallets[side], col = this[side].color;
      c.fillStyle = 'rgba(0,0,0,0.35)';
      c.beginPath(); c.arc(m.x + 6, m.y + 9, MR, 0, Math.PI * 2); c.fill();
      c.shadowColor = col; c.shadowBlur = 30;
      c.fillStyle = col;
      c.beginPath(); c.arc(m.x, m.y, MR, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.beginPath(); c.arc(m.x, m.y, MR * 0.62, 0, Math.PI * 2); c.fill();
      c.fillStyle = col;
      c.beginPath(); c.arc(m.x, m.y, MR * 0.42, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.beginPath(); c.arc(m.x - MR * 0.15, m.y - MR * 0.18, MR * 0.16, 0, Math.PI * 2); c.fill();
    }

    // Kıvılcımlar
    for (const sp of this.sparks) {
      c.globalAlpha = Math.min(1, sp.life * 3);
      c.fillStyle = sp.color;
      c.fillRect(sp.x - 3, sp.y - 3, 6, 6);
    }
    c.globalAlpha = 1;
    c.restore();

    this.drawOverlay(c);
  }

  drawHud(c) {
    const cx = innerWidth / 2;
    c.textBaseline = 'middle';
    c.font = '800 64px system-ui, sans-serif';
    c.textAlign = 'right';
    c.fillStyle = this.left.color;
    c.fillText(this.score.left, cx - 40, 58);
    c.textAlign = 'left';
    c.fillStyle = this.right.color;
    c.fillText(this.score.right, cx + 40, 58);
    c.textAlign = 'center';
    c.fillStyle = 'rgba(255,255,255,.4)';
    c.fillText(':', cx, 54);
    c.font = '700 26px system-ui, sans-serif';
    c.textAlign = 'right';
    c.fillStyle = '#eef2ff';
    c.fillText(this.left.name, cx - 120, 60);
    c.textAlign = 'left';
    c.fillText(this.right.name, cx + 120, 60);
    c.font = '500 15px system-ui, sans-serif';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(255,255,255,.4)';
    c.fillText(`${WIN} sayıya ilk ulaşan kazanır`, cx, 100);
  }

  drawOverlay(c) {
    const cx = innerWidth / 2, cy = this.view.oy + (H * this.view.s) / 2;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    if (this.state === 'countdown') {
      const n = Math.ceil(this.timer);
      const frac = this.timer - Math.floor(this.timer);
      c.globalAlpha = 0.4 + frac * 0.6;
      c.font = `900 ${150 + frac * 60}px system-ui, sans-serif`;
      c.fillStyle = '#fff';
      c.fillText(n > 0 ? n : '', cx, cy);
      c.globalAlpha = 1;
      c.font = '600 22px system-ui, sans-serif';
      c.fillStyle = 'rgba(255,255,255,.75)';
      c.fillText('Telefonunda parmağını kaydır: tokacın parmağını takip eder', cx, cy + 140);
    } else if (this.state === 'goal' && !this.winner) {
      c.font = '900 120px system-ui, sans-serif';
      c.fillStyle = this[this.lastScorer].color;
      c.shadowColor = this[this.lastScorer].color; c.shadowBlur = 40;
      c.fillText('GOL!', cx, cy);
      c.shadowBlur = 0;
    } else if (this.state === 'over' || (this.state === 'goal' && this.winner)) {
      c.fillStyle = 'rgba(5,7,13,.72)';
      c.fillRect(0, 0, innerWidth, innerHeight);
      const w = this[this.winner];
      c.font = '900 96px system-ui, sans-serif';
      c.fillStyle = w.color;
      c.shadowColor = w.color; c.shadowBlur = 40;
      c.fillText(`${w.name} kazandı!`, cx, cy - 40);
      c.shadowBlur = 0;
      c.font = '700 48px system-ui, sans-serif';
      c.fillStyle = '#fff';
      c.fillText(`${this.score.left} – ${this.score.right}`, cx, cy + 50);
      c.font = '500 22px system-ui, sans-serif';
      c.fillStyle = 'rgba(255,255,255,.7)';
      c.fillText('Yönetici telefonundan “Tekrar oyna” ya da “Menüye dön”ü seçebilir', cx, cy + 120);
    } else if (this.state === 'abort') {
      c.fillStyle = 'rgba(5,7,13,.72)';
      c.fillRect(0, 0, innerWidth, innerHeight);
      c.font = '800 54px system-ui, sans-serif';
      c.fillStyle = '#fff';
      c.fillText(this.abortMsg, cx, cy - 20);
      c.font = '500 24px system-ui, sans-serif';
      c.fillStyle = 'rgba(255,255,255,.7)';
      c.fillText('Lobiye dönülüyor…', cx, cy + 40);
    }
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
