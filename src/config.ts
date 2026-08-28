import { z } from 'zod';
import { parseServerList, defaultServers, type ServerEndpoint } from './pocket/servers.ts';
import type { AccountMode, ChartType } from './types.ts';

const numeric = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? fallback : Number(v)))
    .pipe(z.number().finite());

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_ADMIN_IDS: z.string().optional().default(''),

  PO_DEMO_SSID: z.string().optional().default(''),
  PO_REAL_SSID: z.string().optional().default(''),
  PO_DEMO_UID: numeric(0),
  PO_REAL_UID: numeric(0),
  PO_DEMO_SERVERS: z.string().optional(),
  PO_REAL_SERVERS: z.string().optional(),
  PO_SERVER_TIME_OFFSET: numeric(7200),

  DB_PATH: z.string().optional().default('./data/bot.sqlite'),
  HEARTBEAT_PATH: z.string().optional().default('./data/heartbeat'),
  DISPLAY_TIMEZONE: z.string().optional().default('Asia/Tehran'),

  DEFAULT_AMOUNT: numeric(1),
  DEFAULT_TIMEFRAME_SECONDS: numeric(60),
  DEFAULT_DURATION_SECONDS: numeric(60),
  MIN_AMOUNT: numeric(1),
  MAX_AMOUNT: numeric(20000),
  MIN_DURATION_SECONDS: numeric(5),
  MAX_DURATION_SECONDS: numeric(43200),
  SESSION_IDLE_TTL_SECONDS: numeric(60),
  ORDER_ACK_TIMEOUT_SECONDS: numeric(10),
  ORDER_SETTLE_GRACE_SECONDS: numeric(90),
  MAX_TICK_GAP_SECONDS: numeric(30),
});

export type ChartTypeName = ChartType;

export interface AppConfig {
  telegram: {
    token: string;
    adminIds: number[];
  };
  pocket: {
    ssid: Record<AccountMode, string>;
    uid: Record<AccountMode, number>;
    servers: Record<AccountMode, readonly ServerEndpoint[]>;
    serverTimeOffset: number;
  };
  dbPath: string;
  heartbeatPath: string;
  timezone: string;
  defaults: {
    amount: number;
    timeframeSeconds: number;
    durationSeconds: number;
    chartType: ChartType;
  };
  limits: {
    minAmount: number;
    maxAmount: number;
    minDurationSeconds: number;
    maxDurationSeconds: number;
  };
  engine: {
    sessionIdleTtlSeconds: number;
    orderAckTimeoutSeconds: number;
    orderSettleGraceSeconds: number;
    maxTickGapSeconds: number;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${issues.join('\n')}`);
  }
  const c = parsed.data;

  const adminIds = c.TELEGRAM_ADMIN_IDS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n));

  const demoOverride = parseServerList(c.PO_DEMO_SERVERS);
  const realOverride = parseServerList(c.PO_REAL_SERVERS);

  return {
    telegram: { token: c.TELEGRAM_BOT_TOKEN, adminIds },
    pocket: {
      ssid: { demo: c.PO_DEMO_SSID.trim(), real: c.PO_REAL_SSID.trim() },
      uid: { demo: c.PO_DEMO_UID, real: c.PO_REAL_UID },
      servers: {
        demo: demoOverride.length > 0 ? demoOverride : defaultServers('demo'),
        real: realOverride.length > 0 ? realOverride : defaultServers('real'),
      },
      serverTimeOffset: c.PO_SERVER_TIME_OFFSET,
    },
    dbPath: c.DB_PATH,
    heartbeatPath: c.HEARTBEAT_PATH,
    timezone: c.DISPLAY_TIMEZONE,
    defaults: {
      amount: c.DEFAULT_AMOUNT,
      timeframeSeconds: c.DEFAULT_TIMEFRAME_SECONDS,
      durationSeconds: c.DEFAULT_DURATION_SECONDS,
      chartType: 'candle',
    },
    limits: {
      minAmount: c.MIN_AMOUNT,
      maxAmount: c.MAX_AMOUNT,
      minDurationSeconds: c.MIN_DURATION_SECONDS,
      maxDurationSeconds: c.MAX_DURATION_SECONDS,
    },
    engine: {
      sessionIdleTtlSeconds: c.SESSION_IDLE_TTL_SECONDS,
      orderAckTimeoutSeconds: c.ORDER_ACK_TIMEOUT_SECONDS,
      orderSettleGraceSeconds: c.ORDER_SETTLE_GRACE_SECONDS,
      maxTickGapSeconds: c.MAX_TICK_GAP_SECONDS,
    },
  };
}
