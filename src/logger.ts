/**
 * PumpFun Channel Bot — Logger
 *
 * Leveled logging in one of two formats: readable text lines (default) or one
 * JSON object per line (LOG_FORMAT=json) for log aggregators.
 */

import { format } from 'node:util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'text' | 'json';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: LogLevel = 'info';
let currentFormat: LogFormat = 'text';
let logOutput: 'stdout' | 'stderr' = 'stdout';

/** Stdio MCP reserves stdout for protocol messages, including during tool calls. */
export function setLogOutput(output: 'stdout' | 'stderr'): void {
    logOutput = output;
}

export function setLogLevel(level: LogLevel): void {
    currentLevel = level;
}

export function setLogFormat(logFormat: LogFormat): void {
    currentFormat = logFormat;
}

function write(level: LogLevel, msg: string, args: unknown[]): void {
    if (LEVELS[level] < LEVELS[currentLevel]) return;
    const time = new Date().toISOString();
    const message = format(msg, ...args);
    const line = currentFormat === 'json'
        ? JSON.stringify({ time, level, msg: message })
        : `[${time}] [${level.toUpperCase()}] ${message}`;
    // warn and error always go to stderr; debug and info follow setLogOutput.
    const toStderr = level === 'warn' || level === 'error' || logOutput === 'stderr';
    (toStderr ? process.stderr : process.stdout).write(`${line}\n`);
}

export const log = {
    debug: (msg: string, ...args: unknown[]) => write('debug', msg, args),
    info: (msg: string, ...args: unknown[]) => write('info', msg, args),
    warn: (msg: string, ...args: unknown[]) => write('warn', msg, args),
    error: (msg: string, ...args: unknown[]) => write('error', msg, args),
};
