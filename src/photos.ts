import { COUNTRIES } from './data/countries';

export interface Photo {
  src: string;
  credit: string;
}

const cache = new Map<string, Photo>();

function stripHtml(s: string) {
  const d = document.createElement('div');
  d.innerHTML = s;
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

async function loadBaked() {
  try {
    const r = await fetch('/photos/credits.json');
    if (!r.ok) return false;
    const j = (await r.json()) as Record<string, Photo>;
    for (const [iso, p] of Object.entries(j)) cache.set(iso, p);
    return cache.size > 0;
  } catch {
    return false;
  }
}

async function loadFromWikimedia() {
  const titles = COUNTRIES.map((c) => c.photo.wiki);
  const q = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', prop: 'pageimages', piprop: 'name', redirects: '1',
    titles: titles.join('|'),
  });
  const pages = await (await fetch(`https://en.wikipedia.org/w/api.php?${q}`)).json();
  const redirects: Record<string, string> = {};
  for (const r of pages.query?.redirects ?? []) redirects[r.from] = r.to;
  for (const n of pages.query?.normalized ?? []) redirects[n.from] = n.to;
  const fileByTitle: Record<string, string> = {};
  for (const p of Object.values<any>(pages.query?.pages ?? {})) if (p.pageimage) fileByTitle[p.title] = p.pageimage;

  const files = [...new Set(Object.values(fileByTitle))];
  if (!files.length) return;
  const q2 = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1600',
    titles: files.map((f) => `File:${f}`).join('|'),
  });
  const info = await (await fetch(`https://commons.wikimedia.org/w/api.php?${q2}`)).json();
  const byFile: Record<string, Photo> = {};
  for (const p of Object.values<any>(info.query?.pages ?? {})) {
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    const m = ii.extmetadata ?? {};
    const artist = m.Artist ? stripHtml(m.Artist.value) : 'Okänd';
    const lic = m.LicenseShortName?.value ?? '';
    byFile[p.title.replace(/^File:/, '').replace(/ /g, '_')] = {
      src: ii.thumburl || ii.url,
      credit: `Foto: ${artist}${lic ? `, ${lic}` : ''} / Wikimedia Commons`,
    };
  }
  for (const c of COUNTRIES) {
    let t = c.photo.wiki;
    while (redirects[t]) t = redirects[t];
    const f = fileByTitle[t];
    const photo = f && byFile[f.replace(/ /g, '_')];
    if (photo) cache.set(c.iso, photo);
  }
}

export async function loadPhotos() {
  try {
    if (!(await loadBaked())) await loadFromWikimedia();
  } catch (e) {
    console.warn('Photos unavailable', e);
  }
  for (const p of cache.values()) {
    const img = new Image();
    img.src = p.src;
  }
}

export function photoFor(iso: string): Photo | undefined {
  return cache.get(iso);
}
