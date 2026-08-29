import { describe, expect, it } from 'bun:test';
import { orderEventText } from '../src/telegram/notify.ts';
import { storedOrder } from './fakes.ts';

const TZ = 'UTC';

describe('orderEventText', () => {
  it('names the order in every message', () => {
    const text = orderEventText({ type: 'triggered', order: storedOrder(), price: 1.0854 }, TZ);
    expect(text).toContain('#A7K2');
    expect(text).toContain('GBPAUD_otc');
  });

  it('tells an armed order when it will enter', () => {
    const text = orderEventText({ type: 'armed', order: storedOrder(), price: 1.0854, entryAt: 0 }, TZ)!;
    expect(text).toContain('کندل بعدی');
    expect(text).toContain('1970-01-01 00:00:00');
  });

  it('reports the outcome of a settled trade', () => {
    const won = orderEventText({ type: 'settled', order: storedOrder({ status: 'won', profit: 4.2 }) }, TZ)!;
    expect(won).toContain('برد');
    expect(won).toContain('$4.20');

    const lost = orderEventText({ type: 'settled', order: storedOrder({ status: 'lost', profit: -5 }) }, TZ)!;
    expect(lost).toContain('باخت');
    expect(lost).toContain('-$5.00');

    const draw = orderEventText({ type: 'settled', order: storedOrder({ status: 'draw', profit: 0 }) }, TZ)!;
    expect(draw).toContain('مساوی');
  });

  it('escapes a broker error rather than letting it break the HTML', () => {
    const text = orderEventText({ type: 'failed', order: storedOrder(), error: 'bad <input> & more' }, TZ)!;
    expect(text).toContain('bad &lt;input&gt; &amp; more');
  });

  it('explains an expiry and a missed entry differently', () => {
    expect(orderEventText({ type: 'expired', order: storedOrder() }, TZ)).toContain('منقضی شد');
    const missed = orderEventText({ type: 'missed', order: storedOrder(), price: 1.09, reason: 'gap' }, TZ)!;
    expect(missed).toContain('فرصت از دست رفت');
    expect(missed).toContain('1.09');
  });
});
