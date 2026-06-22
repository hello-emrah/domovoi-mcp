#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { mod as messages } from './src/messages.js';
import { mod as contacts } from './src/contacts.js';

// ─── Module registry ────────────────────────────────────────────────────────
// Each module exports { tools, handlers }. Add new native surfaces (notes,
// reminders, notifications, shortcuts, system) here as they land.
const MODULES = [messages, contacts];
const TOOLS = MODULES.flatMap((m) => m.tools);
const HANDLERS = Object.assign({}, ...MODULES.map((m) => m.handlers));

// ─── Server ─────────────────────────────────────────────────────────────────
const server = new Server(
  { name: 'domovoi-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const fn = HANDLERS[name];
  if (!fn) {
    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
  try {
    const result = await fn(args || {});
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    return { isError: true, content: [{ type: 'text', text: `Error: ${e.message}` }] };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`domovoi ready (${TOOLS.length} tools: messages, contacts)`);
