import type { Incident } from '../types/incident'
import type { UserIncidentGroup } from '../utils/groupIncidents'
import { displayName, groupAgeLabel } from '../utils/groupIncidents'
import { formatRelativeTime } from '../utils/relativeTime'
import ResponderPills from './ResponderPills'
import PriorityMeter from './PriorityMeter'

interface Props {
  group: UserIncidentGroup
  now: number
  expanded: boolean
  selectedId: string | null
  onToggle: () => void
  onSelectReport: (id: string) => void
  onMessage: (userId: number) => void
  messaging: boolean
}

export default function UserIncidentGroupRow({
  group,
  now,
  expanded,
  selectedId,
  onToggle,
  onSelectReport,
  onMessage,
  messaging,
}: Props) {
  const name = displayName(group.userId, group.userName)
  const age = groupAgeLabel(group, now)

  return (
    <div className={`user-group ${expanded ? 'open' : ''} ${messaging ? 'messaging' : ''}`}>
      <div className="user-row">
        <button type="button" className="user-row-main" onClick={onToggle} aria-expanded={expanded}>
          <span className={`user-chevron ${expanded ? 'open' : ''}`} aria-hidden>
            <ChevronIcon />
          </span>
          <span className="user-identity">
            <strong>{name}</strong>
            <span className="user-meta">
              {group.reports.length} {group.reports.length === 1 ? 'report' : 'reports'}
              {age ? ` · ${age}` : ''}
            </span>
            <span className="user-priority-row">
              <PriorityMeter level={group.maxPriority} />
              <ResponderPills responders={group.responders} className="user-pills" />
            </span>
          </span>
          {group.hasNew && <span className="user-status new">NEW</span>}
        </button>
        <button
          type="button"
          className={`user-message-btn ${messaging ? 'active' : ''}`}
          aria-label={`Message ${name}`}
          title="Message"
          onClick={event => {
            event.stopPropagation()
            onMessage(group.userId)
          }}
        >
          <MessageIcon />
        </button>
      </div>
      {expanded && (
        <div className="user-reports">
          {group.reports.map(report => (
            <ReportRow
              key={report.id}
              report={report}
              now={now}
              selected={selectedId === report.id}
              onSelect={() => onSelectReport(report.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ReportRow({
  report,
  now,
  selected,
  onSelect,
}: {
  report: Incident
  now: number
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      data-report-id={report.id}
      className={`report-row ${selected ? 'selected' : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="report-row-top">
        {report.status === 'NEW' ? (
          <span className="report-status new">NEW</span>
        ) : (
          <span className="report-status-spacer" aria-hidden />
        )}
        <span className="report-body">
          <span className="report-place">{report.placeName ?? report.location}</span>
        </span>
        <PriorityMeter level={report.priority} />
        <span className="report-age">{formatRelativeTime(report.arrivedAt, now)}</span>
      </span>
      <ResponderPills responders={report.aiResponders} className="report-pills" />
    </button>
  )
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M4.25 2.5 7.75 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MessageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5.2L2.5 13.5v-9a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}
