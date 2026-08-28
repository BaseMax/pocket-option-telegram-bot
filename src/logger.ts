const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'silent'] as const;

export type LogLevel = (typeof LEVELS)[number];

const COLORS = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
} as const;

const LEVEL_COLOR: Record<Exclude<LogLevel, 'silent'>, string> = {
  trace: COLORS.gray,
  debug: COLORS.cyan,
  info: COLORS.green,
  warn: COLORS.yellow,
  error: COLORS.red,
};

function envLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return (LEVELS as readonly string[]).includes(raw) ? (raw as LogLevel) : 'info';
}

let currentLevel: LogLevel = envLevel();

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function enabled(level: Exclude<LogLevel, 'silent'>): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(currentLevel);
}

export interface Logger {
  trace(msg: string, extra?: unknown): void;
  debug(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
  child(scope: string): Logger;
}

function render(extra: unknown): string {
  if (extra === undefined) return '';
  if (extra instanceof Error) return ` ${COLORS.gray}${extra.stack ?? extra.message}${COLORS.reset}`;
  if (typeof extra === 'string') return ` ${COLORS.gray}${extra}${COLORS.reset}`;
  try {
    const text = JSON.stringify(extra);
    const truncated = text.length > 600 ? `${text.slice(0, 600)}…` : text;
    return ` ${COLORS.gray}${truncated}${COLORS.reset}`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return ` ${COLORS.gray}[unserializable: ${reason}]${COLORS.reset}`;
  }
}

export function createLogger(scope: string): Logger {
  const emit = (level: Exclude<LogLevel, 'silent'>, msg: string, extra?: unknown): void => {
    if (!enabled(level)) return;
    const stamp = new Date().toISOString();
    const color = LEVEL_COLOR[level];
    const line = `${COLORS.gray}${stamp}${COLORS.reset} ${color}${level.toUpperCase().padEnd(5)}${COLORS.reset} ${COLORS.magenta}[${scope}]${COLORS.reset} ${msg}${render(extra)}`;
    if (level === 'error' || level === 'warn') console.error(line);
    else console.log(line);
  };

  return {
    trace: (m, e) => emit('trace', m, e),
    debug: (m, e) => emit('debug', m, e),
    info: (m, e) => emit('info', m, e),
    warn: (m, e) => emit('warn', m, e),
    error: (m, e) => emit('error', m, e),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}

export const log = createLogger('app');
