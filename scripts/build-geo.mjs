import fs from 'node:fs';
import { topology } from 'topojson-server';
import { feature } from 'topojson-client';
import { presimplify, simplify, quantile } from 'topojson-simplify';

const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/build-geo.mjs <ne_50m_admin_0_countries.geojson>');
  process.exit(1);
}

const EXCLUDE = new Set(['ATA']);
const NOT_ASIA = new Set(['IOA', 'KAS', 'CYN']);
const EXTRA_HIGHLIGHT = new Set(['RU', 'SE']);

const geo = JSON.parse(fs.readFileSync(src, 'utf8'));
const features = geo.features
  .filter((f) => !EXCLUDE.has(f.properties.ADM0_A3))
  .map((f) => {
    const p = f.properties;
    const iso = p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : p.ADM0_A3;
    const asia = (p.CONTINENT === 'Asia' && !NOT_ASIA.has(p.ADM0_A3)) || EXTRA_HIGHLIGHT.has(iso);
    return {
      type: 'Feature',
      id: iso,
      properties: { iso, name: p.NAME_SV || p.NAME, hl: asia ? 1 : 0 },
      geometry: f.geometry,
    };
  });

let topo = topology({ countries: { type: 'FeatureCollection', features } }, 1e5);
topo = presimplify(topo);
topo = simplify(topo, quantile(topo, 0.3));
const simplified = feature(topo, topo.objects.countries);
topo = topology({ countries: simplified }, 1e4);
fs.writeFileSync('public/data/world.topo.json', JSON.stringify(topo));
console.log('features', features.length, 'highlighted', features.filter((f) => f.properties.hl).length,
  'bytes', fs.statSync('public/data/world.topo.json').size);
