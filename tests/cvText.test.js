import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCvText, docxXmlToText, cvFileKind, MAX_CV_CHARS } from "../lib/cvText.js";

test("normalize collapses whitespace, blank runs and bullet glyphs", () => {
  const raw = "Jane Doe\r\n\r\n\r\n•  Owned month-end close   \n● Built accrual schedule\n\n\n\nSkills:\tExcel";
  assert.equal(normalizeCvText(raw), "Jane Doe\n\n- Owned month-end close\n- Built accrual schedule\n\nSkills: Excel");
});

test("normalize drops running headers/footers repeated across pages", () => {
  const page = (n) => `jane@example.com | +44 7700 900000\nContent of page ${n}\nPage ${n} of 3`;
  const out = normalizeCvText([page(1), page(2), page(3)].join("\n"));
  assert.equal(out.split("jane@example.com").length - 1, 1, "email kept once");
  assert.equal(/Page \d+ of 3/.test(out), false, "page numbers gone");
  assert.ok(out.includes("Content of page 2"));
});

test("normalize truncates a very long CV with a marker", () => {
  const out = normalizeCvText("x".repeat(MAX_CV_CHARS + 500));
  assert.ok(out.length < MAX_CV_CHARS + 100);
  assert.match(out, /CV truncated/);
});

test("docx xml: paragraphs, tabs, breaks, entities and list items", () => {
  const xml = `<w:document><w:body>
    <w:p><w:r><w:t>Jane </w:t></w:r><w:r><w:t xml:space="preserve">Doe</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Cut close from 9</w:t></w:r><w:r><w:tab/><w:t>to 5 days</w:t></w:r></w:p>
    <w:p><w:r><w:t>R&amp;D &lt;team&gt;</w:t><w:br/><w:t>second line</w:t></w:r></w:p>
    <w:p><w:pPr></w:pPr></w:p>
    <w:p><w:r><w:t>after a blank</w:t></w:r></w:p>
  </w:body></w:document>`;
  assert.equal(docxXmlToText(xml), "Jane Doe\n- Cut close from 9\tto 5 days\nR&D <team>\nsecond line\n\nafter a blank");
});

test("file kind is decided by extension, case-insensitively", () => {
  assert.equal(cvFileKind("CV.PDF"), "pdf");
  assert.equal(cvFileKind("resume.docx"), "docx");
  assert.equal(cvFileKind("notes.md"), "text");
  assert.equal(cvFileKind("cv.txt"), "text");
  assert.equal(cvFileKind("old.doc"), "unsupported");
  assert.equal(cvFileKind("photo.png"), "unsupported");
});
