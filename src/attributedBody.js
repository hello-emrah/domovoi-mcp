// ─── attributedBody decoder ─────────────────────────────────────────────────
// Modern macOS stores message text in a binary `attributedBody` blob (an Apple
// `streamtyped` NSAttributedString archive) rather than the plain `text`
// column, so a naive read of `text` misses a large share of messages. This
// pulls the first NSString instance out of that blob.
//
// Layout in the archive: after the `NSString` class declaration the string
// instance is emitted as `+` (0x2B), then a length prefix, then the UTF-8
// bytes. The length prefix is a single byte, unless it is 0x81 (next 2 bytes,
// little-endian) or 0x82 (next 4 bytes, little-endian).

export function decodeAttributedBody(hex) {
  if (!hex) return null;
  let buf;
  try { buf = Buffer.from(hex, 'hex'); } catch { return null; }
  if (!buf.length) return null;

  const cls = buf.indexOf('NSString', 0, 'utf8');
  if (cls === -1) return null;

  let p = buf.indexOf(0x2b, cls); // '+'
  if (p === -1 || p + 1 >= buf.length) return null;
  p += 1;

  let len = buf[p]; p += 1;
  if (len === 0x81) { if (p + 2 > buf.length) return null; len = buf.readUInt16LE(p); p += 2; }
  else if (len === 0x82) { if (p + 4 > buf.length) return null; len = buf.readUInt32LE(p); p += 4; }

  if (len <= 0 || p + len > buf.length) return null;
  const text = buf.slice(p, p + len).toString('utf8');
  return text.trim() ? text : null;
}
