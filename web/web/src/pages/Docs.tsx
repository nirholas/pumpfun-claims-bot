import { useState, useRef } from 'react'
import { useSEO } from '../hooks/useSEO'

function BotMsg({ children, time = '10:00' }: { children: React.ReactNode; time?: string }) {
  return (
    <div className="flex gap-2 items-start">
      <div className="w-8 h-8 rounded-full bg-tg-input flex items-center justify-center text-sm shrink-0">📖</div>
      <div className="bg-tg-bubble-in rounded-2xl rounded-tl-sm px-4 py-3 max-w-[85%]">
        <p className="text-tg-blue text-sm font-medium mb-1">PumpKit Docs</p>
        {children}
        <span className="text-[11px] text-zinc-500 block text-right mt-1">{time}</span>
      </div>
    </div>
  )
}

const SECTIONS = [
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'tutorials',       label: '🎓 Tutorials' },
  { id: 'architecture',    label: 'Architecture' },
  { id: 'packages',        label: 'Packages' },
  { id: 'commands',        label: 'Bot Commands' },
  { id: 'api',             label: 'API' },
  { id: 'faq',             label: 'FAQ' },
]

export default function Docs() {
  useSEO('Documentation', 'PumpKit documentation — getting started, tutorials, architecture, API reference, bot commands, and FAQ for the PumpFun monitoring framework.')
  const [active, setActive] = useState('getting-started')
  const containerRef = useRef<HTMLDivElement>(null)

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActive(id)
  }

  return (
    <div className="flex flex-col h-full">

      {/* TOC */}
      <div className="sticky top-0 z-10 bg-tg-chat/95 backdrop-blur-sm border-b border-tg-border px-4 py-2">
        <div className="flex gap-2 overflow-x-auto">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition shrink-0 ${
                active === s.id ? 'bg-tg-blue text-white' : 'bg-tg-input text-zinc-400 hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={containerRef} className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-4 max-w-3xl mx-auto pb-20">

          <div id="getting-started" className="pt-2" />
          <BotMsg time="09:00">
            <p className="text-white font-bold mb-2">📖 Getting Started</p>
            <p className="text-zinc-300 text-sm leading-relaxed mb-3">
              PumpKit is an open-source TypeScript framework for building PumpFun Telegram bots on Solana.
              Production-ready building blocks so you can ship a bot in hours.
            </p>
            <ul className="text-zinc-400 text-xs space-y-0.5 mb-3">
              <li>• Node.js ≥ 20</li>
              <li>• A Telegram Bot Token (from @BotFather)</li>
              <li>• A Solana RPC URL (Helius, Quicknode, etc.)</li>
            </ul>
            <div className="bg-[#1a2332] rounded-lg p-3 font-mono text-xs text-zinc-300 overflow-x-auto">
              <p><span className="text-pump-green">$</span> git clone https://github.com/nirholas/pumpkit.git</p>
              <p><span className="text-pump-green">$</span> cd pumpkit &amp;&amp; npm install</p>
            </div>
          </BotMsg>

          <div id="tutorials" className="pt-2" />
          <BotMsg time="09:01">
            <p className="text-white font-bold mb-2">🎓 Tutorials</p>
            <p className="text-zinc-300 text-sm leading-relaxed mb-3">
              Step-by-step guides for setting up the bot from scratch. No coding required.
            </p>
            <div className="space-y-3">
              <a
                href="https://github.com/nirholas/pumpfun-claims-bot/blob/main/docs/railway-github-claims.md"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 bg-[#1a2332] rounded-xl p-3 hover:bg-[#1e2b3d] transition group"
              >
                <span className="text-2xl">🚀</span>
                <div>
                  <p className="text-tg-blue font-semibold text-sm group-hover:underline">Deploy GitHub Claims Bot on Railway</p>
                  <p className="text-zinc-400 text-xs mt-0.5 leading-relaxed">
                    Full walkthrough — Telegram bot setup, Helius RPC, GitHub token, Railway deploy, persistent storage. ~20 minutes.
                  </p>
                  <div className="flex gap-2 mt-2">
                    <span className="text-[10px] bg-pump-green/10 text-pump-green px-2 py-0.5 rounded-full">Beginner</span>
                    <span className="text-[10px] bg-tg-blue/10 text-tg-blue px-2 py-0.5 rounded-full">No code</span>
                    <span className="text-[10px] bg-zinc-700 text-zinc-400 px-2 py-0.5 rounded-full">~20 min</span>
                  </div>
                </div>
              </a>
            </div>
          </BotMsg>

          {/* Tutorial: Railway Step-by-Step */}
          <BotMsg time="09:01">
            <p className="text-white font-bold mb-3">🚀 Railway Setup — Quick Guide</p>
            <div className="space-y-2 text-xs">
              {[
                { n: '1', title: 'Create a Telegram Bot', desc: 'Message @BotFather → /newbot → save your token' },
                { n: '2', title: 'Create a Telegram Channel', desc: 'New Channel → add your bot as admin with Post Messages permission' },
                { n: '3', title: 'Get a Helius RPC', desc: 'Sign up at helius.xyz → copy both the https:// and wss:// URLs' },
                { n: '4', title: 'Get a GitHub Token', desc: 'github.com/settings/tokens → classic token → no scopes needed' },
                { n: '5', title: 'Fork the repo', desc: 'github.com/nirholas/pumpfun-claims-bot → Fork' },
                { n: '6', title: 'Deploy on Railway', desc: 'railway.app → New Project → Deploy from GitHub' },
                { n: '7', title: 'Add your variables', desc: 'Service → Variables → Raw Editor → paste your settings' },
                { n: '8', title: 'Add a Volume', desc: 'New → Volume → mount at /app/data → prevents duplicate alerts on restart' },
                { n: '9', title: 'Deploy & check logs', desc: 'Deploy Now → look for "WS connected" in logs → done!' },
              ].map(({ n, title, desc }) => (
                <div key={n} className="flex gap-3 items-start">
                  <span className="w-5 h-5 rounded-full bg-tg-blue/20 text-tg-blue text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</span>
                  <div>
                    <p className="text-white font-medium">{title}</p>
                    <p className="text-zinc-500 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </BotMsg>

          {/* Paste-ready settings */}
          <BotMsg time="09:02">
            <p className="text-white font-bold mb-2">📋 Paste-Ready Settings</p>
            <p className="text-zinc-400 text-xs mb-3">Copy this into Railway's Raw Editor and fill in the 4 blanks:</p>
            <div className="bg-[#1a2332] rounded-lg p-3 font-mono text-xs text-zinc-300 overflow-x-auto space-y-1">
              <p><span className="text-zinc-500"># Required</span></p>
              <p>TELEGRAM_BOT_TOKEN=<span className="text-pump-green">← from @BotFather</span></p>
              <p>CHANNEL_ID=<span className="text-pump-green">← @channelname or -100xxx</span></p>
              <p>SOLANA_RPC_URL=<span className="text-pump-green">← https://mainnet.helius-rpc.com/?api-key=...</span></p>
              <p>SOLANA_WS_URL=<span className="text-pump-green">← wss://mainnet.helius-rpc.com/?api-key=...</span></p>
              <p>GITHUB_TOKEN=<span className="text-pump-green">← ghp_...</span></p>
              <p className="pt-1"><span className="text-zinc-500"># Leave these as-is</span></p>
              <p>FEED_CLAIMS=true</p>
              <p>FEED_GRADUATIONS=false</p>
              <p>REQUIRE_GITHUB=true</p>
              <p>LOG_LEVEL=info</p>
              <p>DATA_DIR=/app/data</p>
            </div>
          </BotMsg>

          {/* Healthy logs */}
          <BotMsg time="09:02">
            <p className="text-white font-bold mb-2">✅ What Healthy Logs Look Like</p>
            <p className="text-zinc-400 text-xs mb-2">If you see this in Railway's Logs tab, you're done:</p>
            <div className="bg-[#1a2332] rounded-lg p-3 font-mono text-xs overflow-x-auto space-y-0.5">
              <p><span className="text-pump-green">[INFO]</span> <span className="text-zinc-300">Starting PumpFun Channel Bot</span></p>
              <p><span className="text-pump-green">[INFO]</span> <span className="text-zinc-300">Feeds enabled: claims=true</span></p>
              <p><span className="text-pump-green">[INFO]</span> <span className="text-zinc-300">SocialFeeIndex ready: 148234 entries</span></p>
              <p><span className="text-pump-green">[INFO]</span> <span className="text-zinc-300">WS connected to pfee...</span></p>
              <p><span className="text-pump-green">[INFO]</span> <span className="text-zinc-300">WS heartbeat: 0 events (uptime 0h1m)</span></p>
            </div>
          </BotMsg>

          {/* Troubleshooting */}
          <BotMsg time="09:03">
            <p className="text-white font-bold mb-3">🔧 Something Wrong?</p>
            <div className="space-y-3">
              {[
                {
                  q: 'Bot started but nothing posts',
                  a: 'Check FEED_CLAIMS=true and that your bot is an admin in the channel with Post Messages enabled.',
                },
                {
                  q: '"Unauthorized" error in logs',
                  a: 'Your TELEGRAM_BOT_TOKEN is wrong — go back to BotFather and copy it again.',
                },
                {
                  q: 'Duplicate "first claim" alerts after restart',
                  a: 'Volume not attached. Confirm mount path is exactly /app/data.',
                },
                {
                  q: '"WS disconnected" in logs',
                  a: 'SOLANA_WS_URL must start with wss:// (not https://) and contain your Helius key.',
                },
                {
                  q: 'GitHub rate limit errors',
                  a: 'Add GITHUB_TOKEN to Variables — without it you\'re limited to 60 lookups/hour.',
                },
              ].map(({ q, a }) => (
                <div key={q}>
                  <p className="text-white text-xs font-semibold">❓ {q}</p>
                  <p className="text-zinc-400 text-xs mt-0.5 leading-relaxed">{a}</p>
                </div>
              ))}
            </div>
          </BotMsg>

          <div id="architecture" className="pt-2" />
          <BotMsg time="09:01">
            <p className="text-white font-bold mb-2">🏗️ Architecture</p>
            <div className="bg-[#1a2332] rounded-lg p-3 font-mono text-xs text-zinc-300 overflow-x-auto">
              <pre>{`┌────────────────────────────────┐
│        @pumpkit/core           │
│  bot/ monitor/ solana/         │
│  formatter/ storage/ health/   │
└────────┬──────────┬────────────┘
         │          │
  ┌──────▼───┐  ┌───▼──────┐
  │ monitor  │  │ tracker  │
  │ channel  │  │ claims   │
  └──────────┘  └──────────┘`}</pre>
            </div>
          </BotMsg>

          <div id="packages" className="pt-2" />
          {[
            {
              pkg: '@pumpkit/core',
              desc: 'Shared framework: bot scaffolding, Solana monitoring, formatters, storage',
              features: ['Grammy bot scaffolding + command router', 'WebSocket + HTTP event monitors', 'Solana RPC + program decoders', 'File-based + SQLite storage adapters'],
            },
            {
              pkg: '@pumpkit/monitor',
              desc: 'All-in-one PumpFun monitor: fee claims, launches, graduations, whale trades',
              features: ['REST API + SSE streaming', 'Configurable thresholds', 'Webhook support', 'Railway Docker image'],
            },
            {
              pkg: '@pumpkit/claim',
              desc: 'Fee claim tracker: look up claims by token CA or creator X handle',
              features: ['/claim <CA>', '/creator <handle>', 'CSV export', 'Historical data'],
            },
          ].map(p => (
            <BotMsg key={p.pkg} time="09:02">
              <p className="text-tg-blue font-bold font-mono text-sm mb-1">✅ {p.pkg}</p>
              <p className="text-zinc-300 text-xs mb-2">{p.desc}</p>
              <ul className="text-zinc-500 text-xs space-y-0.5">
                {p.features.map(f => <li key={f}>├─ {f}</li>)}
              </ul>
            </BotMsg>
          ))}

          <div id="commands" className="pt-2" />
          <BotMsg time="09:05">
            <p className="text-white font-bold mb-2">🤖 Bot Commands</p>
            <div className="bg-[#1a2332] rounded-lg p-3 text-xs overflow-x-auto space-y-1">
              {[
                ['/start',      'Welcome + setup'],
                ['/help',       'All commands'],
                ['/watch CA',   'Watch a wallet'],
                ['/unwatch CA', 'Remove watch'],
                ['/list',       'Watched wallets'],
                ['/claims',     'Recent claims'],
                ['/status',     'Bot health + uptime'],
              ].map(([cmd, desc]) => (
                <div key={cmd} className="flex gap-2">
                  <span className="text-pump-green font-mono w-24 shrink-0">{cmd}</span>
                  <span className="text-zinc-400">{desc}</span>
                </div>
              ))}
            </div>
          </BotMsg>

          <div id="api" className="pt-2" />
          <BotMsg time="09:06">
            <p className="text-white font-bold mb-2">📡 API Endpoints</p>
            <div className="bg-[#1a2332] rounded-lg p-3 text-xs overflow-x-auto space-y-1">
              {[
                ['GET',  '/health',                'Bot status'],
                ['GET',  '/api/v1/watches',        'List watches'],
                ['POST', '/api/v1/watches',        'Add watch'],
                ['DEL',  '/api/v1/watches/:addr',  'Remove watch'],
                ['GET',  '/api/v1/claims/stream',  'SSE stream'],
              ].map(([method, path, desc]) => (
                <div key={path} className="flex gap-2 items-center">
                  <span className={`font-mono font-bold w-10 shrink-0 ${method === 'GET' ? 'text-pump-green' : method === 'POST' ? 'text-tg-blue' : 'text-pump-pink'}`}>{method}</span>
                  <span className="text-zinc-300 font-mono w-44 shrink-0">{path}</span>
                  <span className="text-zinc-500">{desc}</span>
                </div>
              ))}
            </div>
          </BotMsg>

          <div id="faq" className="pt-2" />
          <BotMsg time="09:07">
            <p className="text-white font-bold mb-2">❓ FAQ</p>
            <div className="space-y-3">
              {[
                { q: 'Is PumpKit free?', a: 'Yes, fully open-source under the MIT license.' },
                { q: 'Can I use it in production?', a: 'Yes! Rails, Docker, and Kubernetes configs are included.' },
                { q: 'Does it support Raydium?', a: 'Yes — graduation events fire when tokens migrate to Raydium/PumpSwap.' },
                { q: 'How fast are alerts?', a: 'Typically < 1 second via WebSocket streaming from the Solana validator.' },
              ].map(({ q, a }) => (
                <div key={q}>
                  <p className="text-white text-sm font-medium">{q}</p>
                  <p className="text-zinc-400 text-xs mt-0.5">{a}</p>
                </div>
              ))}
            </div>
          </BotMsg>

        </div>
      </div>
    </div>
  )
}
