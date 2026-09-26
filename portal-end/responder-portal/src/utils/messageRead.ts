const STORAGE_KEY = 'net0.messages.readAt'

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeMap(map: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ignore quota / private-mode failures; in-memory UI state still clears unread
  }
}

export function getLastReadAt(userId: number): number {
  const iso = readMap()[String(userId)]
  if (!iso) return 0
  const ms = new Date(iso).getTime()
  return Number.isFinite(ms) ? ms : 0
}

/** Mark read at least as new as the latest message so the thread clears immediately. */
export function markConversationRead(userId: number, latestMessageAt?: string) {
  const now = Date.now()
  const latest = latestMessageAt ? new Date(latestMessageAt).getTime() : 0
  const stamp = new Date(Math.max(now, Number.isFinite(latest) ? latest : 0)).toISOString()
  const map = readMap()
  map[String(userId)] = stamp
  writeMap(map)
}

export function isConversationUnread(
  lastMessage: { created_at: string; direction: string } | undefined,
  userId: number,
): boolean {
  if (!lastMessage || lastMessage.direction !== 'uplink') return false
  const created = new Date(lastMessage.created_at).getTime()
  if (!Number.isFinite(created)) return false
  return created > getLastReadAt(userId)
}
