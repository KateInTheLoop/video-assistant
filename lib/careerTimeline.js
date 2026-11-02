// Career navigation uses the CV itself, independently of the model's story shortlist.
// Dates, employers and duties stay as written; uncertain transitions are never invented.
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DATE = "(?:(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\\.?\\s+)?(?:19|20)\\d{2}";
const RANGE = new RegExp(`(${DATE})\\s*(?:[-–—]|to)\\s*(${DATE}|present|current|now)`, "i");
const EXPERIENCE = /^(?:(?:professional|work|employment|career|relevant)\s+)?(?:experience|history)\s*:?$/i;
const SECTION = /^(?:education|skills|technical skills|certifications?|languages|qualifications|professional development|references)\s*:?$/i;
const BULLET = /^\s*(?:[-•●▪‣*]|\d+[.)])\s+/;

function dateOrder(text) {
  if (/present|current|now/i.test(text)) return Infinity;
  const year = Number(text.match(/(?:19|20)\d{2}/)?.[0]);
  const month = MONTHS.indexOf(text.slice(0, 3).toLowerCase());
  return year * 12 + Math.max(0, month);
}

export function isCareerWalkthrough(text = "") {
  return /\b(?:walk|talk|take|run)\s+(?:me|us)\s+through\b[\s\S]{0,100}\b(?:resum[eé]|résumé|cv|career|background|(?:work|professional)\s+(?:experience|history))\b/i.test(text)
    || /\b(?:overview|summary|summari[sz]e|outline)\b[\s\S]{0,60}\b(?:career|resum[eé]|résumé|cv|(?:work|professional)\s+(?:experience|history))\b/i.test(text)
    || /\b(?:tell\s+(?:me|us)\s+(?:a\s+(?:little(?:\s+bit)?|bit)\s+)?about|describe)\s+(?:yourself|your\s+(?:resum[eé]|résumé|cv|career|background|(?:professional|work)\s+(?:history|experience)))\s*(?:,?\s*please)?\s*[?.!]*$/i.test(text)
    || /\bintroduce\s+yourself\s*(?:,?\s*please)?\s*[?.!]*$/i.test(text);
}

export function careerTimeline(cvText = "") {
  const lines = cvText.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  const section = lines.findIndex((line) => EXPERIENCE.test(line));
  const start = section < 0 ? 0 : section + 1;
  let end = lines.findIndex((line, i) => i >= start && SECTION.test(line));
  if (end < 0) end = lines.length;
  const headers = [];
  for (let i = start; i < end; i++) {
    if (BULLET.test(lines[i])) continue;
    const match = RANGE.exec(lines[i]);
    if (!match) continue;
    const before = lines[i].slice(0, match.index).trim().replace(/[|,\s]+$/, "");
    const title = before || (i > start && !BULLET.test(lines[i - 1]) ? lines[i - 1] : "");
    if (!title) continue;
    headers.push({ index: before ? i : i - 1, dateIndex: i, title,
      dates: match[0], from: match[1], to: match[2], order: dateOrder(match[1]),
      // Some CVs put employer after dates on the same line.
      inlineEmployer: lines[i].slice(match.index + match[0].length).replace(/^[\s|,]+/, "").trim() });
  }
  return headers.map((header, i) => {
    const body = lines.slice(header.dateIndex + 1, headers[i + 1]?.index ?? end);
    const employer = header.inlineEmployer || (body[0] && !BULLET.test(body[0]) ? body.shift() : "");
    const highlights = [];
    for (const line of body) {
      if (BULLET.test(line)) highlights.push(line.replace(BULLET, ""));
      else if (highlights.length) highlights[highlights.length - 1] += ` ${line}`;
      else highlights.push(line);
    }
    return { title: header.title, employer, dates: header.dates, from: header.from, to: header.to, highlights,
      order: header.order, endOrder: dateOrder(header.to) };
  }).sort((a, b) => a.order - b.order || a.endOrder - b.endOrder)
    .map(({ order, endOrder, ...role }) => role);
}

// Strong, explicit resume requests should not fall back to the story-ranking UI even if
// the model calls them generic experience questions. This also works while streaming.
export function routeCareerHint(hint, question) {
  if (!hint || (!isCareerWalkthrough(question) && !(hint.is_question && hint.question_type === "career_walkthrough"))) return hint;
  return { ...hint, is_question: true, question_type: "career_walkthrough", career_key: question,
    stories: [], cv_leads: [], technical_points: [] };
}
