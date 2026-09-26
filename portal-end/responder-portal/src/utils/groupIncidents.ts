import type { AiResponder, AiPriority, Incident } from '../types/incident'
import { formatRelativeTime } from './relativeTime'
import { parseServerTime } from './serverTime'

export type IncidentSort = 'arrival' | 'priority'

export interface UserIncidentGroup {
  userId: number
  userName?: string
  reports: Incident[]
  newestArrivedAt: string
  maxPriority: AiPriority | null
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

function timeMs(iso: string): number {
  return parseServerTime(iso) ?? 0
}

function maxPriorityOf(reports: Incident[]): AiPriority | null {
  return reports.reduce<AiPriority | null>((max, report) => {
    if (report.priority == null) return max
    if (max == null || report.priority > max) return report.priority
    return max
  }, null)
}

function newestTimestamp(reports: Incident[]): string {
  return reports.reduce((newest, report) => {
    return timeMs(report.arrivedAt) > timeMs(newest) ? report.arrivedAt : newest
  }, reports[0]?.arrivedAt ?? '')
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
      const priorityDelta = (b.maxPriority ?? 0) - (a.maxPriority ?? 0)
      if (priorityDelta !== 0) return priorityDelta
      return timeMs(b.newestArrivedAt) - timeMs(a.newestArrivedAt)
    })
  } else {
    copy.sort((a, b) => timeMs(b.newestArrivedAt) - timeMs(a.newestArrivedAt))
  }
  return copy
}

export function displayName(userId: number, userName?: string): string {
  return userName?.trim() || `User ${userId}`
}

export function groupAgeLabel(group: UserIncidentGroup, now = Date.now()): string {
  return formatRelativeTime(group.newestArrivedAt, now)
}
