let rates: Record<string, number> | null = null;
let date: string | null = null;

export async function loadFx() {
  try {
    const r = await fetch('https://api.frankfurter.dev/v1/latest?base=SEK');
    if (!r.ok) return;
    const j = await r.json();
    rates = j.rates;
    date = j.date;
  } catch {
    /* fall back to static rates */
  }
}

export function sekPer(code: string, fallback: number): { value: number; live: boolean; date: string | null } {
  if (code === 'SEK') return { value: 1, live: false, date: null };
  const r = rates?.[code];
  if (r) return { value: 1 / r, live: true, date };
  return { value: fallback, live: false, date: null };
}
