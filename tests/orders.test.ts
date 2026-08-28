import { describe, expect, it } from 'bun:test';
import { openDatabase } from '../src/storage/db.ts';
import { OrderRepository } from '../src/storage/orders.ts';
import type { NewOrder } from '../src/types.ts';

function repo(): OrderRepository {
  return new OrderRepository(openDatabase(':memory:'));
}

const base: NewOrder = {
  chatId: 111,
  accountMode: 'demo',
  symbol: 'GBPAUD_otc',
  direction: 'call',
  triggerPrice: 1.9532,
  triggerMode: 'touch',
  amount: 1,
  expiryMode: 'fixed',
  durationSeconds: 60,
  candleCount: 1,
  timeframeSeconds: 60,
  chartType: 'candle',
};

describe('OrderRepository', () => {
  it('creates a pending order with a short unique id', () => {
    const orders = repo();
    const a = orders.create(base);
    const b = orders.create(base);

    expect(a.status).toBe('pending');
    expect(a.id).toHaveLength(4);
    expect(a.id).not.toBe(b.id);
    expect(orders.get(a.id)?.triggerPrice).toBeCloseTo(1.9532, 6);
  });

  it('round-trips every field through SQLite', () => {
    const orders = repo();
    const created = orders.create({
      ...base,
      expiryMode: 'floating',
      candleCount: 3,
      chartType: 'heikin_ashi',
      accountMode: 'real',
      direction: 'put',
      validUntil: 1787911237,
      referencePrice: 1.9,
      approachSide: 'below',
    });
    const loaded = orders.get(created.id)!;
    expect(loaded).toEqual(created);
    expect(loaded.chartType).toBe('heikin_ashi');
    expect(loaded.approachSide).toBe('below');
  });

  it('applies partial updates and refreshes updatedAt', async () => {
    const orders = repo();
    const created = orders.create(base);
    await Bun.sleep(5);

    const updated = orders.update(created.id, { status: 'open', dealId: 'deal-9', openPrice: 1.95 })!;
    expect(updated.status).toBe('open');
    expect(updated.dealId).toBe('deal-9');
    expect(updated.symbol).toBe(created.symbol);
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);
  });

  it('clears a column when the patch carries null', () => {
    const orders = repo();
    const created = orders.create({ ...base, validUntil: 123 });
    expect(orders.update(created.id, { validUntil: null })!.validUntil).toBeNull();
  });

  it('finds an order by its broker deal id', () => {
    const orders = repo();
    const created = orders.create(base);
    orders.update(created.id, { dealId: 'deal-7' });
    expect(orders.findByDealId('deal-7')?.id).toBe(created.id);
    expect(orders.findByDealId('missing')).toBeNull();
  });

  it('lists only orders the engine still has to watch', () => {
    const orders = repo();
    const pending = orders.create(base);
    const done = orders.create(base);
    orders.update(done.id, { status: 'won' });

    expect(orders.listActive().map((o) => o.id)).toEqual([pending.id]);
    expect(orders.listActiveByChat(111).map((o) => o.id)).toEqual([pending.id]);
    expect(orders.listActiveByChat(222)).toEqual([]);
  });

  it('summarises settled orders for the chat', () => {
    const orders = repo();
    const now = Date.now() / 1000;
    const won = orders.create(base);
    const lost = orders.create(base);
    const other = orders.create({ ...base, chatId: 222 });
    orders.update(won.id, { status: 'won', profit: 1.8, closedAt: now });
    orders.update(lost.id, { status: 'lost', profit: -1, closedAt: now });
    orders.update(other.id, { status: 'won', profit: 5, closedAt: now });

    const summary = orders.summary(111, now - 3600);
    expect(summary.won).toBe(1);
    expect(summary.lost).toBe(1);
    expect(summary.profit).toBeCloseTo(0.8, 6);
  });
});
