import { useState } from 'react'
import Header from './components/Header'
import IncidentQueue from './components/IncidentQueue'
import IncidentMap from './components/IncidentMap'
import IncidentDetails from './components/IncidentDetails'
import AgentBrief from './components/AgentBrief'
import NetworkStatus from './components/NetworkStatus'
import { mockIncidents, mockNetworkNodes, mockBrief } from './data/mockIncidents'
import NodeDetails from './components/NodeDetails'
import { mockMapNodes } from './data/mockMapNodes'
import MapPopup from './components/MapPopup'
import './App.css'

function App() {
  const [incidents, setIncidents] = useState(mockIncidents)
  const [selection, setSelection] = useState<{ kind: 'incident' | 'device'; id: string } | null>(null)
  const selectedId = selection?.kind === 'incident' ? selection.id : null
  const selectedNodeId = selection?.kind === 'device' ? selection.id : null
  const selectedNode = mockMapNodes.find(node => node.id === selectedNodeId)
  const selectedIncident = incidents.find(incident => incident.id === selectedId)

  function selectIncident(id: string) {
    setSelection({ kind: 'incident', id })
  }

  function acknowledgeIncident(id: string) {
    setIncidents(current => current.map(incident =>
      incident.id === id && incident.status === 'NEW' ? { ...incident, status: 'ACKNOWLEDGED' } : incident,
    ))
  }

  return (
    <div className="dashboard">
      <Header nodes={mockNetworkNodes} />
      <main className="dashboard-content">
        <div className="workspace">
          <IncidentQueue incidents={incidents} selectedId={selectedId} onSelect={selectIncident} />
          <IncidentMap nodes={mockNetworkNodes} incidents={incidents} selectedId={selectedId} selectedNodeId={selectedNodeId} onSelectNode={id => setSelection({ kind: 'device', id })} onSelectIncident={selectIncident}>
            {selection && <MapPopup selectionKey={`${selection.kind}-${selection.id}`} label={selectedIncident ? `${selectedIncident.type} incident details` : `${selectedNode?.name} device details`} onClose={() => setSelection(null)}>
              {selectedNode && <NodeDetails networkNodes={mockNetworkNodes} node={selectedNode} incidents={incidents} onSelectIncident={selectIncident} onClose={() => setSelection(null)} />}
              {selectedIncident && <IncidentDetails key={selectedId} incident={selectedIncident} onAcknowledge={acknowledgeIncident} />}
            </MapPopup>}
          </IncidentMap>
        </div>
        <AgentBrief brief={mockBrief} />
        <NetworkStatus nodes={mockNetworkNodes} />
        <footer className="dashboard-footer"><span>net0 · Offline emergency communication</span><span>Development preview · Mock data</span></footer>
      </main>
    </div>
  )
}

export default App
