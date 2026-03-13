import { useState, useRef } from 'react'

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
  { id: 'architecture',    label: 'Architecture' },
  { id: 'packages',        label: 'Packages' },
  { id: 'commands',        label: 'Bot Commands' },
  { id: 'api',             label: 'API' },
  { id: 'faq',             label: 'FAQ' },
]

export default function Docs() {
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
