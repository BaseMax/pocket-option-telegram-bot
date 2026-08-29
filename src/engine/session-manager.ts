import { createLogger } from '../logger.ts';
import { parseSsid, type AuthPayload } from '../util/ssid.ts';
import { MissingCredentialsError, Session } from './session.ts';
import type { AppConfig } from '../config.ts';
import type { SettingsStore } from '../storage/settings.ts';
import type { AccountMode } from '../types.ts';

/**
 * Borrows a session for one question and always gives it back, so a query never keeps a
 * connection alive after it is done with it.
 */
export async function borrowSession<T>(
  sessions: SessionManager,
  mode: AccountMode,
  symbol: string | null,
  label: string,
  ask: (session: Session) => Promise<T>,
): Promise<T> {
  const holder = `${label}:${Date.now()}`;
  const session = sessions.acquire(mode, symbol, holder);
  try {
    return await ask(session);
  } finally {
    sessions.release(mode, symbol, holder);
  }
}

interface SessionEntry {
  session: Session;
  holders: Set<string>;
  disposeTimer: ReturnType<typeof setTimeout> | null;
}

export class SessionManager {
  private readonly logger = createLogger('sessions');
  private readonly entries = new Map<string, SessionEntry>();

  constructor(
    private readonly config: AppConfig,
    private readonly settings: SettingsStore,
  ) {}

  private static key(mode: AccountMode, symbol: string | null): string {
    return `${mode}:${symbol ?? '*'}`;
  }
  private authFor(mode: AccountMode): AuthPayload {
    const raw = this.settings.get('ssid')[mode] || this.config.pocket.ssid[mode];
    if (!raw) throw new MissingCredentialsError(mode);
    const uid = this.settings.get('uid')[mode] || this.config.pocket.uid[mode];
    return parseSsid(raw, mode, uid);
  }

  hasCredentials(mode: AccountMode): boolean {
    return Boolean(this.settings.get('ssid')[mode] || this.config.pocket.ssid[mode]);
  }
  acquire(mode: AccountMode, symbol: string | null, holder: string): Session {
    const key = SessionManager.key(mode, symbol);
    let entry = this.entries.get(key);

    if (!entry) {
      const session = new Session(mode, symbol, this.authFor(mode), this.config);
      entry = { session, holders: new Set(), disposeTimer: null };
      this.entries.set(key, entry);
      this.logger.info(`opening session ${key}`);
      session.start();
    }

    if (entry.disposeTimer) {
      clearTimeout(entry.disposeTimer);
      entry.disposeTimer = null;
    }
    entry.holders.add(holder);
    return entry.session;
  }

  release(mode: AccountMode, symbol: string | null, holder: string): void {
    const key = SessionManager.key(mode, symbol);
    const entry = this.entries.get(key);
    if (!entry) return;

    entry.holders.delete(holder);
    if (entry.holders.size > 0 || entry.disposeTimer) return;
    entry.disposeTimer = setTimeout(() => {
      if (entry.holders.size > 0) return;
      this.logger.info(`closing idle session ${key}`);
      entry.session.stop();
      this.entries.delete(key);
    }, this.config.engine.sessionIdleTtlSeconds * 1000);
  }
  resetMode(mode: AccountMode): void {
    for (const [key, entry] of [...this.entries]) {
      if (entry.session.mode !== mode) continue;
      if (entry.disposeTimer) clearTimeout(entry.disposeTimer);
      this.logger.info(`recycling session ${key} after a credentials change`);
      entry.session.stop();
      this.entries.delete(key);
    }
  }

  get(mode: AccountMode, symbol: string | null): Session | undefined {
    return this.entries.get(SessionManager.key(mode, symbol))?.session;
  }

  list(): { key: string; session: Session; holders: number }[] {
    return [...this.entries.entries()].map(([key, entry]) => ({
      key,
      session: entry.session,
      holders: entry.holders.size,
    }));
  }

  stopAll(): void {
    for (const [key, entry] of this.entries) {
      if (entry.disposeTimer) clearTimeout(entry.disposeTimer);
      entry.session.stop();
      this.entries.delete(key);
    }
  }
}
