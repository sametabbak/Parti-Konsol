# PartiKonsol

Ekranın konsol, telefonun kumanda. AirConsole benzeri, tarayıcı tabanlı bir parti oyunu platformu.
İlk oyun: **Masa Hokeyi** (2 oyuncu).

## Çalıştırma

Node.js 18+ gerekir.

```bash
npm install
npm start
```

Konsolda iki adres görünür:

- `http://localhost:3000` → bilgisayarda/TV'de aç, **BAŞLA**'ya bas.
- `http://192.168.x.x:3000` → aynı Wi-Fi'deki telefonların erişeceği adres. QR kod otomatik olarak bu adresi gösterir.

Telefonlar QR'ı okutur ya da `/katil` adresini açıp 4 haneli kodu girer. İlk katılan oyuncu 👑 yöneticidir ve oyunu telefonundan seçer.

> Windows'ta telefonlar bağlanamıyorsa güvenlik duvarında 3000 portuna (Node.js) izin ver.

## Nasıl çalışır?

```
Telefon (controller.html) ──input──▶  Sunucu (Socket.IO)  ──input──▶  Ekran (screen.html)
Telefon ◀──screen (view, vibrate, hud)──  Sunucu  ◀──toController──  Ekran
```

- **Sunucu** (`server.js`) yalnızca oda açar (4 haneli kod) ve mesajları taşır. Oyun mantığı tamamen ekranda çalışır.
- **Ekran** (`public/js/screen.js`) lobiyi gösterir, oyunu yükler ve telefonlardan gelen girdileri oyuna iletir.
- **Telefon** (`public/js/controller.js`) ekrandan gelen `view` mesajına göre arayüzünü değiştirir (menü, dokunmatik pad, oyun sonu…).
- Konum paketleri `volatile` gönderilir: ağ yavaşlarsa eski konumlar birikmez, gecikme büyümez.

## Dosyalar

| Dosya | Görev |
|---|---|
| `server.js` | Express + Socket.IO, oda kodları, QR üretimi (`/api/qr`) |
| `public/index.html` | Ana sayfa (BAŞLA düğmesi, oyun listesi) |
| `public/screen.html`, `js/screen.js` | Büyük ekran: lobi, kod/QR, oyun yöneticisi |
| `public/controller.html`, `js/controller.js` | Telefon kumandası |
| `public/js/games.js` | Oyun kataloğu |
| `public/games/airhockey.js` | Masa hokeyi (fizik, çizim, skor) |
| `public/js/sfx.js` | Dosyasız ses efektleri (Web Audio) |

## Yeni oyun eklemek

1. `public/js/games.js` içine kayıt ekle (`available: true`).
2. `public/games/<id>.js` dosyasını yaz. Sınıfın şu metotları olmalı:
   - `constructor(api)` — `api.canvas`, `api.send(id, data)`, `api.sendAll(data)`, `api.vibrate(id, ms)`, `api.sfx`, `api.backToLobby()`
   - `start(players)`, `onInput(playerId, data)`, `onPlayersChanged(players)`, `restart()`, `stop()`
3. Telefonda yeni bir kumanda görünümü gerekiyorsa `controller.js` içindeki `switch (d.view)` bloğuna ekle.

## Yayına alma

Herhangi bir Node.js barındırıcısında çalışır (VPS, Render, Railway, Fly.io…). `PORT` ortam değişkeni desteklenir.
WebSocket desteği olan bir ortam gerekir; nginx arkasındaysa `Upgrade` başlıklarını iletmeyi unutma.
Telefonların titreşimi yalnızca Android'de çalışır (iOS Safari Vibration API'yi desteklemez).
