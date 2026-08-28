import { describe, expect, it } from 'bun:test';
import { parseSsid, SsidParseError } from '../src/util/ssid.ts';

describe('parseSsid', () => {
  it('reads the legacy auth frame', () => {
    const payload = parseSsid('42["auth",{"session":"abc123","isDemo":1,"uid":999,"platform":1}]', 'demo');
    expect(payload.session).toBe('abc123');
    expect(payload.uid).toBe(999);
    expect(payload.frame['session']).toBe('abc123');
    expect(payload.frame['isDemo']).toBe(1);
    expect(payload.initFrame).toBeNull();
  });

  it('reads the newer sessionToken frame and derives a user_init frame', () => {
    const payload = parseSsid(
      '42["auth",{"sessionToken":"deadbeef","uid":"42","lang":"en","isChart":1}]',
      'demo',
    );
    expect(payload.session).toBe('deadbeef');
    expect(payload.uid).toBe(42);
    expect(payload.frame['sessionToken']).toBe('deadbeef');
    expect(payload.frame['currentUrl']).toBe('cabinet/demo-quick-high-low');
    expect(payload.initFrame).toEqual({ id: 42, secret: 'deadbeef' });
  });

  it('merges a user_init frame pasted alongside the auth frame', () => {
    const payload = parseSsid(
      '42["user_init",{"id":7,"secret":"s3cr3t"}] 42["auth",{"sessionToken":"s3cr3t","uid":"7","lang":"en"}]',
      'demo',
    );
    expect(payload.uid).toBe(7);
    expect(payload.session).toBe('s3cr3t');
  });

  it('lets the requested account mode win over the captured one', () => {
    const payload = parseSsid('{"session":"abc","isDemo":1,"uid":5,"platform":1}', 'real');
    expect(payload.isDemo).toBe(0);
    expect(payload.frame['isDemo']).toBe(0);

    const modern = parseSsid('{"sessionToken":"abc","uid":"5"}', 'real');
    expect(modern.frame['currentUrl']).toBe('cabinet/quick-high-low');
  });

  it('accepts a bare session id when a uid is available', () => {
    const payload = parseSsid('rawsession', 'demo', 123);
    expect(payload.session).toBe('rawsession');
    expect(payload.uid).toBe(123);
  });

  it('refuses a bare session id with no uid', () => {
    expect(() => parseSsid('rawsession', 'demo')).toThrow(SsidParseError);
  });

  it('refuses a payload with no token at all', () => {
    expect(() => parseSsid('{"uid":5}', 'demo')).toThrow(SsidParseError);
  });
});
