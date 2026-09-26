import type { NetworkNode } from '../types/network'

export default function NetworkStatus({ nodes }: { nodes: NetworkNode[] }) {
  return (
    <section className="panel network-panel" aria-labelledby="network-heading">
      <div className="network-heading"><h2 id="network-heading">Mesh Network</h2><p>Global connectivity</p></div>
      <ol className="network-path">
        {nodes.map(node => (
          <li key={node.id} className={`network-node ${node.status.toLowerCase()}`}>
            <div>
              <strong>{node.name}</strong>
              <span className="node-health"><span className="health-symbol" aria-hidden="true">{node.status === 'ONLINE' ? '●' : '×'}</span>{node.status === 'ONLINE' ? 'Online' : 'Offline'}</span>
              {node.rerouted && <span className="rerouted-label">Rerouted</span>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
