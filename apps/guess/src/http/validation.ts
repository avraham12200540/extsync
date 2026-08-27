import { z } from "zod";

export class ValidationError extends Error {}

/** Generic opaque-id shape (UUIDs, base64url tokens, etc.) - never a format that implies a predictable/derivable structure. */
export const opaqueIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "must be an opaque id");

export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/, "must be a client-generated opaque idempotency key");

/** Generous for these tiny JSON payloads (an id, a key) - guards against a client sending an oversized body, not a real payload-size need. */
export const MAX_BODY_BYTES = 8 * 1024;

export function parsePathParam(value: string | undefined, fieldName: string): string {
  const result = opaqueIdSchema.safeParse(value);
  if (!result.success) throw new ValidationError(`invalid path parameter: ${fieldName}`);
  return result.data;
}

/**
 * Validates Content-Type, body size, JSON well-formedness, and shape (via
 * `schema`) before returning parsed data - any failure throws
 * ValidationError, uniformly mapped to 400 by errors.ts. GET endpoints
 * never call this; they must not read/consume a body at all.
 */
export async function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ValidationError("Content-Type must be application/json");
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new ValidationError("request body too large");
  }

  let json: unknown;
  try {
    json = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    throw new ValidationError("malformed JSON body");
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`).join(", ");
    throw new ValidationError(`invalid request body (${detail})`);
  }
  return result.data;
}

/**
 * Shared page/pageSize query parsing for every admin list endpoint - one
 * place enforcing bounds (page >= 1, 1 <= pageSize <= maxPageSize) so a
 * caller can never request an unbounded page. Defaults are applied when a
 * query param is absent; anything present but malformed is a ValidationError,
 * never silently clamped/ignored.
 */
export function parsePaginationQuery(searchParams: URLSearchParams, defaultPageSize: number, maxPageSize: number): { page: number; pageSize: number } {
  const pageSchema = z.coerce.number().int().min(1).default(1);
  const pageSizeSchema = z.coerce.number().int().min(1).max(maxPageSize).default(defaultPageSize);

  const pageRaw = searchParams.get("page");
  const pageSizeRaw = searchParams.get("pageSize");

  const pageResult = pageSchema.safeParse(pageRaw ?? undefined);
  if (!pageResult.success) throw new ValidationError("invalid query parameter: page");
  const pageSizeResult = pageSizeSchema.safeParse(pageSizeRaw ?? undefined);
  if (!pageSizeResult.success) throw new ValidationError(`invalid query parameter: pageSize (max ${maxPageSize})`);

  return { page: pageResult.data, pageSize: pageSizeResult.data };
}

/** Validates a query param against an allowlist of exact string values - used for sort fields/directions/status filters so a caller can never inject an arbitrary column/keyword into a query. */
export function parseEnumQuery<T extends readonly [string, ...string[]]>(
  searchParams: URLSearchParams,
  paramName: string,
  allowed: T,
  defaultValue: T[number],
): T[number] {
  const raw = searchParams.get(paramName);
  if (raw === null) return defaultValue;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new ValidationError(`invalid query parameter: ${paramName} (must be one of ${allowed.join(", ")})`);
  }
  return raw;
}

/** Same allowlist discipline as parseEnumQuery, but the param is optional with no default - returns undefined when absent, so callers can distinguish "no filter" from "filter to X". */
export function parseOptionalEnumQuery<T extends readonly [string, ...string[]]>(
  searchParams: URLSearchParams,
  paramName: string,
  allowed: T,
): T[number] | undefined {
  const raw = searchParams.get(paramName);
  if (raw === null || raw === "") return undefined;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new ValidationError(`invalid query parameter: ${paramName} (must be one of ${allowed.join(", ")})`);
  }
  return raw;
}
