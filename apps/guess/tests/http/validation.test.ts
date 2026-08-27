import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { MAX_BODY_BYTES, ValidationError, opaqueIdSchema, parseJsonBody, parsePathParam } from "../../src/http/validation";

function jsonRequest(body: unknown, contentType = "application/json"): Request {
  return new Request("https://example.invalid/x", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const SCHEMA = z.object({ choiceId: opaqueIdSchema });

test("parseJsonBody accepts a well-formed matching payload", async () => {
  const result = await parseJsonBody(jsonRequest({ choiceId: "abc-123" }), SCHEMA);
  assert.equal(result.choiceId, "abc-123");
});

test("parseJsonBody rejects a non-JSON content type", async () => {
  await assert.rejects(() => parseJsonBody(jsonRequest({ choiceId: "abc" }, "text/plain"), SCHEMA), ValidationError);
});

test("parseJsonBody rejects malformed JSON", async () => {
  await assert.rejects(() => parseJsonBody(jsonRequest("{not valid json"), SCHEMA), ValidationError);
});

test("parseJsonBody rejects a payload that fails schema validation", async () => {
  await assert.rejects(() => parseJsonBody(jsonRequest({ choiceId: "has a space and !@#" }), SCHEMA), ValidationError);
});

test("parseJsonBody rejects a body larger than MAX_BODY_BYTES", async () => {
  const oversized = { choiceId: "a".repeat(MAX_BODY_BYTES + 100) };
  await assert.rejects(() => parseJsonBody(jsonRequest(oversized), SCHEMA), ValidationError);
});

test("parsePathParam accepts a valid opaque id", () => {
  assert.equal(parsePathParam("abc-123_XYZ", "gameId"), "abc-123_XYZ");
});

test("parsePathParam rejects undefined and malformed values", () => {
  assert.throws(() => parsePathParam(undefined, "gameId"), ValidationError);
  assert.throws(() => parsePathParam("has a space", "gameId"), ValidationError);
  assert.throws(() => parsePathParam("../../etc/passwd", "gameId"), ValidationError);
});
