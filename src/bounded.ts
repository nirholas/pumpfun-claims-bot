/**
 * Size-capped collections for long-running state (seen signatures, caches,
 * per-user indexes). When full, the oldest entry is evicted; re-adding or
 * setting an existing key refreshes it, so the structure behaves as an LRU.
 */

export class BoundedSet<T> {
    private readonly items = new Set<T>();

    constructor(private readonly maxSize: number) {
        if (!Number.isInteger(maxSize) || maxSize < 1) throw new Error(`BoundedSet maxSize must be a positive integer, got ${maxSize}`);
    }

    get size(): number {
        return this.items.size;
    }

    has(value: T): boolean {
        return this.items.has(value);
    }

    /** Add a value. Returns true when it was not already present. */
    add(value: T): boolean {
        const isNew = !this.items.delete(value);
        this.items.add(value);
        if (this.items.size > this.maxSize) {
            const oldest = this.items.values().next();
            if (!oldest.done) this.items.delete(oldest.value);
        }
        return isNew;
    }

    values(): IterableIterator<T> {
        return this.items.values();
    }
}

export class BoundedMap<K, V> {
    private readonly entries = new Map<K, V>();

    constructor(private readonly maxSize: number) {
        if (!Number.isInteger(maxSize) || maxSize < 1) throw new Error(`BoundedMap maxSize must be a positive integer, got ${maxSize}`);
    }

    get size(): number {
        return this.entries.size;
    }

    has(key: K): boolean {
        return this.entries.has(key);
    }

    get(key: K): V | undefined {
        return this.entries.get(key);
    }

    set(key: K, value: V): this {
        this.entries.delete(key);
        this.entries.set(key, value);
        if (this.entries.size > this.maxSize) {
            const oldest = this.entries.keys().next();
            if (!oldest.done) this.entries.delete(oldest.value);
        }
        return this;
    }

    delete(key: K): boolean {
        return this.entries.delete(key);
    }

    [Symbol.iterator](): IterableIterator<[K, V]> {
        return this.entries.entries();
    }
}

/** A BoundedMap whose entries expire `ttlMs` after they were written. */
export class TtlCache<K, V> {
    private readonly entries: BoundedMap<K, { value: V; expiresAt: number }>;

    constructor(maxSize: number, private readonly defaultTtlMs: number) {
        this.entries = new BoundedMap(maxSize);
    }

    get size(): number {
        return this.entries.size;
    }

    /** The cached value, or undefined when absent or expired. A cached null is returned as null. */
    get(key: K): V | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.expiresAt) {
            this.entries.delete(key);
            return undefined;
        }
        return entry.value;
    }

    set(key: K, value: V, ttlMs = this.defaultTtlMs): void {
        this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    }
}
