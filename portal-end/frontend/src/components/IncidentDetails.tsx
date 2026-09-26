import { useState } from 'react'
import type { Incident } from '../types/incident'
import EmergencyIcon from './EmergencyIcon'

export default function IncidentDetails({ incident, onAcknowledge }: { incident: Incident; onAcknowledge: (id: string) => void }) {
  const [showReports, setShowReports] = useState(false)
  return (
    <section className={`panel details-panel ${incident.type.toLowerCase()}`} aria-labelledby="details-heading">
      <div className="panel-heading"><h2 id="details-heading">Incident Details</h2></div>
      <div className="details-body">
        <div className="incident-top"><span className="incident-id">SOS / {incident.id}</span><span className={`incident-status ${incident.status.toLowerCase()}`} role="status">{incident.status}</span></div>
        <div className="detail-emergency"><span className="emergency-icon"><EmergencyIcon type={incident.type} /></span><h3>{incident.type}</h3></div>
        <p className="people-detail"><strong>{incident.people}</strong> {incident.people === 1 ? 'person' : 'people'} needing help</p>
        <dl className="detail-facts"><div><dt>Reported</dt><dd>{incident.reported}</dd></div><div><dt>Source</dt><dd>Node {incident.node}</dd></div><div><dt>Location</dt><dd>{incident.location}</dd></div></dl>
        <h4>Report</h4><blockquote>“{incident.report}”</blockquote>
        <h4>Network Path</h4><p className="detail-route">{incident.path.join(' → ')}</p>
        <div className="detail-actions"><button className="acknowledge-button" disabled={incident.status !== 'NEW'} onClick={() => onAcknowledge(incident.id)}>{incident.status === 'NEW' ? 'Acknowledge' : incident.status.charAt(0) + incident.status.slice(1).toLowerCase()}</button><button className="reports-button" aria-expanded={showReports} aria-controls="source-reports" onClick={() => setShowReports(!showReports)}>{showReports ? 'Hide Reports' : 'View Reports'}</button></div>
        {showReports && <div id="source-reports" className="source-reports"><h4>Source Report · 1</h4><p>SOS / {incident.id} · Node {incident.node} · {incident.reported}</p><p>{incident.report}</p><p>No other reports have been linked to this incident.</p></div>}
      </div>
    </section>
  )
}
