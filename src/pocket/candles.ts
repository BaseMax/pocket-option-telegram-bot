import { createLogger } from '../logger.ts';
import type { Candle, ChartType, Tick } from '../types.ts';
import { candleOpenTime } from '../util/time.ts';

const MAX_HISTORY = 600;

const logger = createLogger('candles');

export interface TickResult {
  closed: Candle | null;
  current: Candle;
  startedNewCandle: boolean;
}

export class CandleSeries {
  readonly timeframeSeconds: number;

  private readonly candles: Candle[] = [];
  private live: Candle | null = null;

  constructor(timeframeSeconds: number) {
    this.timeframeSeconds = timeframeSeconds;
  }
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
  view(chartType: ChartType, limit = MAX_HISTORY): Candle[] {
    const raw = this.snapshot(limit);
    if (chartType === 'candle') return raw;
    if (chartType === 'line') {
      let previousClose: number | null = null;
      return raw.map((c) => {
        const open = previousClose ?? c.close;
        previousClose = c.close;
        return {
          ...c,
          open,
          high: Math.max(open, c.close),
          low: Math.min(open, c.close),
        };
      });
    }

    let haOpen: number | null = null;
    let haClose: number | null = null;
    return raw.map((c) => {
      const close = (c.open + c.high + c.low + c.close) / 4;
      const open = haOpen === null || haClose === null ? (c.open + c.close) / 2 : (haOpen + haClose) / 2;
      haOpen = open;
      haClose = close;
      return {
        ...c,
        open,
        close,
        high: Math.max(c.high, open, close),
        low: Math.min(c.low, open, close),
      };
    });
  }
}
