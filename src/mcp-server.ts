/**
 * PumpFun Channel Bot — MCP Server
 *
 * Exposes read-only PumpFun data (tokens, holders, trades, creators, GitHub
 * profiles, this bot's claim history) as MCP tools. No tool signs, sends or
 * changes anything.
 *
 * Supports two transports:
 *   - Streamable HTTP (embedded in the bot when MCP_ENABLED=true), one MCP
 *     server per session
 *   - Stdio (the `pumpfun-claims-bot` CLI, for Claude Desktop, Cursor, etc.)
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { getGithubTotalClaimCount, getGithubUserClaimedMints, hasGithubUserClaimed, loadPersistedClaims } from './claim-tracker.js';
import { fetchGitHubUserById, fetchGitHubUser } from './github-client.js';
import { log, setLogOutput } from './logger.js';
import { fetchTokenInfo, fetchTopHolders, fetchTokenTrades, fetchCreatorProfile, fetchSolUsdPrice, fetchPoolLiquidity, fetchBundleInfo } from './pump-client.js';

/** Concurrent HTTP sessions; each holds an MCP server and transport in memory. */
const MAX_HTTP_SESSIONS = 100;
/** An HTTP session with no request for this long is closed. */
const HTTP_SESSION_IDLE_MS = 30 * 60_000;

function packageVersion(): string {
    // src/ and dist/ both sit one level below the package root.
    const pkg: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const version = pkg !== null && typeof pkg === 'object' && 'version' in pkg ? pkg.version : undefined;
    if (typeof version !== 'string') throw new Error('package.json has no version');
    return version;
}

// ── Input schemas ────────────────────────────────────────────────────────────

const solanaAddress = (what: string) => z.string().trim()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, `${what} must be a base58 Solana address`)
    .describe(what);
const githubLogin = z.string().trim()
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/, 'username must be a valid GitHub login')
    .describe('GitHub username (login)');
const githubUserId = z.string().trim()
    .regex(/^[1-9]\d{0,11}$/, 'GitHub user ID must be a positive integer')
    .describe('GitHub numeric user ID');

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

function text(value: string, isError = false) {
    return { content: [{ type: 'text' as const, text: value }], ...(isError ? { isError: true } : {}) };
}

function json(value: unknown) {
    return text(JSON.stringify(value, null, 2));
}

// ── MCP Server Instance ──────────────────────────────────────────────────────

function createMcpServer(): McpServer {
    const mcp = new McpServer({
        name: 'pumpfun-claims-bot',
        version: packageVersion(),
    }, {
        capabilities: {
            tools: {},
        },
    });

    mcp.registerTool('get_token_info', {
        description: 'Fetch PumpFun token metadata, market cap, bonding curve progress, and flags',
        inputSchema: { mint: solanaAddress('Token mint address') },
        annotations: READ_ONLY,
    }, async ({ mint }) => {
        const token = await fetchTokenInfo(mint);
        return token ? json(token) : text(`Token not found: ${mint}`, true);
    });

    mcp.registerTool('get_token_holders', {
        description: 'Fetch top holders for a PumpFun token including concentration metrics',
        inputSchema: { mint: solanaAddress('Token mint address') },
        annotations: READ_ONLY,
    }, async ({ mint }) => json(await fetchTopHolders(mint)));

    mcp.registerTool('get_token_trades', {
        description: 'Fetch recent trade activity for a PumpFun token (volume, buy/sell counts)',
        inputSchema: { mint: solanaAddress('Token mint address') },
        annotations: READ_ONLY,
    }, async ({ mint }) => json(await fetchTokenTrades(mint)));

    mcp.registerTool('get_pool_liquidity', {
        description: 'Fetch PumpSwap AMM pool liquidity for a graduated token',
        inputSchema: {
            mint: solanaAddress('Token mint address'),
            usdMarketCap: z.number().nonnegative().optional().describe('Current USD market cap, used for the market-cap-to-liquidity ratio'),
        },
        annotations: READ_ONLY,
    }, async ({ mint, usdMarketCap }) => {
        const liq = await fetchPoolLiquidity(mint, usdMarketCap ?? 0);
        return liq ? json(liq) : text('No pool liquidity data (token may not be graduated)');
    });

    mcp.registerTool('get_bundle_info', {
        description: 'Detect if a token launch was bundled (scam indicator)',
        inputSchema: { mint: solanaAddress('Token mint address') },
        annotations: READ_ONLY,
    }, async ({ mint }) => {
        const bundle = await fetchBundleInfo(mint);
        return bundle ? json(bundle) : text('No bundle data available');
    });

    mcp.registerTool('get_creator_profile', {
        description: 'Fetch PumpFun creator profile — username, launch count, scam estimate, recent coins',
        inputSchema: { wallet: solanaAddress('Creator wallet address') },
        annotations: READ_ONLY,
    }, async ({ wallet }) => json(await fetchCreatorProfile(wallet)));

    mcp.registerTool('get_github_user', {
        description: 'Fetch GitHub user profile by username or numeric ID — repos, followers, bio, account age',
        inputSchema: {
            username: githubLogin.optional(),
            userId: githubUserId.optional(),
        },
        annotations: READ_ONLY,
    }, async ({ username, userId }) => {
        let user;
        if (userId) user = await fetchGitHubUserById(userId);
        else if (username) user = await fetchGitHubUser(username);
        else return text('Provide either username or userId', true);
        return user ? json(user) : text(`GitHub user not found: ${userId ?? username}`, true);
    });

    mcp.registerTool('get_claim_history', {
        description: 'Claim history this bot has recorded for a GitHub user: whether they have claimed, '
            + 'how many claims, and from which token mints. Reads the bot\'s DATA_DIR state, so it is empty '
            + 'when run without a bot\'s data.',
        inputSchema: { githubUserId },
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ githubUserId: id }) => json({
        githubUserId: id,
        hasClaimed: hasGithubUserClaimed(id),
        totalClaimCount: getGithubTotalClaimCount(id),
        claimedMints: getGithubUserClaimedMints(id),
    }));

    mcp.registerTool('get_sol_price', {
        description: 'Fetch current SOL/USD price',
        annotations: READ_ONLY,
    }, async () => json({ solUsdPrice: await fetchSolUsdPrice() }));

    return mcp;
}

// ── Streamable HTTP Transport ────────────────────────────────────────────────

interface HttpSession {
    server: McpServer;
    transport: StreamableHTTPServerTransport;
    lastSeen: number;
}

function sendJsonRpcError(res: ServerResponse, status: number, message: string): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

/**
 * Start the MCP server with Streamable HTTP transport on its own port. Each
 * client session gets its own MCP server instance (an MCP server can serve
 * only one transport). `host` defaults to all interfaces.
 */
export function startMcpHttpServer(port: number, host?: string): { server: Server; close: () => Promise<void> } {
    const sessions = new Map<string, HttpSession>();

    const closeSession = async (id: string): Promise<void> => {
        const session = sessions.get(id);
        if (!session) return;
        sessions.delete(id);
        await session.server.close().catch((err: unknown) => log.debug('MCP session close failed: %s', err));
    };

    const openSession = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        if (sessions.size >= MAX_HTTP_SESSIONS) {
            sendJsonRpcError(res, 503, 'Too many MCP sessions, try again later');
            return;
        }
        const server = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
                sessions.set(id, { server, transport, lastSeen: Date.now() });
            },
        });
        transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await server.connect(transport);
        await transport.handleRequest(req, res);
        // Anything but a valid initialize request is rejected by the transport
        // and leaves no session behind; release the server it was given.
        if (!transport.sessionId || !sessions.has(transport.sessionId)) await server.close();
    };

    const httpServer = createServer((req, res) => {
        void (async () => {
            const path = (req.url ?? '/').split('?')[0];
            if (path !== '/mcp') {
                res.writeHead(404);
                res.end('Not Found');
                return;
            }
            const header = req.headers['mcp-session-id'];
            const sessionId = Array.isArray(header) ? header[0] : header;
            if (sessionId) {
                const session = sessions.get(sessionId);
                if (!session) {
                    sendJsonRpcError(res, 404, 'Session not found');
                    return;
                }
                session.lastSeen = Date.now();
                await session.transport.handleRequest(req, res);
                return;
            }
            if (req.method === 'POST') {
                await openSession(req, res);
                return;
            }
            sendJsonRpcError(res, 400, 'Missing mcp-session-id header');
        })().catch((err: unknown) => {
            log.error('MCP request error: %s', err);
            if (!res.headersSent) sendJsonRpcError(res, 500, 'Internal server error');
            else res.end();
        });
    });

    const sweep = setInterval(() => {
        const cutoff = Date.now() - HTTP_SESSION_IDLE_MS;
        for (const [id, session] of sessions) {
            if (session.lastSeen < cutoff) void closeSession(id);
        }
    }, 60_000);
    sweep.unref();

    httpServer.listen(port, host, () => {
        log.info('MCP server (Streamable HTTP) listening on port %d → POST/GET/DELETE /mcp', port);
    });

    httpServer.on('error', (err) => {
        log.error('MCP HTTP server error: %s', err);
    });

    return {
        server: httpServer,
        close: async () => {
            clearInterval(sweep);
            await Promise.all([...sessions.keys()].map(closeSession));
            await new Promise<void>((resolve) => {
                httpServer.close(() => resolve());
                httpServer.closeAllConnections();
            });
        },
    };
}

/**
 * Start the MCP server with stdio transport (for local CLI / piped usage).
 * This takes over stdin/stdout, so only use when running as a standalone MCP server.
 */
export async function startMcpStdioServer(): Promise<void> {
    setLogOutput('stderr');
    // get_claim_history reads the bot's state when run next to its DATA_DIR.
    loadPersistedClaims();
    const mcp = createMcpServer();
    const transport = new StdioServerTransport();
    await mcp.connect(transport);
    log.info('MCP server (stdio) connected');
}
