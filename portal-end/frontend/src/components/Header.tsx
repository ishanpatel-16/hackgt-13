import type { NetworkNode } from '../types/network'

export default function Header({ nodes }: { nodes: NetworkNode[] }) {
  const onlineCount = nodes.filter(node => node.status === 'ONLINE').length
  const healthy = nodes.length > 0 && onlineCount === nodes.length
  return (
    <header className="portal-header">
      <div className="portal-brand"><h1>net<span>0</span></h1><span className="portal-name">Responder Center</span></div>
      <div className="header-status">
        <span className={`mesh-status ${healthy ? '' : 'degraded'}`}><span className="status-dot" /> {healthy ? 'Mesh Online' : 'Mesh Degraded'}</span>
        <span className="node-count"><strong>{onlineCount}/{nodes.length}</strong> Nodes</span>
      </div>
    </header>
  )
}
