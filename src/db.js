// ─── sqlite read helper ─────────────────────────────────────────────────────
// Shells out to the system `sqlite3` CLI in read-only JSON mode. No native
// dependency to build, and read-only means we never mutate Apple's stores.
// Reading the protected stores (chat.db, AddressBook) requires the host app to
// hold Full Disk Access; without it sqlite3 returns "authorization denied".

import { execFileSync } from 'child_process';

export function query(dbPath, sql, { timeout = 20000 } = {}) {
  const uri = `file:${dbPath}?mode=ro`;
  let out;
  try {
    out = execFileSync('sqlite3', ['-readonly', '-json', uri, sql], {
      encoding: 'utf8',
      timeout,
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch (e) {
    const msg = (e.stderr || e.message || '').toString();
    if (/authorization denied|unable to open|not permitted/i.test(msg)) {
      throw new Error(
        'Cannot read the macOS store. Grant Full Disk Access to the host app ' +
        '(System Settings, Privacy and Security, Full Disk Access) and relaunch it.'
      );
    }
    throw new Error(`sqlite read failed: ${msg.trim()}`);
  }
  out = (out || '').trim();
  return out ? JSON.parse(out) : [];
}

// SQL string literal, single-quote escaped.
export const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
