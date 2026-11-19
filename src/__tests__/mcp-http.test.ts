/**
 * The embedded Streamable HTTP MCP server: several clients at once, each with
 * its own session, and tool inputs validated before any lookup runs.
 */

import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../logger.js', () => ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    setLogOutput: vi.fn(),
}));

const { startMcpHttpServer } = await import('../mcp-server.js');

describe('MCP Streamable HTTP server', () => {
    let mcp: ReturnType<typeof startMcpHttpServer>;
    let url: URL;

    beforeAll(async () => {
        mcp = startMcpHttpServer(0, '127.0.0.1');
        await once(mcp.server, 'listening');
        url = new URL(`http://127.0.0.1:${(mcp.server.address() as AddressInfo).port}/mcp`);
    });

    afterAll(async () => { await mcp.close(); });

    async function connect(name: string): Promise<Client> {
        const client = new Client({ name, version: '1.0.0' });
        await client.connect(new StreamableHTTPClientTransport(url));
        return client;
    }

    it('serves concurrent sessions, each with its own server', async () => {
        const [a, b] = await Promise.all([connect('client-a'), connect('client-b')]);
        try {
            const [toolsA, toolsB] = await Promise.all([a.listTools(), b.listTools()]);
            expect(toolsA.tools).toHaveLength(9);
            expect(toolsB.tools.map((t) => t.name)).toContain('get_claim_history');
            const history = await b.callTool({ name: 'get_claim_history', arguments: { githubUserId: '12345' } });
            expect(history.isError).toBeFalsy();
            const [first] = history.content as Array<{ type: string; text: string }>;
            expect(JSON.parse(first!.text)).toEqual({ githubUserId: '12345', hasClaimed: false, totalClaimCount: 0, claimedMints: [] });
        } finally {
            await Promise.all([a.close(), b.close()]);
        }
    });

    it('rejects malformed tool input before doing any lookup', async () => {
        const client = await connect('client-validate');
        try {
            for (const call of [
                { name: 'get_token_info', arguments: { mint: '../../users/x?' } },
                { name: 'get_creator_profile', arguments: { wallet: 'not-a-wallet' } },
                { name: 'get_github_user', arguments: { username: 'a/../b' } },
                { name: 'get_claim_history', arguments: { githubUserId: '12abc' } },
            ]) {
                const result = await client.callTool(call);
                expect(result.isError, call.name).toBe(true);
            }
        } finally {
            await client.close();
        }
    });

    it('rejects a request for an unknown session', async () => {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': 'nope' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        });
        expect(response.status).toBe(404);
    });
});
