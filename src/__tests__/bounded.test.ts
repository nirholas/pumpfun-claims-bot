import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoundedMap, BoundedSet, TtlCache } from '../bounded.js';

describe('BoundedSet', () => {
    it('reports whether a value was new and evicts the oldest past the cap', () => {
        const set = new BoundedSet<string>(2);
        expect(set.add('a')).toBe(true);
        expect(set.add('b')).toBe(true);
        expect(set.add('a')).toBe(false);
        set.add('c');
        expect(set.size).toBe(2);
        expect(set.has('a')).toBe(true); // refreshed by the re-add
        expect(set.has('b')).toBe(false);
        expect(set.has('c')).toBe(true);
    });

    it('rejects a non-positive cap', () => {
        expect(() => new BoundedSet(0)).toThrow(/positive integer/);
    });
});

describe('BoundedMap', () => {
    it('evicts the least recently written key', () => {
        const map = new BoundedMap<string, number>(2);
        map.set('a', 1).set('b', 2).set('a', 3).set('c', 4);
        expect([...map]).toEqual([['a', 3], ['c', 4]]);
    });
});

describe('TtlCache', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('expires entries and keeps cached nulls distinct from misses', () => {
        vi.useFakeTimers();
        const cache = new TtlCache<string, number | null>(10, 1_000);
        cache.set('hit', 1);
        cache.set('none', null);
        cache.set('short', 2, 100);
        expect(cache.get('hit')).toBe(1);
        expect(cache.get('none')).toBeNull();
        expect(cache.get('missing')).toBeUndefined();
        vi.advanceTimersByTime(500);
        expect(cache.get('short')).toBeUndefined();
        expect(cache.get('hit')).toBe(1);
        vi.advanceTimersByTime(600);
        expect(cache.get('hit')).toBeUndefined();
    });

    it('never holds more than its cap', () => {
        const cache = new TtlCache<number, number>(3, 60_000);
        for (let i = 0; i < 100; i++) cache.set(i, i);
        expect(cache.size).toBe(3);
        expect(cache.get(99)).toBe(99);
        expect(cache.get(0)).toBeUndefined();
    });
});
