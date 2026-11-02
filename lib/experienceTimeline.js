// Topic experience comes from dated CV evidence, never an assumed length of software use.
// Model links can suggest related examples, but only literal mentions count toward the
// employment-window upper bound. A role's full dates are not confirmed topic tenure.
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const STOP_WORDS = new Set(["a", "an", "the", "of", "and", "or", "to", "for", "in", "on", "at", "with", "your", "you", "using"]);

function cleanTopic(text) {
  return text.replace(/^[\s:,-]+|[\s?.!]+$/g, "")
    .replace(/[,;]\s+(?:and\s+)?(?:how|what|why|when|where)\b[\s\S]*$/i, "")
    .replace(/\s+(?:please|so far|overall|in total)\s*$/i, "").trim();
}

// Explicit personal-experience requests only. Generic fragments require conversational
// context in the caller, and definitions such as "what is inventory costing" stay technical.
export function experienceQuestion(text = "") {
  if (typeof text !== "string") return null;
  const input = text.replace(/\s+/g, " ").trim();
  const duration = [
    /\bhow many (?:years?|months?)(?:\s+(?:of\s+)?(?:hands[- ]on\s+|professional\s+|relevant\s+)?experience)?\s+(?:do|did)\s+you\s+have\s+(?:with|in|using|of|on)\s+(.+)/i,
    /\bhow many (?:years?|months?)\s+of\s+experience\s+(?:have|had)\s+you\s+had\s+(?:with|in|using|of|on)\s+(.+)/i,
    /\bhow many (?:years?|months?)\s+(?:of\s+)?(.+?)\s+experience\s+(?:do|did)\s+you\s+have\b/i,
    /\bhow many (?:years?|months?)\s+(?:of\s+)?experience\s+(?:with|in|using|of|on)\s+(.+?)\s+(?:do|did)\s+you\s+have\b/i,
    /\bhow many (?:years?|months?)\s+(?:have|had)\s+you\s+(?:worked|been working|used|been using)\s+(?:(?:with|in|on)\s+)?(.+)/i,
    /\bhow long\s+(?:have|had)\s+you\s+(?:worked|been working|used|been using)\s+(?:(?:with|in|on)\s+)?(.+)/i,
  ];
  const narrative = [
    /\b(?:tell|talk to)\s+(?:me|us)\s+about\s+(?:your\s+)?(?:hands[- ]on\s+|professional\s+|relevant\s+)?experience\s+(?:working\s+)?(?:with|in|using|of|on)\s+(.+)/i,
    /\btalk\s+about\s+your\s+experience\s+(?:working\s+)?(?:with|in|using|of|on)\s+(.+)/i,
    /\b(?:what is|what's|describe|outline|summari[sz]e|explain)\s+your\s+(?:hands[- ]on\s+|professional\s+|relevant\s+)?experience\s+(?:with|in|using|of|on)\s+(.+)/i,
    /\b(?:walk|talk|take|run)\s+(?:me|us)\s+through\s+your\s+(?:(?:work|professional|hands[- ]on)\s+)?experience\s+(?:with|in|using|of|on)\s+(.+)/i,
    /\b(?:do|have)\s+you\s+(?:have|had)\s+(?:any\s+)?(?:professional\s+|hands[- ]on\s+|relevant\s+)?experience\s+(?:with|in|using|of|on)\s+(.+)/i,
    /\bwhat\s+experience\s+(?:do|did)\s+you\s+have\s+(?:with|in|using|of|on)\s+(.+)/i,
  ];
  for (const [patterns, asksDuration] of [[duration, true], [narrative, false]]) {
    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (!match) continue;
      const topic = cleanTopic(match[1]);
      if (!topic || topic.length > 120 || /^(?:this|that|it|them|something|anything|your (?:resume|cv|career))$/i.test(topic)) return null;
      return { topic, asksDuration };
    }
  }
  return null;
}

function tokens(text) {
  // Keep C++, C#, .NET and Node.js distinct from unrelated single-letter tokens.
  return (String(text).normalize("NFKC").toLowerCase().match(/(?:\.[a-z][a-z0-9]*|[a-z0-9]+(?:[.#][a-z0-9]+)*(?:\+\+|#)?)/g) || [])
    .filter((token) => !STOP_WORDS.has(token))
    .map((token) => token.length > 4 && /ies$/.test(token) ? `${token.slice(0, -3)}y`
      : token.length > 3 && /s$/.test(token) && !/(?:ss|us|is)$/.test(token) ? token.slice(0, -1) : token);
}

function evidenceClauses(text) {
  // Scope denials to their own clause. An earlier positive verb for SQL must not cancel
  // "never used Workday" later in the same bullet. Keep offsets for quote anchoring.
  const source = String(text), clauses = [];
  const separators = /[;,!?\n]+|\.(?=\s|$)|\s+(?:but|however|whereas|yet|although|despite)\s+|\s+and\s+(?=(?:(?:i|we|they)\s+)?(?:never|not|no|without|did|have|has|was|were|used|worked|implemented|supported|tested|built|managed|maintained|handled|developed)\b)|\s+(?=not\b(?!\s+only\b))|\s+(?=(?:with\s+)?(?:no|without)\s+(?:(?:prior|direct|hands[- ]on|professional|practical|relevant)\s+)*(?:experience|exposure|knowledge)\b)/gi;
  let start = 0, match;
  const add = (end) => {
    const raw = source.slice(start, end), leading = raw.length - raw.trimStart().length;
    const value = raw.trim();
    if (value) clauses.push({ text: value, start: start + leading, end: start + leading + value.length });
  };
  while ((match = separators.exec(source))) { add(match.index); start = match.index + match[0].length; }
  add(source.length);
  return clauses;
}

function deniesExperience(text) {
  return /\b(?:no|without)\s+(?:(?:prior|direct|hands[- ]on|professional|practical|relevant)\s+)*(?:experience|exposure|knowledge)\b|\bno\s+(?:[\w+#.]+\s+){1,3}(?:experience|exposure|knowledge)\b|\bnever\s+(?:used|worked|handled)\b|\bnot\s+(?:use|used|using|work|worked|responsible|with|in|on)\b|^not\b(?!\s+only\b)/i.test(text);
}

function matchingClauses(text, topic) {
  const wanted = tokens(topic);
  if (!wanted.length) return [];
  return evidenceClauses(text).filter((clause) => {
    if (deniesExperience(clause.text)) return false;
    const source = new Set(tokens(clause.text));
    return wanted.every((token) => source.has(token));
  });
}

export function topicMatches(text, topic) {
  return matchingClauses(text, topic).length > 0;
}

export function quoteFromRole(role, quote) {
  if (!role || typeof quote !== "string" || quote.trim().length < 3) return null;
  const needle = quote.trim().toLowerCase();
  for (const source of [role.title, ...(role.highlights || [])]) {
    if (typeof source !== "string") continue;
    const clauses = evidenceClauses(source);
    let index = source.toLowerCase().indexOf(needle);
    while (index >= 0) {
      const overlap = clauses.filter((clause) => clause.start < index + needle.length && clause.end > index);
      if (overlap.length && overlap.every((clause) => !deniesExperience(clause.text))) return source.slice(index, index + needle.length);
      index = source.toLowerCase().indexOf(needle, index + 1);
    }
  }
  return null;
}

// roleIndex is 1-based in the complete chronological CV list. Entries retain that index
// even when only a subset of roles is relevant. No story-shortlist limit is applied.
export function topicTimeline(roles = [], topic = "", modelEvidence = []) {
  const entries = [];
  roles.forEach((role, index) => {
    const quotes = [role.title, ...(role.highlights || [])]
      .filter((source) => typeof source === "string")
      .flatMap((source) => matchingClauses(source, topic).map((clause) => clause.text));
    const direct = quotes.length > 0;
    for (const evidence of Array.isArray(modelEvidence) ? modelEvidence : []) {
      if (!evidence || evidence.role !== index + 1) continue;
      const quote = quoteFromRole(role, evidence.quote);
      if (quote) quotes.push(quote);
    }
    const unique = [...new Set(quotes)];
    if (unique.length) entries.push({ role, roleIndex: index + 1, quotes: unique, direct });
  });
  return entries.sort((a, b) => (boundary(a.role.from, false)?.point ?? Infinity) - (boundary(b.role.from, false)?.point ?? Infinity) || a.roleIndex - b.roleIndex);
}

function boundary(value, end) {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (end && /^(?:present|current|now)$/.test(text)) return { present: true, coarse: false };
  const year = text.match(/^((?:19|20)\d{2})$/);
  if (year) return { point: Number(year[1]) * 12 + (end ? 12 : 0), coarse: true };
  const month = text.match(/^([a-z]+)\.?\s+((?:19|20)\d{2})$/);
  if (!month) return null;
  const name = month[1];
  const index = MONTH_NAMES.findIndex((full) => name === full || name === full.slice(0, 3) || (full === "september" && name === "sept"));
  return index < 0 ? null : { point: Number(month[2]) * 12 + index + (end ? 1 : 0), coarse: false };
}

function monthPoint(date) {
  const year = date.getUTCFullYear(), month = date.getUTCMonth();
  const start = Date.UTC(year, month, 1), end = Date.UTC(year, month + 1, 1);
  return year * 12 + month + (date.getTime() - start) / (end - start);
}

function pointDate(point) {
  const whole = Math.floor(point), year = Math.floor(whole / 12), month = whole % 12;
  const start = Date.UTC(year, month, 1), end = Date.UTC(year, month + 1, 1);
  return new Date(Math.round(start + (point - whole) * (end - start))).toISOString().slice(0, 10);
}

function durationLabel(months) {
  const years = Math.floor(months / 12), rest = months % 12;
  return [years ? `${years} year${years === 1 ? "" : "s"}` : "", rest ? `${rest} month${rest === 1 ? "" : "s"}` : ""].filter(Boolean).join(" ") || "less than one month";
}

/**
 * {months, label, uncertain, roleCount, omittedRoles, intervals, caveat}
 * `months` is a rounded-up upper bound on the union of direct-match employment windows,
 * never confirmed topic tenure. Monthly boundaries include the listed end month; year-only
 * boundaries use the broadest possible months and flag uncertainty. Present/future end
 * boundaries stop at asOf. Indirect examples and invalid/future-only roles are not counted.
 * `intervals` contain ISO dates with exclusive end boundaries, after union and clipping.
 */
export function experienceDuration(entries = [], asOf = new Date()) {
  const now = asOf instanceof Date ? asOf : new Date(asOf);
  const windows = [];
  let omittedRoles = 0, uncertain = false, indirect = 0;
  const cutoff = Number.isFinite(now.getTime()) ? monthPoint(now) : null;
  for (const entry of entries) {
    if (entry.direct !== true) { omittedRoles++; indirect++; uncertain = true; continue; }
    const start = boundary(entry.role?.from, false), finish = boundary(entry.role?.to, true);
    if (cutoff === null || !start || !finish) { omittedRoles++; uncertain = true; continue; }
    const end = Math.min(finish.present ? cutoff : finish.point, cutoff);
    if (end <= start.point) { omittedRoles++; uncertain = true; continue; }
    uncertain ||= start.coarse || finish.coarse || (!finish.present && finish.point > cutoff);
    windows.push({ start: start.point, end });
  }
  windows.sort((a, b) => a.start - b.start || a.end - b.end);
  const union = [];
  for (const window of windows) {
    const last = union.at(-1);
    if (last && window.start <= last.end) last.end = Math.max(last.end, window.end);
    else union.push({ ...window });
  }
  const months = union.length ? Math.max(1, Math.ceil(union.reduce((total, window) => total + window.end - window.start, 0) - 1e-8)) : null;
  const label = months === null ? "Topic duration is not established by dated CV roles"
    : `Up to ${durationLabel(months)} across matching role windows${uncertain ? " (approximate dates)" : ""}`;
  let caveat = "Role dates do not confirm continuous use of this skill. Confirm actual topic tenure before quoting a number. Overlaps count once; gaps are excluded.";
  if (indirect) caveat += " Model-related examples are not counted.";
  return { months, label, uncertain, roleCount: windows.length, omittedRoles,
    intervals: union.map(window => ({ from: pointDate(window.start), to: pointDate(window.end) })), caveat };
}
