import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { asStringArray, objectEntries, readJsonFile, writeJsonFileAtomic } from '../persistence.js';

describe('JSON state files', () => {
    let dir: string;

    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'persistence-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('writes atomically into a directory it creates, leaving no temp file', () => {
        const path = join(dir, 'nested', 'state.json');
        writeJsonFileAtomic(path, { a: [1, 2] });
        expect(readJsonFile(path)).toEqual({ a: [1, 2] });
        expect(readdirSync(join(dir, 'nested'))).toEqual(['state.json']);
    });

    it('returns undefined for a missing file and names the file when it is corrupt', () => {
        expect(readJsonFile(join(dir, 'missing.json'))).toBeUndefined();
        const corrupt = join(dir, 'corrupt.json');
        writeFileSync(corrupt, '{"half":');
        expect(() => readJsonFile(corrupt)).toThrow(corrupt);
    });

    it('keeps the previous file when serialisation fails', () => {
        const path = join(dir, 'state.json');
        writeJsonFileAtomic(path, ['kept']);
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(() => writeJsonFileAtomic(path, cyclic)).toThrow();
        expect(readJsonFile(path)).toEqual(['kept']);
        expect(existsSync(`${path}.${process.pid}.tmp`)).toBe(false);
    });
});

describe('shape helpers', () => {
    it('keeps only strings from an array', () => {
        expect(asStringArray(['a', 1, null, 'b'])).toEqual(['a', 'b']);
        expect(asStringArray({ a: 1 })).toEqual([]);
    });

    it('lists entries of plain objects only', () => {
        expect(objectEntries({ a: 1 })).toEqual([['a', 1]]);
        expect(objectEntries(['x'])).toEqual([]);
        expect(objectEntries(null)).toEqual([]);
    });
});
