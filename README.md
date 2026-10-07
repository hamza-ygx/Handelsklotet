# Handelsklotet

Interactive globe for client events. All of Asia is highlighted, plus Sweden. Someone taps a country on an iPad, the country lifts off the globe as particles that fly up into the screen, and they build a panel. The panel shows the economy, trade, finance, e-commerce and the Sweden angle for that country. The UI is in Swedish.

| URL | Device | Contents |
|---|---|---|
| `/` | Laptop → TV/projector (fullscreen) | Globe and country panel |
| `/remote` | iPad | Map and country list, tabs, Close button |

## Stack

- **Vite + TypeScript**, no framework
- **globe.gl / three.js** for the globe; a 2D canvas overlay handles the particles
- **Natural Earth 1:50m** for country borders (`public/data/world.topo.json`, built with `npm run geo`)
- **Supabase Realtime (broadcast)** syncs the iPad and the big screen. It needs no database tables. Without config, it falls back to `BroadcastChannel` (two tabs in the same browser, for testing).
- **Vercel** for hosting (`vercel.json`, clean URL `/remote`)

## Get started

```bash
npm install
cp .env.example .env.local   # fill in Supabase URL + publishable key + room name
npm run dev                  # http://localhost:5173  and  http://localhost:5173/remote
npm run build
```

Without `.env.local`, open `/` and `/remote` in two tabs of the **same** browser to test.

Keyboard on the display: `f` = fullscreen, `Esc` = close the panel. You can also click countries with the mouse.

## Event day

1. Laptop: open the URL in Chrome, press `f` for fullscreen and turn off sleep/screensaver.
2. iPad: open `/remote` → Share → "Add to Home Screen" so it runs without the browser chrome.
   Turn on **Guided Access** (Settings → Accessibility) so clients can't leave the app.
3. Check that the dot at the top right of the iPad says "Ansluten" (connected).
4. Optional, for offline robustness: run `npm run photos` before the build so the photos are bundled locally (see below).

## Content / data

All figures live in `src/data/countries.ts`, one object per country. To add a country, add an object. It becomes clickable automatically if its ISO code exists on the map.

> ⚠️ **The figures are compiled from public sources (IMF, World Bank, SCB etc.), rounded, and mostly from 2024. Verify and update them before the event.** Prioritise: policy rates, growth, Sweden's trade per country (SCB), and the e-commerce estimates. Exchange rates are fetched live from the ECB (frankfurter.dev) where available, otherwise an approximate static rate is shown.

Photos: one per country, fetched from Wikimedia Commons via the article in `photo.wiki`, with photographer and licence shown in the panel. `npm run photos` downloads them to `public/photos/` plus `credits.json`, which is then used instead of fetching live.

Logo: put the firm's logo at `public/logo.svg` and it shows at the bottom right.

## Security / data protection

- The app shows public macro data only. It stores no personal or client data and uses no cookies or tracking.
- Sync uses Supabase's **publishable** key, which is public by design. Anyone who knows the channel name (`VITE_ROOM`) and the key could in theory control the screen. Use a random room name for the event.

## Credits

Borders: Natural Earth (public domain). Flags: [flag-icons](https://github.com/lipis/flag-icons) (MIT). Photos: Wikimedia Commons (licence shown per photo).
