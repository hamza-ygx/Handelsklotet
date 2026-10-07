import Globe, { type GlobeInstance } from 'globe.gl';
import { MeshPhongMaterial, Color, Vector3 } from 'three';
import { geoArea, geoBounds, geoCentroid, geoContains } from 'd3-geo';
import type { CountryFeature } from '../geo';

export interface Pt {
  x: number;
  y: number;
}

const IDLE_ALT = 2.15;
const LIFT_ALT = 0.07;

const C = {
  cap: 'rgba(250, 196, 92, 0.88)',
  capDim: 'rgba(214, 150, 50, 0.42)',
  capOther: 'rgba(120, 150, 200, 0.07)',
  side: 'rgba(242, 184, 75, 0.25)',
  stroke: 'rgba(255, 240, 210, 0.95)',
  strokeDim: 'rgba(255, 222, 160, 0.35)',
  strokeOther: 'rgba(150, 180, 230, 0.16)',
  hidden: 'rgba(0, 0, 0, 0)',
};

export class GlobeView {
  readonly globe: GlobeInstance;
  private byIso = new Map<string, CountryFeature>();
  private hidden: string | null = null;
  private lifted: string | null = null;
  private idle = true;
  private phase = 0;
  private last = performance.now();

  constructor(el: HTMLElement, features: CountryFeature[], onPick: (iso: string) => void) {
    for (const f of features) this.byIso.set(f.properties.iso, f);

    this.globe = new Globe(el, { rendererConfig: { antialias: true, alpha: true } })
      .backgroundColor('rgba(0,0,0,0)')
      .globeMaterial(new MeshPhongMaterial({ color: new Color('#0a1830'), emissive: new Color('#050d1c'), shininess: 6 }))
      .showAtmosphere(true)
      .atmosphereColor('#4f9dff')
      .atmosphereAltitude(0.2)
      .polygonsData(features)
      .polygonsTransitionDuration(450)
      .polygonAltitude((d) => this.altitude(d as CountryFeature))
      .polygonCapColor((d) => this.capColor(d as CountryFeature))
      .polygonSideColor((d) => this.sideColor(d as CountryFeature))
      .polygonStrokeColor((d) => this.strokeColor(d as CountryFeature))
      .polygonLabel(() => '')
      .onPolygonClick((d) => {
        const f = d as CountryFeature;
        if (f.clickable) onPick(f.properties.iso);
      })
      .ringsData(
        features
          .filter((f) => f.clickable && geoArea(f) < 0.0003)
          .map((f) => {
            const [lng, lat] = geoCentroid(f);
            return { lat, lng };
          }),
      )
      .ringColor(() => (t: number) => `rgba(242,184,75,${1 - t})`)
      .ringMaxRadius(2.2)
      .ringPropagationSpeed(1.4)
      .ringRepeatPeriod(1600)
      .showPointerCursor((type, d) => type === 'polygon' && !!(d as CountryFeature)?.clickable);

    const controls = this.globe.controls();
    controls.enabled = false;

    this.globe.pointOfView(this.swayAt(0), 0);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame(this.tick);
  }

  private resize() {
    this.globe.width(window.innerWidth).height(window.innerHeight);
  }

  private swayAt(phase: number) {
    return {
      lng: 82 + 34 * Math.sin(phase * 0.06),
      lat: 30 + 7 * Math.sin(phase * 0.037),
      altitude: IDLE_ALT,
    };
  }

  private tick = (now: number) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.idle) {
      this.phase += dt;
      this.globe.pointOfView(this.swayAt(this.phase), 0);
    }
    requestAnimationFrame(this.tick);
  };

  private altitude(f: CountryFeature) {
    if (f.properties.iso === this.lifted) return LIFT_ALT;
    if (f.clickable) return 0.014;
    return f.properties.hl ? 0.009 : 0.004;
  }
  private capColor(f: CountryFeature) {
    if (f.properties.iso === this.hidden) return C.hidden;
    if (f.clickable) return C.cap;
    return f.properties.hl ? C.capDim : C.capOther;
  }
  private sideColor(f: CountryFeature) {
    if (f.properties.iso === this.hidden) return C.hidden;
    return f.properties.hl ? C.side : C.hidden;
  }
  private strokeColor(f: CountryFeature) {
    if (f.properties.iso === this.hidden) return C.strokeDim;
    if (f.clickable) return C.stroke;
    return f.properties.hl ? C.strokeDim : C.strokeOther;
  }

  private refresh() {
    const g = this.globe;
    g.polygonAltitude((d) => this.altitude(d as CountryFeature))
      .polygonCapColor((d) => this.capColor(d as CountryFeature))
      .polygonSideColor((d) => this.sideColor(d as CountryFeature))
      .polygonStrokeColor((d) => this.strokeColor(d as CountryFeature));
  }

  focus(iso: string, ms = 1100): Promise<void> {
    const f = this.byIso.get(iso);
    if (!f) return Promise.resolve();
    this.idle = false;
    const [lng, lat] = geoCentroid(f);
    const altitude = Math.min(2.2, 0.75 + Math.sqrt(geoArea(f)) * 2.4);
    this.globe.pointOfView({ lat, lng, altitude }, ms);
    return wait(ms);
  }

  lift(iso: string | null) {
    this.lifted = iso;
    this.refresh();
    return wait(iso ? 420 : 0);
  }

  hide(iso: string | null) {
    this.hidden = iso;
    this.refresh();
  }

  release(ms = 1600) {
    this.globe.pointOfView(this.swayAt(this.phase), ms);
    return wait(ms).then(() => {
      this.idle = true;
    });
  }

  sample(iso: string, n: number): Pt[] {
    const f = this.byIso.get(iso);
    if (!f) return [];
    const [[x0, y0], [x1, y1]] = geoBounds(f);
    const w = x1 >= x0 ? x1 - x0 : x1 + 360 - x0;
    const pts: [number, number][] = [];
    for (let i = 0; i < 60000 && pts.length < n; i++) {
      let lng = x0 + Math.random() * w;
      if (lng > 180) lng -= 360;
      const lat = y0 + Math.random() * (y1 - y0);
      if (geoContains(f, [lng, lat])) pts.push([lng, lat]);
    }
    if (pts.length < n / 4) {
      const [cl, ca] = geoCentroid(f);
      const r = Math.max(0.15, Math.sqrt(geoArea(f)) * 20);
      while (pts.length < n) pts.push([cl + (Math.random() - 0.5) * r, ca + (Math.random() - 0.5) * r]);
    }

    const cam = this.globe.camera().position;
    const out: Pt[] = [];
    const p = new Vector3();
    for (const [lng, lat] of pts) {
      const c = this.globe.getCoords(lat, lng, LIFT_ALT);
      p.set(c.x, c.y, c.z);
      const facing = p.clone().normalize().dot(cam.clone().sub(p));
      if (facing <= 0) continue;
      out.push(this.globe.getScreenCoords(lat, lng, LIFT_ALT));
    }
    return out;
  }
}

export function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
