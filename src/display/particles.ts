import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Camera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  type WebGLRenderer,
} from 'three';

export interface Pt {
  x: number;
  y: number;
}

const COUNT = 5000;
const GHOSTS = [
  { lag: 0, alpha: 1, size: 1 },
  { lag: 0.028, alpha: 0.5, size: 0.8 },
  { lag: 0.056, alpha: 0.26, size: 0.62 },
  { lag: 0.084, alpha: 0.12, size: 0.48 },
];
const SPREAD = 0.38;

const vert = /* glsl */ `
  attribute vec2 aStart;
  attribute vec2 aCtrl;
  attribute vec2 aEnd;
  attribute vec4 aMeta;   // delay, size, swirl, seed
  attribute vec2 aGhost;  // lag, alpha
  attribute float aBorder;
  uniform float uT;
  uniform float uSpread;
  uniform float uDir;     // 1 = out (globe → panel), 0 = in
  uniform vec2 uRes;
  uniform float uDpr;
  varying float vAlpha;
  varying float vHot;

  float ease(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }

  void main() {
    float t = clamp((uT - aMeta.x - aGhost.x) / (1.0 - uSpread), 0.0, 1.0);
    float e = ease(t);
    float u = 1.0 - e;
    vec2 p = u * u * aStart + 2.0 * u * e * aCtrl + e * e * aEnd;
    vec2 dir = normalize(aEnd - aStart + 1e-4);
    vec2 perp = vec2(-dir.y, dir.x);
    p += perp * sin(t * 3.14159) * sin(t * 7.0 + aMeta.w * 6.283) * aMeta.z;

    vec2 ndc = vec2(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0);
    gl_Position = vec4(ndc, 0.0, 1.0);

    float bell = sin(t * 3.14159);
    gl_PointSize = aMeta.y * (0.7 + bell * 0.8) * uDpr;
    float fadeIn = smoothstep(0.0, 0.05, t);
    float outEnd = mix(0.8, 0.93, aBorder);
    float fadeOut = uDir > 0.5 ? 1.0 - smoothstep(outEnd, 1.0, t) : 1.0 - smoothstep(0.88, 1.0, t);
    vAlpha = aGhost.y * fadeIn * fadeOut * step(0.0001, t) * (1.0 + aBorder * 0.6 * smoothstep(0.6, 0.95, t));
    vHot = max(bell, aBorder * smoothstep(0.7, 1.0, t));
  }
`;

const frag = /* glsl */ `
  varying float vAlpha;
  varying float vHot;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    float core = exp(-d * d * 7.0);
    float halo = exp(-d * d * 2.0) * 0.45;
    vec3 gold = vec3(1.0, 0.66, 0.22);
    vec3 white = vec3(1.0, 0.95, 0.85);
    vec3 col = mix(gold, white, core * (0.35 + vHot * 0.65)) * 1.35;
    gl_FragColor = vec4(col * (core + halo), (core + halo) * vAlpha);
  }
`;

/** GPU particle burst rendered inside the globe's WebGL canvas. */
export class ParticleLayer {
  private scene = new Scene();
  private camera = new Camera();
  private mat: ShaderMaterial;
  private points: Points | null = null;
  private anim: { t0: number; ms: number; onProgress?: (t: number) => void; done: () => void } | null = null;

  constructor(private renderer: WebGLRenderer) {
    this.mat = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uT: { value: 0 },
        uSpread: { value: SPREAD },
        uDir: { value: 1 },
        uRes: { value: new Vector2(1, 1) },
        uDpr: { value: 1 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
    });
  }

  get active() {
    return this.anim !== null;
  }

  private build(points: Pt[], rect: DOMRect, dir: 'out' | 'in') {
    const n = COUNT * GHOSTS.length;
    const start = new Float32Array(n * 2);
    const ctrl = new Float32Array(n * 2);
    const end = new Float32Array(n * 2);
    const meta = new Float32Array(n * 4);
    const ghost = new Float32Array(n * 2);
    const brd = new Float32Array(n);
    const border = 0.34;

    for (let i = 0; i < COUNT; i++) {
      const g = points[(Math.random() * points.length) | 0];
      const gx = g.x + (Math.random() - 0.5) * 2.5;
      const gy = g.y + (Math.random() - 0.5) * 2.5;
      let rx: number, ry: number;
      const onBorder = Math.random() < border;
      if (onBorder) {
        // trace the panel outline so the burst "draws" the card
        const side = Math.random() * 2 * (rect.width + rect.height);
        const j = (Math.random() - 0.5) * 6;
        if (side < rect.width) [rx, ry] = [rect.left + side, rect.top + j];
        else if (side < rect.width + rect.height) [rx, ry] = [rect.right + j, rect.top + side - rect.width];
        else if (side < 2 * rect.width + rect.height) [rx, ry] = [rect.right - (side - rect.width - rect.height), rect.bottom + j];
        else [rx, ry] = [rect.left + j, rect.bottom - (side - 2 * rect.width - rect.height)];
      } else {
        rx = rect.left + Math.random() * rect.width;
        ry = rect.top + Math.random() * rect.height;
      }
      const [sx, sy, ex, ey] = dir === 'out' ? [gx, gy, rx, ry] : [rx, ry, gx, gy];
      const cx = gx + (rx - gx) * 0.2 + (Math.random() - 0.5) * 360;
      const cy = Math.max(20, Math.min(gy, ry) - 220 - Math.random() * 360);
      const delay = Math.random() * SPREAD;
      const size = 4 + Math.random() ** 2.5 * 14;
      const swirl = (Math.random() - 0.5) * 70;
      const seed = Math.random();

      for (let k = 0; k < GHOSTS.length; k++) {
        const idx = i * GHOSTS.length + k;
        start.set([sx, sy], idx * 2);
        ctrl.set([cx, cy], idx * 2);
        end.set([ex, ey], idx * 2);
        meta.set([Math.min(SPREAD, delay), size * GHOSTS[k].size, swirl, seed], idx * 4);
        ghost.set([GHOSTS[k].lag, GHOSTS[k].alpha], idx * 2);
        brd[idx] = onBorder ? 1 : 0;
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aStart', new BufferAttribute(start, 2));
    geo.setAttribute('aCtrl', new BufferAttribute(ctrl, 2));
    geo.setAttribute('aEnd', new BufferAttribute(end, 2));
    geo.setAttribute('aMeta', new BufferAttribute(meta, 4));
    geo.setAttribute('aGhost', new BufferAttribute(ghost, 2));
    geo.setAttribute('aBorder', new BufferAttribute(brd, 1));

    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
    }
    this.points = new Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  fly(points: Pt[], rect: DOMRect, dir: 'out' | 'in', ms: number, onProgress?: (t: number) => void): Promise<void> {
    if (!points.length) points = [{ x: window.innerWidth / 2, y: window.innerHeight / 2 }];
    this.build(points, rect, dir);
    this.mat.uniforms.uDir.value = dir === 'out' ? 1 : 0;
    this.mat.uniforms.uT.value = 0;
    return new Promise((done) => {
      this.anim = { t0: performance.now(), ms, onProgress, done };
    });
  }

  /** Called by the globe render loop after the globe is drawn. */
  render(now: number) {
    if (!this.anim || !this.points) return;
    const { t0, ms, onProgress, done } = this.anim;
    const t = Math.min(1, (now - t0) / ms);
    const size = this.renderer.getSize(new Vector2());
    this.mat.uniforms.uRes.value.copy(size);
    this.mat.uniforms.uDpr.value = this.renderer.getPixelRatio();
    this.mat.uniforms.uT.value = t;
    onProgress?.(t);
    this.renderer.render(this.scene, this.camera);
    if (t >= 1) {
      this.anim = null;
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      this.points = null;
      done();
    }
  }
}
