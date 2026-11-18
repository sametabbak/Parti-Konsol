// Oyun kataloğu. Yeni bir oyun eklerken buraya kayıt ekleyip
// public/games/<id>.js dosyasını yazman yeterli (bkz. airhockey.js).
export const GAMES = [
  {
    id: 'airhockey', name: 'Masa Hokeyi', icon: '🏒', players: '2 oyuncu · telefonun dokunmatik pad olur',
    min: 2, max: 2, available: true,
    bg: 'linear-gradient(135deg,#0f3b5c,#1a6f9e)',
  },
  { id: 'pong', name: 'Pong', icon: '🏓', players: '2 oyuncu', min: 2, max: 2, available: false, bg: 'linear-gradient(135deg,#3b1d5c,#6d2f9e)' },
  { id: 'snake', name: 'Yılan Arenası', icon: '🐍', players: '2–8 oyuncu', min: 2, max: 8, available: false, bg: 'linear-gradient(135deg,#17502e,#2c8f52)' },
  { id: 'quiz', name: 'Bilgi Yarışması', icon: '❓', players: '1–8 oyuncu', min: 1, max: 8, available: false, bg: 'linear-gradient(135deg,#5c3a10,#a8651c)' },
];
