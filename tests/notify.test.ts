import { describe, expect, it } from 'bun:test';
import { orderEventText } from '../src/telegram/notify.ts';
import type { Order } from '../src/types.ts';

const TZ = 'UTC';

function order(patch: Partial<Order> = {}): Order {
  return {
    id: 'A7K2',
    chatId: 1,
    accountMode: 'demo',
    symbol: 'EURUSD',
    direction: 'call',
    triggerPrice: 1.0854,
    triggerMode: 'touch',
    approachSide: 'below',
    amount: 5,
    expiryMode: 'fixed',
    durationSeconds: 60,
    candleCount: 1,
    timeframeSeconds: 60,
    chartType: 'candle',
    status: 'pending',
    referencePrice: 1.08,
    validUntil: null,
    triggeredPrice: null,
    triggeredAt: null,
    dealId: null,
    openPrice: null,
    openedAt: null,
    closesAt: null,
    closePrice: null,
    closedAt: null,
    profit: null,
    note: null,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  };
}

describe('orderEventText', () => {
  it('names the order in every message', () => {
    const text = orderEventText({ type: 'triggered', order: order(), price: 1.0854 }, TZ);
    expect(text).toContain('#A7K2');
    expect(text).toContain('EURUSD');
  });

  it('tells an armed order when it will enter', () => {
    const text = orderEventText({ type: 'armed', order: order(), price: 1.0854, entryAt: 0 }, TZ)!;
    expect(text).toContain('کندل بعدی');
    expect(text).toContain('1970-01-01 00:00:00');
  });

  it('reports the outcome of a settled trade', () => {
    const won = orderEventText({ type: 'settled', order: order({ status: 'won', profit: 4.2 }) }, TZ)!;
    expect(won).toContain('برد');
    expect(won).toContain('$4.20');

    const lost = orderEventText({ type: 'settled', order: order({ status: 'lost', profit: -5 }) }, TZ)!;
    expect(lost).toContain('باخت');
    expect(lost).toContain('-$5.00');

    const draw = orderEventText({ type: 'settled', order: order({ status: 'draw', profit: 0 }) }, TZ)!;
    expect(draw).toContain('مساوی');
  });

  it('escapes a broker error rather than letting it break the HTML', () => {
    const text = orderEventText({ type: 'failed', order: order(), error: 'bad <input> & more' }, TZ)!;
    expect(text).toContain('bad &lt;input&gt; &amp; more');
  });

  it('explains an expiry and a missed entry differently', () => {
    expect(orderEventText({ type: 'expired', order: order() }, TZ)).toContain('منقضی شد');
    const missed = orderEventText({ type: 'missed', order: order(), price: 1.09, reason: 'gap' }, TZ)!;
    expect(missed).toContain('فرصت از دست رفت');
    expect(missed).toContain('1.09');
  });
});
