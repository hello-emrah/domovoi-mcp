// ─── Contacts (AddressBook) ──────────────────────────────────────────────────
// Resolves message handles (phone numbers, emails) to people's names by reading
// the local AddressBook sqlite stores, and exposes a contacts_search tool.
// AddressBook lives under several per-source .abcddb files; we union them.

import { query, lit } from './db.js';
import { homedir } from 'os';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';

const AB_ROOT = `${homedir()}/Library/Application Support/AddressBook`;

function abFiles() {
  let files = [];
  try {
    const out = execFileSync('find', [AB_ROOT, '-name', 'AddressBook-v22.abcddb'], { encoding: 'utf8' });
    files = out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { /* AddressBook may not exist; resolution just no-ops */ }
  return files.filter(existsSync);
}

// Normalise a handle to a comparison key: email lowercased, phone reduced to
// its last 9 digits (AU mobile significant digits; tolerates +61 vs 0 vs spacing).
export function normHandle(h) {
  if (!h) return '';
  if (h.includes('@')) return h.trim().toLowerCase();
  const d = h.replace(/\D/g, '');
  return d.length > 9 ? d.slice(-9) : d;
}

function displayName(f, l, o) {
  const n = [f, l].filter(Boolean).join(' ').trim();
  return n || (o ? String(o).trim() : '');
}

let _index = null;
function index() {
  if (_index) return _index;
  const map = new Map();
  for (const db of abFiles()) {
    let phones = [];
    try {
      phones = query(db, `
        select r.ZFIRSTNAME f, r.ZLASTNAME l, r.ZORGANIZATION o, p.ZFULLNUMBER num
        from ZABCDPHONENUMBER p join ZABCDRECORD r on p.ZOWNER = r.Z_PK
        where p.ZFULLNUMBER is not null;`);
    } catch { /* skip this source */ }
    for (const x of phones) {
      const name = displayName(x.f, x.l, x.o);
      const key = normHandle(x.num);
      if (name && key && !map.has(key)) map.set(key, name);
    }
    let emails = [];
    try {
      emails = query(db, `
        select r.ZFIRSTNAME f, r.ZLASTNAME l, r.ZORGANIZATION o, e.ZADDRESS addr
        from ZABCDEMAILADDRESS e join ZABCDRECORD r on e.ZOWNER = r.Z_PK
        where e.ZADDRESS is not null;`);
    } catch { /* skip this source */ }
    for (const x of emails) {
      const name = displayName(x.f, x.l, x.o);
      const key = normHandle(x.addr);
      if (name && key && !map.has(key)) map.set(key, name);
    }
  }
  _index = map;
  return map;
}

export function resolve(handle) {
  return index().get(normHandle(handle)) || null;
}

// tool: contacts_search
export function contactsSearch({ query: q, limit = 10 } = {}) {
  if (!q) throw new Error('query is required');
  const ql = String(q).toLowerCase();
  const digits = String(q).replace(/\D/g, '');
  const out = [];
  const seen = new Set();
  for (const [key, name] of index()) {
    const matched = name.toLowerCase().includes(ql) || (digits && key.includes(digits));
    if (!matched) continue;
    const dedupe = name + '|' + key;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ name, handle: key });
    if (out.length >= Math.min(Number(limit) || 10, 50)) break;
  }
  return out;
}

export const mod = {
  tools: [
    {
      name: 'contacts_search',
      description: 'Search the macOS Contacts (AddressBook) by name, phone number, or email. Returns matching people with a comparison handle.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Name fragment, phone digits, or email to search for.' },
          limit: { type: 'number', description: 'Max results (default 10).' },
        },
        required: ['query'],
      },
    },
  ],
  handlers: { contacts_search: contactsSearch },
};
