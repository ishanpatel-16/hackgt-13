import { request } from './client'
import type { RoutePoint } from '../types/agent'

export interface AgentApiEvidence {
  label: string
  detail: string
  tone: 'confirmed' | 'warning' | 'unknown'
}

export interface AgentApiRoutePoint {
  lat: number
  lon: number
  label: string
  kind: 'responder' | 'waypoint' | 'civilian'
}

export interface AgentApiPlan {
  report_id: number
  cluster_id: string
  priority: 1 | 2 | 3 | 4 | 5
  title: string
  summary: string
  approach: string
  avoid: string
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  evidence: AgentApiEvidence[]
  unknowns: string[]
  draft: string
  route: AgentApiRoutePoint[]
  route_label: string
  route_note: string
  generated_at: string
}

export interface AgentApiBrief {
  report_count: number
  incident_count: number
  insight: string
  highlights: string[]
  summary: string
  signals: string[]
  verify: string[]
  generated_at: string
}

export interface AgentRunResponse {
  plan: AgentApiPlan | null
  brief: AgentApiBrief
  processed_reports: number
  status: 'ok' | 'fallback'
}

export function runAgent(
  reportId?: number,
  responderPosition?: { lat: number; lon: number },
  responderRoute?: RoutePoint[],
): Promise<AgentRunResponse> {
  const body = {
    ...(reportId == null ? {} : { report_id: reportId }),
    ...(responderPosition ? { responder_lat: responderPosition.lat, responder_lon: responderPosition.lon } : {}),
    ...(responderRoute?.length ? { responder_route: responderRoute } : {}),
  }
  return request('/api/ai/agent/run', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function sendAgentCheckIn(
  reportId: number,
  text: string,
): Promise<{ message_id: number; status: 'sent' | 'pending'; text: string }> {
  return request('/api/ai/check-in/send', {
    method: 'POST',
    body: JSON.stringify({ report_id: reportId, text, approved: true }),
  })
}
