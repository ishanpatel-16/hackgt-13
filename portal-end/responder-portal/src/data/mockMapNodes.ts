export interface MapNode {
  id: string
  name: string
  label: string
  role: 'Access node' | 'Relay' | 'Gateway'
  x: number
  y: number
  connections: string[]
}

export const mockMapNodes: MapNode[] = [
  { id: '07', name: 'Node 07', label: '07', role: 'Access node', x: 325, y: 210, connections: ['Relay 02'] },
  { id: '12', name: 'Node 12', label: '12', role: 'Access node', x: 585, y: 150, connections: ['Relay 03'] },
  { id: '04', name: 'Node 04', label: '04', role: 'Access node', x: 505, y: 345, connections: ['Relay 03'] },
  { id: 'r02', name: 'Relay 02', label: 'R02', role: 'Relay', x: 260, y: 295, connections: ['Node 07', 'Relay 03'] },
  { id: 'r03', name: 'Relay 03', label: 'R03', role: 'Relay', x: 410, y: 290, connections: ['Relay 02', 'Node 12', 'Node 04', 'Gateway'] },
  { id: 'gw', name: 'Gateway', label: 'GW', role: 'Gateway', x: 675, y: 355, connections: ['Relay 03'] },
]
