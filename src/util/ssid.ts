import { createLogger } from '../logger.ts';
import { asNumber, asRecord } from './values.ts';
import type { AccountMode } from '../types.ts';

const logger = createLogger('ssid');

export interface AuthPayload {
  frame: Record<string, unknown>;
  initFrame: Record<string, unknown> | null;
  session: string;
  uid: number;
  isDemo: 0 | 1;
}

export class SsidParseError extends Error {}

function cabinetUrl(mode: AccountMode): string {
  return mode === 'demo' ? 'cabinet/demo-quick-high-low' : 'cabinet/quick-high-low';
}

function buildLegacy(session: string, uid: number, mode: AccountMode, extras: Record<string, unknown>): AuthPayload {
  return {
    frame: {
      ...extras,
      session,
      isDemo: mode === 'demo' ? 1 : 0,
      uid,
      platform: asNumber(extras['platform']) ?? 1,
    },
    initFrame: null,
    session,
    uid,
    isDemo: mode === 'demo' ? 1 : 0,
  };
}

function buildModern(
  token: string,
  uid: number,
  mode: AccountMode,
  extras: Record<string, unknown>,
): AuthPayload {
  const frame: Record<string, unknown> = {
    lang: 'en',
    isChart: 1,
    ...extras,
    sessionToken: token,
    currentUrl: cabinetUrl(mode),
    uid: String(uid),
  };
  return {
    frame,
    initFrame: { id: uid, secret: token },
    session: token,
    uid,
    isDemo: mode === 'demo' ? 1 : 0,
  };
}

function fromObject(raw: Record<string, unknown>, mode: AccountMode, uidFallback: number): AuthPayload {
  const { session, sessionToken, secret, uid, id, ...extras } = raw;

  const resolvedUid = asNumber(uid) ?? asNumber(id) ?? uidFallback;
  if (!Number.isFinite(resolvedUid) || resolvedUid === 0) {
    throw new SsidParseError('auth payload has no usable "uid"');
  }

  if (typeof session === 'string' && session.length > 0) {
    return buildLegacy(session, resolvedUid, mode, extras);
  }

  const token = typeof sessionToken === 'string' ? sessionToken : typeof secret === 'string' ? secret : null;
  if (token !== null && token.length > 0) {
    return buildModern(token, resolvedUid, mode, extras);
  }

  throw new SsidParseError('auth payload has no "session", "sessionToken" or "secret" field');
}

export function parseSsid(input: string, mode: AccountMode, uidFallback = 0): AuthPayload {
  const text = input.trim();
  if (!text) throw new SsidParseError('empty SSID');
  const frames = [...text.matchAll(/\d*\s*\[\s*"(\w+)"\s*,\s*(\{[\s\S]*?\})\s*\]/g)];
  if (frames.length > 0) {
    const merged: Record<string, unknown> = {};
    for (const match of frames) {
      const body = match[2];
      if (body === undefined) continue;
      try {
        const parsed = asRecord(JSON.parse(body));
        if (parsed) Object.assign(merged, parsed);
      } catch (error) {
        logger.debug(`ignoring unreadable "${match[1]}" frame in the pasted SSID`, error);
      }
    }
    if (Object.keys(merged).length > 0) return fromObject(merged, mode, uidFallback);
  }

  if (text.startsWith('{')) {
    const parsed: unknown = JSON.parse(text);
    const record = asRecord(typeof parsed === 'string' ? JSON.parse(parsed) : parsed);
    if (!record) throw new SsidParseError('auth payload is not an object');
    return fromObject(record, mode, uidFallback);
  }
  if (uidFallback === 0) {
    throw new SsidParseError('a bare session id also needs a uid: set PO_DEMO_UID / PO_REAL_UID');
  }
  return buildLegacy(text, uidFallback, mode, {});
}

export function redactAuth(payload: AuthPayload): Record<string, unknown> {
  return {
    uid: payload.uid,
    isDemo: payload.isDemo,
    session: `${payload.session.slice(0, 4)}…${payload.session.slice(-4)}`,
    keys: Object.keys(payload.frame),
  };
}
