import { useEffect, useMemo, useState } from 'react'
import Header from './components/Header'
import IncidentQueue from './components/IncidentQueue'
import IncidentMap from './components/IncidentMap'
import NavRail, { type AppView } from './components/NavRail'
import MessagesView from './views/MessagesView'
import AgentModeDock from './components/AgentModeDock'
import { useLivePortal } from './hooks/useLivePortal'
import type { AiResponder } from './types/incident'
import type { AgentBrief, RescuePlan } from './types/agent'
import { filterByResponders } from './utils/groupIncidents'
import { runAgent, sendAgentCheckIn, type AgentApiBrief, type AgentApiPlan } from './api/agent'
import './App.css'

function App() {
  const { incidents, nodes, loading, error, link, acknowledge } = useLivePortal()
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
      const visible = filterByResponders(incidents, next)
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

  function toggleAgentMode() {
    setAgentMode(current => {
      const next = !current
      if (next && selectedId == null && incidents.length > 0) {
        const highestPriority = [...incidents].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0]
        setSelectedId(highestPriority.id)
      }
      return next
    })
  }

  const emptyMessage =
    incidents.length > 0
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
                incidents={incidents}
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
                notice={error && incidents.length > 0 ? error : null}
                emptyMessage={emptyMessage}
                agentMode={agentMode}
              />
              <IncidentMap
                incidents={filteredIncidents}
                selectedId={selectedId}
                onSelectIncident={selectIncident}
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
    </div>
  )
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
