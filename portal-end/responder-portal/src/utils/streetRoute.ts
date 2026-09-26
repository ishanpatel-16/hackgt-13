import type { FeatureCollection, LineString } from 'geojson'
import type L from 'leaflet'
import type { RoutePoint } from '../types/agent'

type Coordinate = L.LatLngTuple

interface Edge {
  to: string
  cost: number
}

export interface StreetGraph {
  coordinates: Map<string, Coordinate>
  edges: Map<string, Edge[]>
}

const CLOSED_HIGHWAYS = new Set(['abandoned', 'construction', 'corridor', 'motorway', 'motorway_link', 'planned', 'proposed', 'raceway', 'trunk', 'trunk_link'])

function nodeKey(point: Coordinate): string {
  return `${point[0].toFixed(6)},${point[1].toFixed(6)}`
}

function distance(a: Coordinate, b: Coordinate): number {
  const latScale = 111_000
  const lonScale = 111_000 * Math.cos((a[0] * Math.PI) / 180)
  return Math.hypot((b[0] - a[0]) * latScale, (b[1] - a[1]) * lonScale)
}

function edgeMultiplier(highway: string): number {
  if (highway === 'steps') return 3
  if (highway === 'footway' || highway === 'path' || highway === 'pedestrian' || highway === 'cycleway') return 1.35
  if (highway === 'service' || highway === 'track') return 1.15
  return 1
}

function addEdge(graph: StreetGraph, from: string, to: string, cost: number) {
  const edges = graph.edges.get(from) ?? []
  if (!edges.some(edge => edge.to === to)) edges.push({ to, cost })
  graph.edges.set(from, edges)
}

export function buildStreetGraph(data: FeatureCollection): StreetGraph {
  const graph: StreetGraph = { coordinates: new Map(), edges: new Map() }
  for (const feature of data.features) {
    const highway = typeof feature.properties?.highway === 'string' ? feature.properties.highway : ''
    if (!highway || CLOSED_HIGHWAYS.has(highway) || feature.geometry.type !== 'LineString') continue
    const coordinates = (feature.geometry as LineString).coordinates
      .map(([lon, lat]) => [lat, lon] as Coordinate)
      .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon))
    for (let index = 1; index < coordinates.length; index += 1) {
      const from = coordinates[index - 1]
      const to = coordinates[index]
      const fromKey = nodeKey(from)
      const toKey = nodeKey(to)
      const cost = distance(from, to) * edgeMultiplier(highway)
      graph.coordinates.set(fromKey, from)
      graph.coordinates.set(toKey, to)
      addEdge(graph, fromKey, toKey, cost)
      addEdge(graph, toKey, fromKey, cost)
    }
  }
  return graph
}

function nearestNode(graph: StreetGraph, point: Coordinate): string | null {
  let nearest: string | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const [key, coordinate] of graph.coordinates) {
    const currentDistance = distance(point, coordinate)
    if (currentDistance < nearestDistance) {
      nearest = key
      nearestDistance = currentDistance
    }
  }
  return nearest
}

class MinHeap {
  private values: Array<{ key: string; cost: number }> = []

  push(value: { key: string; cost: number }) {
    this.values.push(value)
    let index = this.values.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.values[parent].cost <= value.cost) break
      this.values[index] = this.values[parent]
      index = parent
    }
    this.values[index] = value
  }

  pop(): { key: string; cost: number } | undefined {
    if (!this.values.length) return undefined
    const first = this.values[0]
    const last = this.values.pop()!
    if (this.values.length) {
      let index = 0
      while (true) {
        const left = index * 2 + 1
        const right = left + 1
        if (left >= this.values.length) break
        const child = right < this.values.length && this.values[right].cost < this.values[left].cost ? right : left
        if (this.values[child].cost >= last.cost) break
        this.values[index] = this.values[child]
        index = child
      }
      this.values[index] = last
    }
    return first
  }
}

export function findStreetRoute(graph: StreetGraph, start: Coordinate, end: Coordinate): Coordinate[] {
  const startKey = nearestNode(graph, start)
  const endKey = nearestNode(graph, end)
  if (!startKey || !endKey) return []
  const distances = new Map<string, number>([[startKey, 0]])
  const previous = new Map<string, string>()
  const queue = new MinHeap()
  queue.push({ key: startKey, cost: 0 })

  while (true) {
    const current = queue.pop()
    if (!current) break
    if (current.key === endKey) break
    if (current.cost !== distances.get(current.key)) continue
    for (const edge of graph.edges.get(current.key) ?? []) {
      const nextCost = current.cost + edge.cost
      if (nextCost < (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.to, nextCost)
        previous.set(edge.to, current.key)
        queue.push({ key: edge.to, cost: nextCost })
      }
    }
  }

  if (!distances.has(endKey)) return []
  const keys = [endKey]
  while (keys[0] !== startKey) {
    const parent = previous.get(keys[0])
    if (!parent) return []
    keys.unshift(parent)
  }
  return [start, ...keys.map(key => graph.coordinates.get(key)!), end]
}

export function routePoints(path: Coordinate[]): RoutePoint[] {
  if (path.length < 2) return []
  const selected = [path[0]]
  const interiorCount = Math.min(5, Math.max(1, path.length - 2))
  for (let index = 1; index <= interiorCount; index += 1) {
    const sourceIndex = Math.round((index * (path.length - 1)) / (interiorCount + 1))
    selected.push(path[sourceIndex])
  }
  selected.push(path[path.length - 1])
  return selected.map((point, index) => ({
    lat: point[0],
    lon: point[1],
    label: index === 0 ? 'Responder position' : index === selected.length - 1 ? 'Civilian signal' : 'Accessible street',
    kind: index === 0 ? 'responder' : index === selected.length - 1 ? 'civilian' : 'waypoint',
  }))
}
