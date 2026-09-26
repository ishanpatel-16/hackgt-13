export const MESSAGE_MAX = 400

export interface PortalMessage {
  id: number
  msg_id: number | null
  direction: 'uplink' | 'downlink' | string
  user_id: number | null
  reply_to: number
  target_node: number | null
  path: number[] | null
  sender: string
  text: string
  status: string
  created_at: string
}

export interface ConversationSummary {
  userId: number
  userName?: string
  lastMessage?: PortalMessage
  messageCount: number
}
