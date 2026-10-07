# Handelsklotet

Interactive globe for client events. All of Asia is highlighted, plus Sweden. Someone taps a country on an iPad, the country lifts off the globe as particles that fly up into the screen, and they build a panel. The panel shows the economy, trade, finance, e-commerce and the Sweden angle for that country. The UI is in Swedish.

| URL | Device | Contents |
|---|---|---|
| `/` | Laptop → TV/projector (fullscreen) | Globe and country panel |
| `/remote` | iPad | Map and country list, tabs, Close button |

## Stack

- **Vite + TypeScript**, no framework
- **three.js with a custom shader globe**: day/night textures, city lights, clouds, ocean reflection and atmosphere. Asia is highlighted via a mask texture (gold borders); no 3D country geometry is involved. Particles (5,000 with motion trails) are animated entirely on the GPU in the same WebGL canvas, and so are the twinkling stars.
- **Performance**: one WebGL canvas for globe, stars and particles; pixel ratio max 1.5 and lowered automatically if frames stay slow; rendering stops while the panel covers the globe; country selection uses a small raster (no polygon geometry, no heavy point-in-polygon sampling); no `backdrop-filter`.
- **Natural Earth 1:50m** for country borders (`public/data/world.topo.json`, built with `npm run geo`)
- **QR pairing, peer-to-peer.** The TV shows a QR code; scanning it opens `/remote#<id>` and the iPad connects directly to the TV over WebRTC (PeerJS; the free public PeerJS server only introduces the two devices, and its TURN relays are used if the venue Wi-Fi blocks device-to-device traffic). No database or backend. The QR hides while a controller is connected and comes back when it closes the page or drops (heartbeat, ~3–7 s). The TV keeps its id in `localStorage`, so a reloaded TV keeps the same QR and the iPad reconnects by itself.
- **Vercel** for hosting (`vercel.json`, clean URL `/remote`)

## Get started

```bash
npm install
npm run dev                  # http://localhost:5173  and  http://localhost:5173/remote
npm run build
```

Open `/` and scan the QR code (or open the link it encodes) on another device on the internet. Two tabs in the same browser also work via `BroadcastChannel`.

Keyboard on the display: `f` = fullscreen, `Esc` = close the panel. You can also click countries with the mouse.

## Event day

1. Laptop: open the URL in Chrome, press `f` for fullscreen and turn off sleep/screensaver.
2. iPad: scan the QR code in the corner of the TV with the camera and open the link. Optionally Share → "Add to Home Screen" from there (keeps the link) and turn on **Guided Access** (Settings → Accessibility) so clients can't leave the app.
3. The QR code disappears when the iPad is connected and the iPad shows "Ansluten". If the iPad closes the page or loses Wi-Fi, the QR code comes back; scanning again (or reopening the page) reconnects.
4. Optional, for offline robustness: run `npm run photos` before the build so the photos are bundled locally (see below).

## Content / data

All figures live in `src/data/countries.ts`, one object per country. To add a country, add an object. It becomes clickable automatically if its ISO code exists on the map.

> ⚠️ **The figures are compiled from public sources (IMF, World Bank, SCB etc.), rounded, and mostly from 2024. Verify and update them before the event.** Prioritise: policy rates, growth, Sweden's trade per country (SCB), and the e-commerce estimates. Exchange rates are fetched live from the ECB (frankfurter.dev) where available, otherwise an approximate static rate is shown.

Photos: one per country, fetched from Wikimedia Commons via the article in `photo.wiki`, with photographer and licence shown in the panel. `npm run photos` downloads them to `public/photos/` plus `credits.json`, which is then used instead of fetching live.

Logo: put the firm's logo at `public/logo.svg` and it shows at the bottom right.

## Security / data protection

- The app shows public macro data only. It stores no personal or client data and uses no cookies or tracking.
- Control requires the session id from the QR code (random, 48 bits); only someone who can see the TV can scan it, and the QR is hidden while a controller is connected. The id stays the same across TV reloads; clear the site's storage on the TV laptop to get a new one.
- Messages go directly between the devices over an encrypted WebRTC data channel; the PeerJS server only sees the session ids and IP addresses used to connect them.

## Credits

Borders: Natural Earth (public domain). Earth textures: NASA Blue Marble (public domain) and [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0), via the three.js / three-globe examples. Flags: [flag-icons](https://github.com/lipis/flag-icons) (MIT). Photos: Wikimedia Commons (licence shown per photo).
