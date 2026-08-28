import { loadConfig } from './config.ts';
import { openDatabase } from './storage/db.ts';
import { OrderRepository } from './storage/orders.ts';
import { SettingsStore } from './storage/settings.ts';
import { TradeEngine } from './engine/engine.ts';
import { createBot, publishCommands } from './telegram/bot.ts';
import { createLogger } from './logger.ts';

const logger = createLogger('main');

async function main(): Promise<void> {
  const config = loadConfig();

  const db = openDatabase(config.dbPath);
  const settings = new SettingsStore(db, config);
  const orders = new OrderRepository(db);

  const engine = new TradeEngine(config, orders, settings);
  const bot = createBot({ config, settings, orders, engine });

  engine.start();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`received ${signal}, shutting down`);
    try {
      await bot.stop();
    } catch (error) {
      logger.warn('bot did not stop cleanly', error);
    }
    engine.stop();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error('unhandled rejection', reason));

  if (config.telegram.adminIds.length === 0 && settings.get('owners').length === 0) {
    logger.warn('no admins configured; the first chat to send /start will claim this bot');
  }
  for (const mode of ['demo', 'real'] as const) {
    if (!engine.hasCredentials(mode)) {
      logger.warn(`no Pocket Option session for the ${mode} account; set it with /session ${mode} <SSID>`);
    }
  }

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
