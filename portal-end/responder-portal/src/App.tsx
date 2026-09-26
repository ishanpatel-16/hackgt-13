import { useMemo, useState } from 'react'
import Header from './components/Header'
import IncidentQueue from './components/IncidentQueue'
import IncidentMap from './components/IncidentMap'
import NavRail, { type AppView } from './components/NavRail'
import MessagesView from './views/MessagesView'
import { useLivePortal } from './hooks/useLivePortal'
import type { AiResponder } from './types/incident'
import { filterByResponders } from './utils/groupIncidents'
import './App.css'

function App() {
  const { incidents, nodes, loading, error, link, acknowledge } = useLivePortal()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedFilters, setSelectedFilters] = useState<AiResponder[]>([])
  const [view, setView] = useState<AppView>('home')
  const [peekUserId, setPeekUserId] = useState<number | null>(null)
  const [messagesUserId, setMessagesUserId] = useState<number | null>(null)

  const filteredIncidents = useMemo(
    () => filterByResponders(incidents, selectedFilters),
    [incidents, selectedFilters],
  )

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
    void acknowledge(id)
  }

  function acknowledgeIncident(id: string) {
    void acknowledge(id)
  }

  function changeFilters(next: AiResponder[]) {
    setSelectedFilters(next)
    setSelectedId(current => {
      if (current == null) return current
      const visible = filterByResponders(incidents, next)
      return visible.some(incident => incident.id === current) ? current : null
    })
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

  const emptyMessage =
    incidents.length > 0
      ? 'No reports match these filters.'
      : error
        ? error
        : loading
          ? 'Connecting to the portal server…'
          : 'No reports yet. New emergencies will appear here.'

  return (
    <div className="app-shell">
      <NavRail view={view} onChange={changeView} />
      <div className="dashboard">
        <Header nodes={nodes} link={link} />
        <main className={`dashboard-content ${view === 'messages' ? 'messages-mode' : ''}`}>
          {view === 'home' ? (
            <div className="workspace">
              <IncidentQueue
                incidents={incidents}
                filteredIncidents={filteredIncidents}
                selectedFilters={selectedFilters}
                onFiltersChange={changeFilters}
                selectedId={selectedId}
                onSelect={selectIncident}
                onClearSelect={() => setSelectedId(null)}
                onAcknowledge={acknowledgeIncident}
                peekUserId={peekUserId}
                onPeekUser={setPeekUserId}
                onOpenMessages={openMessages}
                notice={error && incidents.length > 0 ? error : null}
                emptyMessage={emptyMessage}
              />
              <IncidentMap
                incidents={filteredIncidents}
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
