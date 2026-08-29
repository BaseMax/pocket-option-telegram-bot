import { createLogger } from '../logger.ts';
import type { Candle, ChartType, Tick } from '../types.ts';
import { candleOpenTime } from '../util/time.ts';

const MAX_HISTORY = 600;

const logger = createLogger('candles');

/** A line chart is only the closes joined up: each bar spans the previous close to this one. */
function toLine(raw: readonly Candle[]): Candle[] {
  let previousClose: number | null = null;
  return raw.map((candle) => {
    const open = previousClose ?? candle.close;
    previousClose = candle.close;
    return {
      ...candle,
      open,
      high: Math.max(open, candle.close),
      low: Math.min(open, candle.close),
    };
  });
}

/**
 * Heikin-Ashi averages each bar with the one before it: the close is the mean of the four real
 * prices, the open is the midpoint of the previous Heikin-Ashi bar. Trends read cleaner, but the
 * numbers are no longer prices anyone traded at.
 */
function toHeikinAshi(raw: readonly Candle[]): Candle[] {
  let previousOpen: number | null = null;
  let previousClose: number | null = null;

  return raw.map((candle) => {
    const close = (candle.open + candle.high + candle.low + candle.close) / 4;
    const open =
      previousOpen === null || previousClose === null
        ? (candle.open + candle.close) / 2
        : (previousOpen + previousClose) / 2;
    previousOpen = open;
    previousClose = close;

    return {
      ...candle,
      open,
      close,
      high: Math.max(candle.high, open, close),
      low: Math.min(candle.low, open, close),
    };
  });
}

export interface TickResult {
  closed: Candle | null;
  current: Candle;
  startedNewCandle: boolean;
}

export class CandleSeries {
  private readonly candles: Candle[] = [];
  private live: Candle | null = null;

  constructor(readonly timeframeSeconds: number) {}
  addTick(tick: Tick): TickResult {
    const openTime = candleOpenTime(tick.time, this.timeframeSeconds);
    const live = this.live;

    if (live && live.openTime === openTime) {
      live.high = Math.max(live.high, tick.price);
      live.low = Math.min(live.low, tick.price);
      live.close = tick.price;
      live.ticks += 1;
      return { closed: null, current: live, startedNewCandle: false };
    }
    if (live && openTime < live.openTime) {
      logger.debug(
        `dropping a tick for the ${this.timeframeSeconds}s candle at ${openTime}: ` +
          `the series is already at ${live.openTime}`,
      );
      return { closed: null, current: live, startedNewCandle: false };
    }

    let closed: Candle | null = null;
    if (live) {
      live.live = false;
      closed = live;
      this.candles.push(live);
      if (this.candles.length > MAX_HISTORY) this.candles.shift();
    }

    const fresh: Candle = {
      openTime,
      closeTime: openTime + this.timeframeSeconds,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      ticks: 1,
      live: true,
    };
    this.live = fresh;
    return { closed, current: fresh, startedNewCandle: live !== null };
  }
  seed(ticks: readonly Tick[]): void {
    for (const tick of ticks) this.addTick(tick);
  }

  get currentCandle(): Candle | null {
    return this.live;
  }

  get lastClosedCandle(): Candle | undefined {
    return this.candles[this.candles.length - 1];
  }

  get size(): number {
    return this.candles.length + (this.live ? 1 : 0);
  }
  snapshot(limit = MAX_HISTORY): Candle[] {
    const all = this.live ? [...this.candles, this.live] : [...this.candles];
    return all.slice(-limit).map((c) => ({ ...c }));
  }
  /** The candles as the chosen chart type draws them. */
  view(chartType: ChartType, limit = MAX_HISTORY): Candle[] {
    const raw = this.snapshot(limit);
    if (chartType === 'line') return toLine(raw);
    if (chartType === 'heikin_ashi') return toHeikinAshi(raw);
    return raw;
  }
}
