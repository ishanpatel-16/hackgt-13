/** Relative time from an ISO timestamp vs the user's local clock. */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const deltaSec = Math.max(0, Math.round((now - then) / 1000))
  if (deltaSec < 5) return 'just now'
  if (deltaSec < 60) return `${deltaSec} sec ago`
  const minutes = Math.floor(deltaSec / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
