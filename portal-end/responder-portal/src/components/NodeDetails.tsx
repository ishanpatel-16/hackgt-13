import { deviceName } from '../utils/networkLabels'
import type { NetworkNode } from '../types/network'
import type { Incident } from '../types/incident'
import type { MapNode } from '../data/mockMapNodes'

interface Props {
  networkNodes: NetworkNode[]
  node: MapNode
  incidents: Incident[]
  onSelectIncident: (id: string) => void
  onClose: () => void
}

export default function NodeDetails({ node, networkNodes, incidents, onSelectIncident, onClose }: Props) {
  const reports = incidents.filter(incident => incident.path.includes(node.name))
  const status = networkNodes.find(item => deviceName(item.name) === deviceName(node.name))?.status
  const purpose = node.role === 'Access node' ? 'Allows nearby civilians to connect to Net0 and send emergency requests.' : node.role === 'Relay' ? 'Passes emergency messages between nearby Net0 devices.' : 'Receives emergency messages from the Net0 network and delivers them to this responder center.'
  const activeCount = reports.filter(report => report.status !== 'RESOLVED').length
  return (
    <section className="panel details-panel" aria-labelledby="node-details-heading">
      <div className="panel-heading"><h2 id="node-details-heading">Device Details</h2><button className="reports-button node-close" onClick={onClose}>Close details</button></div>
      <div className="details-body">
        <h3 className="node-detail-name">{deviceName(node.name)}</h3>
        <p className={status === 'ONLINE' ? 'node-health' : 'network-impact'}>{status === 'ONLINE' ? '● Operating normally' : status === 'OFFLINE' ? 'Device stopped responding. Some emergency messages may not currently reach the responder station.' : 'Device status unavailable'}</p>
        <h4 className="device-section-title">What this device does</h4><p className="detail-route">{purpose}</p>
        <h4>Connected to</h4><p className="detail-route">{node.connections.map(deviceName).join(' · ')}</p>
        <h4>Emergency traffic</h4><p className="detail-route">{activeCount} active {activeCount === 1 ? 'report lists' : 'reports list'} this device in its delivery path.</p>
        <details className="technical-details"><summary>Technical details</summary><p>Device ID: {node.id} · {node.name}</p><p>Role: {node.role}</p><p>Neighbors: {node.connections.join(' · ')}</p></details>
        <h4>{node.role === 'Access node' ? 'Emergency requests from here' : 'Emergency requests passed through here'}</h4>
        <div className="node-reports">{reports.map(incident => <button key={incident.id} className={`incident ${incident.type.toLowerCase()}`} onClick={() => onSelectIncident(incident.id)}><span className="incident-top"><strong>{incident.type}</strong><span className={`incident-status ${incident.status.toLowerCase()}`}>{incident.status}</span></span><span>{incident.people} {incident.people === 1 ? 'person' : 'people'} · Access Point {incident.node}</span><span className="incident-details">SOS / {incident.id} · {incident.arrivedAt} →</span></button>)}</div>
        {reports.length === 0 && <p>No reports associated with this device.</p>}
      </div>
    </section>
  )
}
