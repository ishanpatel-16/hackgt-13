import { getPrimaryResponse } from '../utils/primaryResponse'
import type { Incident } from '../types/incident'
import EmergencyIcon from './EmergencyIcon'

interface Props {
  incidents: Incident[]
  selectedId: string | null
  onSelect: (id: string) => void
}

export default function IncidentQueue({ incidents, selectedId, onSelect }: Props) {
  return (
    <section className="panel queue-panel" aria-labelledby="queue-heading">
      <div className="panel-heading"><h2 id="queue-heading">Incidents</h2><span className="small-label">{incidents.length} active</span></div>
      <p className="queue-caption">Incoming reports · newest first</p>
      <div className="incident-feed">
        {incidents.map(incident => (
          <button key={incident.id} className={`incident ${incident.type.toLowerCase()} ${selectedId === incident.id ? 'selected' : ''}`} aria-pressed={selectedId === incident.id} onClick={() => onSelect(incident.id)}>
            <span className="incident-top"><span className={`incident-status ${incident.status.toLowerCase()}`}>{incident.status}</span><span className="incident-id">{incident.age}</span></span>
            <span className="incident-title"><span className="emergency-icon"><EmergencyIcon type={incident.type} /></span><span className="queue-emergency"><strong>{incident.type}</strong><span>{incident.people} {incident.people === 1 ? 'person' : 'people'}</span></span><span className="small-label" aria-label={`Primary response: ${getPrimaryResponse(incident.type)}`}>{getPrimaryResponse(incident.type)}</span></span>
            <span className="incident-details"><span><strong>{incident.placeName ?? incident.location}</strong><br />{incident.locationDetail && <>{incident.locationDetail}<br /></>}<small>SOS / {incident.id} · via Access Point {incident.node}</small></span></span>
          </button>
        ))}
      </div>
      <p className="queue-note">Select a report to inspect its location and details.</p>
    </section>
  )
}
