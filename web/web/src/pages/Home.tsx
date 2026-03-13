import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-12 flex flex-col gap-10">

      {/* Hero */}
      <div className="text-center flex flex-col items-center gap-4">
        <div className="text-6xl">🐸</div>
        <h1 className="text-3xl font-bold text-white">PumpKit</h1>
        <p className="text-zinc-400 leading-relaxed">
          Real-time PumpFun monitoring: fee claims, whale trades, new launches,
          token graduations and more — piped straight to your Telegram channel.
        </p>
        <div className="flex gap-3">
          <Link
            to="/dashboard"
            className="bg-tg-blue text-white px-5 py-2.5 rounded-lg font-semibold hover:opacity-90 transition text-sm"
          >
            Live dashboard →
          </Link>
          <Link
            to="/docs"
            className="bg-tg-input text-zinc-300 px-5 py-2.5 rounded-lg font-semibold hover:text-white transition text-sm"
          >
            Docs
          </Link>
        </div>
      </div>

      {/* Features */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { icon: '🚀', title: 'New launches',        desc: 'Instant alerts when tokens are created — with social links, GitHub, cashback and mayhem badges.' },
          { icon: '🐋', title: 'Whale trades',         desc: 'Track big buys and sells with market cap, bonding curve progress, and creator fee info.' },
          { icon: '🎓', title: 'Graduations',          desc: 'Know the moment a token migrates to Raydium — with pool address and migration fee.' },
          { icon: '💰', title: 'Fee claims',            desc: 'Full claim history per token: claimer wallet, amount, GitHub handle, lifetime totals.' },
          { icon: '💎', title: 'Distributions',        desc: 'See exactly how fees are split across shareholders, including BPS breakdowns.' },
          { icon: '🔔', title: 'Telegram alerts',       desc: 'Every event above delivered to your Telegram channel in real time.' },
        ].map(f => (
          <div key={f.title} className="bg-tg-input/60 border border-tg-border rounded-xl p-4 flex gap-3">
            <span className="text-2xl shrink-0">{f.icon}</span>
            <div>
              <div className="font-semibold text-white text-sm mb-1">{f.title}</div>
              <div className="text-zinc-400 text-xs leading-relaxed">{f.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="text-center text-zinc-500 text-sm">
        Open-source •{' '}
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
