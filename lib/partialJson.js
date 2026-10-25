// Parse the JSON that has streamed so far. Structured outputs guarantee the final text is
// valid JSON, so a prefix of it can be completed by closing whatever is open: an unfinished
// string, then every open array/object. A dangling key or comma is dropped. Returns null if
// even the closed text does not parse (e.g. mid-number or mid-escape), which the caller treats
// as "nothing new yet".
export function parsePartialJson(text) {
  if (!text || !text.trim()) return null;
  const stack = [];
  let inStr = false, esc = false;
  for (const ch of text) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let s = text;
  if (esc) s = s.slice(0, -1);
  if (inStr) s += '"';
  // Drop a trailing comma, then a key with no value yet: inside an object, a trailing string
  // that follows "{" or "," is a key ("key" or "key":); one that follows ":" is a finished value.
  s = s.replace(/,\s*$/, "");
  if (stack.at(-1) === "}") s = s.replace(/([{,])\s*"(?:[^"\\]|\\.)*"\s*:?\s*$/, "$1");
  s = s.replace(/,\s*$/, "");
  s += stack.reverse().join("");
  try { return JSON.parse(s); } catch { return null; }
}
