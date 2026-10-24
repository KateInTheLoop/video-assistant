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

export const HINT_TIMEOUT_MS = 8000;   // a hint that arrives after the candidate started answering is useless
export const PREP_TIMEOUT_MS = 180000; // CV extraction and debriefs may legitimately take a while

async function call(apiKey, body, betas, timeoutMs = PREP_TIMEOUT_MS) {
  if (!apiKey) throw new Error("No Anthropic API key set (Settings).");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(API, { method: "POST", headers: headers(apiKey, betas), body: JSON.stringify(body), signal: ac.signal });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? `Claude did not answer within ${Math.round(timeoutMs / 1000)} s.` : `Network error reaching Claude: ${e.message}`);
  } finally { clearTimeout(timer); }
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 300)}`);
  }
  const msg = await res.json();
  if (msg.stop_reason === "refusal") throw new Error("Claude declined this request.");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return { data: JSON.parse(text), usage: msg.usage || {}, model: msg.model };
}

// A lightweight auth probe: a 1-token message. 200/400 means the key works; 401/403 means it does not.
export async function checkAnthropicKey(apiKey) {
  if (!apiKey) return { ok: false, reason: "No Anthropic key saved." };
  let res;
  try {
    res = await fetch(API, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
    });
  } catch (e) {
    return { ok: false, reason: `Cannot reach api.anthropic.com (${e.message}).` };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: `Anthropic rejected the key (HTTP ${res.status}). Check the key in Settings.` };
  if (res.ok || res.status === 400) return { ok: true, reason: "Key OK." };
  const body = await res.text().catch(() => "");
  return { ok: false, reason: `Anthropic returned HTTP ${res.status}. ${body.slice(0, 160)}` };
}

// --- Live hint -------------------------------------------------------------

// Resolves to { hint, usage, ms, model }. The caller validates `hint` and records diagnostics.
export async function getHint({ apiKey, ...ctx }) {
  const t0 = performance.now();
  const { data, usage, model } = await call(apiKey, buildHintRequest(ctx), ["server-side-fallback-2026-07-01"], HINT_TIMEOUT_MS);
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

// PDF -> plain text. Browsers have no dependency-free PDF parser, so Claude reads the file
// once; Haiku keeps it to a few seconds. The result lands in the CV textarea like any other
// upload, so the user can check it before anything else uses it.
const CV_TEXT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["text"],
  properties: { text: { type: "string", description: "The CV as plain text: headings, bullets as '- ', one blank line between sections. No commentary." } },
};

export async function cvTextFromPdf({ apiKey, base64 }) {
  const { data } = await call(apiKey, {
    model: "claude-haiku-5-5",
    max_tokens: 8000,
    output_config: { format: { type: "json_schema", schema: CV_TEXT_SCHEMA } },
    system: "Transcribe this CV to plain text, faithfully and completely. Keep the order, headings and bullet points; drop page numbers and repeated headers. Respond only with the JSON object.",
    messages: [{ role: "user", content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
      { type: "text", text: "Transcribe the CV." },
    ] }],
  }, []);
  return data.text;
}

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
      type: "array",
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

// --- Debrief after the interview ---------------------------------------------

const DEBRIEF_SCHEMA = {
  type: "object", additionalProperties: false, required: ["answers", "overall", "top_fix"],
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["question", "story_used", "star", "went_well", "improve"],
        properties: {
          question: { type: "string", description: "The interviewer's question, short." },
          story_used: { type: ["string", "null"], description: "Exact story-bank title the candidate drew on, or null." },
          star: {
            type: "object", additionalProperties: false, required: ["situation", "task", "action", "result"],
            properties: { situation: { type: "boolean" }, task: { type: "boolean" }, action: { type: "boolean" }, result: { type: "boolean" } },
            description: "Which STAR parts the answer actually contained.",
          },
          went_well: { type: "string", description: "One specific thing, quoting the candidate where possible." },
          improve: { type: "string", description: "One concrete change for next time. Not a rewritten answer." },
        },
      },
    },
    overall: { type: "string", description: "Two or three sentences, warm and specific." },
    top_fix: { type: "string", description: "The single most valuable thing to practise before the next interview." },
  },
};

export async function debrief({ apiKey, model, lines, stories }) {
  const transcript = lines.map((l) => `${l.speaker === "interviewer" ? "INTERVIEWER" : "CANDIDATE"}: ${l.text}`).join("\n");
  const bank = stories.map((s) => `- ${s.title}`).join("\n") || "(empty)";
  const { data } = await call(apiKey, {
    model,
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema: DEBRIEF_SCHEMA } },
    fallbacks: "default",
    system: `You are a supportive interview coach reviewing a transcript after the interview. For each question the interviewer asked, say which of the candidate's prepared stories they used (exact title or null), which STAR parts were present, one thing that went well, and one concrete improvement. Do not write model answers; the candidate must find their own words. Be specific and kind. Respond only with the JSON object.`,
    messages: [{ role: "user", content: `# Story bank titles\n${bank}\n\n# Transcript\n${transcript}` }],
  }, ["server-side-fallback-2026-07-01"]);
  return data;
}
