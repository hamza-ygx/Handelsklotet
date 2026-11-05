import { feature } from 'topojson-client';
import { geoArea, geoCentroid, geoDistance } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry, Polygon } from 'geojson';
import { BY_ISO } from './data/countries';

export interface CountryProps {
  iso: string;
  name: string;
  hl: 0 | 1;
}
export type CountryFeature = Feature<Geometry, CountryProps> & {
  clickable: boolean;
  /** Core landmass only (drops far-away overseas parts such as French Guiana or Jan Mayen). */
  main: Feature<Geometry, CountryProps>;
};

const MAIN_RADIUS = (25 * Math.PI) / 180;

function mainPart(f: Feature<Geometry, CountryProps>): Feature<Geometry, CountryProps> {
  if (f.geometry.type !== 'MultiPolygon') return f;
  const polys = f.geometry.coordinates.map((coordinates) => ({ type: 'Polygon', coordinates }) as Polygon);
  const largest = polys.reduce((a, b) => (geoArea(b) > geoArea(a) ? b : a));
  const center = geoCentroid(largest);
  const kept = polys.filter((p) => geoDistance(geoCentroid(p), center) < MAIN_RADIUS);
  return { ...f, geometry: { type: 'MultiPolygon', coordinates: kept.map((p) => p.coordinates) } };
}

export async function loadCountries(): Promise<CountryFeature[]> {
  const topo = await (await fetch('/data/world.topo.json')).json();
  const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, CountryProps>;
  return fc.features
    .filter((f) => f.geometry)
    .map((f) => Object.assign(f, { clickable: BY_ISO.has(f.properties.iso), main: mainPart(f) }));
}
