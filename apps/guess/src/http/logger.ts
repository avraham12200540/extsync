/**
 * Structured JSON logging with request/correlation id and event names.
 * Every field is redacted through an allowlist-of-exclusions BEFORE being
 * serialized - cookies, auth/CSRF/idempotency headers, request bodies,
 * session/IP hashes, usernames, raw/clean post content, and stack
 * details never reach a log line, even if a caller passes them by
 * accident. Nested objects are redacted recursively.
 */

const REDACTED_KEYS = new Set(
  [
    "cookie",
    "set-cookie",
    "authorization",
    "x-guess-csrf",
    "csrf",
    "csrftoken",
    "rawcsrftoken",
    "x-idempotency-key",
    "idempotencykey",
    "body",
    "requestbody",
    "sessiontoken",
    "rawsessiontoken",
    "sessiontokenhash",
    "csrftokenhash",
    "iphash",
    "ip",
    "username",
    "correctusername",
    "targetusername",
    "rawcontent",
    "cleancontent",
    "stack",
    "error", // raw Error objects/messages - use the mapped ApiErrorShape's `code` instead
    // Admin-specific: never a secret, but PII an audit/observability log must not carry either.
    "email",
    "passwordhash",
    "password",
    "x-guess-admin-csrf",
    "admincsrf",
  ].map((k) => k.toLowerCase()),
);

const REDACTED = "[REDACTED]";

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return redactFields(value as Record<string, unknown>);
  }
  return value;
}

function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? REDACTED : redactValue(value);
  }
  return out;
}

export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export function createLogger(sink: (line: string) => void, requestId: string, correlationId?: string): Logger {
  function emit(level: string, event: string, fields: Record<string, unknown> = {}): void {
    const record = {
      ts: new Date().toISOString(),
      level,
      event,
      requestId,
      correlationId: correlationId ?? requestId,
      ...redactFields(fields),
    };
    sink(JSON.stringify(record));
  }
  return {
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields) => emit("error", event, fields),
  };
}
