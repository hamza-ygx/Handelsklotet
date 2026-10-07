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
- **Sync via Upstash Redis.** The iPad posts commands to `/api/sync` (a Vercel function), and the display polls about 4×/s. The Redis token stays server-side; the app only stores the latest commands and display state (6 h TTL). Without Redis it falls back to `BroadcastChannel` (two tabs in the same browser, for testing).
- **Vercel** for hosting (`vercel.json`, clean URL `/remote`)

## Get started

```bash
npm install
npm run dev                  # http://localhost:5173  and  http://localhost:5173/remote
npx vercel dev               # with /api + Redis locally (needs env vars, see .env.example)
npm run build
```

With `npm run dev` (no `/api`), open `/` and `/remote` in two tabs of the **same** browser to test.

**Redis on Vercel:** Vercel → Project → Storage/Marketplace → Upstash Redis → Connect (sets `KV_REST_API_URL`/`KV_REST_API_TOKEN`), or set `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` manually. Redeploy. The app detects Redis automatically.

Keyboard on the display: `f` = fullscreen, `Esc` = close the panel. You can also click countries with the mouse.

## Event day

1. Laptop: open the URL in Chrome, press `f` for fullscreen and turn off sleep/screensaver.
2. iPad: open `/remote` → Share → "Add to Home Screen" so it runs without the browser chrome.
   Turn on **Guided Access** (Settings → Accessibility) so clients can't leave the app.
3. Check that the dot at the top right of the iPad says "Ansluten" (connected). On the display, the small dot at the top right is green when Redis sync is active, orange in local mode.
4. Optional, for offline robustness: run `npm run photos` before the build so the photos are bundled locally (see below).

## Content / data

All figures live in `src/data/countries.ts`, one object per country. To add a country, add an object. It becomes clickable automatically if its ISO code exists on the map.

> ⚠️ **The figures are compiled from public sources (IMF, World Bank, SCB etc.), rounded, and mostly from 2024. Verify and update them before the event.** Prioritise: policy rates, growth, Sweden's trade per country (SCB), and the e-commerce estimates. Exchange rates are fetched live from the ECB (frankfurter.dev) where available, otherwise an approximate static rate is shown.

Photos: one per country, fetched from Wikimedia Commons via the article in `photo.wiki`, with photographer and licence shown in the panel. `npm run photos` downloads them to `public/photos/` plus `credits.json`, which is then used instead of fetching live.

Logo: put the firm's logo at `public/logo.svg` and it shows at the bottom right.

## Security / data protection

- The app shows public macro data only. It stores no personal or client data and uses no cookies or tracking.
- The Redis token is only in Vercel's server environment, never in the browser. `/api/sync` validates every message (country code, tab, state).
- The URL has no login (by choice: fixed URL, no pairing). Anyone who knows the URL could control the screen, so set a random `VITE_ROOM` for the event and don't share the `/remote` link.

## Credits

Borders: Natural Earth (public domain). Earth textures: NASA Blue Marble (public domain) and [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0), via the three.js / three-globe examples. Flags: [flag-icons](https://github.com/lipis/flag-icons) (MIT). Photos: Wikimedia Commons (licence shown per photo).
