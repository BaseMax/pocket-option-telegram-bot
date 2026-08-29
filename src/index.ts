import { loadConfig, type AppConfig } from './config.ts';
import { openDatabase } from './storage/db.ts';
import { OrderRepository } from './storage/orders.ts';
import { SettingsStore } from './storage/settings.ts';
import { TradeEngine } from './engine/engine.ts';
import { createBot, publishCommands } from './telegram/bot.ts';
import { createLogger } from './logger.ts';
import type { Database } from 'bun:sqlite';
import type { Bot } from 'grammy';

const logger = createLogger('main');

const HEARTBEAT_INTERVAL_MS = 30_000;

/** Touches a file the Docker healthcheck reads, so a wedged process is visible from outside. */
function startHeartbeat(path: string): ReturnType<typeof setInterval> {
  const beat = (): void => {
    Bun.write(path, String(Date.now())).catch((error: unknown) =>
      logger.warn('could not write the heartbeat file', error),
    );
  };
  beat();
  return setInterval(beat, HEARTBEAT_INTERVAL_MS);
}

/** Stops polling, closes the broker sockets and the database, once, on the first signal. */
function installShutdown(parts: { bot: Bot; engine: TradeEngine; db: Database; heartbeat: ReturnType<typeof setInterval> }): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal}, shutting down`);

    clearInterval(parts.heartbeat);
    try {
      await parts.bot.stop();
    } catch (error) {
      logger.warn('bot did not stop cleanly', error);
    }
    parts.engine.stop();
    parts.db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', reason));
}

/** Says what is missing before the user finds out by trying to trade. */
function warnAboutSetup(config: AppConfig, settings: SettingsStore, engine: TradeEngine): void {
  if (config.telegram.adminIds.length === 0 && settings.get('owners').length === 0) {
    logger.warn('no admins configured; the first chat to send /start will claim this bot');
  }
  for (const mode of ['demo', 'real'] as const) {
    if (!engine.hasCredentials(mode)) {
      logger.warn(`no Pocket Option session for the ${mode} account; set it with /session ${mode} <SSID>`);
    }
  }
}

async function main(): Promise<void> {
  const config = loadConfig();

  const db = openDatabase(config.dbPath);
  const settings = new SettingsStore(db, config);
  const orders = new OrderRepository(db);

  const engine = new TradeEngine(config, orders, settings);
  const bot = createBot({ config, settings, orders, engine });

  engine.start();
  const heartbeat = startHeartbeat(config.heartbeatPath);
  installShutdown({ bot, engine, db, heartbeat });
  warnAboutSetup(config, settings, engine);

  await publishCommands(bot);

  logger.info('starting Telegram long polling');
  await bot.start({
    onStart: (info) => logger.info(`bot @${info.username} is live`),
    drop_pending_updates: true,
  });
}

main().catch((error: unknown) => {
  logger.error('fatal startup error', error);
  process.exit(1);
});
