import { useState } from 'react'
import Header from './components/Header'
import IncidentQueue from './components/IncidentQueue'
import IncidentMap from './components/IncidentMap'
import IncidentDetails from './components/IncidentDetails'
import AgentBrief from './components/AgentBrief'
import NetworkStatus from './components/NetworkStatus'
import { mockIncidents, mockNetworkNodes, mockBrief } from './data/mockIncidents'
import './App.css'

function App() {
  const [incidents, setIncidents] = useState(mockIncidents)
  const [selectedId, setSelectedId] = useState(mockIncidents[0].id)
  const selectedIncident = incidents.find(incident => incident.id === selectedId)!

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
          <IncidentQueue incidents={incidents} selectedId={selectedId} onSelect={setSelectedId} />
          <IncidentMap incidents={incidents} selectedId={selectedId} />
          <IncidentDetails key={selectedId} incident={selectedIncident} onAcknowledge={acknowledgeIncident} />
        </div>
        <AgentBrief brief={mockBrief} />
        <NetworkStatus nodes={mockNetworkNodes} />
        <footer className="dashboard-footer"><span>net0 · Offline emergency communication</span><span>Development preview · Mock data</span></footer>
      </main>
    </div>
  )
}

export default App
