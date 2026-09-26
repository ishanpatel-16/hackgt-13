import { useEffect, useState } from 'react'
import type { AgentEvidence, AgentModeDockProps } from '../types/agent'

function priorityLabel(priority: number): string {
  return priority >= 5 ? 'Immediate life threat' : priority >= 4 ? 'Urgent response' : 'Monitor closely'
}

function StatusDot({ tone }: { tone: AgentEvidence['tone'] }) {
  return <span className={`agent-status-dot ${tone}`} aria-hidden />
}

export default function AgentModeDock({
  active,
  selectedId,
  plan,
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
              <span>{active ? 'Gemini clustering, triage, and rescue planning' : 'Manual responder workflow remains active'}</span>
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
                  {brief.summary ? <p className="agent-plan-summary">{brief.summary}</p> : null}
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
                <span>{loading ? '◌ Refreshing Gemini' : '✓ Gemini clustered reports'}</span>
                <span>✓ Checked mesh</span>
                <span>{runStatus === 'ok' ? '✓ Gemini rescue plan' : '◇ Gemini unavailable'}</span>
              </div>
            </div>
          ) : active ? (
            <div className="agent-paused">
              <span className="agent-paused-mark">◌</span>
              <p>
                {loading
                  ? 'Gemini is clustering reports and drafting the rescue plan…'
                  : runStatus === 'fallback'
                    ? 'Gemini did not return a plan. Check GEMINI_API_KEY and backend logs, then retry.'
                    : 'Waiting for Gemini to return an agent plan for the selected report.'}
              </p>
            </div>
          ) : (
            <div className="agent-paused">
              <span className="agent-paused-mark">✦</span>
              <p>Turn Agent Mode on to let Gemini prioritize incidents, cluster nearby GPS reports, and prepare a rescue plan.</p>
              <button type="button" className="agent-enable" onClick={toggleMode}>Enable Agent Mode</button>
            </div>
          )}
        </div>
      )}

      <button type="button" className={`agent-dock-toggle ${active ? 'active' : ''}`} onClick={toggleDock} aria-expanded={expanded}>
        <span className="agent-orbit" aria-hidden><span /></span>
        <span className="agent-dock-label">
          <strong>Agent Mode</strong>
          <small>{active ? 'ON · Gemini assisting' : 'OFF · manual control'}</small>
        </span>
        <span className="agent-caret" aria-hidden>{expanded ? '⌄' : '⌃'}</span>
      </button>
    </aside>
  )
}
