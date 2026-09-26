import type { AiResponder } from '../types/incident'
import { RESPONDER_COLOR, RESPONDER_LABEL, RESPONDER_SHORT } from '../utils/responders'

export default function ResponderPills({
  responders,
  className = '',
}: {
  responders: AiResponder[]
  className?: string
}) {
  if (!responders.length) return null
  return (
    <div className={`responder-pills ${className}`.trim()}>
      {responders.map(responder => {
        const color = RESPONDER_COLOR[responder]
        return (
          <span
            key={responder}
            className="responder-pill"
            title={RESPONDER_LABEL[responder]}
            style={{ background: color.bg, color: color.fg }}
          >
            {RESPONDER_SHORT[responder]}
          </span>
        )
      })}
    </div>
  )
}
