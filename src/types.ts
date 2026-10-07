export type TabId = 'oversikt' | 'handel' | 'finans' | 'ehandel' | 'sverige';

export const TABS: { id: TabId; label: string }[] = [
  { id: 'oversikt', label: 'Översikt' },
  { id: 'handel', label: 'Handel' },
  { id: 'finans', label: 'Finans' },
  { id: 'ehandel', label: 'E-handel' },
  { id: 'sverige', label: 'Sverige' },
];

export type Region = 'Östasien' | 'Sydostasien' | 'Sydasien' | 'Västasien' | 'Europa';

export interface Country {
  iso: string;
  name: string;
  region: Region;
  capital: string;
  tagline: string;
  fact: string;
  photo: { wiki: string; caption: string };
  macro: {
    gdp: number;
    growth: number;
    gdpPerCapita: number;
    population: number;
    inflation: number;
    unemployment: number;
    growthSeries: number[];
  };
  trade: {
    exports: number;
    imports: number;
    topExports: string[];
    partners: [string, number][];
  };
  finance: {
    currency: string;
    code: string;
    policyRate: number | null;
    policyNote?: string;
    index: string;
    rating: string;
    fdi: number | null;
    fxFallback: number;
  };
  ecom: {
    market: number;
    internet: number;
    platforms: string[];
    payments: string[];
  };
  sweden: {
    exports: number;
    imports: number;
    companies: string[];
    note: string;
    flowLabel?: string;
    companiesLabel?: string;
  };
}

export type Msg =
  | { t: 'select'; iso: string }
  | { t: 'tab'; tab: TabId }
  | { t: 'close' }
  | { t: 'hello' }
  | { t: 'state'; iso: string | null; tab: TabId; busy: boolean };
