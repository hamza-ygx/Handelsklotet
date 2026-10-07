const nf = (d: number) => new Intl.NumberFormat('sv-SE', { minimumFractionDigits: d, maximumFractionDigits: d });

export function num(v: number, d = 0) {
  return nf(d).format(v);
}

export function usdBn(v: number): { value: string; unit: string } {
  if (v >= 1000) return { value: num(v / 1000, 1), unit: 'biljoner $' };
  if (v >= 100) return { value: num(v), unit: 'miljarder $' };
  if (v >= 10) return { value: num(v), unit: 'miljarder $' };
  return { value: num(v, 1), unit: 'miljarder $' };
}

export function sekBn(v: number): { value: string; unit: string } {
  return { value: v < 10 ? num(v, 1) : num(v), unit: 'miljarder kr' };
}

export function pct(v: number, d = 1) {
  return `${num(v, d)} %`;
}

export function people(m: number): { value: string; unit: string } {
  if (m >= 1000) return { value: num(m / 1000, 2), unit: 'miljarder' };
  return { value: m < 100 ? num(m, 1) : num(m), unit: 'miljoner' };
}

export function sek(v: number) {
  if (v >= 1) return `${num(v, 2)} kr`;
  if (v >= 0.01) return `${num(v * 100, 2)} öre`;
  return `${num(v * 100, 3)} öre`;
}
