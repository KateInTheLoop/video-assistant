// Minimal ZIP reader: enough to pull one entry (word/document.xml) out of a .docx without a
// library. Walks the central directory, then inflates with the browser's own DecompressionStream.

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

// Returns Map<name, {method, compressedSize, size, localOffset}>.
export function readZipDirectory(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End-of-central-directory record is at the tail, possibly followed by a comment.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP file (no end-of-central-directory record).");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== SIG_CENTRAL) throw new Error("Corrupt ZIP central directory.");
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, compressedSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// The compressed bytes of one entry (the local header carries its own name/extra lengths).
export function zipEntryData(bytes, entry) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const p = entry.localOffset;
  if (dv.getUint32(p, true) !== SIG_LOCAL) throw new Error("Corrupt ZIP local header.");
  const nameLen = dv.getUint16(p + 26, true);
  const extraLen = dv.getUint16(p + 28, true);
  const start = p + 30 + nameLen + extraLen;
  return bytes.subarray(start, start + entry.compressedSize);
}

// Inflate with the platform stream API (Chrome and Node 20+ both have deflate-raw).
export async function inflateRaw(data) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Read one entry as text. Method 0 = stored, 8 = deflate; .docx uses both.
export async function readZipEntryText(bytes, name) {
  const entry = readZipDirectory(bytes).get(name);
  if (!entry) throw new Error(`ZIP has no entry named ${name}.`);
  const raw = zipEntryData(bytes, entry);
  let out;
  if (entry.method === 0) out = raw;
  else if (entry.method === 8) out = await inflateRaw(raw);
  else throw new Error(`Unsupported ZIP compression method ${entry.method}.`);
  return new TextDecoder("utf-8").decode(out);
}
