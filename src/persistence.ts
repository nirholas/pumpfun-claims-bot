/**
 * PumpFun Channel Bot — JSON state files
 *
 * Dedup and reputation state lives in small JSON files under DATA_DIR. Writes
 * go to a temporary file that is then renamed over the target, so a crash or a
 * full disk mid-write leaves the previous file intact instead of a truncated
 * one that would fail to parse and silently reset first-claim detection.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Directory for persisted state (DATA_DIR, default ./data). Read at call time. */
export function dataDir(): string {
    return process.env.DATA_DIR || join(process.cwd(), 'data');
}

/** Path of a state file inside dataDir(). */
export function dataFile(name: string): string {
    return join(dataDir(), name);
}

/**
 * Parse a JSON file. Returns undefined when the file does not exist; throws
 * with the file path in the message when it exists but cannot be read or parsed.
 */
export function readJsonFile(path: string): unknown {
    if (!existsSync(path)) return undefined;
    try {
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
    } catch (err) {
        throw new Error(`Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
}

/** Write `value` as JSON to `path` atomically, creating the directory if needed. */
export function writeJsonFileAtomic(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    try {
        writeFileSync(tmp, JSON.stringify(value), 'utf8');
        renameSync(tmp, path);
    } catch (err) {
        rmSync(tmp, { force: true });
        throw err;
    }
}

/** A JSON array of strings, ignoring non-string entries; [] for anything else. */
export function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** A JSON object's own entries; [] when the value is not a plain object. */
export function objectEntries(value: unknown): Array<[string, unknown]> {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [];
}
