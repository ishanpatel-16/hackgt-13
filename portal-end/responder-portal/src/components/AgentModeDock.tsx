import { useEffect, useMemo, useState } from 'react'
import type { AgentEvidence, AgentModeDockProps, RescuePlan, RoutePoint } from '../types/agent'
import type { Incident } from '../types/incident'
import type { NetworkNode } from '../types/network'

function priorityLabel(priority: number): string {
  return priority >= 5 ? 'Immediate life threat' : priority >= 4 ? 'Urgent response' : 'Monitor closely'
}

function buildPlan(incident: Incident, incidents: Incident[], nodes: NetworkNode[]): RescuePlan {
  const related = incidents.filter(
    candidate => candidate.placeName === incident.placeName || candidate.userId === incident.userId,
  )
  const offline = nodes.filter(node => node.status === 'OFFLINE')
  const hasFireSignal = related.some(candidate => candidate.type === 'Fire')
  const hasTrappedSignal = related.some(candidate => candidate.type === 'Trapped')
  const isUrgent = incident.priority >= 4
  const evidence: AgentEvidence[] = [
    {
      label: `${related.length} linked reports`,
      detail: related.length > 1 ? `Reports cluster around ${incident.placeName ?? 'the same area'}.` : 'No nearby duplicate report found yet.',
      tone: related.length > 1 ? 'confirmed' : 'unknown',
    },
    {
      label: `${incident.type} signal`,
      detail: `${incident.people} ${incident.people === 1 ? 'person' : 'people'} reported at ${incident.locationDetail ?? incident.location}.`,
      tone: 'confirmed',
    },
    {
      label: offline.length ? `${offline.length} relay warning` : 'Mesh path operational',
      detail: offline.length
        ? `${offline.map(node => node.name).join(', ')} is not responding; information from that zone may be stale.`
        : 'The current message path is reporting healthy nodes.',
      tone: offline.length ? 'warning' : 'confirmed',
    },
  ]

  const approach = hasFireSignal || hasTrappedSignal ? 'North entrance → Relay 03 → east corridor' : 'Gateway → nearest confirmed access point'
  const avoid = hasFireSignal ? 'West stairwell until smoke conditions are confirmed' : 'Any route without a recent civilian or relay signal'
  const coordinates = incident.location.split(',').map(Number)
  const route: RoutePoint[] = coordinates.length === 2 && coordinates.every(Number.isFinite)
    ? [
        { lat: coordinates[0] + 0.0012, lon: coordinates[1] - 0.0012, label: 'Responder position', kind: 'responder' },
        { lat: coordinates[0] + 0.00076, lon: coordinates[1] - 0.00072, label: 'Confirmed approach', kind: 'waypoint' },
        { lat: coordinates[0], lon: coordinates[1], label: 'Civilian signal', kind: 'civilian' },
      ]
    : []

  return {
    priority: incident.priority,
    title: `${incident.type} cluster near ${incident.placeName ?? 'reported location'}`,
    summary: `${related.length} report${related.length === 1 ? '' : 's'} suggest ${incident.people} ${incident.people === 1 ? 'person may need' : 'people may need'} help now. ${hasFireSignal ? 'Smoke makes the west approach unreliable.' : 'The next priority is confirming access and condition.'}`,
    approach,
    avoid,
    confidence: offline.length ? 'MEDIUM' : isUrgent ? 'HIGH' : 'MEDIUM',
    evidence,
    unknowns: [
      hasTrappedSignal ? 'Whether all occupants can still move' : 'Whether this is a duplicate of a nearby report',
      offline.length ? 'Whether civilians in the relay gap can receive a reply' : 'Exact responder arrival route',
    ],
    draft: `Net0 received your ${incident.type.toLowerCase()} report at ${incident.placeName ?? incident.location}. Reply 1 if you can move, 2 if injured, or 3 if trapped.`,
    route,
    routeLabel: route.length ? 'Preferred corridor' : 'Route waiting for GPS',
    routeNote: route.length ? 'Demo street corridor until live responder GPS is available.' : 'GPS is needed to draw the preferred street corridor.',
  }
}

function StatusDot({ tone }: { tone: AgentEvidence['tone'] }) {
  return <span className={`agent-status-dot ${tone}`} aria-hidden />
}

export default function AgentModeDock({
  active,
  incidents,
  selectedId,
  nodes,
  responderLive = false,
  plan: remotePlan,
  brief,
  loading = false,
  runStatus = null,
  onToggle,
  onApproveCheckIn,
}: AgentModeDockProps) {
  const [expanded, setExpanded] = useState(false)
  const [approved, setApproved] = useState(false)
  const [deliveryStatus, setDeliveryStatus] = useState<'sent' | 'pending' | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const selectedIncident = incidents.find(incident => incident.id === selectedId) ?? null
  const focusIncident = selectedIncident ?? [...incidents].sort((a, b) => b.priority - a.priority)[0]
  const fallbackPlan = useMemo(
    () => (focusIncident ? buildPlan(focusIncident, incidents, nodes) : null),
    [focusIncident, incidents, nodes],
  )
  const plan = remotePlan && fallbackPlan && remotePlan.route.length === 0 && fallbackPlan.route.length > 0
    ? { ...remotePlan, route: fallbackPlan.route, routeLabel: fallbackPlan.routeLabel, routeNote: fallbackPlan.routeNote }
    : remotePlan ?? fallbackPlan

  useEffect(() => {
    setApproved(false)
    setDeliveryStatus(null)
    setSendError(null)
    setSending(false)
  }, [selectedId, plan?.reportId, plan?.draft])

  async function approveCheckIn() {
    if (!plan) return
    setSendError(null)
    if (!onApproveCheckIn || plan.reportId == null) {
      setDeliveryStatus('pending')
      setApproved(true)
      return
    }
    setSending(true)
    try {
      const status = await onApproveCheckIn(plan.reportId, plan.draft)
      setDeliveryStatus(status)
      setApproved(true)
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Could not queue check-in')
    } finally {
      setSending(false)
    }
  }

  function toggleDock() {
    setExpanded(current => !current)
  }

  function toggleMode() {
    setApproved(false)
    onToggle()
    if (!active) setExpanded(true)
  }

  return (
    <aside className={`agent-dock ${expanded ? 'expanded' : ''} ${active ? 'active' : ''}`} aria-label="Net0 Agent Mode">
      {expanded && (
        <div className="agent-dock-panel">
          <div className="agent-dock-heading">
            <div>
              <span className="agent-eyebrow">Operational co-pilot</span>
              <h2>Net0 Agent Mode</h2>
            </div>
            <button type="button" className="agent-close" onClick={toggleDock} aria-label="Close Agent Mode panel">
              ×
            </button>
          </div>

          <div className="agent-mode-row">
            <div>
              <strong>{active ? 'Agent is assisting' : 'Agent is paused'}</strong>
              <span>{active ? 'Sorting, clustering, and preparing actions' : 'Manual responder workflow remains active'}</span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={active}
              className={`agent-switch ${active ? 'on' : ''}`}
              onClick={toggleMode}
              aria-label={active ? 'Turn Agent Mode off' : 'Turn Agent Mode on'}
            >
              <span />
            </button>
          </div>

          {active && plan ? (
            <div className="agent-plan">
              <div className="agent-plan-meta">
                <span className={`agent-priority p${plan.priority}`}>P{plan.priority}</span>
                <span>{priorityLabel(plan.priority)}</span>
                <span className="agent-confidence">{plan.confidence} confidence</span>
              </div>
              {brief && (
                <div className="agent-live-brief">
                  <span className="agent-section-label">Live synthesis · {brief.incidentCount} incident clusters</span>
                  <strong>{brief.insight}</strong>
                </div>
              )}
              <h3>{plan.title}</h3>
              <p className="agent-plan-summary">{plan.summary}</p>

              <div className="agent-route-grid">
                <div className="agent-route preferred">
                  <span className="route-kicker">Preferred approach</span>
                  <strong>{plan.approach}</strong>
                </div>

                <div className="agent-route avoid">
                  <span className="route-kicker">Avoid for now</span>
                  <strong>{plan.avoid}</strong>
                </div>

                <div className="agent-best-path">
                  <div className="agent-best-path-heading">
                    <div>
                      <span className="agent-section-label">Best path · visible on map</span>
                      <strong>{plan.routeLabel}</strong>
                    </div>
                    <span className="agent-path-status"><i /> {plan.route.length ? (responderLive ? 'Live position' : 'Demo movement') : 'Waiting for GPS'}</span>
                  </div>
                  <div className="agent-path-steps">
                    {plan.route.length
                      ? plan.route.map((point, index) => (
                          <span key={`${point.label}-${point.lat}`}>
                            <b>{index + 1}</b>{point.label}{index < plan.route.length - 1 && <em>→</em>}
                          </span>
                        ))
                      : <span>Enable location access or select a GPS-backed report.</span>}
                  </div>
                  <p>{plan.routeNote}</p>
                </div>
              </div>

              <div className="agent-section">
                <span className="agent-section-label">Evidence trail</span>
                <div className="agent-evidence-list">
                  {plan.evidence.map(item => (
                    <div className="agent-evidence" key={item.label}>
                      <StatusDot tone={item.tone} />
                      <div>
                        <strong>{item.label}</strong>
                        <span>{item.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="agent-section agent-unknowns">
                <span className="agent-section-label">Still unconfirmed</span>
                <ul>
                  {plan.unknowns.map(item => <li key={item}>{item}</li>)}
                </ul>
              </div>

              <div className="agent-draft">
                <div>
                  <span className="agent-section-label">Draft civilian check-in</span>
                  <p>{plan.draft}</p>
                </div>
                <button type="button" className={`agent-approve ${approved ? 'approved' : ''}`} onClick={approveCheckIn} disabled={approved || sending}>
                  {sending ? 'Sending…' : approved ? (deliveryStatus === 'sent' ? 'Sent' : 'Queued for mesh') : 'Approve & send'}
                </button>
              </div>
              {sendError && <p className="agent-send-error" role="alert">{sendError}</p>}
              {approved && !sendError && (
                <p className="agent-send-status" role="status">
                  {deliveryStatus === 'sent' ? 'Check-in handed to the mesh gateway.' : 'Check-in saved for delivery when the mesh gateway is available.'}
                </p>
              )}

              <div className="agent-tool-trace" aria-label="Agent activity">
                <span>{loading ? '◌ Refreshing agent' : '✓ Clustered reports'}</span>
                <span>✓ Checked mesh</span>
                <span>{runStatus === 'fallback' ? '◇ Deterministic fallback' : '✓ Drafted check-in'}</span>
              </div>
            </div>
          ) : (
            <div className="agent-paused">
              <span className="agent-paused-mark">✦</span>
              <p>Turn Agent Mode on to automatically prioritize incidents and prepare a grounded rescue plan.</p>
              <button type="button" className="agent-enable" onClick={toggleMode}>Enable Agent Mode</button>
            </div>
          )}
        </div>
      )}

      <button type="button" className={`agent-dock-toggle ${active ? 'active' : ''}`} onClick={toggleDock} aria-expanded={expanded}>
        <span className="agent-orbit" aria-hidden><span /></span>
        <span className="agent-dock-label">
          <strong>Agent Mode</strong>
          <small>{active ? 'ON · ready to assist' : 'OFF · manual control'}</small>
        </span>
        <span className="agent-caret" aria-hidden>{expanded ? '⌄' : '⌃'}</span>
      </button>
    </aside>
  )
}
