import { useEffect, useState } from 'react'
import { formatRelativeTime } from '../utils/relativeTime'

/** Recompute relative labels once per second from the user's clock. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export function useRelativeTime(iso: string | undefined): string {
  const now = useNow()
  if (!iso) return ''
  return formatRelativeTime(iso, now)
}
