export type AppView = 'home' | 'messages'

interface Props {
  view: AppView
  onChange: (view: AppView) => void
}

export default function NavRail({ view, onChange }: Props) {
  return (
    <nav className="nav-rail" aria-label="Primary">
      <button
        type="button"
        className={view === 'home' ? 'active' : ''}
        aria-current={view === 'home' ? 'page' : undefined}
        onClick={() => onChange('home')}
      >
        <span className="nav-icon" aria-hidden>
          ⌂
        </span>
        <span>Home</span>
      </button>
      <button
        type="button"
        className={view === 'messages' ? 'active' : ''}
        aria-current={view === 'messages' ? 'page' : undefined}
        onClick={() => onChange('messages')}
      >
        <span className="nav-icon" aria-hidden>
          ✉
        </span>
        <span>Messages</span>
      </button>
    </nav>
  )
}
