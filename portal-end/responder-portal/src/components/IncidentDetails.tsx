import { getPrimaryResponse } from '../utils/primaryResponse'
import { deviceName } from '../utils/networkLabels'
import { useState } from 'react'
import type { Incident } from '../types/incident'
import EmergencyIcon from './EmergencyIcon'
import { useRelativeTime } from '../hooks/useRelativeTime'
import PriorityMeter from './PriorityMeter'

export default function IncidentDetails({
  incident,
  onAcknowledge,
}: {
  incident: Incident
  onAcknowledge: (id: string) => void
}) {
  const [showReports, setShowReports] = useState(false)
  const reported = useRelativeTime(incident.arrivedAt)
  const isNew = incident.status === 'NEW'

  return (
    <section className={`panel details-panel ${incident.type.toLowerCase()}`} aria-labelledby="details-heading">
      <div className="panel-heading">
        <h2 id="details-heading">Incident Details</h2>
      </div>
      <div className="details-body">
        <div className="incident-top">
          <span className="incident-id">SOS / {incident.id}</span>
          {isNew ? (
            <span className="incident-status new" role="status">
              NEW
            </span>
          ) : null}
        </div>
        <div className="detail-emergency">
          <span className="emergency-icon">
            <EmergencyIcon type={incident.type} />
          </span>
          <h3>{incident.type}</h3>
        </div>
        <p className="people-detail">
          <strong>{incident.people}</strong> {incident.people === 1 ? 'person' : 'people'} needing help
        </p>
        <dl className="detail-facts">
          <div>
            <dt>Location</dt>
            <dd>
              {incident.placeName ?? incident.location}
              <br />
              {incident.locationDetail}
            </dd>
          </div>
          <div>
            <dt>Priority</dt>
            <dd className="priority-detail">
              <PriorityMeter level={incident.priority} size="md" />
              <span>P{incident.priority}</span>
            </dd>
          </div>
        </dl>
        <h4>Primary response</h4>
        <p className="detail-route">{getPrimaryResponse(incident.type)}</p>
        <h4>Report</h4>
        <blockquote>“{incident.report}”</blockquote>
        <p className="detail-route">Reported {reported}</p>
        <div className="detail-actions">
          {isNew && (
            <button className="acknowledge-button" onClick={() => onAcknowledge(incident.id)}>
              Acknowledge
            </button>
          )}
          <button
            className="reports-button"
            aria-expanded={showReports}
            aria-controls="source-reports"
            onClick={() => setShowReports(!showReports)}
          >
            {showReports ? 'Hide Reports' : 'View Reports'}
          </button>
        </div>
        <dl className="detail-facts">
          <div>
            <dt>Received via</dt>
            <dd>Access Point {incident.node}</dd>
          </div>
          <div>
            <dt>Coordinates</dt>
            <dd>{incident.location}</dd>
          </div>
        </dl>
        <h4>How this report reached us</h4>
        <p className="detail-route">{incident.path.map(deviceName).join(' → ')}</p>
        {showReports && (
          <div id="source-reports" className="source-reports">
            <h4>Source Report · 1</h4>
            <p>
              SOS / {incident.id} · Access Point {incident.node} · {reported}
            </p>
            <p>{incident.report}</p>
            <p>No other reports have been linked to this incident.</p>
          </div>
        )}
      </div>
    </section>
  )
}
