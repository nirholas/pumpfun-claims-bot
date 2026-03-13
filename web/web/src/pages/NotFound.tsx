export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
      <div className="text-5xl">🐸</div>
      <h1 className="text-2xl font-bold text-white">404 – Page not found</h1>
      <p className="text-zinc-400 text-sm">This page doesn't exist.</p>
      <a href="/" className="text-tg-blue hover:underline text-sm">← Back home</a>
    </div>
  )
}
