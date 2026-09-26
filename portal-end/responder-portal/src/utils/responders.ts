import type { AiResponder } from '../types/incident'

export const AI_RESPONDERS: AiResponder[] = [
  'medical_ems',
  'fire_rescue',
  'law_enforcement',
  'technical_sar',
  'humanitarian_care',
  'coast_guard',
]

export const RESPONDER_SHORT: Record<AiResponder, string> = {
  medical_ems: 'EMS',
  fire_rescue: 'Fire',
  law_enforcement: 'Law',
  technical_sar: 'SAR',
  humanitarian_care: 'Care',
  coast_guard: 'Coast',
}

export const RESPONDER_LABEL: Record<AiResponder, string> = {
  medical_ems: 'Medical / EMS',
  fire_rescue: 'Fire / Rescue',
  law_enforcement: 'Law Enforcement',
  technical_sar: 'Technical SAR',
  humanitarian_care: 'Humanitarian Care',
  coast_guard: 'Coast Guard',
}

/** Muted fill / text pairs for pill badges */
export const RESPONDER_COLOR: Record<AiResponder, { bg: string; fg: string }> = {
  medical_ems: { bg: '#1e3a4f', fg: '#8ec8ef' },
  fire_rescue: { bg: '#4a2e1c', fg: '#f0a86e' },
  law_enforcement: { bg: '#2e3540', fg: '#b8c4d4' },
  technical_sar: { bg: '#3f3520', fg: '#e0c56a' },
  humanitarian_care: { bg: '#1c3a36', fg: '#7dccc0' },
  coast_guard: { bg: '#1a3a42', fg: '#6ec8d8' },
}
