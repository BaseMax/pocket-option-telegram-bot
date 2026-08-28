import { Database } from 'bun:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createLogger } from '../logger.ts';

const logger = createLogger('db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  chat_id           INTEGER NOT NULL,
  account_mode      TEXT    NOT NULL,
  symbol            TEXT    NOT NULL,
  direction         TEXT    NOT NULL,
  trigger_price     REAL    NOT NULL,
  trigger_mode      TEXT    NOT NULL,
  approach_side     TEXT    NOT NULL,
  amount            REAL    NOT NULL,
  expiry_mode       TEXT    NOT NULL,
  duration_seconds  INTEGER NOT NULL,
  candle_count      INTEGER NOT NULL,
  timeframe_seconds INTEGER NOT NULL,
  chart_type        TEXT    NOT NULL,
  status            TEXT    NOT NULL,
  reference_price   REAL,
  valid_until       REAL,
  triggered_price   REAL,
  triggered_at      REAL,
  deal_id           TEXT,
  open_price        REAL,
  opened_at         REAL,
  closes_at         REAL,
  close_price       REAL,
  closed_at         REAL,
  profit            REAL,
  note              TEXT,
  created_at        REAL    NOT NULL,
  updated_at        REAL    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_chat    ON orders(chat_id);
CREATE INDEX IF NOT EXISTS idx_orders_deal    ON orders(deal_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path, { create: true });
  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA busy_timeout = 5000;');
  db.run('PRAGMA foreign_keys = ON;');
  db.run(SCHEMA);
  logger.info(`storage ready at ${path}`);
  return db;
}
