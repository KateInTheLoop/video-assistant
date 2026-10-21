// Raw Messages API calls. No bundler in this extension, so we use fetch directly.
import { buildHintRequest } from "./lib/hintRequest.js";
import { STORY_FROM_ANSWER_SCHEMA } from "./lib/storyInterview.js";

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

// --- Prep: turn a typed interview answer into a story ------------------------

export async function storyFromAnswer({ apiKey, model, question, tag, answer }) {
  const { data } = await call(apiKey, {
    model,
    max_tokens: 4000,
    output_config: { format: { type: "json_schema", schema: STORY_FROM_ANSWER_SCHEMA } },
    fallbacks: "default",
    system: `You turn a candidate's spoken-style answer into a STAR story card for their own notes.
Keep their words and their facts. Tighten, do not embellish, never add outcomes or numbers they did not state.
Point out what is missing so they can fill it in. Respond only with the JSON object.`,
    messages: [{ role: "user", content: `Question (${tag}): ${question}

Candidate's answer:
${answer}` }],
  }, ["server-side-fallback-2026-07-01"]);
  return data;
}

// --- Prep: gap report --------------------------------------------------------

const GAP_SCHEMA = {
  type: "object", additionalProperties: false, required: ["questions"],
  properties: {
    questions: {
      type: "array", minItems: 8, maxItems: 14,
      items: {
        type: "object", additionalProperties: false, required: ["q", "story"],
        properties: {
          q: { type: "string", description: "A question this job description makes likely." },
          story: { type: ["string", "null"], description: "Exact title of the story-bank entry that best answers it, or null if no story fits." },
        },
      },
    },
  },
};

export async function gapReport({ apiKey, model, jobDescription, stories }) {
  const bank = stories.map((s) => `- ${s.title} (${s.tags || "no tags"}): ${s.situation.slice(0, 160)}`).join("\n") || "(empty)";
  const { data } = await call(apiKey, {
    model,
    max_tokens: 4000,
    output_config: { format: { type: "json_schema", schema: GAP_SCHEMA } },
    fallbacks: "default",
    system: `You prepare a candidate for an interview. Given the job description and the titles of their prepared stories, list the questions most likely to come up and, for each, the single story that answers it best, by exact title. Use null when nothing fits well; an honest null is more useful than a stretch. Respond only with the JSON object.`,
    messages: [{ role: "user", content: `# Job description\n${jobDescription || "(none)"}\n\n# Story bank\n${bank}` }],
  }, ["server-side-fallback-2026-07-01"]);
  const titles = new Set(stories.map((s) => s.title.trim().toLowerCase()));
  return data.questions.map((x) => ({ q: x.q, story: x.story && titles.has(x.story.trim().toLowerCase()) ? x.story : null }));
}
