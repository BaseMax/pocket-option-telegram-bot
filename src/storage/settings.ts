import type { Database, Statement } from 'bun:sqlite';
import { createLogger } from '../logger.ts';
import { isPlainObject } from '../util/values.ts';
import type { AppConfig } from '../config.ts';
import type { AccountMode, ChartType, ExpiryMode, TriggerMode } from '../types.ts';

export interface BotSettings {
  defaultAccountMode: AccountMode;
  defaultAmount: number;
  defaultTimeframeSeconds: number;
  defaultDurationSeconds: number;
  defaultCandleCount: number;
  defaultChartType: ChartType;
  defaultTriggerMode: TriggerMode;
  defaultExpiryMode: ExpiryMode;
  notifyBalance: boolean;
  ssid: Record<AccountMode, string>;
  uid: Record<AccountMode, number>;
  owners: number[];
}

interface SettingsRow {
  key: string;
  value: string;
}

const logger = createLogger('settings');

export class SettingsStore {
  private readonly db: Database;
  private readonly defaults: BotSettings;
  private readonly selectAll: Statement<SettingsRow, []>;
  private cache: BotSettings;

  constructor(db: Database, config: AppConfig) {
    this.db = db;
    this.selectAll = db.query<SettingsRow, []>('SELECT key, value FROM settings');
    this.defaults = {
      defaultAccountMode: 'demo',
      defaultAmount: config.defaults.amount,
      defaultTimeframeSeconds: config.defaults.timeframeSeconds,
      defaultDurationSeconds: config.defaults.durationSeconds,
      defaultCandleCount: 1,
      defaultChartType: config.defaults.chartType,
      defaultTriggerMode: 'touch',
      defaultExpiryMode: 'fixed',
      notifyBalance: true,
      ssid: { demo: config.pocket.ssid.demo, real: config.pocket.ssid.real },
      uid: { demo: config.pocket.uid.demo, real: config.pocket.uid.real },
      owners: [],
    };
    this.cache = this.load();
  }

  private load(): BotSettings {
    const merged: BotSettings = structuredClone(this.defaults);
    for (const row of this.selectAll.all()) {
      if (!(row.key in merged)) continue;
      try {
        const value: unknown = JSON.parse(row.value);
        const current = merged[row.key as keyof BotSettings];
        // Nested defaults (ssid, uid) keep the keys the stored value does not mention.
        if (isPlainObject(current) && isPlainObject(value)) Object.assign(current, value);
        else (merged as unknown as Record<string, unknown>)[row.key] = value;
      } catch (error) {
        logger.warn(`settings row "${row.key}" is unreadable, using the default`, error);
      }
    }
    return merged;
  }

  get all(): Readonly<BotSettings> {
    return this.cache;
  }

  get<K extends keyof BotSettings>(key: K): BotSettings[K] {
    return this.cache[key];
  }

  set<K extends keyof BotSettings>(key: K, value: BotSettings[K]): void {
    this.cache[key] = value;
    this.db
      .query('INSERT INTO settings (key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value = $value')
      .run({ $key: key, $value: JSON.stringify(value) });
  }
  setCredentials(mode: AccountMode, ssid: string, uid: number): void {
    this.set('ssid', { ...this.cache.ssid, [mode]: ssid });
    this.set('uid', { ...this.cache.uid, [mode]: uid });
  }

  addOwner(chatId: number): void {
    if (this.cache.owners.includes(chatId)) return;
    this.set('owners', [...this.cache.owners, chatId]);
  }
}
