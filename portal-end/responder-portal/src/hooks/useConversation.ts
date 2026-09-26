import { useCallback, useEffect, useRef, useState } from 'react'
import { listMessages, sendMessage } from '../api/messages'
import type { PortalMessage } from '../types/message'

const cache = new Map<number, PortalMessage[]>()
const POLL_MS = 4000

function sortAsc(messages: PortalMessage[]): PortalMessage[] {
  return [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
}

function mergeMessages(existing: PortalMessage[], incoming: PortalMessage[]): PortalMessage[] {
  const byId = new Map<number, PortalMessage>()
  for (const msg of existing) byId.set(msg.id, msg)
  for (const msg of incoming) byId.set(msg.id, msg)
  return sortAsc([...byId.values()])
}

export function useConversation(userId: number | null, active: boolean) {
  const [messages, setMessages] = useState<PortalMessage[]>(() =>
    userId != null ? cache.get(userId) ?? [] : [],
  )
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const userIdRef = useRef(userId)
  userIdRef.current = userId

  const refresh = useCallback(async (id: number, silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const remote = await listMessages({ userId: id, limit: 100 })
      const next = sortAsc(remote)
      cache.set(id, next)
      if (userIdRef.current === id) setMessages(next)
    } catch (err) {
      if (userIdRef.current === id) {
        setError(err instanceof Error ? err.message : 'Failed to load messages')
      }
    } finally {
      if (!silent && userIdRef.current === id) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (userId == null || !active) return
    setMessages(cache.get(userId) ?? [])
    void refresh(userId, cache.has(userId))

    const tick = () => {
      if (document.visibilityState === 'hidden') return
      void refresh(userId, true)
    }
    const timer = window.setInterval(tick, POLL_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [userId, active, refresh])

  const send = useCallback(
    async (text: string) => {
      if (userId == null) return
      const trimmed = text.trim()
      if (!trimmed) return
      setSending(true)
      setError(null)
      const optimistic: PortalMessage = {
        id: -Date.now(),
        msg_id: null,
        direction: 'downlink',
        user_id: userId,
        reply_to: 0,
        target_node: null,
        path: null,
        sender: 'Portal',
        text: trimmed,
        status: 'pending',
        created_at: new Date().toISOString(),
      }
      setMessages(current => {
        const next = mergeMessages(current, [optimistic])
        cache.set(userId, next)
        return next
      })
      try {
        const saved = await sendMessage({ user_id: userId, text: trimmed })
        setMessages(current => {
          const withoutOptimistic = current.filter(m => m.id !== optimistic.id)
          const next = mergeMessages(withoutOptimistic, [saved])
          cache.set(userId, next)
          return next
        })
      } catch (err) {
        setMessages(current => {
          const next = current.filter(m => m.id !== optimistic.id)
          cache.set(userId, next)
          return next
        })
        setError(err instanceof Error ? err.message : 'Failed to send')
        throw err
      } finally {
        setSending(false)
      }
    },
    [userId],
  )

  return { messages, loading, sending, error, send, refresh: () => (userId != null ? refresh(userId) : Promise.resolve()) }
}
