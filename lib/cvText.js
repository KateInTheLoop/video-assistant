// Turns an uploaded CV into the compact plain text that goes into the cached hint prefix.
// Plain text beats JSON here: a CV has no structure worth the ~30% token overhead of keys
// and quotes, and Claude reads prose and bullets natively. Pure, so it is testable.

export const MAX_CV_CHARS = 14000; // ~3.5k tokens; a long CV past this is appendix material

// Collapse the noise that converters leave behind: trailing spaces, runs of blank lines,
// page furniture repeated on every page, bullets in six different glyphs.
export function normalizeCvText(text) {
  let lines = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[•●▪‣⁃◦]/g, "-") // bullet glyphs -> dash
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim());

  lines = dropRepeatedFurniture(lines);

  const out = [];
  for (const l of lines) {
    if (l === "" && out[out.length - 1] === "") continue; // at most one blank line in a row
    out.push(l);
  }
  const joined = out.join("\n").trim();
  return joined.length > MAX_CV_CHARS ? `${joined.slice(0, MAX_CV_CHARS).trimEnd()}\n[... CV truncated at ${MAX_CV_CHARS} characters]` : joined;
}

// A line that appears three or more times is a running header/footer ("Page 2 of 3",
// the candidate's email on every page), not content. Keep its first occurrence only.
function dropRepeatedFurniture(lines) {
  const counts = new Map();
  for (const l of lines) if (l.length > 2) counts.set(l, (counts.get(l) || 0) + 1);
  const seen = new Set();
  return lines.filter((l) => {
    if ((counts.get(l) || 0) < 3) return true;
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  }).filter((l) => !/^page \d+( of \d+)?$/i.test(l));
}

// word/document.xml -> text. Paragraphs become lines, tabs and breaks are honoured,
// list items get a dash. String-based so it runs identically in the browser and in tests.
export function docxXmlToText(xml) {
  const paragraphs = String(xml ?? "").split(/<\/w:p>/);
  const lines = [];
  for (const p of paragraphs) {
    const isListItem = /<w:numPr[\s\/>]/.test(p);
    const runs = [];
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<w:cr\s*\/>/g;
    let m;
    while ((m = re.exec(p))) {
      if (m[1] !== undefined) runs.push(unescapeXml(m[1]));   // <w:t>…</w:t>
      else if (m[0].startsWith("<w:tab")) runs.push("\t");
      else runs.push("\n");                                    // <w:br/> or <w:cr/>
    }
    const text = runs.join("");
    if (text.trim() === "" && !/<w:p[\s>]/.test(p)) continue; // trailing fragment after the last paragraph
    lines.push(isListItem && text.trim() ? `- ${text}` : text);
  }
  return lines.join("\n");
}

function unescapeXml(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

// Which path a file takes, from its name (browsers often report an empty or generic MIME type).
export function cvFileKind(name) {
  const ext = String(name ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (["txt", "md", "markdown", "text", "rtf"].includes(ext)) return "text";
  return "unsupported";
}
