/**
 * Structured logging.
 *
 * Logs are JSON so they stay queryable in Vercel's log drain. Two rules:
 *   1. Never log a credential, access token, full account number or raw
 *      transaction description (see docs/SECURITY.md).
 *   2. Prefer a few high-signal lines over a stream of trivia. Jarvis will
 *      eventually run continuously; noisy logs become unreadable fast.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Returns a logger that stamps every line with the given context. */
  child(context: LogContext): Logger;
}

function resolveThreshold(): number {
  const configured = process.env.LOG_LEVEL;
  if (configured === "debug" || configured === "info" || configured === "warn" || configured === "error") {
    return levelRank[configured];
  }
  return levelRank.info;
}

function emit(level: LogLevel, scope: string, base: LogContext, message: string, context?: LogContext): void {
  if (levelRank[level] < resolveThreshold()) return;

  const line = JSON.stringify({
    level,
    scope,
    message,
    time: new Date().toISOString(),
    ...base,
    ...context,
  });

  // `console` is the transport Vercel captures. The eslint rule that bans
  // console elsewhere is intentionally not disabled for warn/error.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else process.stdout.write(`${line}\n`);
}

export function createLogger(scope: string, base: LogContext = {}): Logger {
  return {
    debug: (message, context) => emit("debug", scope, base, message, context),
    info: (message, context) => emit("info", scope, base, message, context),
    warn: (message, context) => emit("warn", scope, base, message, context),
    error: (message, context) => emit("error", scope, base, message, context),
    child: (context) => createLogger(scope, { ...base, ...context }),
  };
}

export const logger = createLogger("jarvis");
