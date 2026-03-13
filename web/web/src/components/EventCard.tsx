import type {
  FeedEvent,
  TokenLaunchEvent,
  TradeAlertEvent,
  GraduationEvent,
  FeeClaimEvent,
  FeeDistributionEvent,
} from '../types'
import WalletAddress from './WalletAddress'
import SolAmount from './SolAmount'
import TokenBadge from './TokenBadge'
import TimeAgo from './TimeAgo'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** Thin bonding-curve progress bar */
function BondingBar({ pct }: { pct: number }) {
  const capped = Math.min(Math.max(pct, 0), 100)
  const color = capped >= 80 ? '#b388ff' : capped >= 50 ? '#00e676' : '#5eb5f7'
  return (
    <div>
      <div className="flex justify-between text-[10px] mb-0.5">
        <span className="text-zinc-500">Bonding Curve</span>
        <span style={{ color }} className="font-medium">{capped.toFixed(1)}%</span>
      </div>
      <div className="w-full h-1.5 bg-tg-input rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${capped}%`, background: color }}
        />
      </div>
    </div>
  )
}

/** Pill badge */
function Pill({
  label,
  color = 'tg-input',
}: {
  label: string
  color?: 'green' | 'blue' | 'pink' | 'yellow' | 'purple' | 'orange' | 'tg-input'
}) {
  const classes: Record<string, string> = {
    green:    'bg-pump-green/20 text-pump-green border border-pump-green/30',
    blue:     'bg-tg-blue/20 text-tg-blue border border-tg-blue/30',
    pink:     'bg-pump-pink/20 text-pump-pink border border-pump-pink/30',
    yellow:   'bg-pump-yellow/20 text-pump-yellow border border-pump-yellow/30',
    purple:   'bg-pump-purple/20 text-pump-purple border border-pump-purple/30',
    orange:   'bg-pump-orange/20 text-pump-orange border border-pump-orange/30',
    'tg-input': 'bg-tg-input text-zinc-400',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${classes[color]}`}>
      {label}
    </span>
  )
}

/** Stat cell used in two-column grids */
function Stat({ icon, label, value, valueColor = 'text-white' }: {
  icon: string
  label: string
  value: string | number
  valueColor?: string
}) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span>{icon}</span>
      <span className={`font-medium ${valueColor}`}>{value}</span>
      <span className="text-zinc-500">{label}</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Launch Card
// ─────────────────────────────────────────────────────────────────────────────

function LaunchCard({ e }: { e: TokenLaunchEvent }) {
  const pumpLink  = `https://pump.fun/coin/${e.mintAddress}`
  const solLink   = `https://solscan.io/token/${e.mintAddress}`
  const dexLink   = `https://dexscreener.com/solana/${e.mintAddress}`

  const twitter  = e.metadata?.twitter  as string | undefined
  const telegram = e.metadata?.telegram as string | undefined
  const website  = e.metadata?.website  as string | undefined

  return (
    <>
      {/* ── Header ── */}
      <p className="font-semibold text-sm text-white">🚀 New Token Launch</p>

      {/* ── Token identity ── */}
      <div className="mt-2 space-y-0.5">
        <TokenBadge name={e.name} symbol={e.symbol} size="lg" />
        <p className="text-[11px] text-zinc-500 font-mono">
          CA: <WalletAddress address={e.mintAddress} chars={4} copyable className="text-zinc-400" />
        </p>
        <p className="text-xs text-zinc-400 font-mono">
          Creator: <WalletAddress address={e.creatorWallet} chars={6} copyable className="text-zinc-400" />
        </p>
      </div>

      {/* ── Description ── */}
      {e.description && e.description.trim() !== '' && (
        <blockquote className="mt-2 text-xs text-zinc-400 italic border-l-2 border-tg-border pl-2 line-clamp-2">
          "{e.description.trim()}"
        </blockquote>
      )}

      {/* ── Feature pills ── */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {e.cashbackEnabled && <Pill label="🔁 Cashback" color="green" />}
        {e.mayhemMode && <Pill label="⚡ Mayhem" color="orange" />}
        {e.hasGithub && (
          <Pill
            label={e.githubUrls.length > 1 ? `🐙 GitHub ×${e.githubUrls.length}` : '🐙 GitHub'}
            color="blue"
          />
        )}
        {!e.cashbackEnabled && !e.mayhemMode && !e.hasGithub && (
          <Pill label="🔵 Standard launch" />
        )}
      </div>

      {/* ── Social links ── */}
      {(twitter || telegram || website) && (
        <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
          {twitter  && <a href={twitter}  target="_blank" rel="noreferrer" className="text-tg-blue hover:underline">🐦 Twitter</a>}
          {telegram && <a href={telegram} target="_blank" rel="noreferrer" className="text-tg-blue hover:underline">💬 Telegram</a>}
          {website  && <a href={website}  target="_blank" rel="noreferrer" className="text-tg-blue hover:underline">🌐 Website</a>}
        </div>
      )}

      {/* ── GitHub links ── */}
      {e.hasGithub && e.githubUrls.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {e.githubUrls.slice(0, 2).map(url => (
            <a key={url} href={url} target="_blank" rel="noreferrer"
               className="block text-xs text-zinc-500 hover:text-tg-blue truncate">
              🔗 {url.replace('https://', '')}
            </a>
          ))}
        </div>
      )}

      {/* ── Action buttons ── */}
      <div className="grid grid-cols-3 gap-1.5 mt-3">
        <a href={pumpLink} target="_blank" rel="noreferrer"
           className="bg-tg-input text-tg-blue text-xs rounded-lg px-2 py-1.5 text-center hover:bg-tg-hover transition">
          PumpFun
        </a>
        <a href={solLink} target="_blank" rel="noreferrer"
           className="bg-tg-input text-tg-blue text-xs rounded-lg px-2 py-1.5 text-center hover:bg-tg-hover transition">
          Explorer
        </a>
        <a href={dexLink} target="_blank" rel="noreferrer"
           className="bg-tg-input text-tg-blue text-xs rounded-lg px-2 py-1.5 text-center hover:bg-tg-hover transition">
          DexScreener
        </a>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Whale Trade Card
// ─────────────────────────────────────────────────────────────────────────────

function TradeCard({ e }: { e: TradeAlertEvent }) {
  const isBuy       = e.isBuy
  const amtColor    = isBuy ? 'text-pump-green' : 'text-pump-pink'
  const solLink     = `https://solscan.io/tx/${e.txSignature}`
  const pumpLink    = `https://pump.fun/coin/${e.mintAddress}`

  const mcSol   = e.marketCapSol
  const mcUsd   = mcSol * 150  // rough SOL → USD at ~$150; real app should use live price

  return (
    <>
      <p className="font-semibold text-sm text-white">
        🐋 Whale {isBuy ? 'Buy' : 'Sell'} —{' '}
        <SolAmount sol={e.solAmount} className={`font-bold ${amtColor}`} />
      </p>

      <div className="mt-2 space-y-0.5">
        <TokenBadge name={e.tokenName} symbol={e.tokenSymbol} size="md" />
        <p className="text-[11px] text-zinc-500 font-mono">
          CA: <WalletAddress address={e.mintAddress} chars={4} copyable className="text-zinc-400" />
        </p>
        <p className="text-xs text-zinc-400 font-mono">
          Wallet: <WalletAddress address={e.user} chars={6} copyable className="text-zinc-400" />
        </p>
      </div>

      {/* Stats */}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        <Stat icon="💰" label="MC" value={fmtUsd(mcUsd)} />
        <Stat icon="⚡" label="SOL" value={`${e.solAmount.toFixed(2)}`} valueColor={amtColor} />
        <Stat icon="🪙" label="tokens" value={(e.tokenAmount / 1e6).toFixed(1) + 'M'} />
        <Stat icon="👤" label="fee" value={`${e.creatorFee.toFixed(4)} SOL`} />
      </div>

      {/* Bonding curve */}
      <div className="mt-2">
        <BondingBar pct={e.bondingCurveProgress} />
      </div>

      {/* Reserve info */}
      <div className="mt-1.5 flex gap-3 text-[11px] text-zinc-500">
        <span>🏊 {e.realSolReserves.toFixed(1)} SOL pool</span>
        {e.mayhemMode && <span className="text-pump-orange">⚡ Mayhem</span>}
      </div>

      <div className="grid grid-cols-2 gap-1.5 mt-3">
        <a href={pumpLink} target="_blank" rel="noreferrer"
           className="bg-tg-input text-tg-blue text-xs rounded-lg px-2 py-1.5 text-center hover:bg-tg-hover transition">
          PumpFun
        </a>
        <a href={solLink} target="_blank" rel="noreferrer"
           className="bg-tg-input text-tg-blue text-xs rounded-lg px-2 py-1.5 text-center hover:bg-tg-hover transition">
          View TX
        </a>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Graduation Card
// ─────────────────────────────────────────────────────────────────────────────

function GraduationCard({ e }: { e: GraduationEvent }) {
  const pumpLink    = `https://pump.fun/coin/${e.mintAddress}`
  const solLink     = `https://solscan.io/tx/${e.txSignature}`
  const dexLink     = e.poolAddress
    ? `https://dexscreener.com/solana/${e.poolAddress}`
    : `https://dexscreener.com/solana/${e.mintAddress}`

  return (
    <>
      <p className="font-semibold text-sm text-white">
        🎓 Token Graduated{e.isMigration ? ' (AMM Migration)' : ''}!
      </p>

      <div className="mt-2 space-y-0.5">
        <TokenBadge name={e.tokenName} symbol={e.tokenSymbol} size="md" />
        <p className="text-[11px] text-zinc-500 font-mono">
          CA: <WalletAddress address={e.mintAddress} chars={4} copyable className="text-zinc-400" />
        </p>
        <p className="text-xs text-zinc-400">
          {e.isMigration ? 'Migrated to PumpSwap AMM' : 'Bonding curve complete'}
        </p>
      </div>

      {/* Stats */}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        {e.solAmount !== undefined && (
          <Stat icon="🏊" label="liquidity" value={`${e.solAmount.toFixed(1)} SOL`} valueColor="text-pump-green" />
        )}
        {e.poolMigrationFee !== undefined && (
          <Stat icon="💸" label="migration fee" value={`${e.poolMigrationFee.toFixed(3)} SOL`} />
        )}
        {e.mintAmount !== undefined && (
          <Stat icon="🪙" label="tokens" value={(e.mintAmount / 1e9).toFixed(0) + 'M'} />
        )}
        {e.poolAddress && (
          <span className="text-[11px] text-zinc-500 col-span-2 font-mono truncate">
            Pool: <WalletAddress address={e.poolAddress} chars={4} />
          </span>
        )}
      </div>

      {/* BC complete badge */}
      <div className="mt-2">
        <BondingBar pct={100} />
      </div>

      <div className="grid grid-cols-3 gap-1.5 mt-3">
        <a href={pumpLink} target="_blank" rel="noreferrer"
           className="bg-tg-input text-tg-blue text-xs rounded-lg px-2 py-1.5 text-center hover:bg-tg-hover transition">
          PumpFun
        </a>
        <a href={dexLink} target="_blank" rel="noreferrer"
           className="bg-tg-input text-tg-blue text-xs rounded-lg px-2 py-1.5 text-center hover:bg-tg-hover transition">
          Pool
        </a>
        <a href={solLink} target="_blank" rel="noreferrer"
           className="bg-tg-input text-tg-blue text-xs rounded-lg px-2 py-1.5 text-center hover:bg-tg-hover transition">
          TX
        </a>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Fee Claim Card
// ─────────────────────────────────────────────────────────────────────────────

function ClaimCard({ e }: { e: FeeClaimEvent }) {
  const solLink  = `https://solscan.io/tx/${e.txSignature}`
  const pumpLink = `https://pump.fun/coin/${e.tokenMint}`

  return (
    <>
      <p className="font-semibold text-sm text-white">
        {e.isFirstClaim ? '🚨 First ' : ''}
        💰 Fee Claimed —{' '}
        <SolAmount sol={e.amountSol} className="font-bold text-pump-green" />
      </p>

      <div className="mt-2 space-y-0.5">
        <TokenBadge name={e.tokenName} symbol={e.tokenSymbol} size="md" />
        <p className="text-[11px] text-zinc-500 font-mono">
          CA: <WalletAddress address={e.tokenMint} chars={4} copyable className="text-zinc-400" />
        </p>
        <p className="text-xs text-zinc-400 font-mono">
          Claimer: <WalletAddress address={e.claimerWallet} chars={6} copyable className="text-zinc-400" />
        </p>
        {e.githubHandle && (
          <a
            href={`https://github.com/${e.githubHandle}`}
            target="_blank"
            rel="noreferrer"
            className="block text-xs text-tg-blue hover:underline"
          >
            🐙 @{e.githubHandle}
          </a>
        )}
      </div>

      {/* Stats */}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        <Stat icon="💰" label="this claim" value={`${e.amountSol.toFixed(4)} SOL`} valueColor="text-pump-green" />
        {e.lifetimeClaimedSol !== undefined && (
          <Stat icon="🏆" label="lifetime" value={`${e.lifetimeClaimedSol.toFixed(2)} SOL`} />
        )}
        {e.claimNumber !== undefined && (
          <Stat icon="🔖" label="" value={`Claim #${e.claimNumber}`} />
        )}
        {e.marketCapSol !== undefined && (
          <Stat icon="📊" label="MC" value={`${e.marketCapSol.toFixed(0)} SOL`} />
        )}
        {e.holderCount !== undefined && (
          <Stat icon="👥" label="holders" value={e.holderCount} />
        )}
      </div>

      {/* Claim type */}
      <div className="mt-2">
        <Pill label={e.claimLabel} color="blue" />
        {e.isFirstClaim && <Pill label="🥇 First ever" color="yellow" />}
      </div>

      <div className="grid grid-cols-2 gap-1.5 mt-3">
        <a href={pumpLink} target="_blank" rel="noreferrer"
           className="bg-tg-input text-tg-blue text-xs rounded-lg px-2 py-1.5 text-center hover:bg-tg-hover transition">
          Token
        </a>
        <a href={solLink} target="_blank" rel="noreferrer"
           className="bg-tg-input text-tg-blue text-xs rounded-lg px-2 py-1.5 text-center hover:bg-tg-hover transition">
          View TX
        </a>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Fee Distribution Card
// ─────────────────────────────────────────────────────────────────────────────

function DistributionCard({ e }: { e: FeeDistributionEvent }) {
  const solLink = `https://solscan.io/tx/${e.txSignature}`

  return (
    <>
      <p className="font-semibold text-sm text-white">
        💎 Fee Distribution —{' '}
        <SolAmount sol={e.distributedSol} className="font-bold text-pump-cyan" />
      </p>

      <div className="mt-2 space-y-0.5">
        <TokenBadge name={e.tokenName} symbol={e.tokenSymbol} size="md" />
        <p className="text-[11px] text-zinc-500 font-mono">
          CA: <WalletAddress address={e.mintAddress} chars={4} copyable className="text-zinc-400" />
        </p>
      </div>

      {/* Shareholders */}
      {e.shareholders.length > 0 && (
        <div className="mt-2 space-y-0.5">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Shareholders</p>
          {e.shareholders.slice(0, 4).map(s => (
            <div key={s.address} className="flex items-center justify-between text-xs">
              <WalletAddress address={s.address} chars={4} className="text-zinc-400" />
              <span className="text-pump-green font-medium">{(s.shareBps / 100).toFixed(1)}%</span>
            </div>
          ))}
          {e.shareholders.length > 4 && (
            <p className="text-zinc-600 text-[10px]">+{e.shareholders.length - 4} more…</p>
          )}
        </div>
      )}

      <div className="mt-3">
        <a href={solLink} target="_blank" rel="noreferrer"
           className="block w-full bg-tg-input text-tg-blue text-xs rounded-lg px-2 py-1.5 text-center hover:bg-tg-hover transition">
          View TX
        </a>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Avatar config
// ─────────────────────────────────────────────────────────────────────────────

const AVATAR: Record<string, { emoji: string; bg: string }> = {
  launch:       { emoji: '🚀', bg: 'bg-tg-blue' },
  trade:        { emoji: '🐋', bg: 'bg-pump-orange' },
  graduation:   { emoji: '🎓', bg: 'bg-pump-purple' },
  claim:        { emoji: '💰', bg: 'bg-pump-green' },
  distribution: { emoji: '💎', bg: 'bg-pump-cyan' },
}

// ─────────────────────────────────────────────────────────────────────────────
// EventCard
// ─────────────────────────────────────────────────────────────────────────────

interface EventCardProps {
  event: FeedEvent
  isNew?: boolean
}

export default function EventCard({ event, isNew = false }: EventCardProps) {
  const av = AVATAR[event.type] ?? { emoji: '❓', bg: 'bg-tg-input' }

  return (
    <div className={`flex gap-2 items-start ${isNew ? 'animate-[slideIn_0.3s_ease-out]' : ''}`}>

      {/* Channel avatar */}
      <div className={`w-10 h-10 rounded-full ${av.bg} flex items-center justify-center text-lg shrink-0`}>
        {av.emoji}
      </div>

      {/* Message bubble */}
      <div className="bg-tg-bubble-in rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%] min-w-[240px]">
        <p className="text-tg-blue text-sm font-medium mb-2">PumpKit Live</p>

        {event.type === 'launch'       && <LaunchCard       e={event as TokenLaunchEvent}       />}
        {event.type === 'trade'        && <TradeCard         e={event as TradeAlertEvent}        />}
        {event.type === 'graduation'   && <GraduationCard    e={event as GraduationEvent}        />}
        {event.type === 'claim'        && <ClaimCard         e={event as FeeClaimEvent}          />}
        {event.type === 'distribution' && <DistributionCard  e={event as FeeDistributionEvent}   />}

        {/* Timestamp + age */}
        <div className="flex items-center justify-between mt-2">
          <TimeAgo timestamp={event.timestamp * 1000} className="text-[11px] text-zinc-600" />
          <span className="text-[11px] text-zinc-500">{fmtTime(event.timestamp)}</span>
        </div>
      </div>
    </div>
  )
}
