const PACKAGES = [
  {
    name:    '@pumpkit/core',
    emoji:   '⚙️',
    version: '0.3.2',
    desc:    'Shared framework powering all PumpKit packages. Bot scaffolding, Solana monitoring, formatters, storage and health.',
    features: [
      'Grammy-based bot scaffolding with middleware router',
      'WebSocket + HTTP Solana event monitors',
      'Program account decoders (pump.fun, Raydium)',
      'File-based + SQLite storage adapters',
      'Structured logger (pino)',
      'Health-check HTTP server',
    ],
    weeklyDownloads: '2.1k',
    badge: 'Core',
  },
  {
    name:    '@pumpkit/monitor',
    emoji:   '📡',
    version: '1.0.0',
    desc:    'All-in-one PumpFun monitor: fee claims, launches, graduations, whale trades, CTO alerts. Includes REST API + SSE streaming.',
    features: [
      'Real-time SSE event stream (launch/trade/graduation/claim)',
      'REST API: watches, webhooks, claim history',
      'Configurable whale threshold + mayhem filter',
      'Webhook support (Discord, Slack, custom)',
      'Railway-ready Docker image',
    ],
    weeklyDownloads: '1.5k',
    badge: 'Popular',
  },
  {
    name:    '@pumpkit/channel',
    emoji:   '📢',
    version: '0.2.1',
    desc:    'Read-only Telegram channel bot. Broadcasts launch, trade, graduation and claim events with customizable templates.',
    features: [
      'Zero interaction — pure broadcast',
      'Customizable Markdown templates per event type',
      'Filter by event type or token CA',
      'Rate limiting with queue',
    ],
    weeklyDownloads: '890',
    badge: null,
  },
  {
    name:    '@pumpkit/claim',
    emoji:   '💰',
    version: '0.1.8',
    desc:    'Telegram bot for looking up PumpFun fee claims by token CA or creator handle. Includes CSV export and leaderboard.',
    features: [
      '/claim <CA>  — claims for a token',
      '/creator <handle>  — all claims by creator',
      'Lifetime SOL + claim count stats',
      'CSV export',
    ],
    weeklyDownloads: '430',
    badge: null,
  },
  {
    name:    '@pumpkit/tracker',
    emoji:   '🏆',
    version: '0.4.0',
    desc:    'Group call-tracking bot: leaderboards, PNL cards, win rate, multipliers. Multi-chain support.',
    features: [
      'Daily / weekly / monthly leaderboards',
      'Win rate, avg multiplier, max gain',
      'Rank tiers: Amateur → Pro → Oracle',
      'SOL, ETH, Base, BSC chains',
    ],
    weeklyDownloads: '1.2k',
    badge: 'New',
  },
]

const BADGE_CLASSES: Record<string, string> = {
  Core:    'bg-tg-blue/20 text-tg-blue border border-tg-blue/30',
  Popular: 'bg-pump-green/20 text-pump-green border border-pump-green/30',
  New:     'bg-pump-yellow/20 text-pump-yellow border border-pump-yellow/30',
}

import { useSEO } from '../hooks/useSEO'

export default function Packages() {
  useSEO('Packages', 'PumpKit npm packages — @pumpkit/core, @pumpkit/monitor, @pumpkit/channel, @pumpkit/claim, @pumpkit/tracker. Open-source TypeScript modules for PumpFun on Solana.')
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">

      <div className="text-center mb-6">
        <h1 className="text-xl font-bold text-white">📦 PumpKit Packages</h1>
        <p className="text-zinc-400 text-sm mt-1">Open-source TypeScript packages for building PumpFun bots</p>
      </div>

      {PACKAGES.map(pkg => (
        <div key={pkg.name}
             className="bg-tg-bubble-in border border-tg-border rounded-2xl p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xl">{pkg.emoji}</span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-mono font-semibold text-sm">{pkg.name}</span>
                  {pkg.badge && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${BADGE_CLASSES[pkg.badge]}`}>
                      {pkg.badge}
                    </span>
                  )}
                </div>
                <span className="text-zinc-500 text-xs">v{pkg.version} · {pkg.weeklyDownloads}/wk</span>
              </div>
            </div>
            <a
              href={`https://www.npmjs.com/package/${pkg.name}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-xs bg-tg-input text-tg-blue px-3 py-1.5 rounded-lg hover:bg-tg-hover transition"
            >
              npm ↗
            </a>
          </div>

          <p className="text-zinc-400 text-xs mt-2 leading-relaxed">{pkg.desc}</p>

          <ul className="mt-3 space-y-1">
            {pkg.features.map(f => (
              <li key={f} className="text-xs text-zinc-500 flex gap-1.5">
                <span className="text-tg-green shrink-0">✓</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>

          <div className="mt-3 bg-[#1a2332] rounded-lg px-3 py-2 font-mono text-xs text-zinc-400">
            <span className="text-pump-green">$</span> npm install {pkg.name}
          </div>
        </div>
      ))}

      <div className="text-center pt-4 text-zinc-500 text-xs">
        All packages are open-source under MIT •{' '}
        <a
          href="https://github.com/nirholas/pumpkit"
          target="_blank"
          rel="noreferrer"
          className="text-tg-blue hover:underline"
        >
          github.com/nirholas/pumpkit
        </a>
      </div>
    </div>
  )
}
