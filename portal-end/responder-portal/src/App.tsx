import { useMemo, useState } from 'react'
import Header from './components/Header'
import IncidentQueue from './components/IncidentQueue'
import IncidentMap from './components/IncidentMap'
import NavRail, { type AppView } from './components/NavRail'
import MessagesView from './views/MessagesView'
import { mockIncidents, mockNetworkNodes } from './data/mockIncidents'
import './App.css'

function App() {
  const [incidents, setIncidents] = useState(mockIncidents)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<AppView>('home')
  const [peekUserId, setPeekUserId] = useState<number | null>(null)
  const [messagesUserId, setMessagesUserId] = useState<number | null>(null)

  const seedUsers = useMemo(() => {
    const map = new Map<number, string | undefined>()
    for (const incident of incidents) {
      if (!map.has(incident.userId)) map.set(incident.userId, incident.userName)
    }
    return map
  }, [incidents])

  function selectIncident(id: string) {
    setSelectedId(id)
    setPeekUserId(null)
    setIncidents(current =>
      current.map(incident =>
        incident.id === id && incident.status === 'NEW' ? { ...incident, status: 'ACKNOWLEDGED' } : incident,
      ),
    )
  }

  function acknowledgeIncident(id: string) {
    setIncidents(current =>
      current.map(incident =>
        incident.id === id && incident.status === 'NEW' ? { ...incident, status: 'ACKNOWLEDGED' } : incident,
      ),
    )
  }

  function openMessages(userId: number) {
    setPeekUserId(null)
    setMessagesUserId(userId)
    setView('messages')
  }

  function changeView(next: AppView) {
    setView(next)
    if (next === 'messages') {
      setPeekUserId(null)
      if (messagesUserId == null && seedUsers.size) {
        setMessagesUserId([...seedUsers.keys()][0])
      }
    }
  }

  return (
    <div className="app-shell">
      <NavRail view={view} onChange={changeView} />
      <div className="dashboard">
        <Header nodes={mockNetworkNodes} />
        <main className={`dashboard-content ${view === 'messages' ? 'messages-mode' : ''}`}>
          {view === 'home' ? (
            <div className="workspace">
              <IncidentQueue
                incidents={incidents}
                selectedId={selectedId}
                onSelect={selectIncident}
                onClearSelect={() => setSelectedId(null)}
                onAcknowledge={acknowledgeIncident}
                peekUserId={peekUserId}
                onPeekUser={setPeekUserId}
                onOpenMessages={openMessages}
              />
              <IncidentMap
                incidents={incidents}
                selectedId={selectedId}
                onSelectIncident={selectIncident}
              />
            </div>
          ) : (
            <MessagesView
              incidents={incidents}
              selectedUserId={messagesUserId}
              onSelectUser={setMessagesUserId}
            />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
