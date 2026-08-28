import type { AccountMode } from '../types.ts';

export interface ServerEndpoint {
  url: string;
  origin: string;
}

const PO_MARKET_ORIGIN = 'https://pocketoption.com';
const P_FINANCE_ORIGIN = 'https://p.finance';

const DEMO_SERVERS: readonly ServerEndpoint[] = [
  { url: 'https://demo-api-eu.po.market', origin: P_FINANCE_ORIGIN },
  { url: 'https://demo-api-eu.po.market', origin: PO_MARKET_ORIGIN },
  { url: 'https://try-demo-eu.po.market', origin: P_FINANCE_ORIGIN },
];

const REAL_SERVERS: readonly ServerEndpoint[] = [
  { url: 'https://api-eu.po.market', origin: P_FINANCE_ORIGIN },
  { url: 'https://api-l.po.market', origin: P_FINANCE_ORIGIN },
  { url: 'https://api-fr.po.market', origin: P_FINANCE_ORIGIN },
  { url: 'https://api-c.po.market', origin: P_FINANCE_ORIGIN },
  { url: 'https://api-us-north.po.market', origin: P_FINANCE_ORIGIN },
  { url: 'https://api-us-south.po.market', origin: P_FINANCE_ORIGIN },
  { url: 'https://api-asia.po.market', origin: P_FINANCE_ORIGIN },
  { url: 'https://api-eu.po.market', origin: PO_MARKET_ORIGIN },
];

function originFor(url: string): string {
  return url.includes('pocketoption') ? PO_MARKET_ORIGIN : P_FINANCE_ORIGIN;
}

export function parseServerList(raw: string | undefined): ServerEndpoint[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, origin] = entry.split('|').map((p) => p.trim());
      const normalized = (url ?? '').replace(/\/+$/, '');
      return { url: normalized, origin: origin || originFor(normalized) };
    })
    .filter((endpoint) => endpoint.url.length > 0);
}

export function defaultServers(mode: AccountMode): readonly ServerEndpoint[] {
  return mode === 'demo' ? DEMO_SERVERS : REAL_SERVERS;
}
