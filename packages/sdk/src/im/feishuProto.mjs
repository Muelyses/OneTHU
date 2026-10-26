/** Existing OneTHU Feishu protobuf ABI, with bounded decoding and exact uint64 IDs. */
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_FRAME = 1024 * 1024;
function invalid() { throw Object.assign(new Error('IM_INVALID_FRAME'), { code: 'IM_INVALID_FRAME' }); }
function varint(out, value) {
  let v;
  try { v = BigInt(value); } catch { invalid(); }
  if (v < 0n || v > 0xffffffffffffffffn) invalid();
  while (v > 127n) { out.push(Number(v & 127n) | 128); v >>= 7n; }
  out.push(Number(v));
}
function bytes(out, field, value) {
  const data = typeof value === 'string' ? encoder.encode(value) : value;
  varint(out, (field << 3) | 2); varint(out, data.length);
  for (const byte of data) out.push(byte);
}
class Reader {
  constructor(buf) { this.buf = buf; this.pos = 0; }
  done() { return this.pos === this.buf.length; }
  varint() {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.buf.length) invalid();
      const b = this.buf[this.pos++];
      if (i === 9 && b > 1) invalid();
      value |= BigInt(b & 127) << BigInt(i * 7);
      if (!(b & 128)) return value;
    }
    invalid();
  }
  number() { const value = this.varint(); if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalid(); return Number(value); }
  bytes() { const length = this.number(); if (length > this.buf.length - this.pos) invalid(); const data = this.buf.subarray(this.pos, this.pos + length); this.pos += length; return data; }
  string() { return decoder.decode(this.bytes()); }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 2) this.bytes();
    else if (wire === 1 || wire === 5) { this.pos += wire === 1 ? 8 : 4; if (this.pos > this.buf.length) invalid(); }
    else invalid();
  }
}
export function encodeFrame(frame) {
  const out = [];
  for (const [field, value] of [[1, frame.seqId ?? 0], [2, frame.logId ?? 0], [3, frame.service ?? 0], [4, frame.method ?? 0]]) { varint(out, field << 3); varint(out, value); }
  if ((frame.headers?.length ?? 0) > 256) invalid();
  for (const header of frame.headers ?? []) { const part = []; bytes(part, 1, header.key); bytes(part, 2, header.value); bytes(out, 5, part); }
  if (frame.payloadEncoding) bytes(out, 6, frame.payloadEncoding);
  if (frame.payload) bytes(out, 8, frame.payload);
  if (out.length > MAX_FRAME) invalid();
  return Uint8Array.from(out);
}
export function decodeFrame(input) {
  const buf = new Uint8Array(input);
  if (buf.length > MAX_FRAME) invalid();
  const reader = new Reader(buf);
  const frame = { seqId: 0n, logId: 0n, service: 0, method: 0, headers: [] };
  while (!reader.done()) {
    const tag = reader.number(); const field = tag >>> 3; const wire = tag & 7;
    if (!field) invalid();
    if ([1, 2, 3, 4].includes(field)) {
      if (wire !== 0) invalid();
      if (field === 1 || field === 2) frame[field === 1 ? 'seqId' : 'logId'] = reader.varint();
      else frame[field === 3 ? 'service' : 'method'] = reader.number();
    } else if (field === 5) {
      if (wire !== 2 || frame.headers.length >= 256) invalid();
      const headerReader = new Reader(reader.bytes()); const header = { key: '', value: '' };
      while (!headerReader.done()) {
        const hTag = headerReader.number(); const hField = hTag >>> 3;
        if ([1, 2].includes(hField)) { if ((hTag & 7) !== 2) invalid(); header[hField === 1 ? 'key' : 'value'] = headerReader.string(); }
        else headerReader.skip(hTag & 7);
      }
      if (header.key.length > 128 || header.value.length > 8192) invalid();
      frame.headers.push(header);
    } else if (field === 8) { if (wire !== 2) invalid(); frame.payload = reader.bytes(); }
    else if (field === 6) { if (wire !== 2) invalid(); frame.payloadEncoding = reader.string(); }
    else reader.skip(wire);
  }
  return frame;
}
export function headerOf(frame, key) { return frame.headers.find(header => header.key === key)?.value; }
export function pingFrame(service) { return encodeFrame({ service, method: 0, headers: [{ key: 'type', value: 'ping' }] }); }
