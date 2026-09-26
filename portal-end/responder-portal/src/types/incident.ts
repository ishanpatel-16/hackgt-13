export type Emergency = 'Medical' | 'Fire' | 'Trapped'
export type IncidentStatus = 'NEW' | 'ACKNOWLEDGED' | 'RESPONDING' | 'RESOLVED'

export interface Incident {
  id: string
  type: Emergency
  people: number
  node: string
  age: string
  reported: string
  status: IncidentStatus
  location: string
  placeName?: string
  locationDetail?: string
  report: string
  path: string[]
  x: number
  y: number
}
