import type { NetworkNode } from '../types/network'

export default function Header({ nodes }: { nodes: NetworkNode[] }) {
  const onlineCount = nodes.filter(node => node.status === 'ONLINE').length
  const healthy = nodes.length > 0 && onlineCount === nodes.length
  const hasAny = nodes.length > 0
  const statusClass = !hasAny ? 'down' : healthy ? 'up' : 'degraded'
  const label = !hasAny ? 'No nodes' : `${onlineCount}/${nodes.length} nodes`

  return (
    <header className="portal-header">
      <div className="portal-brand">
        <h1>
          net<span>0</span>
        </h1>
        <span className="portal-name">Responder Center</span>
      </div>
      <div className="header-status">
        <span className={`node-status ${statusClass}`}>
          <span className="status-dot" aria-hidden />
          {label}
        </span>
      </div>
    </header>
  )
}
