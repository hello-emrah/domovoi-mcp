// ─── Messages (iMessage / SMS) ───────────────────────────────────────────────
// Read from the Messages store (chat.db) and send via AppleScript. Text comes
// from the `text` column when present, else is decoded from `attributedBody`.
// Handles are resolved to contact names where possible.

import { query as sql, lit } from './db.js';
import { decodeAttributedBody } from './attributedBody.js';
import { resolve as resolveContact, normHandle } from './contacts.js';
import { execFileSync } from 'child_process';
import { homedir } from 'os';

const CHAT_DB = `${homedir()}/Library/Messages/chat.db`;
const TS = `datetime(m.date/1000000000 + 978307200,'unixepoch','localtime')`;

function textOf(r) {
  if (r.text && String(r.text).trim()) return r.text;
  if (r.body_hex) {
    const d = decodeAttributedBody(r.body_hex);
    if (d) return d;
  }
  return '';
}

function fromOf(r) {
  if (r.is_from_me) return 'me';
  return resolveContact(r.handle) || r.handle || 'unknown';
}

// Resolve a `with` argument (a handle like +61… or an email, or a contact name)
// to the set of original handle ids present in the Messages store.
function handlesFor(withArg) {
  const all = sql(CHAT_DB, 'select distinct id from handle;').map((r) => r.id).filter(Boolean);
  const nq = normHandle(withArg);
  const lc = String(withArg).toLowerCase();
  let hs = all.filter((id) => normHandle(id) === nq || id.toLowerCase() === lc);
  if (hs.length) return hs;
  return all.filter((id) => (resolveContact(id) || '').toLowerCase().includes(lc));
}

// tool: messages_list_chats
export function listChats({ limit = 20 } = {}) {
  const N = Math.min(Number(limit) || 20, 100);
  const rows = sql(CHAT_DB, `
    select c.display_name dname, c.chat_identifier cident,
           datetime(max(m.date)/1000000000 + 978307200,'unixepoch','localtime') last_time
    from chat c
    join chat_message_join cmj on cmj.chat_id = c.ROWID
    join message m on m.ROWID = cmj.message_id
    group by c.ROWID
    order by max(m.date) desc
    limit ${N};`);
  return rows.map((r) => ({
    chat: r.dname || resolveContact(r.cident) || r.cident,
    handle: r.cident,
    last_time: r.last_time,
  }));
}

// tool: messages_read
export function readMessages({ with: withArg, limit = 30, query: q } = {}) {
  const N = Math.min(Number(limit) || 30, 200);
  const where = ['1=1'];
  if (withArg) {
    const hs = handlesFor(withArg);
    if (!hs.length) throw new Error(`No conversation found for "${withArg}".`);
    where.push(`h.id in (${hs.map(lit).join(',')})`);
  }
  if (q) where.push(`m.text like ${lit('%' + q + '%')}`);
  const rows = sql(CHAT_DB, `
    select m.is_from_me, ${TS} t, h.id handle, m.text,
           case when m.text is null or trim(m.text) = '' then hex(m.attributedBody) end body_hex
    from message m
    left join handle h on h.ROWID = m.handle_id
    where ${where.join(' and ')}
    order by m.date desc
    limit ${N};`);
  return rows
    .map((r) => ({ time: r.t, from: fromOf(r), text: textOf(r) }))
    .reverse();
}

// tool: messages_search
export function searchMessages({ query: q, limit = 30 } = {}) {
  if (!q) throw new Error('query is required');
  const N = Math.min(Number(limit) || 30, 200);
  const rows = sql(CHAT_DB, `
    select m.is_from_me, ${TS} t, h.id handle, m.text
    from message m
    left join handle h on h.ROWID = m.handle_id
    where m.text like ${lit('%' + q + '%')}
    order by m.date desc
    limit ${N};`);
  // Note: searches the plain text column only; attributedBody-only messages are
  // not full-text searchable without decoding every row.
  return rows.map((r) => ({ time: r.t, from: fromOf(r), text: r.text }));
}

// tool: messages_send
export function sendMessage({ to, text } = {}) {
  if (!to || !text) throw new Error('both "to" and "text" are required');
  const script = `on run argv
  set targetHandle to item 1 of argv
  set msgText to item 2 of argv
  tell application "Messages"
    set svc to 1st account whose service type = iMessage
    send msgText to participant targetHandle of svc
  end tell
end run`;
  try {
    execFileSync('osascript', ['-e', script, String(to), String(text)], { encoding: 'utf8', timeout: 20000 });
    return { sent: true, to, text };
  } catch (e) {
    const msg = (e.stderr || e.message || '').toString();
    if (/not authoriz|Automation|-1743|not allowed/i.test(msg)) {
      throw new Error(
        'Sending needs Automation permission. Approve "Claude controlling Messages" when macOS prompts, ' +
        'or enable it under System Settings, Privacy and Security, Automation.'
      );
    }
    throw new Error(`send failed: ${msg.trim()}`);
  }
}

export const mod = {
  tools: [
    {
      name: 'messages_list_chats',
      description: 'List the most recent iMessage/SMS conversations with their last-activity time. Start here to see who has been talking.',
      inputSchema: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Max conversations (default 20).' } },
      },
    },
    {
      name: 'messages_read',
      description: 'Read recent messages, oldest to newest. Optionally scope to one conversation via `with` (a phone number, email, or contact name) and/or filter by a `query` substring.',
      inputSchema: {
        type: 'object',
        properties: {
          with: { type: 'string', description: 'Phone number, email, or contact name to scope to one thread. Omit for recent messages across all chats.' },
          query: { type: 'string', description: 'Optional substring to filter message text.' },
          limit: { type: 'number', description: 'Max messages (default 30, max 200).' },
        },
      },
    },
    {
      name: 'messages_search',
      description: 'Search message text across all conversations for a substring. Returns newest first. Note: searches the plain text column only.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to search for.' },
          limit: { type: 'number', description: 'Max results (default 30, max 200).' },
        },
        required: ['query'],
      },
    },
    {
      name: 'messages_send',
      description: 'Send an iMessage to a handle (phone number or email). Requires macOS Automation permission for Messages, granted on first use.',
      inputSchema: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient handle: phone number (e.g. +61415737492) or email.' },
          text: { type: 'string', description: 'Message body.' },
        },
        required: ['to', 'text'],
      },
    },
  ],
  handlers: {
    messages_list_chats: listChats,
    messages_read: readMessages,
    messages_search: searchMessages,
    messages_send: sendMessage,
  },
};
