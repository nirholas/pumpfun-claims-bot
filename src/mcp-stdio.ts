#!/usr/bin/env node
/**
 * PumpFun Claims Bot — Standalone MCP Server (stdio)
 *
 * Run this directly to expose the MCP tools via stdio transport.
 * Useful for local development with Claude Desktop, Cursor, etc.
 *
 * Usage:
 *   npx tsx src/mcp-stdio.ts
 *   node dist/mcp-stdio.js
 */

import 'dotenv/config';
import { startMcpStdioServer } from './mcp-server.js';

startMcpStdioServer().catch((err) => {
    console.error('MCP stdio server failed:', err);
    process.exit(1);
});
