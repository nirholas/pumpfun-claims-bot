import { useState, useCallback, useEffect, useRef } from 'react'
import EventCard from '../components/EventCard'
import StatsBar from '../components/StatsBar'
import { useEventStream } from '../hooks/useEventStream'
import { useSEO } from '../hooks/useSEO'
import type { FeedEvent, TokenLaunchEvent, TradeAlertEvent, GraduationEvent, FeeClaimEvent } from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// Mock feed fallback (used when SSE is unavailable)
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_MINTS = [
  '7GhWwhaMgbKiRWxF93Bud6HnHMci6NCLTJyTxG8zFH51',
  '8ocgxU9ccawJUYAjwf2yC9VvetCUth2xjKS2kAcmjFi8',
  'DzXqFEFuZgJoLmNbPcSnTvYwXaHdKiOpJrStUvWxYz12',
  'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVv',
  '5cNrZAbCdEfGhIjKlMnOpQrStUvWxYz1234567890ABC',
]
const MOCK_WALLETS = [
  '3mFqZAbCdEfGhIjKlMnOpQrStUvWxYz1234567890AB',
  '9aHjCdEfGhIjKlMnOpQrStUvWxYz1234567890ABCD',
  'CREATOR7GhWwhaMgbKiRWxF93Bud6HnHMci6NCLDD',
]
const MOCK_TOKENS = [
  { name: 'kekius',     symbol: 'KEKIUS', desc: 'The original kekius frog' },
  { name: 'Pumfun oso', symbol: 'OSO',    desc: 'Community oso bear token' },
  { name: 'PumpKitty',  symbol: 'KITTY',  desc: undefined },
  { name: 'SolDoge',    symbol: 'SDOGE',  desc: 'The Solana DOGE' },
  { name: 'MoonPump',   symbol: 'MPUMP',  desc: undefined },
  { name: 'BonkFren',   symbol: 'BFREN',  desc: 'WAGMI fren 🐸' },
  { name: 'ChadCoin',   symbol: 'CHAD',   desc: 'Community-driven, no dev wallet' },
  { name: 'WenLambo',   symbol: 'WEN',    desc: undefined },
]

function rand<T>(arr: T[]) { return arr[Math.floor(Math.random() * arr.length)] }
function randNum(min: number, max: number) { return +(Math.random() * (max - min) + min).toFixed(4) }
function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min }
function now() { return Math.floor(Date.now() / 1000) }

function makeMockEvent(): FeedEvent {
  const t           = rand(MOCK_TOKENS)
  const mint        = rand(MOCK_MINTS)
  const wallet      = rand(MOCK_WALLETS)
  const timestamp   = now()
  const type        = rand(['launch', 'trade', 'graduation', 'claim'] as const)

  switch (type) {
    case 'launch': {
      const e: TokenLaunchEvent = {
        type: 'launch',
        txSignature: `sig${Date.now()}`,
        slot: 300_000_000,
        timestamp,
        mintAddress:     mint,
        creatorWallet:   wallet,
        name:            t.name,
        symbol:          t.symbol,
        description:     t.desc ?? '',
        metadataUri:     '',
        hasGithub:       Math.random() > 0.6,
        githubUrls:      Math.random() > 0.6 ? ['https://github.com/nirholas/pumpkit'] : [],
        mayhemMode:      Math.random() > 0.8,
        cashbackEnabled: Math.random() > 0.4,
        metadata: {
          twitter:   Math.random() > 0.5 ? 'https://twitter.com/pumpkitdev' : undefined,
          telegram:  Math.random() > 0.6 ? 'https://t.me/pumpkit' : undefined,
          website:   Math.random() > 0.7 ? 'https://pumpkit.dev' : undefined,
        },
      }
      return e
    }
    case 'trade': {
      const isBuy = Math.random() > 0.35
      const bc    = randNum(5, 80)
      const e: TradeAlertEvent = {
        type: 'trade',
        txSignature: `sig${Date.now()}`,
        slot: 300_000_000,
        timestamp,
        mintAddress:          mint,
        tokenName:            t.name,
        tokenSymbol:          t.symbol,
        user:                 wallet,
        creator:              rand(MOCK_WALLETS),
        isBuy,
        solAmount:            randNum(15, 120),
        tokenAmount:          randInt(5_000_000, 50_000_000) * 1e6,
        fee:                  randNum(0.01, 0.5),
        creatorFee:           randNum(0.005, 0.1),
        virtualSolReserves:   randNum(30, 100),
        virtualTokenReserves: 1_000_000_000,
        realSolReserves:      bc * 0.85,
        realTokenReserves:    (100 - bc) * 10_000_000,
        mayhemMode:           false,
        marketCapSol:         randNum(50, 500),
        bondingCurveProgress: bc,
      }
      return e
    }
    case 'graduation': {
      const e: GraduationEvent = {
        type: 'graduation',
        txSignature: `sig${Date.now()}`,
        slot: 300_000_000,
        timestamp,
        mintAddress:  mint,
        tokenName:    t.name,
        tokenSymbol:  t.symbol,
        user:         wallet,
        bondingCurve: rand(MOCK_MINTS),
        isMigration:  Math.random() > 0.5,
        solAmount:    randNum(84, 87),
        poolMigrationFee: randNum(0.5, 2),
        poolAddress:  rand(MOCK_MINTS),
      }
      return e
    }
    default: {
      const claimSol = randNum(0.5, 25)
      const e: FeeClaimEvent = {
        type: 'claim',
        txSignature: `sig${Date.now()}`,
        slot: 300_000_000,
        timestamp,
        claimerWallet:      wallet,
        tokenMint:          mint,
        tokenName:          t.name,
        tokenSymbol:        t.symbol,
        amountSol:          claimSol,
        claimLabel:         rand(['Collect Creator Fee (Pump)', 'Collect Creator Fee (PumpSwap)', 'Claim Social Fee PDA (GitHub)']),
        claimType:          'collect_creator_fee',
        isCashback:         false,
        githubHandle:       Math.random() > 0.6 ? 'nirholas' : undefined,
        lifetimeClaimedSol: claimSol * randNum(1, 15),
        claimNumber:        randInt(1, 100),
        isFirstClaim:       Math.random() > 0.8,
        marketCapSol:       randNum(10, 300),
        holderCount:        randInt(5, 500),
      }
      return e
    }
  }
}

function useMockFeed() {
  const [events, setEvents] = useState<FeedEvent[]>(() =>
    Array.from({ length: randInt(6, 10) }, (_, i) => {
      const e = makeMockEvent()
      return { ...e, timestamp: now() - i * randInt(30, 180) }
    })
  )

  const add = useCallback(() => {
    setEvents(prev => [makeMockEvent(), ...prev].slice(0, 80))
  }, [])

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>
    function schedule() { t = setTimeout(() => { add(); schedule() }, randInt(3000, 7000)) }
    schedule()
    return () => clearTimeout(t)
  }, [add])

  return events
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter config
// ─────────────────────────────────────────────────────────────────────────────

type Filter = 'all' | 'launch' | 'trade' | 'graduation' | 'claim' | 'distribution'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all',          label: 'All' },
  { id: 'launch',       label: '🚀 Launches' },
  { id: 'trade',        label: '🐋 Whales' },
  { id: 'graduation',   label: '🎓 Grads' },
  { id: 'claim',        label: '💰 Claims' },
  { id: 'distribution', label: '💎 Distributions' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  useSEO('Live Dashboard', 'Real-time PumpFun event feed — token launches, whale trades, graduations, and fee claims streaming live from Solana.')
  const { events: liveEvents, connected, error } = useEventStream()
  const mockEvents  = useMockFeed()
  const useMock     = !connected && liveEvents.length === 0

  const allEvents   = useMock ? mockEvents : liveEvents
  const [filter, setFilter]   = useState<Filter>('all')
  const seenRef = useRef(new Set<string>())

  const visible = filter === 'all'
    ? allEvents
    : allEvents.filter(e => e.type === filter)

  // Track newly added events for animation
  const withNew = visible.map(e => {
    const key = `${e.type}-${e.txSignature}-${e.timestamp}`
    const isNew = !seenRef.current.has(key)
    if (isNew) seenRef.current.add(key)
    return { event: e, isNew }
  })

  return (
    <div className="flex flex-col h-full">

      {/* Filter bar */}
      <div className="sticky top-0 z-10 bg-tg-chat/95 backdrop-blur-sm border-b border-tg-border">
        <div className="flex gap-2 px-4 py-2 overflow-x-auto">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition shrink-0 ${
                filter === f.id ? 'bg-tg-blue text-white' : 'bg-tg-input text-zinc-400 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <StatsBar events={allEvents} connected={connected} />
      </div>

      {/* Connection error banner */}
      {error && !useMock && (
        <div className="bg-pump-pink/10 border-b border-pump-pink/30 px-4 py-1.5 text-xs text-pump-pink">
          ⚠️ Stream error: {error} — showing demo data
        </div>
      )}

      {/* Events */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2 p-4 max-w-3xl mx-auto pb-6">

          <div className="text-center py-2">
            <span className="bg-tg-input/80 text-zinc-400 text-xs px-3 py-1 rounded-full">Today</span>
          </div>

          {visible.length === 0 ? (
            <p className="text-center py-12 text-zinc-500 text-sm">
              No {filter} events yet — waiting for activity…
            </p>
          ) : (
            withNew.map(({ event, isNew }, i) => (
              <EventCard key={`${event.type}-${event.txSignature}-${i}`} event={event} isNew={isNew} />
            ))
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 border-t border-tg-border bg-tg-header/80 px-4 py-2 text-center text-[11px] text-zinc-500">
        {useMock
          ? <>Simulated feed • <a href="https://github.com/nirholas/pumpkit" target="_blank" rel="noreferrer" className="text-tg-blue hover:underline">Connect your bot for live data</a></>
          : `Live feed • ${allEvents.length} events received`}
      </div>
    </div>
  )
}
