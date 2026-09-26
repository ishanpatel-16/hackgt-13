import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface Props {
  selectionKey: string
  label: string
  onClose: () => void
  children: ReactNode
}

// Non-modal: the map and queue remain usable while inspecting a report.
export default function MapPopup({ selectionKey, label, onClose, children }: Props) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const opener = useRef<HTMLElement | SVGElement | null>(null)

  useEffect(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement || active instanceof SVGElement) opener.current = active
    closeButton.current?.focus({ preventScroll: true })
  }, [selectionKey])

  function close() {
    onClose()
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
  }

  return (
    <div className="map-popup" role="dialog" aria-label={label} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); close() }
    }}>
      <button ref={closeButton} className="popup-close" aria-label="Close details" onClick={close}>×</button>
      {children}
    </div>
  )
}
