import { useEffect, useMemo, useRef, useState } from 'react'
import Header from './components/Header'
import IncidentQueue from './components/IncidentQueue'
import IncidentMap from './components/IncidentMap'
import NavRail, { type AppView } from './components/NavRail'
import MessagesView from './views/MessagesView'
import AgentModeDock from './components/AgentModeDock'
import { mockIncidents, mockNetworkNodes } from './data/mockIncidents'
import type { AiResponder, Incident } from './types/incident'
import type { AgentBrief, RescuePlan, RoutePoint } from './types/agent'
import type { NetworkNode } from './types/network'
import { filterByResponders } from './utils/groupIncidents'
import { listNodes, listReports, updateReport, type NodeApi, type ReportApi } from './api/reports'
import { runAgent, sendAgentCheckIn, type AgentApiBrief, type AgentApiPlan } from './api/agent'
import './App.css'

function App() {
  const [incidents, setIncidents] = useState(mockIncidents)
  const [networkNodes, setNetworkNodes] = useState(mockNetworkNodes)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedFilters, setSelectedFilters] = useState<AiResponder[]>([])
  const [view, setView] = useState<AppView>('home')
  const [peekUserId, setPeekUserId] = useState<number | null>(null)
  const [messagesUserId, setMessagesUserId] = useState<number | null>(null)
  const [agentMode, setAgentMode] = useState(false)
  const [agentPlan, setAgentPlan] = useState<RescuePlan | null>(null)
  const [agentBrief, setAgentBrief] = useState<AgentBrief | null>(null)
  const [agentLoading, setAgentLoading] = useState(false)
  const [agentStatus, setAgentStatus] = useState<'ok' | 'fallback' | null>(null)
  const [responderPosition, setResponderPosition] = useState<[number, number] | null>(null)
  const responderPositionRef = useRef<[number, number] | null>(null)
  const [streetRoute, setStreetRoute] = useState<RoutePoint[]>([])

  const filteredIncidents = useMemo(
    () => filterByResponders(incidents, selectedFilters),
    [incidents, selectedFilters],
  )

  const seedUsers = useMemo(() => {
    const map = new Map<number, string | undefined>()
    for (const incident of incidents) {
      if (!map.has(incident.userId)) map.set(incident.userId, incident.userName)
    }
    return map
  }, [incidents])

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      try {
        const [reports, nodes] = await Promise.all([listReports(), listNodes()])
        if (cancelled) return
        if (reports.length) {
          const liveIncidents = reports.map(toIncident)
          // The current seeded reports are text-only and have no coordinates.
          // Keep the mapped campus incidents visible until live GPS reports arrive.
          const hasLiveCoordinates = reports.some(report => report.gps_lat != null && report.gps_lon != null)
          setIncidents(hasLiveCoordinates ? liveIncidents : [...mockIncidents, ...liveIncidents])
        }
        if (nodes.length) setNetworkNodes(nodes.map(toNetworkNode))
      } catch {
        // Keep the demo data available when the API is offline.
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!agentMode) return
    let cancelled = false
    async function refreshAgent() {
      setAgentLoading(true)
      try {
        const result = await runAgent(
          selectedId ? Number(selectedId) : undefined,
          responderPositionRef.current ? { lat: responderPositionRef.current[0], lon: responderPositionRef.current[1] } : undefined,
          streetRoute,
        )
        if (cancelled) return
        setAgentPlan(result.plan ? toRescuePlan(result.plan) : null)
        setAgentBrief(toAgentBrief(result.brief))
        setAgentStatus(result.status)
      } catch {
        if (!cancelled) setAgentStatus(null)
      } finally {
        if (!cancelled) setAgentLoading(false)
      }
    }
    void refreshAgent()
    const timer = window.setInterval(refreshAgent, 30000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [agentMode, selectedId, streetRoute])

  useEffect(() => {
    if (!navigator.geolocation) return
    const watchId = navigator.geolocation.watchPosition(
      position => {
        const next: [number, number] = [position.coords.latitude, position.coords.longitude]
        responderPositionRef.current = next
        setResponderPosition(next)
      },
      () => {
        // Keep the last known position on transient permission/signal errors.
        // Regular mode and Agent Mode share this same location source.
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 8_000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  function selectIncident(id: string) {
    setSelectedId(id)
    setStreetRoute([])
    setPeekUserId(null)
    setIncidents(current =>
      current.map(incident =>
        incident.id === id && incident.status === 'NEW' ? { ...incident, status: 'ACKNOWLEDGED' } : incident,
      ),
    )
    void acknowledgeReport(id)
  }

  function acknowledgeIncident(id: string) {
    setIncidents(current =>
      current.map(incident =>
        incident.id === id && incident.status === 'NEW' ? { ...incident, status: 'ACKNOWLEDGED' } : incident,
      ),
    )
    void acknowledgeReport(id)
  }

  async function acknowledgeReport(id: string) {
    const reportId = Number(id)
    if (!Number.isInteger(reportId)) return
    try {
      await updateReport(reportId, { status: 'acknowledged' })
    } catch {
      // Keep local acknowledgement when the API is unavailable.
    }
  }

  function changeFilters(next: AiResponder[]) {
    setSelectedFilters(next)
    setSelectedId(current => {
      if (current == null) return current
      const visible = filterByResponders(incidents, next)
      if (visible.some(incident => incident.id === current)) return current
      setStreetRoute([])
      return null
    })
  }

  function openMessages(userId: number) {
    setPeekUserId(null)
    setMessagesUserId(userId)
    setView('messages')
  }

  function changeView(next: AppView) {
    setView(next)
    if (next === 'messages') {
      setPeekUserId(null)
      if (messagesUserId == null && seedUsers.size) {
        setMessagesUserId([...seedUsers.keys()][0])
      }
    }
  }

  function toggleAgentMode() {
    setAgentMode(current => {
      const next = !current
      if (next && selectedId == null && incidents.length > 0) {
        const highestPriority = [...incidents].sort((a, b) => b.priority - a.priority)[0]
        setSelectedId(highestPriority.id)
      }

      return next
    })
  }

  const displayPlan = agentPlan && streetRoute.length
    ? {
        ...agentPlan,
        route: streetRoute,
        routeLabel: 'Preferred street corridor',
        routeNote: 'Route follows mapped streets and accessible ways; verify closures before entry.',
      }
    : agentPlan

  return (
    <div className="app-shell">
      <NavRail view={view} onChange={changeView} />
      <div className="dashboard">
        <Header nodes={networkNodes} />
        <main className={`dashboard-content ${view === 'messages' ? 'messages-mode' : ''}`}>
          {view === 'home' ? (
            <div className="workspace">
              <IncidentQueue
                incidents={incidents}
                filteredIncidents={filteredIncidents}
                selectedFilters={selectedFilters}
                onFiltersChange={changeFilters}
                selectedId={selectedId}
                onSelect={selectIncident}
                onClearSelect={() => {
                  setSelectedId(null)
                  setStreetRoute([])
                }}
                onAcknowledge={acknowledgeIncident}
                peekUserId={peekUserId}
                onPeekUser={setPeekUserId}
                onOpenMessages={openMessages}
                agentMode={agentMode}
              />
              <IncidentMap
                incidents={filteredIncidents}
                selectedId={selectedId}
                onSelectIncident={selectIncident}
                route={streetRoute}
                responderPosition={responderPosition}
                onRouteChange={setStreetRoute}
              />
            </div>
          ) : (
            <MessagesView
              incidents={incidents}
              selectedUserId={messagesUserId}
              onSelectUser={setMessagesUserId}
            />
          )}
        </main>
      </div>
      <AgentModeDock
        active={agentMode}
        incidents={incidents}
        selectedId={selectedId}
        nodes={networkNodes}
        responderLive={responderPosition != null}
        plan={displayPlan}
        brief={agentBrief}
        loading={agentLoading}
        runStatus={agentStatus}
        onToggle={toggleAgentMode}
        onApproveCheckIn={async (reportId, text) => {
          const result = await sendAgentCheckIn(reportId, text)
          const targetIncident = incidents.find(incident => incident.id === String(reportId))
          if (targetIncident) setMessagesUserId(targetIncident.userId)
          return result.status
        }}
      />
    </div>
  )
}

export default App

function toIncident(report: ReportApi): Incident {
  const type = report.category === 1 ? 'Medical' : report.category === 2 ? 'Trapped' : report.category === 3 ? 'Fire' : 'Other'
  const status = report.status === 'received' ? 'NEW' : report.status === 'responding' ? 'RESPONDING' : report.status === 'resolved' ? 'RESOLVED' : 'ACKNOWLEDGED'
  const location = report.gps_lat != null && report.gps_lon != null ? `${report.gps_lat}, ${report.gps_lon}` : report.location || 'Unknown location'
  return {
    id: String(report.id),
    userId: report.user_id,
    userName: report.user?.name || undefined,
    type,
    people: report.people,
    node: String(report.origin).padStart(2, '0'),
    arrivedAt: report.created_at,
    status,
    location,
    placeName: report.location || undefined,
    locationDetail: report.gps_lat != null ? `GPS ±${report.gps_accuracy ?? '?'} m` : 'Location reported by civilian',
    report: report.ai_summary || report.message || 'No additional details supplied.',
    path: report.path.map(node => `Node ${String(node).padStart(2, '0')}`),
    aiResponders: (report.ai_responders ?? []).filter(isAiResponder),
    priority: (report.ai_priority ?? 2) as Incident['priority'],
    clusterId: report.cluster_id ?? undefined,
    aiSummary: report.ai_summary ?? undefined,
    x: 0,
    y: 0,
  }

}

function isAiResponder(value: string): value is AiResponder {
  return ['medical_ems', 'fire_rescue', 'law_enforcement', 'technical_sar', 'humanitarian_care', 'coast_guard'].includes(value)
}

function toNetworkNode(node: NodeApi): NetworkNode {
  return {
    id: String(node.node_id),
    name: node.role === 3 ? 'Gateway' : `Access Node ${String(node.node_id).padStart(2, '0')}`,
    status: node.status.toLowerCase() === 'online' ? 'ONLINE' : 'OFFLINE',
  }
}

function toRescuePlan(plan: AgentApiPlan): RescuePlan {
  return {
    reportId: plan.report_id,
    priority: plan.priority,
    title: plan.title,
    summary: plan.summary,
    approach: plan.approach,
    avoid: plan.avoid,
    confidence: plan.confidence,
    evidence: plan.evidence,
    unknowns: plan.unknowns,
    draft: plan.draft,
    route: plan.route ?? [],
    routeLabel: plan.route_label ?? 'Preferred corridor',
    routeNote: plan.route_note ?? 'Verify blocked access and hazards before entry.',
  }
}

function toAgentBrief(brief: AgentApiBrief): AgentBrief {
  return {
    reportCount: brief.report_count,
    incidentCount: brief.incident_count,
    insight: brief.insight,
    highlights: brief.highlights,
    summary: brief.summary,
    signals: brief.signals,
    verify: brief.verify,
    generatedAt: brief.generated_at,
  }
}
