/**
 * PumpFun Channel Bot — Social Fee Index
 *
 * Maintains a map of socialFeePdaAddress → tokenMint by:
 *  1. Scanning all SharingConfig accounts at startup (GPA bootstrap)
 *  2. Updating live from CreateFeeSharingConfigEvent and UpdateFeeSharesEvent logs
 *
 * SharingConfig account layout (after 8-byte discriminator):
 *   bump:          u8   (1)
 *   version:       u8   (1)
 *   status:        u8   (1)  — enum, 1 byte
 *   mint:          pubkey (32)  ← offset 11
 *   admin:         pubkey (32)  ← offset 43
 *   admin_revoked: bool  (1)
 *   shareholders:  vec<Shareholder>  ← offset 76
 *     count: u32 LE (4)
 *     each:  address(32) + share_bps(u16=2) = 34 bytes
 *
 * CreateFeeSharingConfigEvent layout (after 8-byte discriminator):
 *   timestamp:           i64 (8)
 *   mint:                pubkey (32)  ← offset 16
 *   bonding_curve:       pubkey (32)
 *   pool:                Option<pubkey> — 1 byte tag + optional 32
 *   sharing_config:      pubkey (32)
 *   admin:               pubkey (32)
 *   initial_shareholders: vec<Shareholder>
 *   status:              u8
 *
 * UpdateFeeSharesEvent layout (after 8-byte discriminator):
 *   timestamp:        i64 (8)
 *   mint:             pubkey (32)  ← offset 16
 *   sharing_config:   pubkey (32)
 *   admin:            pubkey (32)
 *   new_shareholders: vec<Shareholder>
 */

import { PublicKey, type AccountInfo } from '@solana/web3.js';
import type { RpcFallback } from './rpc-fallback.js';
import { log } from './logger.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** SharingConfig account discriminator (from IDL: [216,74,9,0,56,140,93,75]) */
const SHARING_CONFIG_DISC = Buffer.from([216, 74, 9, 0, 56, 140, 93, 75]);

/** CreateFeeSharingConfigEvent discriminator (from IDL: [133,105,170,200,184,116,251,88]) */
export const CREATE_FEE_SHARING_CONFIG_EVENT_DISC = '8569aac8b874fb58';

/** UpdateFeeSharesEvent discriminator (from IDL: [21,186,196,184,91,228,225,203]) */
export const UPDATE_FEE_SHARES_EVENT_DISC = '15bac4b85be4e1cb';

const PUMP_FEE_PROGRAM_ID = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';

// ── Helpers ──────────────────────────────────────────────────────────────────

function readPubkey(buf: Buffer, offset: number): string {
    if (buf.length < offset + 32) return '';
    return new PublicKey(buf.subarray(offset, offset + 32)).toBase58();
}

/**
 * Parse shareholder addresses from a Borsh-encoded vec<Shareholder>.
 * Each Shareholder = address(32) + share_bps(u16=2) = 34 bytes.
 * Returns the list of address strings.
 */
function parseShareholderAddresses(buf: Buffer, offset: number): string[] {
    if (buf.length < offset + 4) return [];
    const count = buf.readUInt32LE(offset);
    offset += 4;

    if (count > 20) return []; // sanity check

    // Parse as many shareholders as the buffer contains — dataSlice may
    // truncate the account data, so we stop when bytes run out rather than
    // requiring the full count * 34 bytes to be present.
    const addresses: string[] = [];
    for (let i = 0; i < count && offset + 34 <= buf.length; i++) {
        const addr = readPubkey(buf, offset);
        if (addr) addresses.push(addr);
        offset += 34; // 32 (pubkey) + 2 (share_bps u16)
    }
    return addresses;
}

// ── Index ────────────────────────────────────────────────────────────────────

export class SocialFeeIndex {
    /** socialFeePdaAddress → set of mints (1:many — scammers can add the same PDA to multiple tokens) */
    private index = new Map<string, Set<string>>();
    private bootstrapped = false;

    /** Number of PDA→mint mappings in the index. */
    get size(): number {
        let count = 0;
        for (const set of this.index.values()) count += set.size;
        return count;
    }

    private addMapping(pdaAddress: string, mint: string): void {
        let set = this.index.get(pdaAddress);
        if (!set) {
            set = new Set();
            this.index.set(pdaAddress, set);
        }
        set.add(mint);
    }

    /**
     * Bootstrap the index by scanning ALL SharingConfig accounts on-chain.
     * Runs once at startup so historical configs are covered.
     *
     * Opt-in via SOCIAL_FEE_BOOTSTRAP=true. Disabled by default because
     * getProgramAccounts returns all accounts at once and exhausts the JS heap
     * when hundreds of thousands of SharingConfig accounts exist on-chain.
     * Without bootstrap the index is populated incrementally from live
     * CreateFeeSharingConfigEvent / UpdateFeeSharesEvent log emissions.
     */
    async bootstrap(rpc: RpcFallback): Promise<void> {
        if (this.bootstrapped) return;
        if (process.env.SOCIAL_FEE_BOOTSTRAP !== 'true') {
            log.info(
                'SocialFeeIndex: skipping GPA bootstrap (set SOCIAL_FEE_BOOTSTRAP=true to enable). '
                + 'Index will build from live events only.',
            );
            this.bootstrapped = true;
            return;
        }
        try {
            log.info('SocialFeeIndex: bootstrapping from on-chain SharingConfig accounts...');

            // Phase 1: collect account addresses only (dataSlice length=0 means no
            // account data is returned). This caps the GPA JSON response at ~40 MB for
            // 150k accounts, vs ~75 MB when returning 216 bytes per account. The lower
            // water mark prevents the heap from spiking past the V8 limit on
            // memory-constrained containers.
            const refs = await rpc.withFallback((conn) =>
                conn.getProgramAccounts(new PublicKey(PUMP_FEE_PROGRAM_ID), {
                    commitment: 'confirmed',
                    dataSlice: { offset: 0, length: 0 },
                    filters: [
                        {
                            memcmp: {
                                offset: 0,
                                bytes: SHARING_CONFIG_DISC.toString('base64'),
                                encoding: 'base64',
                            },
                        },
                    ],
                }),
            ) as unknown as Array<{ pubkey: PublicKey; account: unknown }>;

            // Keep only the pubkeys so V8 can reclaim the AccountInfo objects before
            // we start phase 2.
            const pubkeys: PublicKey[] = refs.map(({ pubkey }) => pubkey);
            const total = pubkeys.length;
            log.info('SocialFeeIndex: found %d SharingConfig accounts, fetching data in batches...', total);

            // Phase 2: fetch full shareholder data in small concurrent batches so peak
            // heap per round is bounded (100 accounts × 216 bytes × 5 concurrent ≈ 108 KB
            // of raw data, easily fitting within any practical heap budget).
            const BATCH = 100;
            const CONCURRENCY = 5;
            const ROUND_DELAY_MS = 150;
            let indexed = 0;

            for (let i = 0; i < total; i += BATCH * CONCURRENCY) {
                const promises: Promise<(AccountInfo<Buffer> | null)[] | null>[] = [];
                for (let j = i; j < Math.min(i + BATCH * CONCURRENCY, total); j += BATCH) {
                    const slice = pubkeys.slice(j, Math.min(j + BATCH, total));
                    promises.push(
                        rpc.withFallback((conn) =>
                            conn.getMultipleAccountsInfo(slice, {
                                commitment: 'confirmed',
                                dataSlice: { offset: 0, length: 216 },
                            }),
                        ).catch((err: unknown) => {
                            log.debug('SocialFeeIndex bootstrap batch failed: %s', err);
                            return null;
                        }),
                    );
                }

                const batches = await Promise.all(promises);
                for (const accts of batches) {
                    if (!accts) continue;
                    for (const acct of accts) {
                        if (!acct) continue;
                        const data = acct.data as Buffer;
                        if (data.length < 76) continue;
                        const mint = readPubkey(data, 11);
                        if (!mint) continue;
                        const shareholders = parseShareholderAddresses(data, 76);
                        for (const addr of shareholders) {
                            this.addMapping(addr, mint);
                            indexed++;
                        }
                    }
                }

                // Small delay between rounds to avoid saturating the RPC provider.
                if (i + BATCH * CONCURRENCY < total) {
                    await new Promise<void>((r) => setTimeout(r, ROUND_DELAY_MS));
                }
            }

            this.bootstrapped = true;
            log.info('SocialFeeIndex: bootstrapped %d mappings from %d SharingConfig accounts', indexed, total);
        } catch (err) {
            log.warn('SocialFeeIndex: bootstrap failed (will rely on live events): %s', err);
            this.bootstrapped = true; // don't retry on every restart
        }
    }

    /**
     * Update from a CreateFeeSharingConfigEvent log line body (bytes including discriminator).
     * Layout: disc(8) + timestamp(8) + mint(32) + bonding_curve(32) + pool(Option<pubkey>) + sharing_config(32) + admin(32) + shareholders(vec)
     */
    updateFromCreateEvent(bytes: Buffer): void {
        try {
            if (bytes.length < 48) return;
            const mint = readPubkey(bytes, 16); // disc(8)+timestamp(8) = 16
            if (!mint) return;

            // Skip bonding_curve(32) then pool (Option: 1 byte + optional 32)
            let offset = 48 + 32; // 16 + 32 (mint) + 32 (bonding_curve) = 80
            if (bytes.length < offset + 1) return;
            const hasPool = bytes[offset] === 1;
            offset += 1 + (hasPool ? 32 : 0);

            // sharing_config(32) + admin(32)
            offset += 32 + 32;

            const shareholders = parseShareholderAddresses(bytes, offset);
            for (const addr of shareholders) {
                this.addMapping(addr, mint);
            }
            if (shareholders.length > 0) {
                log.debug('SocialFeeIndex: indexed %d shareholders for mint %s', shareholders.length, mint.slice(0, 8));
            }
        } catch (err) {
            log.debug('SocialFeeIndex: CreateFeeSharingConfigEvent parse error: %s', err);
        }
    }

    /**
     * Update from an UpdateFeeSharesEvent log line body (bytes including discriminator).
     * Layout: disc(8) + timestamp(8) + mint(32) + sharing_config(32) + admin(32) + shareholders(vec)
     */
    updateFromUpdateSharesEvent(bytes: Buffer): void {
        try {
            if (bytes.length < 48) return;
            const mint = readPubkey(bytes, 16); // disc(8)+timestamp(8) = 16
            if (!mint) return;

            // sharing_config(32) + admin(32)
            const offset = 16 + 32 + 32 + 32; // 112
            const shareholders = parseShareholderAddresses(bytes, offset);
            for (const addr of shareholders) {
                this.addMapping(addr, mint);
            }
            if (shareholders.length > 0) {
                log.debug('SocialFeeIndex: updated %d shareholders for mint %s', shareholders.length, mint.slice(0, 8));
            }
        } catch (err) {
            log.debug('SocialFeeIndex: UpdateFeeSharesEvent parse error: %s', err);
        }
    }

    /**
     * Look up the mint for a given social fee PDA address.
     * Returns the first mint if only one exists, otherwise undefined
     * (use lookupAll for disambiguation when multiple tokens share the same PDA).
     */
    lookup(socialFeePdaAddress: string): string | undefined {
        const set = this.index.get(socialFeePdaAddress);
        if (!set || set.size === 0) return undefined;
        if (set.size === 1) return set.values().next().value;
        // Multiple mints — caller should use lookupAll + market cap disambiguation
        return undefined;
    }

    /**
     * Look up ALL mints associated with a social fee PDA address.
     * When multiple tokens share the same PDA (scam vector), returns all
     * candidates so the caller can disambiguate by market cap.
     */
    lookupAll(socialFeePdaAddress: string): string[] {
        const set = this.index.get(socialFeePdaAddress);
        if (!set) return [];
        return [...set];
    }

    /**
     * On-demand resolution: when the in-memory index has no entry for a
     * social fee PDA address (e.g. the token was created before the bot
     * started and bootstrap is disabled), attempt to find the mint via RPC.
     *
     * Two strategies tried in order:
     *  1. Fetch the account at `address` directly — if it is a SharingConfig
     *     (matching discriminator), read the mint from offset 11.
     *  2. GPA scan for a SharingConfig whose first shareholder slot (offset 80)
     *     matches `address` — covers the case where social_fee_pda is a
     *     per-user PDA listed inside the SharingConfig's shareholders vec.
     *
     * Updates the in-memory index on success so future lookups are served
     * from memory without another RPC round-trip.
     */
    async resolveFromChain(address: string, rpc: RpcFallback): Promise<string | undefined> {
        // Strategy 1: direct account fetch
        try {
            const info = await rpc.withFallback((conn) =>
                conn.getAccountInfo(new PublicKey(address), { commitment: 'confirmed' }),
            );
            if (info?.data) {
                const data = Buffer.isBuffer(info.data) ? info.data : Buffer.from(info.data as Uint8Array);
                if (data.length >= 43 && data.subarray(0, 8).equals(SHARING_CONFIG_DISC)) {
                    const mint = readPubkey(data, 11);
                    if (mint) {
                        this.addMapping(address, mint);
                        log.debug('SocialFeeIndex: on-demand resolved %s → mint %s (direct)', address.slice(0, 8), mint.slice(0, 8));
                        return mint;
                    }
                }
            }
        } catch (err) {
            log.debug('SocialFeeIndex: on-demand getAccountInfo failed for %s: %s', address.slice(0, 8), err);
        }

        // Strategy 2: GPA scan — find a SharingConfig whose first shareholder = address
        try {
            const accounts = await rpc.withFallback((conn) =>
                conn.getProgramAccounts(new PublicKey(PUMP_FEE_PROGRAM_ID), {
                    commitment: 'confirmed',
                    dataSlice: { offset: 0, length: 76 },
                    filters: [
                        {
                            memcmp: {
                                offset: 0,
                                bytes: SHARING_CONFIG_DISC.toString('base64'),
                                encoding: 'base64',
                            },
                        },
                        {
                            // shareholders vec: count(4) at offset 76, first address at 80
                            memcmp: {
                                offset: 80,
                                bytes: new PublicKey(address).toBase58(),
                            },
                        },
                    ],
                }),
            ) as unknown as Array<{ pubkey: PublicKey; account: { data: Buffer } }>;

            if (accounts.length > 0) {
                let added = 0;
                for (const acct of accounts) {
                    const data = Buffer.isBuffer(acct.account.data)
                        ? acct.account.data
                        : Buffer.from(acct.account.data as Uint8Array);
                    if (data.length >= 43) {
                        const mint = readPubkey(data, 11);
                        if (mint) { this.addMapping(address, mint); added++; }
                    }
                }
                if (added > 0) {
                    log.debug('SocialFeeIndex: on-demand resolved %s → %d mint(s) (GPA)', address.slice(0, 8), added);
                    return this.lookup(address); // undefined when >1 mint — caller uses lookupAll
                }
            }
        } catch (err) {
            log.debug('SocialFeeIndex: on-demand GPA failed for %s: %s', address.slice(0, 8), err);
        }

        return undefined;
    }
}
