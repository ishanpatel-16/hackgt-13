import { deviceName, devicePurpose } from '../utils/networkLabels'
import type { NetworkNode } from '../types/network'

export default function NetworkStatus({ nodes }: { nodes: NetworkNode[] }) {
  const offline = nodes.filter(node => node.status === 'OFFLINE')
  return (
    <section className="panel network-panel" aria-labelledby="network-heading">
      <div className="network-heading"><h2 id="network-heading">Emergency Network</h2><p>Emergency message path</p>{offline.length > 0 && <p className="network-impact" role="status">Some emergency messages may not currently reach the responder station. {offline.map(node => deviceName(node.name)).join(', ')} stopped responding.</p>}</div>
      <ol className="network-path">
        {nodes.map(node => (
          <li key={node.id} className={`network-node ${node.status.toLowerCase()}`}>
            <div>
              <span className="device-purpose">{devicePurpose(node.name)}</span><strong>{node.name === 'Gateway' ? 'Gateway' : deviceName(node.name)}</strong>
              <span className="node-health"><span className="health-symbol" aria-hidden="true">{node.status === 'ONLINE' ? '●' : '×'}</span>{node.status === 'ONLINE' ? 'Online' : 'Offline'}</span>
              {node.rerouted && <span className="rerouted-label">Alternate route selected</span>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
