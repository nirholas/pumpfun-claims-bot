import { describe, expect, it } from 'vitest';

import { asArray, asRecord, bool, num, optStr, str } from '../json-fields.js';

describe('json field readers', () => {
    it('str keeps strings, stringifies scalars and refuses objects', () => {
        expect(str('a')).toBe('a');
        expect(str(42)).toBe('42');
        expect(str(true)).toBe('true');
        expect(str({ toString: () => 'x' }, 'fallback')).toBe('fallback');
        expect(str(null, 'Unknown')).toBe('Unknown');
    });

    it('optStr returns undefined for empty or non-string-like values', () => {
        expect(optStr('')).toBeUndefined();
        expect(optStr([])).toBeUndefined();
        expect(optStr('x')).toBe('x');
    });

    it('num accepts finite numbers and numeric strings only', () => {
        expect(num(5)).toBe(5);
        expect(num('2.5')).toBe(2.5);
        expect(num('')).toBe(0);
        expect(num('12abc', -1)).toBe(-1);
        expect(num(Infinity)).toBe(0);
        expect(num({})).toBe(0);
    });

    it('bool is true only for true, "true" and 1', () => {
        expect([true, 'true', 1].map(bool)).toEqual([true, true, true]);
        expect([false, 'false', 0, 'yes', {}, null].map(bool)).toEqual([false, false, false, false, false, false]);
    });

    it('asRecord and asArray never throw on the wrong shape', () => {
        expect(asRecord(null).x).toBeUndefined();
        expect(asRecord([1, 2])).toEqual({});
        expect(asRecord({ a: 1 }).a).toBe(1);
        expect(asArray('nope')).toEqual([]);
        expect(asArray([1])).toEqual([1]);
    });
});
