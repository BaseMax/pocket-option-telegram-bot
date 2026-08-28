import { describe, expect, it } from 'bun:test';
import { openDatabase } from '../src/storage/db.ts';
import { OrderRepository } from '../src/storage/orders.ts';
import { SettingsStore } from '../src/storage/settings.ts';
import { TradeEngine, type EngineEvent } from '../src/engine/engine.ts';
import { FakeSession, FakeSessionManager, flush, testConfig as config } from './fakes.ts';
import type { SessionManager } from '../src/engine/session.ts';
import type { NewOrder } from '../src/types.ts';

function harness() {
  const db = openDatabase(':memory:');
  const settings = new SettingsStore(db, config);
  const orders = new OrderRepository(db);
  const fakeSessions = new FakeSessionManager();
  const engine = new TradeEngine(config, orders, settings, fakeSessions as unknown as SessionManager);
  const events: EngineEvent[] = [];
  engine.onEvent((event) => events.push(event));
  return { engine, orders, events, fakeSessions };
}

const base: NewOrder = {
  chatId: 1,
  accountMode: 'demo',
  symbol: 'GBPAUD_otc',
  direction: 'call',
  triggerPrice: 1.95,
  triggerMode: 'touch',
  amount: 2,
  expiryMode: 'fixed',
  durationSeconds: 60,
  candleCount: 1,
  timeframeSeconds: 60,
  chartType: 'candle',
  referencePrice: 1.9,
};

describe('TradeEngine', () => {
  it('waits below the trigger, then enters on the touch', async () => {
    const { engine, orders, events } = harness();
    const order = await engine.createOrder(base);
    const session = engine.sessionManager.get('demo', 'GBPAUD_otc') as unknown as FakeSession;

    expect(order.approachSide).toBe('below');

    session.tick(1000, 1.94);
    expect(orders.get(order.id)!.status).toBe('pending');

    session.tick(1001, 1.95);
    await flush();

    const settled = orders.get(order.id)!;
    expect(settled.status).toBe('open');
    expect(settled.dealId).toBe('deal-1');
    expect(settled.triggeredPrice).toBe(1.95);
    expect(session.opens[0]).toMatchObject({ asset: 'GBPAUD_otc', amount: 2, action: 'call', durationSeconds: 60 });
    expect(events.map((e) => e.type)).toEqual(['triggered', 'opened']);
  });

  it('does not enter when the price moves away from the trigger', async () => {
    const { engine, orders } = harness();
    const order = await engine.createOrder(base);
    const session = engine.sessionManager.get('demo', 'GBPAUD_otc') as unknown as FakeSession;

    session.tick(1000, 1.80);
    session.tick(1001, 1.70);
    await flush();

    expect(orders.get(order.id)!.status).toBe('pending');
    expect(session.opens).toHaveLength(0);
  });

  it('arms on the touch and enters on the first tick of the next candle', async () => {
    const { engine, orders, events } = harness();
    const order = await engine.createOrder({ ...base, triggerMode: 'next_candle' });
    const session = engine.sessionManager.get('demo', 'GBPAUD_otc') as unknown as FakeSession;
    session.tick(1020, 1.95);
    await flush();
    expect(orders.get(order.id)!.status).toBe('armed');
    expect(session.opens).toHaveLength(0);
    session.tick(1050, 1.96);
    await flush();
    expect(orders.get(order.id)!.status).toBe('armed');
    session.tick(1080, 1.97);
    await flush();
    expect(orders.get(order.id)!.status).toBe('open');
    expect(events.map((e) => e.type)).toEqual(['armed', 'triggered', 'opened']);
  });

  it('rides floating expiry to the candle close using broker time', async () => {
    const { engine } = harness();
    await engine.createOrder({ ...base, expiryMode: 'floating', candleCount: 1 });
    const session = engine.sessionManager.get('demo', 'GBPAUD_otc') as unknown as FakeSession;

    session.tick(1020, 1.95);
    await flush();
    expect(session.opens[0]!.closeAtServerTime).toBe(1080);
    expect(session.opens[0]!.durationSeconds).toBeUndefined();
  });

  it('stores the close time on the local clock, not the broker one', async () => {
    const { engine, orders } = harness();
    const order = await engine.createOrder({ ...base, expiryMode: 'floating', candleCount: 1 });
    const session = engine.sessionManager.get('demo', 'GBPAUD_otc') as unknown as FakeSession;

    session.tick(1020, 1.95);
    await flush();
    expect(session.opens[0]!.closeAtServerTime).toBe(1080);
    expect(orders.get(order.id)!.closesAt).toBe(1080 - 7200);
    expect(orders.get(order.id)!.triggeredAt).toBe(1020 - 7200);
  });

  it('rolls floating expiry forward when the candle is about to end', async () => {
    const { engine } = harness();
    await engine.createOrder({ ...base, expiryMode: 'floating', candleCount: 1 });
    const session = engine.sessionManager.get('demo', 'GBPAUD_otc') as unknown as FakeSession;
    session.tick(1078, 1.95);
    await flush();
    expect(session.opens[0]!.closeAtServerTime).toBe(1140);
  });

  it('cancels a pending order whose trigger was crossed while the stream was down', async () => {
    const { engine, orders, events } = harness();
    const order = await engine.createOrder(base);
    const session = engine.sessionManager.get('demo', 'GBPAUD_otc') as unknown as FakeSession;

    session.tick(1000, 1.94);
    await flush();
    session.tick(1200, 1.97, true);
    await flush();

    expect(session.opens).toHaveLength(0);
    expect(orders.get(order.id)!.status).toBe('expired');
    expect(events.some((e) => e.type === 'missed')).toBe(true);
  });

  it('still enters normally when the same touch arrives without a gap', async () => {
    const { engine, orders } = harness();
    const order = await engine.createOrder(base);
    const session = engine.sessionManager.get('demo', 'GBPAUD_otc') as unknown as FakeSession;

    session.tick(1000, 1.94);
    await flush();
    session.tick(1010, 1.97);
    await flush();

    expect(session.opens).toHaveLength(1);
    expect(orders.get(order.id)!.status).toBe('open');
  });

  it('cancels an armed order when its entry candle has already passed', async () => {
    const { engine, orders, events } = harness();
    const order = await engine.createOrder({ ...base, triggerMode: 'next_candle' });
    const session = engine.sessionManager.get('demo', 'GBPAUD_otc') as unknown as FakeSession;

    session.tick(1000, 1.94);
    await flush();
    session.tick(1020, 1.95);
    await flush();
    expect(orders.get(order.id)!.status).toBe('armed');

    session.tick(1300, 1.95);
    await flush();

    expect(session.opens).toHaveLength(0);
    expect(orders.get(order.id)!.status).toBe('expired');
    expect(events.some((e) => e.type === 'missed')).toBe(true);
  });

  it('falls back to a relative duration when the broker rejects closeAt', async () => {
    const { engine, orders } = harness();
    const order = await engine.createOrder({ ...base, expiryMode: 'floating', candleCount: 1 });
    const session = engine.sessionManager.get('demo', 'GBPAUD_otc') as unknown as FakeSession;
    session.failWith = 'bad closeAt';
    session.failOnlyCloseAt = true;

    session.tick(1020, 1.95);
    await flush();

    expect(session.opens).toHaveLength(2);
    expect(session.opens[1]!.durationSeconds).toBe(60);
    expect(orders.get(order.id)!.status).toBe('open');
  });

  it('marks the order failed when the broker refuses outright', async () => {
    const { engine, orders, events } = harness();
    const order = await engine.createOrder(base);
    const session = engine.sessionManager.get('demo', 'GBPAUD_otc') as unknown as FakeSession;
    session.failWith = 'insufficient funds';

    session.tick(1000, 1.95);
    await flush();

    const stored = orders.get(order.id)!;
    expect(stored.status).toBe('failed');
    expect(stored.note).toBe('insufficient funds');
    expect(events.some((e) => e.type === 'failed')).toBe(true);
  });

  it('settles a win, a loss and a draw from the broker deal', async () => {
    for (const [profit, status] of [
      [1.8, 'won'],
      [-2, 'lost'],
      [0, 'draw'],
    ] as const) {
      const { engine, orders } = harness();
      const order = await engine.createOrder(base);
      const session = engine.sessionManager.get('demo', 'GBPAUD_otc') as unknown as FakeSession;

      session.tick(1000, 1.95);
      await flush();

      session.settle({
        dealId: orders.get(order.id)!.dealId!,
        asset: 'GBPAUD_otc',
        profit,
        amount: 2,
        closePrice: 1.96,
        closeTimestamp: 1060,
        raw: null,
      });

      const stored = orders.get(order.id)!;
      expect(stored.status).toBe(status);
      expect(stored.profit).toBe(profit);
      expect(stored.closePrice).toBe(1.96);
    }
  });

  it('ignores a settlement for a deal it does not own', async () => {
    const { engine, orders } = harness();
    const order = await engine.createOrder(base);
    const session = engine.sessionManager.get('demo', 'GBPAUD_otc') as unknown as FakeSession;
    session.tick(1000, 1.95);
    await flush();

    session.settle({
      dealId: 'someone-elses-deal',
      asset: 'GBPAUD_otc',
      profit: 99,
      amount: 1,
      closePrice: 2,
      closeTimestamp: 1060,
      raw: null,
    });

    expect(orders.get(order.id)!.status).toBe('open');
  });

  it('cancels a pending order but refuses to cancel an open trade', async () => {
    const { engine, orders } = harness();
    const order = await engine.createOrder(base);

    expect(engine.cancel(order.id)).toMatchObject({ ok: true });
    expect(orders.get(order.id)!.status).toBe('cancelled');
    expect(engine.cancel(order.id)).toMatchObject({ ok: false, reason: 'not_active' });
    expect(engine.cancel('NOPE')).toMatchObject({ ok: false, reason: 'not_found' });

    const live = await engine.createOrder(base);
    const session = engine.sessionManager.get('demo', 'GBPAUD_otc') as unknown as FakeSession;
    session.tick(1000, 1.95);
    await flush();
    expect(engine.cancel(live.id)).toMatchObject({ ok: false, reason: 'already_open' });
  });

  it('refuses to resume an order that was mid-flight when the bot stopped', async () => {
    const { engine, orders, events } = harness();
    const order = await engine.createOrder(base);
    orders.update(order.id, { status: 'placing' });

    engine.start();
    try {
      const stored = orders.get(order.id)!;
      expect(stored.status).toBe('failed');
      expect(stored.note).toContain('restarted');
      expect(events.some((e) => e.type === 'failed')).toBe(true);
    } finally {
      engine.stop();
    }
  });

  it('seeds the approach side from the first tick when no price was known', async () => {
    const { engine, orders } = harness();
    const order = orders.create({ ...base, referencePrice: null });
    expect(order.approachSide).toBe('any');

    engine.start();
    try {
      const session = engine.sessionManager.get('demo', 'GBPAUD_otc') as unknown as FakeSession;
      session.tick(1000, 1.99);
      await flush();
      const seeded = orders.get(order.id)!;
      expect(seeded.status).toBe('pending');
      expect(seeded.referencePrice).toBe(1.99);
      expect(seeded.approachSide).toBe('above');

      session.tick(1001, 1.95);
      await flush();
      expect(orders.get(order.id)!.status).toBe('open');
    } finally {
      engine.stop();
    }
  });
});
