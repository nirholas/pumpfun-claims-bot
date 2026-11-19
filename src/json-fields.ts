/**
 * Typed readers for fields of untrusted JSON (pump.fun, DexScreener, GitHub,
 * price APIs). Each returns a value of the expected type or the fallback, so
 * an unexpected shape (an object where a string was expected, a numeric
 * string, null) never turns into "[object Object]" or NaN downstream.
 */

export type JsonRecord = Readonly<Record<string, unknown>>;

const EMPTY: JsonRecord = Object.freeze({});

/** The value as an object, or an empty object for anything else (arrays included). */
export function asRecord(value: unknown): JsonRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : EMPTY;
}

/** The value as an array, or an empty array. */
export function asArray(value: unknown): readonly unknown[] {
    return Array.isArray(value) ? value : [];
}

/** Strings as-is, numbers and booleans as text, anything else as the fallback. */
export function str(value: unknown, fallback = ''): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return String(value);
    return fallback;
}

/** A non-empty string, or undefined. */
export function optStr(value: unknown): string | undefined {
    const s = str(value);
    return s ? s : undefined;
}

/** Finite numbers, and strings that parse as finite numbers; anything else is the fallback. */
export function num(value: unknown, fallback = 0): number {
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    return Number.isFinite(n) ? n : fallback;
}

/** true for true, "true" and 1; false otherwise. */
export function bool(value: unknown): boolean {
    return value === true || value === 'true' || value === 1;
}
