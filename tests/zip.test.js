import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { readZipDirectory, readZipEntryText } from "../lib/zip.js";
import { cvTextFromFile } from "../lib/cvFile.js";

// Build a real ZIP in memory (local headers + central directory + EOCD) so the reader is
// exercised against the actual byte layout, with one stored and one deflated entry.
function buildZip(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;
  for (const { name, text, deflate } of files) {
    const nameB = enc.encode(name);
    const raw = enc.encode(text);
    const data = deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const method = deflate ? 8 : 0;
    const local = new Uint8Array(30 + nameB.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, method, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameB.length, true);
    local.set(nameB, 30);
    const cen = new Uint8Array(46 + nameB.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, method, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameB.length, true); cv.setUint32(42, offset, true);
    cen.set(nameB, 46);
    parts.push(local, data); central.push(cen);
    offset += local.length + data.length;
  }
  const cenStart = offset;
  const cenLen = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenLen, true); ev.setUint32(16, cenStart, true);
  const all = [...parts, ...central, eocd];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of all) { out.set(a, o); o += a.length; }
  return out;
}

const DOC_XML = `<w:document><w:body><w:p><w:r><w:t>Jane Doe</w:t></w:r></w:p><w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Bank reconciliations</w:t></w:r></w:p></w:body></w:document>`;

test("directory lists both entries with the right methods", () => {
  const zip = buildZip([{ name: "[Content_Types].xml", text: "<x/>", deflate: false }, { name: "word/document.xml", text: DOC_XML, deflate: true }]);
  const dir = readZipDirectory(zip);
  assert.deepEqual([...dir.keys()], ["[Content_Types].xml", "word/document.xml"]);
  assert.equal(dir.get("[Content_Types].xml").method, 0);
  assert.equal(dir.get("word/document.xml").method, 8);
});

test("reads a stored and a deflated entry back as text", async () => {
  const zip = buildZip([{ name: "a.txt", text: "stored", deflate: false }, { name: "b.txt", text: "deflated text", deflate: true }]);
  assert.equal(await readZipEntryText(zip, "a.txt"), "stored");
  assert.equal(await readZipEntryText(zip, "b.txt"), "deflated text");
});

test("a missing entry and a non-zip are clear errors", async () => {
  const zip = buildZip([{ name: "a.txt", text: "x", deflate: false }]);
  await assert.rejects(readZipEntryText(zip, "nope.txt"), /no entry named nope.txt/);
  await assert.rejects(readZipEntryText(new TextEncoder().encode("%PDF-1.4 not a zip"), "a"), /Not a ZIP/);
});

test("end to end: a .docx becomes normalised CV text", async () => {
  const docx = buildZip([{ name: "word/document.xml", text: DOC_XML, deflate: true }]);
  assert.equal(await cvTextFromFile({ name: "cv.docx", bytes: docx }), "Jane Doe\n- Bank reconciliations");
});

test("end to end: an .odt becomes normalised CV text", async () => {
  const odt = buildZip([{ name: "content.xml", text: `<office:text><text:h>Jane Doe</text:h><text:list-item><text:p>Accruals</text:p></text:list-item></office:text>`, deflate: true }]);
  assert.equal(await cvTextFromFile({ name: "cv.odt", bytes: odt }), "Jane Doe\n- Accruals");
});

test("text files pass straight through normalisation; pdf without an extractor is refused", async () => {
  assert.equal(await cvTextFromFile({ name: "cv.md", bytes: new TextEncoder().encode("# Jane\n\n\n\nskills") }), "# Jane\n\nskills");
  await assert.rejects(cvTextFromFile({ name: "cv.pdf", bytes: new Uint8Array() }), /Anthropic key/);
  await assert.rejects(cvTextFromFile({ name: "cv.doc", bytes: new Uint8Array() }), /Save As/);
});
