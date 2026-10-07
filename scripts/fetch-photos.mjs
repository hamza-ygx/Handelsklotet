// Downloads one Wikimedia Commons photo per country into public/photos/ and writes credits.json,
// so the event build does not depend on Wikipedia at runtime. Run locally: npm run photos
import fs from 'node:fs/promises';
import path from 'node:path';

const UA = 'Handelsklotet/1.0 (event presentation; photo prefetch)';
const src = await fs.readFile('src/data/countries.ts', 'utf8');
const entries = [...src.matchAll(/iso: '([A-Z]{2})'[\s\S]*?photo: \{ wiki: (['"])(.+?)\2/g)].map((m) => ({ iso: m[1], wiki: m[3] }));

const get = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r;
};
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const q = new URLSearchParams({ action: 'query', format: 'json', prop: 'pageimages', piprop: 'name', redirects: '1', titles: entries.map((e) => e.wiki).join('|') });
const pages = await (await get(`https://en.wikipedia.org/w/api.php?${q}`)).json();
const alias = {};
for (const r of [...(pages.query.normalized ?? []), ...(pages.query.redirects ?? [])]) alias[r.from] = r.to;
const fileByTitle = {};
for (const p of Object.values(pages.query.pages)) if (p.pageimage) fileByTitle[p.title] = p.pageimage;

const files = [...new Set(Object.values(fileByTitle))];
const q2 = new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '1600', titles: files.map((f) => `File:${f}`).join('|') });
const info = await (await get(`https://commons.wikimedia.org/w/api.php?${q2}`)).json();
const byFile = {};
for (const p of Object.values(info.query.pages)) {
  const ii = p.imageinfo?.[0];
  if (!ii) continue;
  const m = ii.extmetadata ?? {};
  byFile[p.title.replace(/^File:/, '').replace(/ /g, '_')] = {
    url: ii.thumburl || ii.url,
    credit: `Foto: ${m.Artist ? strip(m.Artist.value) : 'Okänd'}${m.LicenseShortName ? `, ${m.LicenseShortName.value}` : ''} / Wikimedia Commons`,
  };
}

await fs.mkdir('public/photos', { recursive: true });
const credits = {};
for (const e of entries) {
  let t = e.wiki;
  while (alias[t]) t = alias[t];
  const f = fileByTitle[t];
  const meta = f && byFile[f.replace(/ /g, '_')];
  if (!meta) {
    console.warn(`! ${e.iso}: no image for "${e.wiki}"`);
    continue;
  }
  const ext = path.extname(new URL(meta.url).pathname) || '.jpg';
  const out = `public/photos/${e.iso.toLowerCase()}${ext}`;
  await fs.writeFile(out, Buffer.from(await (await get(meta.url)).arrayBuffer()));
  credits[e.iso] = { src: `/photos/${e.iso.toLowerCase()}${ext}`, credit: meta.credit };
  console.log(`✓ ${e.iso} ${out}`);
}
await fs.writeFile('public/photos/credits.json', JSON.stringify(credits, null, 2));
console.log(`Saved ${Object.keys(credits).length}/${entries.length} photos`);
