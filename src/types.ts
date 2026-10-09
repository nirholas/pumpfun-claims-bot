/**
 * PumpFun Channel Bot — Types
 *
 * On-chain program IDs, instruction discriminators, and event types
 * for the read-only channel feed bot.
 */

// ============================================================================
// Program IDs
// ============================================================================

export const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_AMM_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const PUMP_FEE_PROGRAM_ID = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
export const MONITORED_PROGRAM_IDS = [PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID] as const;

export const PUMPFUN_FEE_ACCOUNT = 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbCJ5GEFDM97zC';
export const PUMPFUN_MIGRATION_AUTHORITY = '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Ticker and decimals of the non-SOL quote mints a V2 claim can pay out in. */
export const QUOTE_MINT_INFO: Record<string, { ticker: string; decimals: number; isStable: boolean }> = {
    [USDC_MINT]: { ticker: 'USDC', decimals: 6, isStable: true },
};

// ============================================================================
// Token Creation Instruction Discriminators (sha256("global:<ix>")[0..8])
// ============================================================================

export const CREATE_V2_DISCRIMINATOR = 'd6904cec5f8b31b4';
export const CREATE_DISCRIMINATOR = '181ec828051c0777';

// ============================================================================
// Event Discriminators (sha256("event:<Name>")[0..8])
// ============================================================================

/** CreateEvent: emitted by both create and create_v2. */
export const CREATE_EVENT_DISCRIMINATOR = '1b72a94ddeeb6376';
export const COMPLETE_EVENT_DISCRIMINATOR = '5f72619cd42e9808';
export const COMPLETE_AMM_MIGRATION_DISCRIMINATOR = 'bde95db95c94ea94';
export const TRADE_EVENT_DISCRIMINATOR = 'bddb7fd34ee661ee';
/** PostCompleteBuyEvent: the pool part of a buy that completed the curve (synthetic migration). */
export const POST_COMPLETE_BUY_EVENT_DISCRIMINATOR = '6fb06d8b316cd5fb';
export const DISTRIBUTE_CREATOR_FEES_EVENT_DISCRIMINATOR = 'a537817004b3ca28';

// ============================================================================
// Claim Instruction Discriminators
// ============================================================================

export type ClaimType =
    | 'collect_creator_fee'
    | 'claim_cashback'
    | 'collect_coin_creator_fee'
    | 'distribute_creator_fees'
    | 'transfer_creator_fees_to_pump'
    | 'claim_social_fee_pda';

export interface InstructionDef {
    discriminator: string;
    label: string;
    claimType: ClaimType;
    programId: string;
    isCreatorClaim: boolean;
    /** Account index of the coin mint, when the instruction names one. */
    mintAccountIndex?: number;
    /** Account index of the quote mint, when the instruction names one (V2 paths). */
    quoteMintAccountIndex?: number;
}

/**
 * Instructions that pay fees out to a wallet. Account indices follow the
 * October 2026 IDLs (distribute_creator_fees_v2 puts the payer first, so its
 * mint is accounts[1]).
 */
export const CLAIM_INSTRUCTIONS: InstructionDef[] = [
    { claimType: 'collect_creator_fee', discriminator: '1416567bc61cdb84', isCreatorClaim: true, label: 'Collect Creator Fee (Pump)', programId: PUMP_PROGRAM_ID },
    { claimType: 'collect_creator_fee', discriminator: 'cf118af204221338', isCreatorClaim: true, label: 'Collect Creator Fee V2 (Pump)', programId: PUMP_PROGRAM_ID, quoteMintAccountIndex: 4 },
    { claimType: 'claim_cashback', discriminator: '253a237ebe35e4c5', isCreatorClaim: false, label: 'Claim Cashback (Pump)', programId: PUMP_PROGRAM_ID },
    { claimType: 'claim_cashback', discriminator: '7af3cc415e741d37', isCreatorClaim: false, label: 'Claim Cashback V2 (Pump)', programId: PUMP_PROGRAM_ID, quoteMintAccountIndex: 2 },
    { claimType: 'distribute_creator_fees', discriminator: 'a572670079cef751', isCreatorClaim: true, label: 'Distribute Creator Fees (Pump)', programId: PUMP_PROGRAM_ID, mintAccountIndex: 0 },
    { claimType: 'distribute_creator_fees', discriminator: 'ffcb134ff444089f', isCreatorClaim: true, label: 'Distribute Creator Fees V2 (Pump)', programId: PUMP_PROGRAM_ID, mintAccountIndex: 1, quoteMintAccountIndex: 9 },
    { claimType: 'collect_coin_creator_fee', discriminator: 'a039592ab58b2b42', isCreatorClaim: true, label: 'Collect Creator Fee (PumpSwap)', programId: PUMP_AMM_PROGRAM_ID, quoteMintAccountIndex: 0 },
    { claimType: 'claim_cashback', discriminator: '253a237ebe35e4c5', isCreatorClaim: false, label: 'Claim Cashback (PumpSwap)', programId: PUMP_AMM_PROGRAM_ID },
    { claimType: 'transfer_creator_fees_to_pump', discriminator: '8b348655e4e56cf1', isCreatorClaim: true, label: 'Transfer Creator Fees to Pump', programId: PUMP_AMM_PROGRAM_ID },
    { claimType: 'transfer_creator_fees_to_pump', discriminator: '01214eb921432c5c', isCreatorClaim: true, label: 'Transfer Creator Fees to Pump V2', programId: PUMP_AMM_PROGRAM_ID, quoteMintAccountIndex: 1 },
    { claimType: 'claim_social_fee_pda', discriminator: 'e115fb85a11ec7e2', isCreatorClaim: true, label: 'Claim Social Fee PDA (GitHub)', programId: PUMP_FEE_PROGRAM_ID },
    { claimType: 'claim_social_fee_pda', discriminator: '114df0863abc3595', isCreatorClaim: true, label: 'Claim Social Fee PDA V2 (GitHub)', programId: PUMP_FEE_PROGRAM_ID, quoteMintAccountIndex: 2 },
];

/**
 * Fee sweeps. Since the October 2026 upgrade v3, v2 and multi-hop trades leave
 * fees on the curve or pool, and a sweep moves them into the creator vault (or
 * to the protocol). A sweep is permissionless and pays nobody's wallet, so it is
 * never a claim. A claim transaction usually carries a sweep first; only the
 * claim that follows it (vault to creator) is the payout.
 */
export const FEE_SWEEP_INSTRUCTIONS: Array<{ discriminator: string; label: string; programId: string }> = [
    { discriminator: '20f6bf3408c949ba', label: 'Sweep Creator Fee (Pump)', programId: PUMP_PROGRAM_ID },
    { discriminator: '0830be07b644b7e5', label: 'Sweep Protocol Fee (Pump)', programId: PUMP_PROGRAM_ID },
    { discriminator: '20f6bf3408c949ba', label: 'Sweep Creator Fee (PumpSwap)', programId: PUMP_AMM_PROGRAM_ID },
    { discriminator: '0830be07b644b7e5', label: 'Sweep Protocol Fee (PumpSwap)', programId: PUMP_AMM_PROGRAM_ID },
];

/** Payout events, keyed by event discriminator. Sweep events are deliberately absent: they are not payouts. */
export const CLAIM_EVENT_DISCRIMINATORS: Record<string, { label: string; isCreatorClaim: boolean }> = {
    '7a027f010ebf0caf': { isCreatorClaim: true, label: 'CollectCreatorFeeEvent' },
    'a537817004b3ca28': { isCreatorClaim: true, label: 'DistributeCreatorFeesEvent' },
    'e2d6f62107f293e5': { isCreatorClaim: false, label: 'ClaimCashbackEvent' },
    'e8f5c2eeeada3a59': { isCreatorClaim: true, label: 'CollectCoinCreatorFeeEvent' },
    '3212c141edd2eaec': { isCreatorClaim: true, label: 'SocialFeePdaClaimed' },
};

export const DEFAULT_GRADUATION_SOL_THRESHOLD = 85;

// ============================================================================
// Events
// ============================================================================

export interface FeeClaimEvent {
    txSignature: string;
    slot: number;
    timestamp: number;
    claimerWallet: string;
    tokenMint: string;
    tokenName?: string;
    tokenSymbol?: string;
    amountSol: number;
    amountLamports: number;
    claimType: ClaimType;
    isCashback: boolean;
    programId: string;
    claimLabel: string;
    /** GitHub numeric user ID (only for claim_social_fee_pda events) */
    githubUserId?: string;
    /** Platform enum (2 = GitHub) — only for claim_social_fee_pda events */
    socialPlatform?: number;
    /** Recipient wallet for social fee claims (may differ from signer) */
    recipientWallet?: string;
    /** Social fee PDA account for social claims */
    socialFeePda?: string;
    /** True when instruction was called but no SocialFeePdaClaimed event was emitted (scam/fake claim) */
    isFake?: boolean;
    /** Lifetime total claimed in lamports (from on-chain event, cumulative across all claims) */
    lifetimeClaimedLamports?: number;
    /** When multiple tokens share the same social fee PDA (scam vector), all candidate mints */
    allCandidateMints?: string[];
    /**
     * Quote mint of the payout when it is not SOL (a V2 claim on a USDC-quoted coin).
     * amountLamports then holds base units of that mint and amountSol is 0.
     */
    quoteMint?: string;
}

export interface TokenLaunchEvent {
    txSignature: string;
    slot: number;
    timestamp: number;
    mintAddress: string;
    creatorWallet: string;
    name: string;
    symbol: string;
    description: string;
    metadataUri: string;
    hasGithub: boolean;
    githubUrls: string[];
    mayhemMode: boolean;
    cashbackEnabled: boolean;
    metadata?: Record<string, unknown>;
}

export interface GraduationEvent {
    txSignature: string;
    slot: number;
    timestamp: number;
    mintAddress: string;
    user: string;
    bondingCurve: string;
    isMigration: boolean;
    solAmount?: number;
    mintAmount?: number;
    poolMigrationFee?: number;
    poolAddress?: string;
}

export interface TradeAlertEvent {
    txSignature: string;
    slot: number;
    timestamp: number;
    mintAddress: string;
    user: string;
    creator: string;
    isBuy: boolean;
    solAmount: number;
    tokenAmount: number;
    fee: number;
    creatorFee: number;
    virtualSolReserves: number;
    virtualTokenReserves: number;
    realSolReserves: number;
    realTokenReserves: number;
    mayhemMode: boolean;
    marketCapSol: number;
    bondingCurveProgress: number;
    /** TradeEvent ix_name: buy, sell, buy_v3, sell_v3, buy_exact_quote_in_v3, multi_hop_swap, ... */
    ixName?: string;
    /** True when this buy completed the bonding curve (CompleteEvent in the same transaction). */
    completedCurve?: boolean;
    /** SOL spent on the curve part alone, before the post-complete pool part. */
    curveSolAmount?: number;
    /** SOL and tokens of the pool part of a completing buy (PostCompleteBuyEvent), already included in solAmount and tokenAmount. */
    postCompleteSolAmount?: number;
    postCompleteTokenAmount?: number;
}

export interface FeeDistributionEvent {
    txSignature: string;
    slot: number;
    timestamp: number;
    mintAddress: string;
    bondingCurve: string;
    admin: string;
    distributedSol: number;
    shareholders: Array<{ address: string; shareBps: number }>;
}

