import { Link, Outlet, useLocation } from 'react-router-dom'
import StatusDot from './StatusDot'

const CHANNELS = [
  { path: '/',          icon: '🏠', name: 'PumpKit',      subtitle: 'Open-source framework' },
  { path: '/dashboard', icon: '🚀', name: 'PumpKit Live', subtitle: 'Real-time event feed', badge: true },
  { path: '/create',    icon: '🪙', name: 'Create Coin',  subtitle: 'Launch a token' },
  { path: '/docs',      icon: '📖', name: 'PumpKit Docs', subtitle: 'Getting started' },
  { path: '/packages',  icon: '📦', name: 'Packages',     subtitle: '5 packages available' },
]

interface Props {
  connected?: boolean
}

export default function Layout({ connected = false }: Props) {
  const location = useLocation()
  const active =
    CHANNELS.slice().reverse().find(c =>
      c.path === '/' ? location.pathname === '/' : location.pathname.startsWith(c.path),
    ) ?? CHANNELS[0]

  return (
    <div className="flex h-screen bg-tg-bg overflow-hidden">

      {/* ── Sidebar ── */}
      <div className="w-72 bg-tg-sidebar border-r border-tg-border flex flex-col shrink-0">

        <div className="h-14 bg-tg-header border-b border-tg-border flex items-center px-4 gap-3 shrink-0">
          <div className="w-8 h-8 rounded-full bg-tg-blue flex items-center justify-center shrink-0">🚀</div>
          <span className="text-white font-semibold">PumpKit</span>
          <div className="ml-auto flex items-center gap-2">
            <StatusDot connected={connected} />
            <span className="text-zinc-500 text-[10px]">{connected ? 'Live' : 'Demo'}</span>
          </div>
        </div>

        <div className="px-3 py-2 shrink-0">
          <div className="bg-tg-input rounded-full px-4 py-2 text-sm text-zinc-500">🔍 Search</div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {CHANNELS.map(ch => {
            const isActive = ch.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(ch.path)
            return (
              <Link
                key={ch.path}
                to={ch.path}
                className={`flex items-center gap-3 px-4 py-3 transition ${isActive ? 'bg-tg-hover' : 'hover:bg-tg-hover/50'}`}
              >
                <div className="w-11 h-11 rounded-full bg-tg-input flex items-center justify-center text-xl shrink-0 relative">
                  {ch.icon}
                  {ch.badge && connected && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-pump-green border-2 border-tg-sidebar" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{ch.name}</p>
                  <p className="text-zinc-500 text-xs truncate">{ch.subtitle}</p>
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar */}
        <div className="h-14 bg-tg-header border-b border-tg-border flex items-center px-4 gap-3 shrink-0">
          <div className="w-9 h-9 rounded-full bg-tg-input flex items-center justify-center text-lg shrink-0">
            {active.icon}
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold">{active.name}</p>
            <p className="text-zinc-500 text-xs truncate">{active.subtitle}</p>
          </div>
          <div className="ml-auto flex items-center gap-4 text-zinc-500 text-lg shrink-0">
            <span className="hover:text-zinc-300 cursor-pointer">🔍</span>
            <span className="hover:text-zinc-300 cursor-pointer">☰</span>
          </div>
        </div>

        {/* Content */}
        <main className="flex-1 overflow-y-auto bg-tg-chat">
          <Outlet />
        </main>

        {/* Cosmetic input bar */}
        <div className="shrink-0 bg-tg-header border-t border-tg-border px-4 py-2 flex items-center gap-3">
          <button className="text-zinc-500 hover:text-zinc-300 transition text-xl">😊</button>
          <div className="flex-1 bg-tg-input rounded-full px-4 py-2 text-sm text-zinc-500">Message…</div>
          <button className="text-zinc-500 hover:text-tg-blue transition text-xl">📎</button>
          <button className="w-9 h-9 rounded-full bg-tg-blue flex items-center justify-center text-white text-sm hover:bg-tg-blue/80 transition">▶</button>
        </div>
      </div>
    </div>
  )
}
