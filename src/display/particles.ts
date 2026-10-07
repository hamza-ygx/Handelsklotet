import type { Pt } from './globe';

interface P {
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  ex: number;
  ey: number;
  delay: number;
  size: number;
  warm: boolean;
}

const COUNT = 1800;
const SPREAD = 0.4;

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function sprite(color: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  return c;
}

export class Particles {
  private ctx: CanvasRenderingContext2D;
  private gold = sprite('rgba(242,184,75,0.9)');
  private pale = sprite('rgba(255,236,200,0.8)');
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    const fit = () => {
      canvas.width = window.innerWidth * this.dpr;
      canvas.height = window.innerHeight * this.dpr;
    };
    window.addEventListener('resize', fit);
    fit();
  }

  /** dir 'out': globe points → rect. dir 'in': rect → globe points. */
  fly(points: Pt[], rect: DOMRect, dir: 'out' | 'in', duration: number, onProgress?: (t: number) => void): Promise<void> {
    if (!points.length) points = [{ x: window.innerWidth / 2, y: window.innerHeight / 2 }];
    const list: P[] = [];
    for (let i = 0; i < COUNT; i++) {
      const g = points[(Math.random() * points.length) | 0];
      const gx = g.x + (Math.random() - 0.5) * 3;
      const gy = g.y + (Math.random() - 0.5) * 3;
      const rx = rect.left + Math.random() * rect.width;
      const ry = rect.top + Math.random() * rect.height;
      const [sx, sy, ex, ey] = dir === 'out' ? [gx, gy, rx, ry] : [rx, ry, gx, gy];
      const lift = 160 + Math.random() * 320;
      list.push({
        sx, sy, ex, ey,
        cx: gx + (Math.random() - 0.5) * 260,
        cy: Math.max(24, Math.min(gy, ry) - lift),
        delay: Math.random() * SPREAD,
        size: 5 + Math.random() * 9,
        warm: Math.random() < 0.75,
      });
    }

    const { ctx, dpr } = this;
    const start = performance.now();
    return new Promise((resolve) => {
      const frame = (now: number) => {
        const T = Math.min(1, (now - start) / duration);
        onProgress?.(T);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,0.32)';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.globalCompositeOperation = 'lighter';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        for (const p of list) {
          const t = Math.max(0, Math.min(1, (T - p.delay) / (1 - SPREAD)));
          const e = easeInOut(t);
          const u = 1 - e;
          const x = u * u * p.sx + 2 * u * e * p.cx + e * e * p.ex;
          const y = u * u * p.sy + 2 * u * e * p.cy + e * e * p.ey;
          const fadeEnd = dir === 'out' ? 1 - Math.max(0, (t - 0.8) / 0.2) : 1 - Math.max(0, (t - 0.9) / 0.1);
          ctx.globalAlpha = Math.max(0, fadeEnd) * (dir === 'in' && t === 0 ? 0.6 : 1);
          const s = p.size * (0.6 + 0.6 * Math.sin(Math.PI * t) + 0.4);
          ctx.drawImage(p.warm ? this.gold : this.pale, x - s / 2, y - s / 2, s, s);
        }
        ctx.globalAlpha = 1;

        if (T < 1) requestAnimationFrame(frame);
        else {
          this.fadeOut().then(resolve);
        }
      };
      requestAnimationFrame(frame);
    });
  }

  private fadeOut(): Promise<void> {
    const { ctx } = this;
    let n = 0;
    return new Promise((resolve) => {
      const step = () => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        if (++n < 14) requestAnimationFrame(step);
        else {
          ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }
}
