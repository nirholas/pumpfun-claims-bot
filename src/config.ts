/**
 * PumpFun Channel Bot — Configuration
 *
 * Loads and validates environment variables for the read-only channel feed.
 * Every problem is collected and reported together at startup, so a typo
 * fails fast with a clear message instead of silently changing behaviour.
 */

import 'dotenv/config';

import { maskUrl } from './rpc-fallback.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ChannelBotConfig {
    /** Telegram Bot API token */
    telegramToken: string;
    /** Channel ID to post to (@channelname or -100xxx) */
    channelId: string;
    /** Solana RPC HTTP URL (primary) */
    solanaRpcUrl: string;
    /** All Solana RPC HTTP URLs for fallback (primary + backups) */
    solanaRpcUrls: string[];
    /** Solana WebSocket URL: SOLANA_WS_URL, or derived from SOLANA_RPC_URL */
    solanaWsUrl?: string;
    /** True when SOLANA_WS_URL was set explicitly (opts the non-GitHub monitors into WebSocket mode) */
    solanaWsUrlExplicit: boolean;
    /** Polling interval in seconds */
    pollIntervalSeconds: number;
    /** Log level */
    logLevel: LogLevel;
    /** Feed toggles */
    feed: {
        claims: boolean;
        graduations: boolean;
        feeDistributions: boolean;
    };
    /** Only post GitHub social fee claims; never post ordinary creator-fee claims */
    requireGithub: boolean;
    /** Affiliate ref codes for trading links */
    affiliates: {
        axiom: string;
        gmgn: string;
        padre: string;
    };
    /** Port of the /health endpoint */
    healthPort: number;
    /** MCP server settings */
    mcp: {
        enabled: boolean;
        port: number;
    };
}

type Env = Record<string, string | undefined>;

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** Referral codes used when AXIOM_REF / GMGN_REF / PADRE_REF are not set. */
const DEFAULT_AFFILIATES = { axiom: 'nich', gmgn: 'nichxbt', padre: 'nichxbt' } as const;

export class ConfigError extends Error {
    constructor(readonly problems: string[]) {
        super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
        this.name = 'ConfigError';
    }
}

class EnvReader {
    readonly problems: string[] = [];

    constructor(private readonly env: Env) {}

    /** Trimmed value, or undefined when unset or blank. */
    string(name: string): string | undefined {
        const value = this.env[name]?.trim();
        return value ? value : undefined;
    }

    required(name: string, hint: string): string {
        const value = this.string(name);
        if (!value) this.problems.push(`${name} is required. ${hint}`);
        return value ?? '';
    }

    boolean(name: string, fallback: boolean): boolean {
        const raw = this.string(name);
        if (raw === undefined) return fallback;
        const value = raw.toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(value)) return true;
        if (['false', '0', 'no', 'off'].includes(value)) return false;
        this.problems.push(`${name} must be true or false, got "${raw}"`);
        return fallback;
    }

    integer(name: string, fallback: number, min: number, max: number): number {
        const raw = this.string(name);
        if (raw === undefined) return fallback;
        const value = Number(raw);
        if (!Number.isInteger(value) || value < min || value > max) {
            this.problems.push(`${name} must be an integer from ${min} to ${max}, got "${raw}"`);
            return fallback;
        }
        return value;
    }

    url(name: string, raw: string, protocols: readonly string[]): string | undefined {
        let url: URL;
        try {
            url = new URL(raw);
        } catch {
            this.problems.push(`${name} is not a valid URL (${maskUrl(raw)})`);
            return undefined;
        }
        if (!protocols.includes(url.protocol)) {
            this.problems.push(`${name} must use ${protocols.join(' or ')} (${maskUrl(raw)})`);
            return undefined;
        }
        return raw;
    }
}

export function loadConfig(env: Env = process.env): ChannelBotConfig {
    const read = new EnvReader(env);

    const telegramToken = read.required('TELEGRAM_BOT_TOKEN', 'Create a bot via @BotFather and set the env var.');
    const channelId = read.required('CHANNEL_ID', 'Set it to @your_channel_name or the numeric chat ID.');

    const solanaRpcUrl = read.url('SOLANA_RPC_URL', read.string('SOLANA_RPC_URL') ?? 'https://api.mainnet-beta.solana.com', ['https:', 'http:'])
        ?? 'https://api.mainnet-beta.solana.com';
    // Comma-separated fallback RPC URLs; the primary always comes first.
    const extraUrls = (read.string('SOLANA_RPC_URLS') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .flatMap((raw) => read.url('SOLANA_RPC_URLS', raw, ['https:', 'http:']) ?? []);
    const solanaRpcUrls = [solanaRpcUrl, ...extraUrls.filter((u) => u !== solanaRpcUrl)];

    const explicitWs = read.string('SOLANA_WS_URL');
    let solanaWsUrl = explicitWs ? read.url('SOLANA_WS_URL', explicitWs, ['wss:', 'ws:']) : undefined;
    if (!explicitWs) {
        const url = new URL(solanaRpcUrl);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        solanaWsUrl = url.toString();
    }

    const rawLogLevel = (read.string('LOG_LEVEL') ?? 'info').toLowerCase();
    const logLevel = LOG_LEVELS.find((level) => level === rawLogLevel);
    if (!logLevel) read.problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}, got "${rawLogLevel}"`);

    const config: ChannelBotConfig = {
        telegramToken,
        channelId,
        solanaRpcUrl,
        solanaRpcUrls,
        solanaWsUrl,
        solanaWsUrlExplicit: explicitWs !== undefined,
        pollIntervalSeconds: read.integer('POLL_INTERVAL_SECONDS', 30, 1, 3600),
        logLevel: logLevel ?? 'info',
        feed: {
            claims: read.boolean('FEED_CLAIMS', true),
            graduations: read.boolean('FEED_GRADUATIONS', false),
            feeDistributions: read.boolean('FEED_FEE_DISTRIBUTIONS', false),
        },
        requireGithub: read.boolean('REQUIRE_GITHUB', true),
        affiliates: {
            axiom: read.string('AXIOM_REF') ?? DEFAULT_AFFILIATES.axiom,
            gmgn: read.string('GMGN_REF') ?? DEFAULT_AFFILIATES.gmgn,
            padre: read.string('PADRE_REF') ?? DEFAULT_AFFILIATES.padre,
        },
        healthPort: read.integer('HEALTH_PORT', read.integer('PORT', 3000, 1, 65535), 1, 65535),
        mcp: {
            enabled: read.boolean('MCP_ENABLED', false),
            port: read.integer('MCP_PORT', 3001, 1, 65535),
        },
    };

    if (read.problems.length > 0) throw new ConfigError(read.problems);
    return config;
}
