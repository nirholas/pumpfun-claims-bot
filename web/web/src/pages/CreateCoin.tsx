import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSEO } from '../hooks/useSEO'

function BotMsg({ time, children }: { time: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 items-end max-w-[85%]">
      <div className="w-8 h-8 rounded-full bg-tg-input flex items-center justify-center text-sm shrink-0">🤖</div>
      <div className="bg-tg-bubble-in rounded-2xl rounded-bl-sm px-4 py-3">
        <p className="text-tg-blue text-sm font-medium mb-1">PumpKit Bot</p>
        {children}
        <span className="text-[11px] text-zinc-500 block text-right mt-1">{time}</span>
      </div>
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`w-10 h-6 rounded-full flex items-center px-1 transition-colors shrink-0 ${value ? 'bg-pump-green' : 'bg-tg-input'}`}
    >
      <div className={`w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

export default function CreateCoin() {
  useSEO('Create Coin', 'Launch a new token on PumpFun with PumpKit — configure name, symbol, social links, fee sharing, and deploy to Solana.')
  const [name,     setName]     = useState('')
  const [symbol,   setSymbol]   = useState('')
  const [desc,     setDesc]     = useState('')
  const [mayhem,   setMayhem]   = useState(false)
  const [cashback, setCashback] = useState(true)
  const [sharing,  setSharing]  = useState(false)

  return (
    <div className="flex flex-col gap-3 p-4 max-w-3xl mx-auto pb-20">

      <div className="text-center py-2">
        <span className="bg-tg-input/80 text-zinc-400 text-xs px-3 py-1 rounded-full">Today</span>
      </div>

      <BotMsg time="14:00">
        <p className="text-sm text-zinc-300">
          Let's create your token on PumpFun! Fill in the details below and I'll generate the instructions.
        </p>
      </BotMsg>

      {/* Token Name */}
      <BotMsg time="14:01"><p className="text-sm text-zinc-300">What's your token name?</p></BotMsg>
      <div className="bg-tg-bubble rounded-2xl rounded-br-sm max-w-[85%] ml-auto px-4 py-3">
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. PumpKit Token"
          className="bg-tg-input border border-tg-border rounded-lg px-3 py-2 text-white text-sm w-full focus:outline-none focus:border-tg-blue placeholder-zinc-600"
        />
        <span className="text-[11px] text-zinc-500 block text-right mt-1">14:01</span>
      </div>

      {/* Symbol */}
      <BotMsg time="14:02"><p className="text-sm text-zinc-300">Choose a ticker symbol (1–8 chars)</p></BotMsg>
      <div className="bg-tg-bubble rounded-2xl rounded-br-sm max-w-[85%] ml-auto px-4 py-3">
        <input
          value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase().slice(0, 8))}
          placeholder="e.g. PUMP"
          className="bg-tg-input border border-tg-border rounded-lg px-3 py-2 text-white text-sm w-full focus:outline-none focus:border-tg-blue placeholder-zinc-600"
        />
        <span className="text-[11px] text-zinc-500 block text-right mt-1">14:02</span>
      </div>

      {/* Description */}
      <BotMsg time="14:03"><p className="text-sm text-zinc-300">Describe your token (optional)</p></BotMsg>
      <div className="bg-tg-bubble rounded-2xl rounded-br-sm max-w-[85%] ml-auto px-4 py-3">
        <textarea
          value={desc} onChange={e => setDesc(e.target.value)}
          placeholder="The best PumpFun bot framework..."
          rows={3}
          className="bg-tg-input border border-tg-border rounded-lg px-3 py-2 text-white text-sm w-full focus:outline-none focus:border-tg-blue placeholder-zinc-600 resize-none"
        />
        <span className="text-[11px] text-zinc-500 block text-right mt-1">14:03</span>
      </div>

      {/* Image */}
      <BotMsg time="14:04"><p className="text-sm text-zinc-300">Upload a token image (optional)</p></BotMsg>
      <div className="bg-tg-bubble rounded-2xl rounded-br-sm max-w-[85%] ml-auto px-4 py-3">
        <div className="border-2 border-dashed border-tg-border rounded-xl p-8 text-center">
          <div className="text-3xl mb-2">🖼️</div>
          <p className="text-zinc-500 text-xs">Drag & drop or click to upload</p>
        </div>
        <span className="text-[11px] text-zinc-500 block text-right mt-1">14:04</span>
      </div>

      {/* Options */}
      <BotMsg time="14:05">
        <p className="text-sm text-zinc-300 mb-3">Configure launch options:</p>
        {[
          { label: 'Mayhem Mode',         val: mayhem,   set: () => setMayhem(!mayhem) },
          { label: 'Cashback Enabled',    val: cashback, set: () => setCashback(!cashback) },
          { label: 'Creator Fee Sharing', val: sharing,  set: () => setSharing(!sharing) },
        ].map(opt => (
          <div key={opt.label} className="flex justify-between items-center py-2 border-b border-tg-border/50 last:border-0">
            <span className="text-sm text-zinc-300">{opt.label}</span>
            <Toggle value={opt.val} onChange={opt.set} />
          </div>
        ))}
      </BotMsg>

      {/* Preview */}
      <div className="bg-tg-bubble rounded-2xl rounded-br-sm max-w-[85%] ml-auto px-4 py-3">
        <div className="bg-gradient-to-br from-tg-input to-tg-bubble-in rounded-xl p-4 relative">
          <span className="absolute top-2 right-2 bg-tg-blue/20 text-tg-blue text-[10px] px-2 py-0.5 rounded-full">Preview</span>
          <div className="text-4xl mb-2">🪙</div>
          <p className="text-white font-bold text-base">{name || 'Token Name'}</p>
          <p className="text-pump-green text-sm font-mono">${symbol || 'TICKER'}</p>
          <div className="mt-3">
            <div className="flex justify-between text-[10px] text-zinc-500 mb-1">
              <span>Bonding Curve</span><span>0%</span>
            </div>
            <div className="w-full h-1.5 bg-tg-input rounded-full overflow-hidden">
              <div className="h-full w-0 bg-pump-green rounded-full" />
            </div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
            <span>Market Cap: —</span>
            <span>Created by: You</span>
          </div>
        </div>
        <span className="text-[11px] text-zinc-500 block text-right mt-1">14:05</span>
      </div>

      {/* Launch button */}
      <div className="max-w-[85%] ml-auto w-full">
        <button className="w-full bg-pump-green text-black font-bold rounded-lg py-3 text-center text-sm cursor-default opacity-80">
          🚀 Create Token
        </button>
        <p className="text-center text-[11px] text-zinc-500 mt-2">
          This is a demo — use @pumpkit/monitor to build a real bot
        </p>
      </div>

      <BotMsg time="14:06">
        <p className="text-sm text-zinc-300 mb-2">
          Want to integrate token creation into your own bot? Check out the SDK docs:
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Link to="/docs"
             className="bg-tg-input text-tg-blue text-xs rounded-lg px-3 py-1.5 text-center hover:bg-tg-hover transition">
            📖 SDK Docs
          </Link>
          <Link to="/packages"
             className="bg-tg-input text-tg-blue text-xs rounded-lg px-3 py-1.5 text-center hover:bg-tg-hover transition">
            📦 Packages
          </Link>
        </div>
      </BotMsg>
    </div>
  )
}
