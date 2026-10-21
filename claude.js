// Raw Messages API calls. No bundler in this extension, so we use fetch directly.
import { buildHintRequest } from "./lib/hintRequest.js";

const API = "https://api.anthropic.com/v1/messages";

function headers(apiKey, betas = []) {
  const h = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (betas.length) h["anthropic-beta"] = betas.join(",");
  return h;
}

async function call(apiKey, body, betas) {
  const res = await fetch(API, { method: "POST", headers: headers(apiKey, betas), body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 300)}`);
  }
  const msg = await res.json();
  if (msg.stop_reason === "refusal") throw new Error("Claude declined this request.");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { data: JSON.parse(text), usage: msg.usage || {}, model: msg.model };
}

// --- Live hint -------------------------------------------------------------

// Resolves to { hint, usage, ms, model }. The caller validates `hint` and records diagnostics.
export async function getHint({ apiKey, ...ctx }) {
  const t0 = performance.now();
  const { data, usage, model } = await call(apiKey, buildHintRequest(ctx), ["server-side-fallback-2026-07-01"]);
  return { hint: data, usage, model, ms: performance.now() - t0 };
}

// --- Prep: extract stories from CV ------------------------------------------

const STORIES_SCHEMA = {
  type: "object", additionalProperties: false, required: ["stories", "likely_questions"],
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["title", "situation", "action", "result", "tags"],
        properties: {
          title: { type: "string", description: "Short memorable title, 3-6 words." },
          situation: { type: "string" },
          action: { type: "string" },
          result: { type: "string", description: "Include numbers if the CV has them. Say 'result not stated in CV' if unknown." },
          tags: { type: "string", description: "Comma separated: leadership, conflict, failure, ambiguity, technical, impact, etc." },
        },
      },
    },
    likely_questions: { type: "array", items: { type: "string" }, description: "8-12 questions this job description makes likely." },
  },
};

export async function extractStories({ apiKey, model, cvText, jobDescription }) {
  const { data } = await call(apiKey, {
    model,
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema: STORIES_SCHEMA } },
    fallbacks: "default",
    system: `You help a candidate prepare for interviews. From their CV, draft a bank of concrete stories in STAR form (situation, action, result).
Draft only what the CV supports. Where the CV is vague, keep the draft short and mark what the candidate needs to fill in; the candidate will edit every story in their own words before using it.
Then, given the job description, list the questions most likely to come up. Respond only with the JSON object.`,
    messages: [{ role: "user", content: `# CV\n${cvText}\n\n# Job description\n${jobDescription || "(none provided)"}` }],
  }, ["server-side-fallback-2026-07-01"]);
  return data;
}
