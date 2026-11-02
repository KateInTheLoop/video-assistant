import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { INTERVIEW_SKILL, INTERVIEW_SKILL_URL, skillInstructions } from "../lib/interviewSkill.js";
import { buildHintRequest, buildPrewarmRequest } from "../lib/hintRequest.js";
import { getHint } from "../claude.js";

test("runtime and cache warmup load the maintained Markdown skill body", async () => {
  const file = await readFile(INTERVIEW_SKILL_URL, "utf8");
  const expected = skillInstructions(file);
  assert.equal(INTERVIEW_SKILL, expected);
  const ctx = { model: "example", transcript: [], stories: [] };
  const request = buildHintRequest(ctx), warm = buildPrewarmRequest(ctx);
  assert.ok(request.system[0].text.startsWith(expected));
  assert.equal(warm.system[0].text, request.system[0].text);
  assert.doesNotMatch(request.system[0].text, /^---\nname:/);
  assert.throws(() => skillInstructions("---\nname: example\n---\n"), /empty/);
});

test("the actual Anthropic transport sends the skill as system instructions", async () => {
  const previous = globalThis.fetch;
  let sent;
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response(`data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: '{"is_question":false}' } })}\n\n`);
  };
  try {
    await getHint({ apiKey: "example-test", model: "example", transcript: [], stories: [] });
    assert.ok(sent.system[0].text.includes(INTERVIEW_SKILL));
    assert.equal(sent.output_config.format.type, "json_schema");
  } finally { globalThis.fetch = previous; }
});
