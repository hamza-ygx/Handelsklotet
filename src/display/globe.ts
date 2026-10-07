import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { geoArea, geoBounds, geoCentroid, geoContains, geoEquirectangular, geoPath } from 'd3-geo';
import type { CountryFeature } from '../geo';

export interface Pt {
  x: number;
  y: number;
}
interface Pov {
  lat: number;
  lng: number;
  dist: number;
  shift: number;
}

const IDLE_DIST = 3.55;
const IDLE_SHIFT = 0.12;
/** Sun direction in camera space: night side faces the viewer, day limb on the right. */
const SUN_VIEW = new Vector3(0.95, 0.35, -0.45).normalize();
const GOLD = new Color('#f5b94a');

const vert = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPos;
  void main() {
    vUv = uv;
    vNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const earthFrag = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uClouds;
  uniform sampler2D uMask;
  uniform sampler2D uSel;
  uniform vec3 uSun;
  uniform vec3 uGold;
  uniform float uGlow;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPos;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(vPos - cameraPosition);
    float sunOri = dot(uSun, n);
    float dayMix = smoothstep(-0.22, 0.45, sunOri);

    vec3 day = texture2D(uDay, vUv).rgb;
    vec3 night = pow(texture2D(uNight, vUv).rgb, vec3(1.15)) * vec3(3.4, 2.6, 1.7);
    vec3 brc = texture2D(uClouds, vUv).rgb;
    float clouds = smoothstep(0.55, 1.0, brc.b);

    vec3 color = mix(night, day, dayMix);
    color = mix(color, vec3(0.95), clouds * dayMix * 0.8);
    color *= 1.0 - clouds * (1.0 - dayMix) * 0.55;

    // Asia highlight: r = fill, g = borders. Selection: r = glow, g = hole.
    vec4 m = texture2D(uMask, vUv);
    vec4 s = texture2D(uSel, vUv);
    float lum = dot(color, vec3(0.299, 0.587, 0.114));
    lum = min(lum, 1.0);
    color = mix(color, uGold * (0.2 + lum * 1.5), m.r * 0.16 * dayMix);
    color += uGold * m.r * 0.022 * (1.0 - dayMix);
    color = mix(color, vec3(0.006, 0.012, 0.03), s.g * 0.9);
    color += uGold * (m.g * 0.75 + s.r * uGlow * 0.8);

    // atmosphere tint + ocean specular
    float fresnel = pow(1.0 + dot(viewDir, n), 2.0);
    float atmoMix = smoothstep(-0.5, 1.0, sunOri);
    vec3 atmo = mix(vec3(1.0, 0.5, 0.25), vec3(0.32, 0.62, 1.0), atmoMix);
    color = mix(color, atmo, fresnel * atmoMix * 0.6);
    vec3 refl = reflect(-uSun, n);
    float spec = pow(max(-dot(refl, viewDir), 0.0), 28.0) * (1.0 - brc.g) * (1.0 - clouds);
    color += spec * mix(vec3(1.0), atmo, fresnel) * 0.6;

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const atmoFrag = /* glsl */ `
  uniform vec3 uSun;
  varying vec3 vNormal;
  varying vec3 vPos;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(vPos - cameraPosition);
    float sunOri = dot(uSun, n);
    float atmoMix = smoothstep(-0.5, 1.0, sunOri);
    vec3 color = mix(vec3(1.0, 0.5, 0.25), vec3(0.32, 0.62, 1.0), smoothstep(0.0, 1.0, atmoMix));
    float edge = smoothstep(0.0, 0.5, dot(viewDir, n));
    float dayAlpha = smoothstep(-0.45, 0.15, sunOri);
    vec3 nightRim = vec3(0.12, 0.25, 0.55);
    gl_FragColor = vec4(mix(nightRim, color, dayAlpha), edge * (0.10 + dayAlpha * 0.9));
    #include <colorspace_fragment>
  }
`;

function latLngToVec(lat: number, lng: number, r = 1) {
  const la = (lat * Math.PI) / 180;
  const lo = (lng * Math.PI) / 180;
  return new Vector3(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function canvasTex(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  return { c, g: c.getContext('2d')!, tex };
}

export class GlobeView {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(35, 1, 0.05, 100);
  private earthMat: ShaderMaterial;
  private atmoMat: ShaderMaterial;
  private byIso = new Map<string, CountryFeature>();
  private clickable: CountryFeature[] = [];
  private sel = canvasTex(2048, 1024);
  private rings: Mesh[] = [];

  private pov: Pov = { lat: 30, lng: 82, dist: IDLE_DIST, shift: IDLE_SHIFT };
  private tween: { from: Pov; to: Pov; t0: number; ms: number; done: () => void } | null = null;
  private idle = true;
  private phase = 0;
  private paused = false;
  private last = performance.now();
  private glow = 0;
  private glowTarget = 0;
  private pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
  private slowFrames = 0;

  constructor(el: HTMLElement, features: CountryFeature[], onPick: (iso: string) => void) {
    for (const f of features) {
      this.byIso.set(f.properties.iso, f);
      if (f.clickable) this.clickable.push(f);
    }

    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = SRGBColorSpace;
    el.appendChild(this.renderer.domElement);

    const loader = new TextureLoader();
    const load = (url: string, srgb: boolean) => {
      const t = loader.load(url);
      if (srgb) t.colorSpace = SRGBColorSpace;
      t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      return t;
    };

    const mask = this.buildMask(features);
    this.earthMat = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: earthFrag,
      uniforms: {
        uDay: { value: load('/textures/day.jpg', true) },
        uNight: { value: load('/textures/night.jpg', true) },
        uClouds: { value: load('/textures/clouds.jpg', false) },
        uMask: { value: mask },
        uSel: { value: this.sel.tex },
        uSun: { value: new Vector3() },
        uGold: { value: new Vector3(GOLD.r, GOLD.g, GOLD.b) },
        uGlow: { value: 0 },
      },
    });
    this.scene.add(new Mesh(new SphereGeometry(1, 160, 80), this.earthMat));

    this.atmoMat = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: atmoFrag,
      uniforms: { uSun: { value: new Vector3() } },
      side: BackSide,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const atmo = new Mesh(new SphereGeometry(1.045, 96, 48), this.atmoMat);
    this.scene.add(atmo);

    for (const f of this.clickable.filter((f) => geoArea(f) < 0.0003)) {
      const [lng, lat] = geoCentroid(f);
      const ring = new Mesh(
        new RingGeometry(0.85, 1, 48),
        new MeshBasicMaterial({ color: GOLD, transparent: true, depthWrite: false, blending: AdditiveBlending }),
      );
      const p = latLngToVec(lat, lng, 1.004);
      ring.position.copy(p);
      ring.lookAt(p.clone().multiplyScalar(2));
      this.rings.push(ring);
      this.scene.add(ring);
    }

    this.renderer.domElement.addEventListener('click', (e) => {
      const hit = this.pick(e.clientX, e.clientY);
      if (hit) onPick(hit);
    });

    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame(this.tick);
  }

  private buildMask(features: CountryFeature[]): Texture {
    const W = 4096, H = 2048;
    const { g, tex } = canvasTex(W, H);
    const path = geoPath(geoEquirectangular().scale(W / (2 * Math.PI)).translate([W / 2, H / 2]), g);
    g.globalCompositeOperation = 'lighter';
    const hl = features.filter((f) => f.properties.hl);
    for (const f of hl) {
      g.beginPath();
      path(f);
      g.fillStyle = f.clickable ? 'rgb(255,0,0)' : 'rgb(90,0,0)';
      g.fill();
    }
    g.lineJoin = 'round';
    for (const [width, alphaClick, alphaOther] of [[7, 0.16, 0.05], [2.2, 1, 0.32]] as const) {
      g.lineWidth = width;
      for (const f of hl) {
        g.beginPath();
        path(f);
        g.strokeStyle = `rgba(0,255,0,${f.clickable ? alphaClick : alphaOther})`;
        g.stroke();
      }
    }
    tex.generateMipmaps = true;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    return tex;
  }

  private drawSel(iso: string | null, mode: 'glow' | 'hole') {
    const { c, g, tex } = this.sel;
    g.clearRect(0, 0, c.width, c.height);
    const f = iso ? this.byIso.get(iso) : null;
    if (f) {
      const path = geoPath(geoEquirectangular().scale(c.width / (2 * Math.PI)).translate([c.width / 2, c.height / 2]), g);
      g.beginPath();
      path(f);
      g.fillStyle = mode === 'glow' ? 'rgb(255,0,0)' : 'rgb(0,255,0)';
      g.fill();
      if (geoArea(f) < 0.0003) {
        const [lng, lat] = geoCentroid(f);
        g.beginPath();
        g.arc(((lng + 180) / 360) * c.width, ((90 - lat) / 180) * c.height, 4, 0, Math.PI * 2);
        g.fill();
      }
    }
    tex.needsUpdate = true;
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.applyCamera();
  }

  private swayAt(phase: number): Pov {
    return {
      lng: 84 + 30 * Math.sin(phase * 0.06),
      lat: 28 + 7 * Math.sin(phase * 0.037),
      dist: IDLE_DIST,
      shift: IDLE_SHIFT,
    };
  }

  private applyCamera() {
    const { lat, lng, dist, shift } = this.pov;
    this.camera.position.copy(latLngToVec(lat, lng, dist));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.setViewOffset(w, h, -shift * w, 0, w, h);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    const sun = SUN_VIEW.clone().transformDirection(this.camera.matrixWorld);
    this.earthMat.uniforms.uSun.value.copy(sun);
    this.atmoMat.uniforms.uSun.value.copy(sun);
  }

  private tick = (now: number) => {
    requestAnimationFrame(this.tick);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.paused) return;
    this.adaptQuality(dt);

    if (this.tween) {
      const { from, to, t0, ms, done } = this.tween;
      const t = Math.min(1, (now - t0) / ms);
      const e = easeInOut(t);
      const dLng = ((to.lng - from.lng + 540) % 360) - 180;
      this.pov = {
        lat: from.lat + (to.lat - from.lat) * e,
        lng: from.lng + dLng * e,
        dist: from.dist + (to.dist - from.dist) * e,
        shift: from.shift + (to.shift - from.shift) * e,
      };
      if (t >= 1) {
        this.tween = null;
        done();
      }
    } else if (this.idle) {
      this.phase += dt;
      this.pov = this.swayAt(this.phase);
    }

    this.glow += (this.glowTarget - this.glow) * Math.min(1, dt * 8);
    this.earthMat.uniforms.uGlow.value = this.glow;
    const pulse = (now / 1600) % 1;
    for (const r of this.rings) {
      r.scale.setScalar(0.004 + pulse * 0.03);
      (r.material as MeshBasicMaterial).opacity = 1 - pulse;
    }
    this.applyCamera();
    this.renderer.render(this.scene, this.camera);
  };

  /** Weak GPU safety net: drop render resolution if frames stay slow. */
  private adaptQuality(dt: number) {
    if (this.pixelRatio <= 0.75) return;
    this.slowFrames = dt > 0.028 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 90) {
      this.slowFrames = 0;
      this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
    }
  }

  private animateTo(to: Pov, ms: number) {
    return new Promise<void>((resolve) => {
      this.tween = { from: { ...this.pov }, to, t0: performance.now(), ms, done: resolve };
    });
  }

  private pick(x: number, y: number): string | null {
    const ndc = new Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    const origin = this.camera.position.clone();
    const dir = new Vector3(ndc.x, ndc.y, 0.5).unproject(this.camera).sub(origin).normalize();
    const b = origin.dot(dir);
    const c = origin.lengthSq() - 1;
    const disc = b * b - c;
    if (disc < 0) return null;
    const p = origin.add(dir.multiplyScalar(-b - Math.sqrt(disc)));
    const lat = (Math.asin(p.y) * 180) / Math.PI;
    const lng = (Math.atan2(-p.z, p.x) * 180) / Math.PI;
    return this.clickable.find((f) => geoContains(f, [lng, lat]))?.properties.iso ?? null;
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.last = performance.now();
  }

  focus(iso: string, ms = 1300): Promise<void> {
    const f = this.byIso.get(iso);
    if (!f) return Promise.resolve();
    this.idle = false;
    const [lng, lat] = geoCentroid(f);
    const dist = Math.min(3.1, Math.max(1.75, 1.55 + Math.sqrt(geoArea(f)) * 3.4));
    return this.animateTo({ lat, lng, dist, shift: 0 }, ms);
  }

  /** Brief gold glow on the country before it leaves the map. */
  lift(iso: string | null) {
    if (!iso) {
      this.glowTarget = 0;
      return Promise.resolve();
    }
    this.drawSel(iso, 'glow');
    this.glow = 0;
    this.glowTarget = 1;
    return new Promise<void>((r) => setTimeout(r, 450));
  }

  hide(iso: string | null) {
    this.glowTarget = 0;
    this.glow = 0;
    this.drawSel(iso, 'hole');
  }

  release(ms = 1800) {
    return this.animateTo(this.swayAt(this.phase), ms).then(() => {
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

    const cam = this.camera.position;
    const w2 = window.innerWidth / 2, h2 = window.innerHeight / 2;
    const out: Pt[] = [];
    for (const [lng, lat] of pts) {
      const p = latLngToVec(lat, lng, 1.01);
      if (p.clone().normalize().dot(cam.clone().sub(p)) <= 0) continue;
      p.project(this.camera);
      out.push({ x: (p.x + 1) * w2, y: (1 - p.y) * h2 });
    }
    return out;
  }
}

export function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
