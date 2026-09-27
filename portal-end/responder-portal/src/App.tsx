import { useEffect, useMemo, useState } from 'react'
import Header from './components/Header'
import IncidentQueue from './components/IncidentQueue'
import IncidentMap from './components/IncidentMap'
import NavRail, { type AppView } from './components/NavRail'
import MessagesView from './views/MessagesView'
import AgentModeDock from './components/AgentModeDock'
import DispatchDock from './components/DispatchDock'
import { useLivePortal } from './hooks/useLivePortal'
import { useDeviceLocation } from './hooks/useDeviceLocation'
import type { AiResponder, Incident } from './types/incident'
import type { AgentBrief, RescuePlan } from './types/agent'
import { filterByResponders } from './utils/groupIncidents'
import { sendMessage } from './api/messages'
import { dispatchCode } from './utils/dispatchOrder'
import { formatArrival, orderByLocation } from './utils/streetRoute'
import { runAgent, sendAgentCheckIn, type AgentApiBrief, type AgentApiPlan } from './api/agent'
import './App.css'

function App() {
  const { incidents, nodes, loading, error, link, acknowledge, resolveReports } = useLivePortal()
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
  const [dispatchIds, setDispatchIds] = useState<string[]>([])
  const [orderNumber, setOrderNumber] = useState(1)
  const [highlightedDispatchId, setHighlightedDispatchId] = useState<string | null>(null)
  const [dispatchFocus, setDispatchFocus] = useState<{ id: string; token: number } | null>(null)
  const [overviewToken, setOverviewToken] = useState(0)
  const [dispatchEtas, setDispatchEtas] = useState<Record<string, number>>({})
  const [dispatchNotice, setDispatchNotice] = useState<string | null>(null)
  const devicePosition = useDeviceLocation()

  const openIncidents = useMemo(
    () => incidents.filter(incident => incident.status !== 'RESOLVED'),
    [incidents],
  )

  const filteredIncidents = useMemo(
    () => filterByResponders(openIncidents, selectedFilters),
    [openIncidents, selectedFilters],
  )

  const seedUsers = useMemo(() => {
    const map = new Map<number, string | undefined>()
    for (const incident of openIncidents) {
      if (!map.has(incident.userId)) map.set(incident.userId, incident.userName)
    }
    return map
  }, [openIncidents])

  const dispatchIncidents = useMemo(() => {
    const chosen = dispatchIds.flatMap(id => {
      const incident = incidents.find(item => item.id === id)
      return incident ? [incident] : []
    })
    const located = chosen.filter(hasFix)
    const missing = chosen.filter(incident => !hasFix(incident))
    const start = devicePosition
      ? ([Number(devicePosition[0].toFixed(4)), Number(devicePosition[1].toFixed(4))] as [number, number])
      : null
    return [...orderByLocation(start, located), ...missing]
  }, [devicePosition, dispatchIds, incidents])

  const dispatchStops = useMemo(
    () => dispatchIncidents.filter(hasFix).map(incident => ({ id: incident.id, lat: incident.lat, lon: incident.lon })),
    [dispatchIncidents],
  )

  useEffect(() => {
    if (!incidents.length) return
    const live = new Set(incidents.map(incident => incident.id))
    setDispatchIds(current => {
      const next = current.filter(id => live.has(id))
      return next.length === current.length ? current : next
    })
  }, [incidents])

  useEffect(() => {
    if (!dispatchNotice) return
    const timer = window.setTimeout(() => setDispatchNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [dispatchNotice])

  useEffect(() => {
    if (!agentMode) return
    let cancelled = false
    async function refreshAgent() {
      setAgentLoading(true)
      try {
        const result = await runAgent(selectedId ? Number(selectedId) : undefined)
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
  }, [agentMode, selectedId])

  function selectIncident(id: string) {
    setSelectedId(id)
    setPeekUserId(null)
    void acknowledge(id)
  }

  function acknowledgeIncident(id: string) {
    void acknowledge(id)
  }

  function changeFilters(next: AiResponder[]) {
    setSelectedFilters(next)
    setSelectedId(current => {
      if (current == null) return current
      const visible = filterByResponders(openIncidents, next)
      if (visible.some(incident => incident.id === current)) return current
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

  function releaseDispatchFocus(id: string) {
    if (dispatchFocus?.id !== id) return
    setDispatchFocus(null)
    setHighlightedDispatchId(current => (current === id ? null : current))
    setOverviewToken(token => token + 1)
  }

  function toggleDispatch(id: string) {
    setDispatchIds(current => {
      if (current.includes(id)) return current.filter(item => item !== id)
      return [...current, id]
    })
    if (dispatchIds.includes(id)) releaseDispatchFocus(id)
  }

  function removeFromDispatch(id: string) {
    setDispatchIds(current => current.filter(item => item !== id))
    releaseDispatchFocus(id)
  }

  function focusDispatchStop(id: string) {
    setHighlightedDispatchId(id)
    setDispatchFocus(current => ({ id, token: (current?.token ?? 0) + 1 }))
  }

  function sendDispatch() {
    const queued = dispatchIncidents
    if (!queued.length) return
    const etas = dispatchEtas
    const code = dispatchCode(orderNumber)
    const ids = queued.map(incident => incident.id)
    setDispatchIds([])
    setDispatchEtas({})
    setHighlightedDispatchId(null)
    setOrderNumber(number => number + 1)
    if (selectedId && ids.includes(selectedId)) setSelectedId(null)
    void notifyDispatch(queued, etas, code)
    void resolveReports(ids)
  }

  async function notifyDispatch(queued: Incident[], etas: Record<string, number>, code: string) {
    const results = await Promise.all(
      queued.map(async incident => {
        const minutes = etas[incident.id]
        const arrival =
          minutes != null
            ? ` Estimated arrival is about ${formatArrival(minutes)}.`
            : ' Help is on the way.'
        const text = `Dispatch #${code} sent for your ${incident.type.toLowerCase()} report.${arrival}`
        try {
          await sendMessage({
            user_id: incident.userId,
            text,
            sender: 'Portal',
            reply_to: incident.msgId,
          })
          return true
        } catch {
          return false
        }
      }),
    )
    const failed = results.filter(ok => !ok).length
    setDispatchNotice(
      failed
        ? `Dispatch sent. ${failed} ${failed === 1 ? 'notification failed' : 'notifications failed'}.`
        : 'Dispatch sent. Each person was told help is on the way.',
    )
  }

  function toggleAgentMode() {
    setAgentMode(current => {
      const next = !current
      if (next && selectedId == null && openIncidents.length > 0) {
        const highestPriority = [...openIncidents].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0]
        setSelectedId(highestPriority.id)
      }
      return next
    })
  }

  const emptyMessage =
    openIncidents.length > 0
      ? 'No reports match these filters.'
      : error
        ? error
        : loading
          ? 'Connecting to the portal server…'
          : 'No reports yet. New emergencies will appear here.'

  return (
    <div className="app-shell">
      <NavRail view={view} onChange={changeView} />
      <div className="dashboard">
        <Header nodes={nodes} link={link} />
        <main className={`dashboard-content ${view === 'messages' ? 'messages-mode' : ''}`}>
          {view === 'home' ? (
            <div className="workspace">
              <IncidentQueue
                incidents={openIncidents}
                filteredIncidents={filteredIncidents}
                selectedFilters={selectedFilters}
                onFiltersChange={changeFilters}
                selectedId={selectedId}
                onSelect={selectIncident}
                onClearSelect={() => {
                  setSelectedId(null)
                }}
                onAcknowledge={acknowledgeIncident}
                peekUserId={peekUserId}
                onPeekUser={setPeekUserId}
                onOpenMessages={openMessages}
                notice={dispatchNotice ?? (error && openIncidents.length > 0 ? error : null)}
                emptyMessage={emptyMessage}
                agentMode={agentMode}
                dispatchIds={dispatchIds}
                onToggleDispatch={toggleDispatch}
              />
              <IncidentMap
                incidents={filteredIncidents}
                selectedId={selectedId}
                onSelectIncident={selectIncident}
                onClearSelection={() => setSelectedId(null)}
                devicePosition={devicePosition}
                dispatchStops={dispatchStops}
                dispatchOrder={dispatchIncidents.map(incident => incident.id)}
                highlightedDispatchId={highlightedDispatchId}
                dispatchFocus={dispatchFocus}
                overviewToken={overviewToken}
                onDispatchEtas={setDispatchEtas}
              />
            </div>
          ) : (
            <MessagesView
              incidents={openIncidents}
              selectedUserId={messagesUserId}
              onSelectUser={setMessagesUserId}
            />
          )}
        </main>
      </div>
      <div className="corner-stack">
        <AgentModeDock
          active={agentMode}
          incidents={openIncidents}
          selectedId={selectedId}
          nodes={nodes}
          plan={agentPlan}
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
        {dispatchIncidents.length > 0 ? (
          <DispatchDock
            orderNumber={orderNumber}
            incidents={dispatchIncidents}
            hasDeviceFix={devicePosition != null}
            etas={dispatchEtas}
            onRemove={removeFromDispatch}
            onSend={sendDispatch}
            onHighlight={setHighlightedDispatchId}
            onFocus={focusDispatchStop}
          />
        ) : null}
      </div>
    </div>
  )
}

function hasFix(incident: Incident): incident is Incident & { lat: number; lon: number } {
  return incident.lat != null && incident.lon != null && Number.isFinite(incident.lat) && Number.isFinite(incident.lon)
}

export default App

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
