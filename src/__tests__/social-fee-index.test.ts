/**
 * SocialFeeIndex reads SharingConfig accounts. web3.js 3 returns account data
 * as a plain Uint8Array, so the Borsh readers must not assume a Buffer.
 */

import { PublicKey } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';

import type { RpcFallback } from '../rpc-fallback.js';
import { SocialFeeIndex } from '../social-fee-index.js';
import { key } from './pump-event-bytes.js';

vi.mock('../logger.js', () => ({
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const SHARING_CONFIG_DISC = [216, 74, 9, 0, 56, 140, 93, 75];
const MINT = key(1);
const PDA = key(20);

/** SharingConfig: disc(8) bump version status mint(32) admin(32) admin_revoked shareholders(vec). */
function sharingConfig(mint: string, shareholders: string[]): Uint8Array {
    const bytes = new Uint8Array(76 + 4 + shareholders.length * 34);
    bytes.set(SHARING_CONFIG_DISC, 0);
    bytes.set(new PublicKey(mint).toBytes(), 11);
    new DataView(bytes.buffer).setUint32(76, shareholders.length, true);
    shareholders.forEach((address, i) => bytes.set(new PublicKey(address).toBytes(), 80 + i * 34));
    return bytes;
}

function rpcReturning(conn: Record<string, unknown>): RpcFallback {
    const fake = { withFallback: async <T>(fn: (c: unknown) => Promise<T>): Promise<T> => fn(conn) };
    return fake as unknown as RpcFallback;
}

describe('SocialFeeIndex.resolveFromChain', () => {
    it('resolves a SharingConfig account returned as a Uint8Array', async () => {
        const index = new SocialFeeIndex();
        const rpc = rpcReturning({ getAccountInfo: async () => ({ data: sharingConfig(MINT, [PDA]) }) });

        await expect(index.resolveFromChain(PDA, rpc)).resolves.toBe(MINT);
        expect(index.lookupAll(PDA)).toEqual([MINT]);
    });

    it('resolves through the shareholder GPA scan with Uint8Array data', async () => {
        const index = new SocialFeeIndex();
        const rpc = rpcReturning({
            getAccountInfo: async () => null,
            getProgramAccounts: async () => [{ pubkey: new PublicKey(key(30)), account: { data: sharingConfig(MINT, [PDA]) } }],
        });

        await expect(index.resolveFromChain(PDA, rpc)).resolves.toBe(MINT);
    });
});
