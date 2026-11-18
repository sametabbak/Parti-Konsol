// Dosya gerektirmeyen küçük ses efektleri (Web Audio ile üretilir).
let ctx = null;

export function unlockAudio() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {}
}

function tone({ freq = 440, to = null, dur = 0.08, type = 'square', vol = 0.15, delay = 0 }) {
  if (!ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

let lastHit = 0;
export const sfx = {
  hit(power = 0.5) {
    const now = performance.now();
    if (now - lastHit < 40) return;
    lastHit = now;
    tone({ freq: 380 + power * 500, to: 180, dur: 0.07, type: 'triangle', vol: 0.12 + power * 0.18 });
  },
  wall() { tone({ freq: 240, to: 140, dur: 0.05, type: 'triangle', vol: 0.08 }); },
  goal() { [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'square', vol: 0.1, delay: i * 0.09 })); },
  join() { tone({ freq: 660, to: 990, dur: 0.12, type: 'sine', vol: 0.12 }); },
  win() { [523, 659, 784, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.2, type: 'square', vol: 0.1, delay: i * 0.13 })); },
  count() { tone({ freq: 880, dur: 0.09, type: 'sine', vol: 0.12 }); },
};
