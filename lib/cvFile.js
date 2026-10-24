// One entry point: bytes of an uploaded CV in, normalised plain text out.
// PDF has no dependency-free parser in a browser, so that path is injected: the caller
// passes a function that asks Claude for the text (one small call, once).
import { cvFileKind, docxXmlToText, odtXmlToText, normalizeCvText, unsupportedCvMessage } from "./cvText.js";
import { readZipEntryText } from "./zip.js";

export async function cvTextFromFile({ name, bytes, pdfToText }) {
  const kind = cvFileKind(name);
  if (kind === "text") return normalizeCvText(new TextDecoder("utf-8").decode(bytes));
  if (kind === "docx") return normalizeCvText(docxXmlToText(await readZipEntryText(bytes, "word/document.xml")));
  if (kind === "odt") return normalizeCvText(odtXmlToText(await readZipEntryText(bytes, "content.xml")));
  if (kind === "pdf") {
    if (!pdfToText) throw new Error("PDF extraction needs an Anthropic key.");
    return normalizeCvText(await pdfToText(bytes));
  }
  throw new Error(unsupportedCvMessage(name));
}
