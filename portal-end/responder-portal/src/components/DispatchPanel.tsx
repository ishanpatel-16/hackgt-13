import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { updateReport } from '../api/reports'
import { mockIncidents } from '../data/mockIncidents'
import type { Incident } from '../types/incident'
import { getPrimaryResponse } from '../utils/primaryResponse'

const services = ['EMS', 'Fire / Rescue', 'Rescue', 'Law Enforcement', 'Hazmat']

export default function DispatchPanel({ incident, onClose }: { incident: Incident; onClose: () => void }) {
  const primaryResponse = getPrimaryResponse(incident.type)
  const [service, setService] = useState(() => services.includes(primaryResponse) ? primaryResponse : '')
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const closeRef = useRef<HTMLButtonElement>(null)
  const submitting = useRef(false)
  // Seed IDs (e.g. "01") can alias real numeric API IDs. Never PATCH a demo report.
  const isDemo = mockIncidents.some(report => report.id === incident.id)

  useEffect(() => {
    const trigger = document.activeElement
    closeRef.current?.focus()
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus()
    }
  }, [])

  async function confirmDispatch() {
    if (!service || submitting.current || confirmed || incident.status === 'RESOLVED') return
    submitting.current = true
    setPending(true)
    setError('')
    try {
      // Only responding status is persisted. Service choice is panel-local demo state;
      // the API has no human dispatch record, service assignment, or notification operation.
      if (!isDemo) await updateReport(Number(incident.id), { status: 'responding' })
      setConfirmed(true)
    } catch {
      setError('Could not save responding status. Check the connection and try again.')
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  return createPortal(
    <section className="dispatch-panel" role="dialog" aria-labelledby="dispatch-heading" aria-describedby="dispatch-limitation"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <div className="report-detail-peek-header">
        <h2 id="dispatch-heading">Dispatch Response</h2>
        <button ref={closeRef} type="button" className="icon-btn" aria-label="Close dispatch" onClick={onClose}>×</button>
      </div>
      <div className="dispatch-body">
        <dl className="dispatch-facts">
          <div><dt>Incident</dt><dd>{incident.type} · SOS / {incident.id}</dd></div>
          <div><dt>Location</dt><dd>{incident.placeName ?? incident.location}{incident.locationDetail && <small>{incident.locationDetail}</small>}</dd></div>
          <div><dt>People</dt><dd>{incident.people} {incident.people === 1 ? 'person' : 'people'} needing help</dd></div>
          <div><dt>Primary response</dt><dd>{primaryResponse}</dd></div>
        </dl>
        <fieldset className="dispatch-services" disabled={pending || confirmed}>
          <legend>Response service</legend>
          {services.map(option => (
            <label key={option}>
              <input type="radio" name="dispatch-service" value={option} checked={service === option} onChange={() => setService(option)} />
              {option}
            </label>
          ))}
        </fieldset>
        <p id="dispatch-limitation" className="dispatch-note">
          {isDemo ? 'Demo report: confirmation is temporary and clears when this panel closes.' : 'Confirmation saves responding status only. Service selection clears when this panel closes.'}
          {' '}No responders are contacted.
        </p>
        {incident.status === 'RESOLVED' && !confirmed && <p className="dispatch-note">This report is resolved and cannot be dispatched.</p>}
        {error && <p role="alert" className="dispatch-note">{error}</p>}
        {confirmed && <p role="status" className="dispatch-result">{isDemo ? 'Demo confirmation' : 'Responding status saved'} · {service}</p>}
        <div className="detail-actions">
          <button type="button" className="reports-button" onClick={onClose}>{confirmed || pending ? 'Close' : 'Cancel'}</button>
          {!confirmed && <button type="button" className="acknowledge-button" disabled={!service || pending || incident.status === 'RESOLVED'} onClick={() => void confirmDispatch()}>{pending ? 'Saving…' : 'Confirm Dispatch'}</button>}
        </div>
      </div>
    </section>,
    document.body,
  )
}
