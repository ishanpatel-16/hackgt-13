import type { AiResponder, AiPriority, Incident } from '../types/incident'
import { formatRelativeTime } from './relativeTime'

export type IncidentSort = 'arrival' | 'priority'

export interface UserIncidentGroup {
  userId: number
  userName?: string
  reports: Incident[]
  newestArrivedAt: string
  maxPriority: AiPriority
  hasNew: boolean
  responders: AiResponder[]
}

/** Keep reports that include any of the selected responders. Empty selection = all. */
export function filterByResponders(
  incidents: Incident[],
  selected: readonly AiResponder[],
): Incident[] {
  if (selected.length === 0) return incidents
  const set = new Set(selected)
  return incidents.filter(incident => incident.aiResponders.some(r => set.has(r)))
}

function maxPriorityOf(reports: Incident[]): AiPriority {
  return reports.reduce<AiPriority>((max, report) => {
    return report.priority > max ? report.priority : max
  }, 1)
}

function newestTimestamp(reports: Incident[]): string {
  return reports.reduce((newest, report) => {
    return new Date(report.arrivedAt).getTime() > new Date(newest).getTime() ? report.arrivedAt : newest
  }, reports[0]?.arrivedAt ?? new Date(0).toISOString())
}

/** Group filtered incidents by userId. */
export function groupByUser(incidents: Incident[]): UserIncidentGroup[] {
  const map = new Map<number, Incident[]>()
  for (const incident of incidents) {
    const list = map.get(incident.userId)
    if (list) list.push(incident)
    else map.set(incident.userId, [incident])
  }

  const groups: UserIncidentGroup[] = []
  for (const [userId, reports] of map) {
    const sortedReports = [...reports].sort(
      (a, b) => new Date(b.arrivedAt).getTime() - new Date(a.arrivedAt).getTime(),
    )
    groups.push({
      userId,
      userName: reports.find(r => r.userName)?.userName,
      reports: sortedReports,
      newestArrivedAt: newestTimestamp(reports),
      maxPriority: maxPriorityOf(reports),
      hasNew: reports.some(r => r.status === 'NEW'),
      responders: [...new Set(reports.flatMap(r => r.aiResponders))],
    })
  }

  return groups
}

export function sortGroups(groups: UserIncidentGroup[], sort: IncidentSort): UserIncidentGroup[] {
  const copy = [...groups]
  if (sort === 'priority') {
    copy.sort((a, b) => {
      if (b.maxPriority !== a.maxPriority) return b.maxPriority - a.maxPriority
      return new Date(b.newestArrivedAt).getTime() - new Date(a.newestArrivedAt).getTime()
    })
  } else {
    copy.sort(
      (a, b) => new Date(b.newestArrivedAt).getTime() - new Date(a.newestArrivedAt).getTime(),
    )
  }
  return copy
}

export function displayName(userId: number, userName?: string): string {
  return userName?.trim() || `User ${userId}`
}

export function groupAgeLabel(group: UserIncidentGroup, now = Date.now()): string {
  return formatRelativeTime(group.newestArrivedAt, now)
}
