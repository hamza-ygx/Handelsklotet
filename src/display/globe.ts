import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  LinearFilter,
  LinearMipmapLinearFilter,
  LoadingManager,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  RepeatWrapping,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import { geoArea, geoBounds, geoCentroid, geoContains, geoEquirectangular, geoPath } from 'd3-geo';
import type { CountryFeature } from '../geo';
import { ParticleLayer, type Pt } from './particles';

export type { Pt };

interface Pov {
  lat: number;
  lng: number;
  dist: number;
  shift: number;
}
interface Raster {
  iso: string;
  canvas: HTMLCanvasElement;
  lon0: number;
  lat0: number;
  lon1: number;
  lat1: number;
}

const IDLE_DIST = 3.55;
const IDLE_SHIFT = 0.12;
/** Sun direction in camera space: night side faces the viewer, day limb on the right. */
const SUN_VIEW = new Vector3(0.95, 0.35, -0.45).normalize();
const GOLD = new Color('#f5b94a');
const TINY = 0.0003;

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

const starVert = /* glsl */ `
  attribute vec2 aStar; // size, phase
  uniform float uTime;
  uniform float uDpr;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.65 + 0.35 * sin(uTime * (0.6 + aStar.y * 1.4) + aStar.y * 40.0);
    gl_PointSize = aStar.x * uDpr * (0.85 + 0.15 * tw);
    vA = tw * (0.35 + aStar.x * 0.25);
  }
`;
const starFrag = /* glsl */ `
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(vec3(0.86, 0.9, 1.0), exp(-d * d * 5.0) * vA);
  }
`;

const earthFrag = /* glsl */ `
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uClouds;
  uniform sampler2D uMask;
  uniform sampler2D uSel;
  uniform vec4 uSelRect;
  uniform vec3 uSun;
  uniform vec3 uGold;
  uniform float uGlow;
  uniform float uHole;
  uniform float uTime;
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
    float clouds = smoothstep(0.55, 1.0, texture2D(uClouds, vUv + vec2(uTime * 0.0016, 0.0)).b);

    vec3 color = mix(night, day, dayMix);
    color = mix(color, vec3(0.95), clouds * dayMix * 0.8);
    color *= 1.0 - clouds * (1.0 - dayMix) * 0.55;

    // Asia highlight: r = fill, g = borders. Selection: country raster inside uSelRect.
    vec4 m = texture2D(uMask, vUv);
    vec2 su = (vUv - uSelRect.xy) / (uSelRect.zw - uSelRect.xy);
    float inRect = step(0.0, su.x) * step(su.x, 1.0) * step(0.0, su.y) * step(su.y, 1.0);
    float sel = texture2D(uSel, clamp(su, 0.0, 1.0)).r * inRect;
    float lum = dot(color, vec3(0.299, 0.587, 0.114));
    lum = min(lum, 1.0);
    color = mix(color, uGold * (0.2 + lum * 1.5), m.r * 0.16 * dayMix);
    color += uGold * m.r * 0.022 * (1.0 - dayMix);
    color = mix(color, vec3(0.004, 0.009, 0.022), sel * uHole * 0.92);
    color += uGold * (m.g * (0.75 + sel * uHole * 0.6) + sel * uGlow * 0.85);

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

function approach(v: number, target: number, rate: number, dt: number) {
  return v + (target - v) * (1 - Math.exp(-rate * dt));
}

export class GlobeView {
  readonly ready: Promise<void>;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(35, 1, 0.05, 200);
  private earthMat: ShaderMaterial;
  private atmoMat: ShaderMaterial;
  private starMat: ShaderMaterial;
  private particles: ParticleLayer;
  private byIso = new Map<string, CountryFeature>();
  private clickable: CountryFeature[] = [];
  private selTex: CanvasTexture;
  private raster: Raster | null = null;
  private rings: Mesh[] = [];

  private pov: Pov = { lat: 30, lng: 82, dist: IDLE_DIST, shift: IDLE_SHIFT };
  private tween: { from: Pov; to: Pov; t0: number; ms: number; done: () => void } | null = null;
  private idle = true;
  private phase = 0;
  private paused = false;
  private last = performance.now();
  private glow = 0;
  private glowTarget = 0;
  private hole = 0;
  private holeTarget = 0;
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
    this.particles = new ParticleLayer(this.renderer);

    let resolveReady!: () => void;
    this.ready = new Promise((r) => (resolveReady = r));
    const manager = new LoadingManager(() => {
      for (const t of loaded) this.renderer.initTexture(t);
      this.renderer.compile(this.scene, this.camera);
      resolveReady();
    });
    const loader = new TextureLoader(manager);
    const loaded: Texture[] = [];
    const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const load = (url: string, srgb: boolean) => {
      const t = loader.load(url);
      if (srgb) t.colorSpace = SRGBColorSpace;
      t.anisotropy = maxAniso;
      loaded.push(t);
      return t;
    };

    const clouds = load('/textures/clouds.jpg', false);
    clouds.wrapS = RepeatWrapping;
    const selCanvas = document.createElement('canvas');
    selCanvas.width = selCanvas.height = 4;
    this.selTex = new CanvasTexture(selCanvas);
    this.selTex.minFilter = LinearFilter;
    this.selTex.generateMipmaps = false;

    this.earthMat = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: earthFrag,
      uniforms: {
        uDay: { value: load('/textures/day.jpg', true) },
        uNight: { value: load('/textures/night.jpg', true) },
        uClouds: { value: clouds },
        uMask: { value: this.buildMask(features, maxAniso) },
        uSel: { value: this.selTex },
        uSelRect: { value: new Vector4(0, 0, 0, 0) },
        uSun: { value: new Vector3() },
        uGold: { value: new Vector3(GOLD.r, GOLD.g, GOLD.b) },
        uGlow: { value: 0 },
        uHole: { value: 0 },
        uTime: { value: 0 },
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
    this.scene.add(new Mesh(new SphereGeometry(1.045, 96, 48), this.atmoMat));

    this.starMat = new ShaderMaterial({
      vertexShader: starVert,
      fragmentShader: starFrag,
      uniforms: { uTime: { value: 0 }, uDpr: { value: this.pixelRatio } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.scene.add(this.buildStars(2600));

    for (const f of this.clickable.filter((f) => geoArea(f) < TINY)) {
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
    this.renderer.setAnimationLoop(this.tick);
  }

  private buildStars(n: number) {
    const pos = new Float32Array(n * 3);
    const star = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const v = new Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(80);
      pos.set([v.x, v.y, v.z], i * 3);
      star.set([0.8 + Math.random() ** 4 * 3.2, Math.random()], i * 2);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aStar', new BufferAttribute(star, 2));
    const pts = new Points(geo, this.starMat);
    pts.frustumCulled = false;
    return pts;
  }

  private buildMask(features: CountryFeature[], aniso: number): Texture {
    const W = 4096, H = 2048;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
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
    for (const [width, alphaClick, alphaOther] of [[6, 0.15, 0.05], [1.9, 1, 0.32]] as const) {
      g.lineWidth = width;
      for (const f of hl) {
        g.beginPath();
        path(f);
        g.strokeStyle = `rgba(0,255,0,${f.clickable ? alphaClick : alphaOther})`;
        g.stroke();
      }
    }
    const tex = new CanvasTexture(c);
    tex.generateMipmaps = true;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.anisotropy = aniso;
    return tex;
  }

  /** Rasterise one country into a small canvas covering its bounding box (used for glow, hole and sampling). */
  private rasterize(iso: string): Raster | null {
    if (this.raster?.iso === iso) return this.raster;
    const f = this.byIso.get(iso);
    if (!f) return null;
    let [[lon0, lat0], [lon1, lat1]] = geoBounds(f);
    if (lon1 < lon0 || lon1 - lon0 > 300) [lon0, lon1] = [-180, 180];
    const pad = Math.max(0.6, (lon1 - lon0) * 0.04);
    lon0 = Math.max(-180, lon0 - pad);
    lon1 = Math.min(180, lon1 + pad);
    lat0 = Math.max(-90, lat0 - pad);
    lat1 = Math.min(90, lat1 + pad);
    const span = Math.max(lon1 - lon0, lat1 - lat0);
    const px = Math.min(1024, Math.max(128, span * 24));
    const W = Math.round((px * (lon1 - lon0)) / span);
    const H = Math.round((px * (lat1 - lat0)) / span);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    const k = W / (((lon1 - lon0) * Math.PI) / 180);
    const proj = geoEquirectangular().scale(k).translate([(-lon0 * Math.PI * k) / 180, (lat1 * Math.PI * k) / 180]);
    g.fillStyle = '#fff';
    g.beginPath();
    geoPath(proj, g)(f);
    g.fill();
    if (geoArea(f) < TINY) {
      const [x, y] = proj(geoCentroid(f)) ?? [W / 2, H / 2];
      g.beginPath();
      g.arc(x, y, Math.max(2, W / 60), 0, Math.PI * 2);
      g.fill();
    }
    this.raster = { iso, canvas, lon0, lat0, lon1, lat1 };
    return this.raster;
  }

  private showRaster(r: Raster | null) {
    const rect = this.earthMat.uniforms.uSelRect.value as Vector4;
    if (!r) {
      rect.set(0, 0, 0, 0);
      return;
    }
    this.selTex.image = r.canvas;
    this.selTex.needsUpdate = true;
    rect.set((r.lon0 + 180) / 360, (r.lat0 + 90) / 180, (r.lon1 + 180) / 360, (r.lat1 + 90) / 180);
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
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.paused && !this.particles.active) return;
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

    this.glow = approach(this.glow, this.glowTarget, 7, dt);
    this.hole = approach(this.hole, this.holeTarget, 9, dt);
    const u = this.earthMat.uniforms;
    u.uGlow.value = this.glow;
    u.uHole.value = this.hole;
    u.uTime.value = now / 1000;
    this.starMat.uniforms.uTime.value = now / 1000;
    const pulse = (now / 1600) % 1;
    for (const r of this.rings) {
      r.scale.setScalar(0.004 + pulse * 0.03);
      (r.material as MeshBasicMaterial).opacity = 1 - pulse;
    }
    this.applyCamera();
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false;
    this.particles.render(now);
  };

  /** Weak GPU safety net: drop render resolution if frames stay slow. */
  private adaptQuality(dt: number) {
    if (this.pixelRatio <= 0.75) return;
    this.slowFrames = dt > 0.028 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    if (this.slowFrames > 90) {
      this.slowFrames = 0;
      this.pixelRatio = Math.max(0.75, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.starMat.uniforms.uDpr.value = this.pixelRatio;
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

  fly(points: Pt[], rect: DOMRect, dir: 'out' | 'in', ms: number, onProgress?: (t: number) => void) {
    return this.particles.fly(points, rect, dir, ms, onProgress);
  }

  focus(iso: string, ms = 1400): Promise<void> {
    const f = this.byIso.get(iso);
    if (!f) return Promise.resolve();
    this.idle = false;
    this.rasterize(iso);
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
    this.showRaster(this.rasterize(iso));
    this.glowTarget = 1;
    return new Promise<void>((r) => setTimeout(r, 420));
  }

  /** iso: country leaves the map (dark hole). null: it fades back in. */
  hide(iso: string | null) {
    this.glowTarget = 0;
    if (iso) {
      this.showRaster(this.rasterize(iso));
      this.holeTarget = 1;
    } else {
      this.holeTarget = 0;
    }
  }

  release(ms = 2000) {
    return this.animateTo(this.swayAt(this.phase), ms).then(() => {
      this.idle = true;
    });
  }

  /** Random on-screen points inside the country, sampled from its raster (fast, no polygon tests). */
  sample(iso: string, n: number): Pt[] {
    const r = this.rasterize(iso);
    if (!r) return [];
    const { canvas, lon0, lat0, lon1, lat1 } = r;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    const filled: number[] = [];
    for (let i = 3; i < data.length; i += 4) if (data[i] > 127) filled.push((i - 3) / 4);
    if (!filled.length) return [];

    const cam = this.camera.position;
    const w2 = window.innerWidth / 2, h2 = window.innerHeight / 2;
    const out: Pt[] = [];
    const p = new Vector3();
    const toCam = new Vector3();
    for (let k = 0; k < n * 1.5 && out.length < n; k++) {
      const idx = filled[(Math.random() * filled.length) | 0];
      const x = (idx % canvas.width) + Math.random();
      const y = Math.floor(idx / canvas.width) + Math.random();
      const lng = lon0 + (x / canvas.width) * (lon1 - lon0);
      const lat = lat1 - (y / canvas.height) * (lat1 - lat0);
      p.copy(latLngToVec(lat, lng, 1.01));
      if (toCam.copy(cam).sub(p).dot(p) <= 0) continue;
      p.project(this.camera);
      out.push({ x: (p.x + 1) * w2, y: (1 - p.y) * h2 });
    }
    return out;
  }
}

export function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
