import { io, type Socket } from 'socket.io-client';
import { Emitter } from '../util/emitter.ts';
import { createLogger, type Logger } from '../logger.ts';
import { nowSeconds } from '../util/time.ts';
import { redactAuth, type AuthPayload } from '../util/ssid.ts';
import type { AccountMode, Tick } from '../types.ts';
import type { ServerEndpoint } from './servers.ts';
import {
  IN,
  OUT,
  decodeFrame,
  parseAssets,
  parseBalance,
  parseClosedDeals,
  parseHistory,
  parseOpenOrderAck,
  parseOpenOrderFailure,
  parseTicks,
  type AssetInfo,
  type ClosedDeal,
  type OpenOrderAck,
  type OpenOrderRequest,
} from './protocol.ts';

const PING_INTERVAL_MS = 15_000;
const PLAYER_STATE_INTERVAL_MS = 30_000;
const AUTH_TIMEOUT_MS = 12_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;
const FAILURES_BEFORE_ROTATE = 3;
const AUTH_TIMEOUTS_BEFORE_GIVING_UP = 3;
const OFFSET_QUANTUM_SECONDS = 900;

export interface PocketClientOptions {
  mode: AccountMode;
  auth: AuthPayload;
  servers: readonly ServerEndpoint[];
  serverTimeOffset: number;
  label: string;
  ackTimeoutMs: number;
}

interface PocketClientEvents extends Record<string, readonly unknown[]> {
  connected: [ServerEndpoint];
  authenticated: [];
  disconnected: [string];
  tick: [Tick];
  history: [{ symbol: string; period: number; ticks: Tick[] }];
  balance: [number];
  assets: [AssetInfo[]];
  orderAccepted: [OpenOrderAck];
  dealClosed: [ClosedDeal];
  authFailed: [string];
}

interface PendingOpen {
  resolve: (ack: OpenOrderAck) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PocketOptionClient extends Emitter<PocketClientEvents> {
  readonly mode: AccountMode;

  private readonly options: PocketClientOptions;
  private readonly logger: Logger;

  private socket: Socket | null = null;
  private endpointIndex = 0;
  private consecutiveFailures = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private playerStateTimer: ReturnType<typeof setInterval> | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;

  private connectedFlag = false;
  private authenticatedFlag = false;
  private authRejected = false;
  private authSentAt = 0;
  private authTimeouts = 0;
  private everAuthenticated = false;
  private readonly subscriptions = new Map<string, number>();
  private readonly pendingOpens = new Map<number, PendingOpen>();
  private readonly lastPrices = new Map<string, Tick>();

  private requestCounter = 0;
  private serverTimeOffset: number;
  private balanceValue: number | null = null;

  constructor(options: PocketClientOptions) {
    super();
    this.options = options;
    this.mode = options.mode;
    this.serverTimeOffset = options.serverTimeOffset;
    this.logger = createLogger(`po:${options.label}`);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.openSocket();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.teardownSocket('client stopped');
    this.failAllPending(new Error('client stopped'));
    this.removeAllListeners();
  }

  get isConnected(): boolean {
    return this.connectedFlag;
  }

  get isReady(): boolean {
    return this.connectedFlag && this.authenticatedFlag;
  }

  get balance(): number | null {
    return this.balanceValue;
  }

  get endpoint(): ServerEndpoint | undefined {
    return this.options.servers[this.endpointIndex % this.options.servers.length];
  }
  get timeOffset(): number {
    return this.serverTimeOffset;
  }

  lastPrice(symbol: string): Tick | undefined {
    return this.lastPrices.get(symbol);
  }
  waitUntilReady(timeoutMs = 30_000): Promise<void> {
    if (this.isReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        offAuth();
        reject(new Error('timed out waiting for Pocket Option authentication'));
      }, timeoutMs);
      const offAuth = this.on('authenticated', () => {
        clearTimeout(timer);
        offAuth();
        resolve();
      });
    });
  }

  private openSocket(): void {
    if (this.stopped) return;
    const endpoint = this.endpoint;
    if (!endpoint) {
      this.logger.error('no Pocket Option endpoints configured');
      return;
    }

    this.logger.info(`connecting to ${endpoint.url}`);
    const headers = { Origin: endpoint.origin };
    const socket = io(endpoint.url, {
      path: '/socket.io',
      transports: ['websocket'],
      extraHeaders: headers,
      transportOptions: { websocket: { extraHeaders: headers } },
      reconnection: false,
      timeout: 10_000,
      forceNew: true,
    });
    this.socket = socket;

    socket.on('connect', () => this.handleConnect());
    socket.on('connect_error', (error: Error) => this.handleFailure(`connect_error: ${error.message}`));
    socket.on('disconnect', (reason: string) => this.handleFailure(`disconnect: ${reason}`));
    socket.onAny((event: string, ...args: unknown[]) => this.handleEvent(event, args));
  }

  private handleConnect(): void {
    this.connectedFlag = true;
    this.logger.info('socket connected, authenticating');
    this.emit('connected', this.endpoint as ServerEndpoint);

    this.rawEmit(OUT.handshake, {});
    this.authSentAt = Date.now();
    this.sendAuth();
    this.logger.debug('auth sent', redactAuth(this.options.auth));

    this.authTimer = setTimeout(() => {
      if (this.authenticatedFlag) return;
      this.authTimeouts += 1;
      this.handleFailure('authentication timed out');
    }, AUTH_TIMEOUT_MS);

    this.pingTimer = setInterval(() => this.rawEmit(OUT.ping), PING_INTERVAL_MS);
    this.playerStateTimer = setInterval(() => this.rawEmit(OUT.playerState), PLAYER_STATE_INTERVAL_MS);
  }

  private handleAuthenticated(): void {
    if (this.authenticatedFlag) return;
    this.authenticatedFlag = true;
    this.everAuthenticated = true;
    this.consecutiveFailures = 0;
    this.authTimeouts = 0;
    if (this.authTimer) clearTimeout(this.authTimer);
    this.authTimer = null;

    this.logger.info('authenticated');
    this.rawEmit(OUT.playerState);
    for (const [symbol, period] of this.subscriptions) {
      this.sendSubscribe(symbol, period);
    }
    this.emit('authenticated');
  }
  private rejectAuth(reason: string): void {
    if (this.authRejected) return;
    this.authRejected = true;
    this.logger.error(reason);
    this.emit('authFailed', reason);
  }

  get isAuthRejected(): boolean {
    return this.authRejected;
  }

  private handleFailure(reason: string): void {
    const wasReady = this.isReady;
    this.connectedFlag = false;
    this.authenticatedFlag = false;
    this.clearTimers();
    this.teardownSocket(reason);

    if (wasReady) this.logger.warn(`connection lost: ${reason}`);
    else this.logger.debug(`connection attempt failed: ${reason}`);
    this.emit('disconnected', reason);

    if (this.stopped) return;
    if (!wasReady && this.authSentAt > 0 && Date.now() - this.authSentAt < 3_000) {
      this.rejectAuth('the broker closed the connection right after authentication: the session is invalid or expired');
    } else if (this.authTimeouts >= (this.everAuthenticated ? AUTH_TIMEOUTS_BEFORE_GIVING_UP : 1)) {
      this.rejectAuth(
        'the broker ignored the auth frame: the session is almost certainly expired; ' +
          'capture a fresh one from a logged-in browser tab',
      );
    }
    if (this.authRejected) {
      this.logger.warn('not reconnecting until a new session is configured');
      return;
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures % FAILURES_BEFORE_ROTATE === 0 && this.options.servers.length > 1) {
      this.endpointIndex = (this.endpointIndex + 1) % this.options.servers.length;
      this.logger.warn(`rotating to endpoint ${this.endpoint?.url}`);
    }

    const delay = Math.min(RECONNECT_MIN_MS * 2 ** (this.consecutiveFailures - 1), RECONNECT_MAX_MS);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.playerStateTimer) clearInterval(this.playerStateTimer);
    if (this.authTimer) clearTimeout(this.authTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.pingTimer = null;
    this.playerStateTimer = null;
    this.authTimer = null;
    this.reconnectTimer = null;
  }

  private teardownSocket(_reason: string): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.removeAllListeners();
    socket.offAny();
    socket.disconnect();
    socket.close();
  }
  handleEvent(event: string, args: unknown[]): void {
    const frame = args.length > 0 ? decodeFrame(args[0]) : null;

    switch (event) {
      case IN.successauth:
      case IN.authSuccess:
        this.handleAuthenticated();
        return;

      case IN.notAuthorized:
      case IN.authError:
        this.rejectAuth(`the broker rejected this session (${event})`);
        return;

      case IN.sid:
        if (!this.authenticatedFlag) this.sendAuth();
        return;

      case IN.updateStream: {
        for (const tick of parseTicks(frame)) {
          this.learnTimeOffset(tick.time, 'tick stream');
          this.lastPrices.set(tick.symbol, tick);
          this.emit('tick', tick);
        }
        return;
      }

      case IN.updateHistoryNew:
      case IN.loadHistoryPeriod: {
        const history = parseHistory(frame);
        if (history) {
          const last = history.ticks[history.ticks.length - 1];
          if (last) this.lastPrices.set(last.symbol, last);
          this.emit('history', history);
        }
        return;
      }

      case IN.updateBalance:
      case IN.successupdateBalance: {
        this.handleAuthenticated();
        const balance = parseBalance(frame);
        if (balance !== null && balance !== this.balanceValue) {
          this.balanceValue = balance;
          this.emit('balance', balance);
        }
        return;
      }

      case IN.updateAssets: {
        const assets = parseAssets(frame);
        if (assets.length > 0) this.emit('assets', assets);
        return;
      }

      case IN.successopenOrder: {
        const ack = parseOpenOrderAck(frame);
        if (!ack) return;
        this.learnTimeOffset(ack.openTimestamp, 'order acknowledgement');
        if (ack.requestId !== null) this.resolvePending(ack.requestId, ack);
        else this.resolveOldestPending(ack);
        this.emit('orderAccepted', ack);
        return;
      }

      case IN.failopenOrder: {
        const failure = parseOpenOrderFailure(frame);
        this.logger.warn(`broker rejected order: ${failure.error}`);
        const error = new Error(failure.error);
        if (failure.requestId !== null) this.rejectPending(failure.requestId, error);
        else this.failAllPending(error);
        return;
      }

      case IN.successcloseOrder:
      case IN.updateClosedDeals: {
        for (const deal of parseClosedDeals(frame)) this.emit('dealClosed', deal);
        return;
      }

      default:
        this.logger.trace(`unhandled event ${event}`);
    }
  }
  private learnTimeOffset(brokerTime: number | null, source: string): void {
    if (brokerTime === null) return;
    const raw = brokerTime - nowSeconds();
    if (Math.abs(raw) > 86_400) return;
    const snapped = Math.round(raw / OFFSET_QUANTUM_SECONDS) * OFFSET_QUANTUM_SECONDS;
    if (snapped !== this.serverTimeOffset) {
      this.logger.info(`server time offset learned from the ${source}: ${this.serverTimeOffset}s -> ${snapped}s`);
      this.serverTimeOffset = snapped;
    }
  }
  private sendAuth(): void {
    const { initFrame, frame } = this.options.auth;
    if (initFrame) this.rawEmit(OUT.userInit, initFrame);
    this.rawEmit(OUT.auth, frame);
  }

  private rawEmit(event: string, ...args: unknown[]): void {
    const socket = this.socket;
    if (!socket) return;
    this.logger.trace(`emit ${event}`, args[0]);
    socket.emit(event, ...args);
  }
  subscribe(symbol: string, periodSeconds: number): void {
    const existing = this.subscriptions.get(symbol);
    this.subscriptions.set(symbol, periodSeconds);
    if (this.isReady && existing !== periodSeconds) this.sendSubscribe(symbol, periodSeconds);
  }

  private sendSubscribe(symbol: string, periodSeconds: number): void {
    this.rawEmit(OUT.subscribe, symbol);
    this.rawEmit(OUT.changeSymbol, { asset: symbol, period: periodSeconds });
  }

  unsubscribe(symbol: string): void {
    if (!this.subscriptions.delete(symbol)) return;
    if (this.isReady) this.rawEmit(OUT.unsubscribe, symbol);
  }

  refreshBalance(): void {
    this.rawEmit(OUT.playerState);
  }

  private nextRequestId(): number {
    this.requestCounter = (this.requestCounter + 1) % 1000;
    return Math.floor(nowSeconds()) * 1000 + this.requestCounter;
  }
  async openOrder(params: {
    asset: string;
    amount: number;
    action: 'call' | 'put';
    optionType?: number;
    durationSeconds?: number;
    closeAtServerTime?: number;
  }): Promise<OpenOrderAck> {
    if (!this.isReady) throw new Error('not connected to Pocket Option');
    const hasDuration = params.durationSeconds !== undefined;
    const hasCloseAt = params.closeAtServerTime !== undefined;
    if (hasDuration === hasCloseAt) {
      throw new Error('openOrder needs exactly one of durationSeconds / closeAtServerTime');
    }

    const requestId = this.nextRequestId();
    const request: OpenOrderRequest = {
      asset: params.asset,
      amount: params.amount,
      action: params.action,
      isDemo: this.options.auth.isDemo,
      requestId,
      optionType: params.optionType ?? 100,
    };
    if (hasDuration) request.time = Math.round(params.durationSeconds as number);
    else request.closeAt = Math.round(params.closeAtServerTime as number);

    const promise = new Promise<OpenOrderAck>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingOpens.delete(requestId);
        reject(new Error('broker did not acknowledge the order in time'));
      }, this.options.ackTimeoutMs);
      this.pendingOpens.set(requestId, { resolve, reject, timer });
    });

    this.logger.info(`placing ${request.action} ${request.asset}`, request);
    this.rawEmit(OUT.openOrder, request);
    return promise;
  }

  private resolvePending(requestId: number, ack: OpenOrderAck): void {
    const pending = this.pendingOpens.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingOpens.delete(requestId);
    pending.resolve(ack);
  }
  private resolveOldestPending(ack: OpenOrderAck): void {
    const first = this.pendingOpens.keys().next();
    if (first.done) return;
    this.resolvePending(first.value, ack);
  }

  private rejectPending(requestId: number, error: Error): void {
    const pending = this.pendingOpens.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingOpens.delete(requestId);
    pending.reject(error);
  }

  private failAllPending(error: Error): void {
    for (const requestId of [...this.pendingOpens.keys()]) this.rejectPending(requestId, error);
  }
}
