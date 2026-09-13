/**
 * PumpFun Channel Bot — Logger
 */

import { format } from 'node:util';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: Level = 'info';
let logOutput: 'stdout' | 'stderr' = 'stdout';

/** Stdio MCP reserves stdout for protocol messages, including during tool calls. */
export function setLogOutput(output: 'stdout' | 'stderr'): void {
    logOutput = output;
}

export function setLogLevel(level: Level): void {
    currentLevel = level;
}

function shouldLog(level: Level): boolean {
    return LEVELS[level] >= LEVELS[currentLevel];
}

function stamp(): string {
    return new Date().toISOString();
}

export const log = {
    debug: (msg: string, ...args: unknown[]) => {
        if (shouldLog('debug')) {
            const write = logOutput === 'stderr' ? console.error : console.debug;
            write(`[${stamp()}] [DEBUG] ${format(msg, ...args)}`);
        }
    },
    info: (msg: string, ...args: unknown[]) => {
        if (shouldLog('info')) {
            const write = logOutput === 'stderr' ? console.error : console.info;
            write(`[${stamp()}] [INFO] ${format(msg, ...args)}`);
        }
    },
    warn: (msg: string, ...args: unknown[]) => {
        if (shouldLog('warn')) console.warn(`[${stamp()}] [WARN] ${format(msg, ...args)}`);
    },
    error: (msg: string, ...args: unknown[]) => {
        if (shouldLog('error')) console.error(`[${stamp()}] [ERROR] ${format(msg, ...args)}`);
    },
};
