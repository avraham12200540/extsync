import assert from "node:assert/strict";
import { test } from "node:test";
import { createLogger } from "../../src/http/logger";

function captureLogger(requestId = "req-1") {
  const lines: string[] = [];
  const logger = createLogger((line) => lines.push(line), requestId);
  return { logger, lines };
}

test("emits structured JSON with ts/level/event/requestId", () => {
  const { logger, lines } = captureLogger("req-42");
  logger.info("session.bootstrap", { isNewSession: true });
  const parsed = JSON.parse(lines[0]!);
  assert.equal(parsed.event, "session.bootstrap");
  assert.equal(parsed.requestId, "req-42");
  assert.equal(parsed.level, "info");
  assert.ok(parsed.ts);
  assert.equal(parsed.isNewSession, true);
});

test("redacts cookie, CSRF, and idempotency header-shaped fields", () => {
  const { logger, lines } = captureLogger();
  logger.info("request.received", {
    cookie: "guess_session=super-secret-raw-token",
    "X-Guess-CSRF": "raw-csrf-value",
    "x-idempotency-key": "client-key-123",
  });
  const line = lines[0]!;
  assert.doesNotMatch(line, /super-secret-raw-token/);
  assert.doesNotMatch(line, /raw-csrf-value/);
  assert.doesNotMatch(line, /client-key-123/);
  assert.match(line, /REDACTED/);
});

test("redacts session token hash, ip hash, and raw ip fields", () => {
  const { logger, lines } = captureLogger();
  logger.info("session.lookup", { sessionTokenHash: "abcd1234hash", ipHash: "iphashvalue", ip: "203.0.113.5" });
  const line = lines[0]!;
  assert.doesNotMatch(line, /abcd1234hash/);
  assert.doesNotMatch(line, /iphashvalue/);
  assert.doesNotMatch(line, /203\.0\.113\.5/);
});

test("redacts usernames even in a sensitive-feedback context", () => {
  const { logger, lines } = captureLogger();
  logger.info("round.resolve", { correctUsername: "realPersonName", username: "anotherName" });
  const line = lines[0]!;
  assert.doesNotMatch(line, /realPersonName/);
  assert.doesNotMatch(line, /anotherName/);
});

test("redacts raw and clean post content", () => {
  const { logger, lines } = captureLogger();
  logger.info("post.imported", { rawContent: "<p>the actual forum post html</p>", cleanContent: "the actual forum post text" });
  const line = lines[0]!;
  assert.doesNotMatch(line, /the actual forum post/);
});

test("redacts a raw request body passed under the 'body' key, including nested fields", () => {
  const { logger, lines } = captureLogger();
  logger.warn("request.body", { body: { choiceId: "abc", sessionTokenHash: "should-not-appear" } });
  const line = lines[0]!;
  assert.doesNotMatch(line, /should-not-appear/);
});

test("redacts stack traces and raw error objects", () => {
  const { logger, lines } = captureLogger();
  const err = new Error("some internal detail with a path /srv/secret/config.ts");
  logger.error("handler.failed", { error: err.message, stack: err.stack });
  const line = lines[0]!;
  assert.doesNotMatch(line, /some internal detail/);
  assert.doesNotMatch(line, /\/srv\/secret/);
});

test("does not redact ordinary safe fields (gameId, roundId, event names, counts)", () => {
  const { logger, lines } = captureLogger();
  logger.info("round.hint_revealed", { gameId: "g-1", roundId: "r-1", hintsRevealedCount: 3 });
  const line = lines[0]!;
  assert.match(line, /g-1/);
  assert.match(line, /r-1/);
  assert.match(line, /3/);
});

test("correlationId defaults to requestId when not provided", () => {
  const lines: string[] = [];
  const logger = createLogger((line) => lines.push(line), "req-7");
  logger.info("x");
  const parsed = JSON.parse(lines[0]!);
  assert.equal(parsed.correlationId, "req-7");
});
