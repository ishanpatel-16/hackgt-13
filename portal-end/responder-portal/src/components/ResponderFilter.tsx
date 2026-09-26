import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { AiResponder } from '../types/incident'
import { AI_RESPONDERS, RESPONDER_LABEL, RESPONDER_SHORT } from '../utils/responders'

interface Props {
  selected: AiResponder[]
  onChange: (next: AiResponder[]) => void
}

export default function ResponderFilter({ selected, onChange }: Props) {
  const allActive = selected.length === 0
  const barRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ active: boolean; startX: number; scrollLeft: number; moved: boolean }>({
    active: false,
    startX: 0,
    scrollLeft: 0,
    moved: false,
  })

  function toggle(responder: AiResponder) {
    if (selected.includes(responder)) {
      onChange(selected.filter(r => r !== responder))
    } else {
      onChange([...selected, responder])
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const el = barRef.current
    if (!el || event.button !== 0) return
    drag.current = {
      active: true,
      startX: event.clientX,
      scrollLeft: el.scrollLeft,
      moved: false,
    }
    el.setPointerCapture(event.pointerId)
    el.classList.add('dragging')
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const el = barRef.current
    if (!el || !drag.current.active) return
    const dx = event.clientX - drag.current.startX
    if (Math.abs(dx) > 4) drag.current.moved = true
    el.scrollLeft = drag.current.scrollLeft - dx
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const el = barRef.current
    if (!el || !drag.current.active) return
    drag.current.active = false
    el.classList.remove('dragging')
    try {
      el.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
  }

  function onClickCapture(event: ReactMouseEvent) {
    if (drag.current.moved) {
      event.preventDefault()
      event.stopPropagation()
      drag.current.moved = false
    }
  }

  return (
    <div
      ref={barRef}
      className="filter-bar"
      role="toolbar"
      aria-label="Filter by responder type"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={onClickCapture}
    >
      <button
        type="button"
        className={`filter-chip ${allActive ? 'active' : ''}`}
        aria-pressed={allActive}
        onClick={() => onChange([])}
      >
        All
      </button>
      {AI_RESPONDERS.map(responder => {
        const active = selected.includes(responder)
        return (
          <button
            key={responder}
            type="button"
            className={`filter-chip ${active ? 'active' : ''}`}
            aria-pressed={active}
            title={RESPONDER_LABEL[responder]}
            onClick={() => toggle(responder)}
          >
            {RESPONDER_SHORT[responder]}
          </button>
        )
      })}
    </div>
  )
}
