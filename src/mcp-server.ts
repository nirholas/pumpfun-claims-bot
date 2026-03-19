/**
 * PumpFun Channel Bot — MCP Server
 *
 * Exposes bot data (claims, tokens, GitHub profiles, health) as MCP tools
 * so AI assistants can query PumpFun social fee claim intelligence.
 *
 * Supports two transports:
 *   - Streamable HTTP (embedded alongside the health server)
 *   - Stdio (for local development / CLI piping)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { z } from 'zod';

import { log } from './logger.js';
import { fetchTokenInfo, fetchTopHolders, fetchTokenTrades, fetchCreatorProfile, fetchSolUsdPrice, fetchPoolLiquidity, fetchBundleInfo } from './pump-client.js';
import { fetchGitHubUserById, fetchGitHubUser } from './github-client.js';
import { getGithubClaimCount, getGithubUserClaimedMints, hasGithubUserClaimed } from './claim-tracker.js';

// ── MCP Server Instance ──────────────────────────────────────────────────────

function createMcpServer(): McpServer {
    const mcp = new McpServer({
        name: 'pumpfun-claims-bot',
        version: '1.0.0',
    }, {
        capabilities: {
            tools: {},
        },
    });

    // ── Tool: get_token_info ─────────────────────────────────────────────
    mcp.tool(
        'get_token_info',
        'Fetch PumpFun token metadata, market cap, bonding curve progress, and flags',
        { mint: z.string().describe('Token mint address') },
        async ({ mint }) => {
            const token = await fetchTokenInfo(mint);
            if (!token) {
                return { content: [{ type: 'text' as const, text: `Token not found: ${mint}` }], isError: true };
            }
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(token, null, 2) }],
            };
        },
    );

    // ── Tool: get_token_holders ──────────────────────────────────────────
    mcp.tool(
        'get_token_holders',
        'Fetch top holders for a PumpFun token including concentration metrics',
        { mint: z.string().describe('Token mint address') },
        async ({ mint }) => {
            const holders = await fetchTopHolders(mint);
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(holders, null, 2) }],
            };
        },
    );

    // ── Tool: get_token_trades ───────────────────────────────────────────
    mcp.tool(
        'get_token_trades',
        'Fetch recent trade activity for a PumpFun token (volume, buy/sell counts)',
        { mint: z.string().describe('Token mint address') },
        async ({ mint }) => {
            const trades = await fetchTokenTrades(mint);
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(trades, null, 2) }],
            };
        },
    );

    // ── Tool: get_pool_liquidity ─────────────────────────────────────────
    mcp.tool(
        'get_pool_liquidity',
        'Fetch PumpSwap AMM pool liquidity for a graduated token',
        {
            mint: z.string().describe('Token mint address'),
            usdMarketCap: z.number().optional().describe('Current USD market cap (for context)'),
        },
        async ({ mint, usdMarketCap }) => {
            const liq = await fetchPoolLiquidity(mint, usdMarketCap ?? 0);
            if (!liq) {
                return { content: [{ type: 'text' as const, text: 'No pool liquidity data (token may not be graduated)' }] };
            }
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(liq, null, 2) }],
            };
        },
    );

    // ── Tool: get_bundle_info ────────────────────────────────────────────
    mcp.tool(
        'get_bundle_info',
        'Detect if a token launch was bundled (scam indicator)',
        { mint: z.string().describe('Token mint address') },
        async ({ mint }) => {
            const bundle = await fetchBundleInfo(mint);
            if (!bundle) {
                return { content: [{ type: 'text' as const, text: 'No bundle data available' }] };
            }
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(bundle, null, 2) }],
            };
        },
    );

    // ── Tool: get_creator_profile ────────────────────────────────────────
    mcp.tool(
        'get_creator_profile',
        'Fetch PumpFun creator profile — username, launch count, scam estimate, recent coins',
        { wallet: z.string().describe('Creator wallet address') },
        async ({ wallet }) => {
            const profile = await fetchCreatorProfile(wallet);
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(profile, null, 2) }],
            };
        },
    );

    // ── Tool: get_github_user ────────────────────────────────────────────
    mcp.tool(
        'get_github_user',
        'Fetch GitHub user profile by username or numeric ID — repos, followers, bio, account age',
        {
            username: z.string().optional().describe('GitHub username (login)'),
            userId: z.string().optional().describe('GitHub numeric user ID'),
        },
        async ({ username, userId }) => {
            if (!username && !userId) {
                return { content: [{ type: 'text' as const, text: 'Provide either username or userId' }], isError: true };
            }
            const user = userId
                ? await fetchGitHubUserById(userId)
                : await fetchGitHubUser(username!);
            if (!user) {
                return { content: [{ type: 'text' as const, text: `GitHub user not found: ${username || userId}` }], isError: true };
            }
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(user, null, 2) }],
            };
        },
    );

    // ── Tool: get_claim_history ──────────────────────────────────────────
    mcp.tool(
        'get_claim_history',
        'Check claim history for a GitHub user — whether they have claimed, claim count, and which token mints they claimed from',
        { githubUserId: z.string().describe('GitHub numeric user ID') },
        async ({ githubUserId }) => {
            const hasClaimed = hasGithubUserClaimed(githubUserId);
            const claimCount = getGithubClaimCount(githubUserId);
            const claimedMints = getGithubUserClaimedMints(githubUserId);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        githubUserId,
                        hasClaimed,
                        totalClaimCount: claimCount,
                        claimedMints,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool: get_sol_price ──────────────────────────────────────────────
    mcp.tool(
        'get_sol_price',
        'Fetch current SOL/USD price',
        {},
        async () => {
            const price = await fetchSolUsdPrice();
            return {
                content: [{ type: 'text' as const, text: JSON.stringify({ solUsdPrice: price }) }],
            };
        },
    );

    return mcp;
}

// ── Streamable HTTP Transport ────────────────────────────────────────────────

/** Active transports keyed by session ID */
const transports = new Map<string, StreamableHTTPServerTransport>();

async function handleMcpRequest(mcp: McpServer, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
    });

    transport.onclose = () => {
        if (transport.sessionId) {
            transports.delete(transport.sessionId);
        }
    };

    await mcp.connect(transport);

    if (transport.sessionId) {
        transports.set(transport.sessionId, transport);
    }

    await transport.handleRequest(req, res);
}

async function handleSessionRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing session ID' }));
        return;
    }
    const transport = transports.get(sessionId)!;
    await transport.handleRequest(req, res);
}

/**
 * Start the MCP server with Streamable HTTP transport, sharing the given HTTP server
 * or creating its own on a separate port.
 */
export function startMcpHttpServer(port: number): { server: Server; close: () => Promise<void> } {
    const mcp = createMcpServer();

    const httpServer = createServer(async (req, res) => {
        const url = req.url ?? '/';

        if (!url.startsWith('/mcp')) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }

        try {
            if (req.method === 'POST') {
                const sessionId = req.headers['mcp-session-id'] as string | undefined;
                if (sessionId && transports.has(sessionId)) {
                    await handleSessionRequest(req, res);
                } else {
                    await handleMcpRequest(mcp, req, res);
                }
            } else if (req.method === 'GET') {
                // SSE stream for server-initiated messages
                await handleSessionRequest(req, res);
            } else if (req.method === 'DELETE') {
                // Session termination
                await handleSessionRequest(req, res);
            } else {
                res.writeHead(405);
                res.end('Method Not Allowed');
            }
        } catch (err) {
            log.error('MCP request error: %s', err);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal server error' }));
            }
        }
    });

    httpServer.listen(port, () => {
        log.info('MCP server (Streamable HTTP) listening on port %d → POST/GET /mcp', port);
    });

    httpServer.on('error', (err) => {
        log.warn('MCP HTTP server error: %s', err);
    });

    return {
        server: httpServer,
        close: async () => {
            for (const transport of transports.values()) {
                await transport.close();
            }
            transports.clear();
            await mcp.close();
            httpServer.close();
        },
    };
}

/**
 * Start the MCP server with stdio transport (for local CLI / piped usage).
 * This takes over stdin/stdout, so only use when running as a standalone MCP server.
 */
export async function startMcpStdioServer(): Promise<void> {
    const mcp = createMcpServer();
    const transport = new StdioServerTransport();
    await mcp.connect(transport);
    log.info('MCP server (stdio) connected');
}
