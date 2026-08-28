import { describe, expect, it } from 'bun:test';
import { CandleSeries } from '../src/pocket/candles.ts';
import type { Tick } from '../src/types.ts';

const tick = (time: number, price: number): Tick => ({ symbol: 'EURUSD', time, price });

describe('CandleSeries', () => {
  it('folds ticks into the candle that contains them', () => {
    const series = new CandleSeries(60);
    series.addTick(tick(600, 1.0));
    series.addTick(tick(610, 1.2));
    series.addTick(tick(650, 0.9));

    const current = series.currentCandle;
    expect(current).not.toBeNull();
    expect(current!.openTime).toBe(600);
    expect(current!.open).toBe(1.0);
    expect(current!.high).toBe(1.2);
    expect(current!.low).toBe(0.9);
    expect(current!.close).toBe(0.9);
    expect(current!.ticks).toBe(3);
  });

  it('closes the candle when a tick crosses the boundary', () => {
    const series = new CandleSeries(60);
    series.addTick(tick(600, 1.0));
    const result = series.addTick(tick(660, 1.1));

    expect(result.startedNewCandle).toBe(true);
    expect(result.closed?.openTime).toBe(600);
    expect(result.closed?.live).toBe(false);
    expect(result.current.openTime).toBe(660);
    expect(result.current.open).toBe(1.1);
  });

  it('ignores a late tick from an already closed candle', () => {
    const series = new CandleSeries(60);
    series.addTick(tick(660, 1.1));
    const result = series.addTick(tick(600, 99));

    expect(result.startedNewCandle).toBe(false);
    expect(series.currentCandle?.high).toBe(1.1);
  });

  it('derives heikin-ashi candles from the raw series', () => {
    const series = new CandleSeries(60);
    series.addTick(tick(600, 10));
    series.addTick(tick(630, 12));
    series.addTick(tick(660, 11));
    series.addTick(tick(690, 15));

    const raw = series.view('candle');
    const ha = series.view('heikin_ashi');
    expect(ha).toHaveLength(raw.length);

    const first = raw[0]!;
    expect(ha[0]!.close).toBeCloseTo((first.open + first.high + first.low + first.close) / 4, 9);
    expect(ha[0]!.open).toBeCloseTo((first.open + first.close) / 2, 9);
    expect(ha[1]!.open).toBeCloseTo((ha[0]!.open + ha[0]!.close) / 2, 9);
  });

  it('collapses to close-to-close segments for a line chart', () => {
    const series = new CandleSeries(60);
    series.addTick(tick(600, 10));
    series.addTick(tick(630, 20));
    series.addTick(tick(660, 15));

    const line = series.view('line');
    expect(line[0]!.close).toBe(20);
    expect(line[1]!.open).toBe(20);
    expect(line[1]!.close).toBe(15);
  });
});
