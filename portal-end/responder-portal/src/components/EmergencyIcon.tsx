import type { Emergency } from '../types/incident'

export default function EmergencyIcon({ type }: { type: Emergency }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {type === 'Medical' && <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z" />}
      {type === 'Fire' && <path d="M13 3c1 5-4 5-3 9 2 0 3-2 4-3 3 3 5 5 5 8a7 7 0 0 1-14 0c0-5 5-8 8-14Z" />}
      {type === 'Trapped' && <><path d="M4 21V3h16v18M8 21h8M12 12v5m-3-2 3-3 3 3" /><circle cx="12" cy="8" r="2" /></>}
      {type === 'Other' && <><path d="m12 3 9 17H3Z" /><path d="M12 9v4m0 3h.01" /></>}
    </svg>
  )
}
