import type { PortalMessage } from '../types/message'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8000'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail || `Request failed (${response.status})`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function listMessages(opts?: {
  userId?: number
  direction?: string
  limit?: number
}): Promise<PortalMessage[]> {
  const params = new URLSearchParams()
  if (opts?.userId != null) params.set('user_id', String(opts.userId))
  if (opts?.direction) params.set('direction', opts.direction)
  if (opts?.limit != null) params.set('limit', String(opts.limit))
  const query = params.toString()
  return request(`/api/messages${query ? `?${query}` : ''}`)
}

export function sendMessage(payload: {
  user_id: number
  text: string
  sender?: string
  reply_to?: number
}): Promise<PortalMessage> {
  return request('/api/messages/send', {
    method: 'POST',
    body: JSON.stringify({
      user_id: payload.user_id,
      text: payload.text,
      sender: payload.sender ?? 'Portal',
      ...(payload.reply_to != null ? { reply_to: payload.reply_to } : {}),
    }),
  })
}

export interface PortalUser {
  user_id: number
  name: string
  phone: string
}

export function listUsers(): Promise<PortalUser[]> {
  return request('/api/users')
}
