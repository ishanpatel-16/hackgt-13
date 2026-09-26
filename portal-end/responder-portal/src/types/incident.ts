export type Emergency = 'Medical' | 'Fire' | 'Trapped'
export type IncidentStatus = 'NEW' | 'ACKNOWLEDGED' | 'RESPONDING' | 'RESOLVED'

export type AiResponder =
  | 'medical_ems'
  | 'fire_rescue'
  | 'law_enforcement'
  | 'technical_sar'
  | 'humanitarian_care'
  | 'coast_guard'

/** AI dispatch priority 1–5 (1 = lowest, 5 = immediate life threat). */
export type AiPriority = 1 | 2 | 3 | 4 | 5

export interface Incident {
  id: string
  userId: number
  userName?: string
  type: Emergency
  people: number
  node: string
  /** ISO timestamp when the report arrived. */
  arrivedAt: string
  status: IncidentStatus
  location: string
  placeName?: string
  locationDetail?: string
  report: string
  path: string[]
  aiResponders: AiResponder[]
  /** Matches backend `ai_priority`. */
  priority: AiPriority
  x: number
  y: number
}
