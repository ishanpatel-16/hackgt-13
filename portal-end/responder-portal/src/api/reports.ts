const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:8000'

export interface ReportApi {
  id: number
  msg_id: number
  user_id: number
  category: number
  people: number
  location: string
  status: string
  ai_priority: number | null
  ai_responders: string[] | null
  cluster_id: string | null
  attempt: number
  origin: number
  path: number[]
  gps_lat: number | null
  gps_lon: number | null
  gps_accuracy: number | null
  message: string
  ai_summary: string | null
  created_at: string
  user: { user_id: number; name: string; phone: string; origin?: number | null }
}

export interface NodeApi {
  node_id: number
  role: number
  status: string
  battery: number | null
  last_seen: string | null
  path: number[]
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
  })
  if (!response.ok) throw new Error((await response.text()) || `Request failed (${response.status})`)
  return response.json() as Promise<T>
}

export function listReports(): Promise<ReportApi[]> {
  return request('/api/reports?limit=500&sort=priority')
}

export function listNodes(): Promise<NodeApi[]> {
  return request('/api/nodes')
}

export function updateReport(reportId: number, payload: { status?: string }): Promise<ReportApi> {
  return request(`/api/reports/${reportId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
