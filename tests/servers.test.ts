import { describe, expect, it } from 'bun:test';
import { defaultServers, parseServerList } from '../src/pocket/servers.ts';

describe('parseServerList', () => {
  it('is empty when nothing is configured', () => {
    expect(parseServerList(undefined)).toEqual([]);
    expect(parseServerList('')).toEqual([]);
    expect(parseServerList(' , ,')).toEqual([]);
  });

  it('reads a comma separated list and trims the entries', () => {
    expect(parseServerList(' https://a.example , https://b.example ')).toEqual([
      { url: 'https://a.example', origin: 'https://p.finance' },
      { url: 'https://b.example', origin: 'https://p.finance' },
    ]);
  });

  it('takes an explicit origin after a pipe', () => {
    expect(parseServerList('https://a.example|https://custom.example')).toEqual([
      { url: 'https://a.example', origin: 'https://custom.example' },
    ]);
  });

  it('guesses the origin a pocketoption host expects', () => {
    expect(parseServerList('https://api.pocketoption.com')[0]?.origin).toBe('https://pocketoption.com');
  });

  it('drops trailing slashes so the url matches the built-in list', () => {
    expect(parseServerList('https://a.example///')[0]?.url).toBe('https://a.example');
  });
});

describe('defaultServers', () => {
  it('keeps the demo and real endpoint lists apart', () => {
    expect(defaultServers('demo').every((s) => s.url.includes('demo') || s.url.includes('try-demo'))).toBe(true);
    expect(defaultServers('real').some((s) => s.url === 'https://api-eu.po.market')).toBe(true);
    expect(defaultServers('real').every((s) => !s.url.includes('demo'))).toBe(true);
  });
});
