import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { BY_ISO } from './data/countries';

export interface CountryProps {
  iso: string;
  name: string;
  hl: 0 | 1;
}
export type CountryFeature = Feature<Geometry, CountryProps> & { clickable: boolean };

export async function loadCountries(): Promise<CountryFeature[]> {
  const topo = await (await fetch('/data/world.topo.json')).json();
  const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry, CountryProps>;
  return fc.features
    .filter((f) => f.geometry)
    .map((f) => Object.assign(f, { clickable: BY_ISO.has(f.properties.iso) }));
}
