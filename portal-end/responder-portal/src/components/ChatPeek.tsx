import { displayName } from '../utils/groupIncidents'
import ChatThread from './ChatThread'

interface Props {
  userId: number
  userName?: string
  onClose: () => void
  onOpenFull: () => void
}

export default function ChatPeek({ userId, userName, onClose, onOpenFull }: Props) {
  const name = displayName(userId, userName)
  return (
    <div className="chat-peek" role="dialog" aria-label={`Chat with ${name}`}>
      <div className="chat-peek-header">
        <div>
          <strong>{name}</strong>
          <span className="small-label">ID {userId}</span>
        </div>
        <div className="chat-peek-actions">
          <button type="button" className="text-btn" onClick={onOpenFull}>
            Open in Messages
          </button>
          <button type="button" className="icon-btn" aria-label="Close chat" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      <ChatThread userId={userId} active compact />
    </div>
  )
}
