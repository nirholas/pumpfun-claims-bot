import { format } from 'node:util';

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
let currentLevel: Level = 'info';

export function setLogLevel(level: Level): void { currentLevel = level; }

const stamp = () => new Date().toISOString();

export const log = {
    debug: (msg: string, ...a: unknown[]) => {
        if (LEVELS['debug'] >= LEVELS[currentLevel]) console.debug(`[${stamp()}] [DEBUG] ${format(msg, ...a)}`);
    },
    info: (msg: string, ...a: unknown[]) => {
        if (LEVELS['info'] >= LEVELS[currentLevel]) console.info(`[${stamp()}] [INFO]  ${format(msg, ...a)}`);
    },
    warn: (msg: string, ...a: unknown[]) => {
        if (LEVELS['warn'] >= LEVELS[currentLevel]) console.warn(`[${stamp()}] [WARN]  ${format(msg, ...a)}`);
    },
    error: (msg: string, ...a: unknown[]) => {
        if (LEVELS['error'] >= LEVELS[currentLevel]) console.error(`[${stamp()}] [ERROR] ${format(msg, ...a)}`);
    },
};
