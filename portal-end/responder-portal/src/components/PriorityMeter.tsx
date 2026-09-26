import type { AiPriority } from '../types/incident'

/** Quiet 5-segment priority meter — filled segments only, one muted tone. */
export default function PriorityMeter({
  level,
  size = 'sm',
}: {
  level: AiPriority
  size?: 'sm' | 'md'
}) {
  return (
    <span
      className={`priority-meter ${size}`}
      title={`Priority ${level} of 5`}
      aria-label={`Priority ${level} of 5`}
    >
      {[1, 2, 3, 4, 5].map(step => (
        <span key={step} className={`priority-bar ${step <= level ? 'on' : ''}`} data-level={level} />
      ))}
    </span>
  )
}
