import type { Incident } from '../types/incident'
import type { NetworkNode } from '../types/network'
import type { CoordinationBrief } from '../types/brief'

export const mockIncidents: Incident[] = [
  { id: '01', type: 'Medical', people: 3, node: '07', age: '30 sec ago', reported: '30 seconds ago', status: 'NEW', location: '33.77, -84.39', report: 'Person injured and unable to move.', path: ['Node 07', 'Relay 02', 'Relay 03', 'Gateway'], x: 325, y: 210 },
  { id: '02', type: 'Fire', people: 2, node: '12', age: '2 min ago', reported: '2 minutes ago', status: 'NEW', location: '33.78, -84.38', report: 'Smoke and flames visible inside the building. Two people need help.', path: ['Node 12', 'Relay 03', 'Gateway'], x: 585, y: 150 },
  { id: '03', type: 'Trapped', people: 1, node: '04', age: '4 min ago', reported: '4 minutes ago', status: 'ACKNOWLEDGED', location: '33.76, -84.38', report: 'One person trapped inside. Exit is blocked by debris.', path: ['Node 04', 'Relay 03', 'Gateway'], x: 505, y: 345 },
]

export const mockNetworkNodes: NetworkNode[] = ['Access Node 07', 'Relay 02', 'Relay 03', 'Gateway'].map(name => ({ id: name, name, status: 'ONLINE' }))

export const mockBrief: CoordinationBrief = {
  reportCount: 3,
  insight: '3 nearby reports may describe the same emergency.',
  highlights: ['6 civilians reported', 'Fire + trapped occupants', 'Node 07 reachable'],
  summary: 'Reports from Nodes 07, 12, and 04 may overlap. Fire and trapped occupants have both been reported. Node 07 remains reachable through Relay 03. The number of unique civilians is unverified.',
  signals: ['Fire report · Node 12 · 2 min ago', 'Trapped report · Node 04 · 4 min ago', 'Mesh route operational'],
  verify: ['Whether reports describe the same physical incident', 'Exact number of affected civilians', 'Whether additional occupants remain inside'],
}
