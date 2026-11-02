import { test } from "node:test";
import assert from "node:assert/strict";
import { countHintTokens } from "../claude.js";
import { buildHintRequest } from "../lib/hintRequest.js";

test("token counting keeps the live response schema and inputs without generation-only options", async () => {
  const original = globalThis.fetch;
  const body = { ...buildHintRequest({ model: "example-model", transcript: [], cvText: "Synthetic CV" }), stream: true };
  let sent;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages/count_tokens");
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({ input_tokens: 9000 }));
  };
  try {
    assert.equal(await countHintTokens({ apiKey: "example-test-key", body }), 9000);
    assert.deepEqual(sent.system, body.system);
    assert.deepEqual(sent.messages, body.messages);
    assert.deepEqual(sent.output_config, body.output_config, "the response format adds input tokens too");
    assert.equal(sent.model, body.model);
    for (const key of ["max_tokens", "fallbacks", "stream"]) assert.equal(key in sent, false);
  } finally { globalThis.fetch = original; }
});
