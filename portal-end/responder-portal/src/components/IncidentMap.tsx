import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import type { FeatureCollection } from 'geojson'
import 'leaflet/dist/leaflet.css'
import type { Incident } from '../types/incident'
import type { RoutePoint } from '../types/agent'
import { buildStreetGraph, findStreetRoute, routePoints, type StreetGraph } from '../utils/streetRoute'

interface Props {
  incidents: Incident[]
  selectedId: string | null
  onSelectIncident: (id: string) => void
  route?: RoutePoint[]
  responderPosition?: L.LatLngTuple | null
  onRouteChange?: (route: RoutePoint[]) => void
}

interface IncidentCluster {
  incidents: Incident[]
  center: L.LatLngTuple
  radius: number
  critical: boolean
}

function coordinates(incident: Incident): L.LatLngTuple | null {
  const values = incident.location.split(',').map(Number)
  return values.length === 2 && values.every(Number.isFinite) && Math.abs(values[0]) <= 90 && Math.abs(values[1]) <= 180
    ? [values[0], values[1]]
    : null
}

function distanceMeters(left: L.LatLngTuple, right: L.LatLngTuple): number {
  const latScale = 111_000
  const lonScale = 111_000 * Math.cos((left[0] * Math.PI) / 180)
  return Math.hypot((right[0] - left[0]) * latScale, (right[1] - left[1]) * lonScale)
}

function clusterIncidents(incidents: Incident[]): IncidentCluster[] {
  const groups: Array<{ incidents: Incident[]; points: L.LatLngTuple[] }> = []
  incidents.forEach(incident => {
    const point = coordinates(incident)
    if (!point) return
    const existing = groups.find(group =>
      incident.clusterId
        ? group.incidents.some(candidate => candidate.clusterId === incident.clusterId)
        : group.points.some(candidate => distanceMeters(candidate, point) <= 340),
    )
    if (existing) {
      existing.incidents.push(incident)
      existing.points.push(point)
    } else {
      groups.push({ incidents: [incident], points: [point] })
    }
  })

  return groups
    .filter(group => group.incidents.length > 1)
    .map(group => {
      const center: L.LatLngTuple = [
        group.points.reduce((sum, point) => sum + point[0], 0) / group.points.length,
        group.points.reduce((sum, point) => sum + point[1], 0) / group.points.length,
      ]
      return {
        incidents: group.incidents,
        center,
        radius: Math.max(100, Math.min(300, Math.max(...group.points.map(point => distanceMeters(center, point))) + 75)),
        critical: group.incidents.some(incident => incident.priority >= 4 || incident.type === 'Fire' || incident.type === 'Trapped'),
      }
    })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] ?? character)
}

function clusterPopup(cluster: IncidentCluster): string {
  const people = cluster.incidents.reduce((sum, incident) => sum + incident.people, 0)
  const types = [...new Set(cluster.incidents.map(incident => incident.type))].join(' · ')
  const signals = cluster.incidents
    .map(incident => incident.aiSummary || incident.report)
    .filter(Boolean)
    .slice(0, 3)
    .map(signal => `<li>${escapeHtml(signal)}</li>`)
    .join('')
  return `<div class="cluster-popup-content">
    <span class="cluster-popup-kicker">Agent synthesis · ${cluster.incidents.length} reports</span>
    <strong>${people} ${people === 1 ? 'person' : 'people'} may need coordinated response</strong>
    <span class="cluster-popup-meta">${escapeHtml(types)} · P${Math.max(...cluster.incidents.map(incident => incident.priority))} highest priority</span>
    <ul>${signals || '<li>Reports share a nearby GPS area; verify conditions on arrival.</li>'}</ul>
    <em>Grouped by GPS proximity and report evidence.</em>
  </div>`
}

function leftChromeWidth(map: L.Map): number {
  const workspace = map.getContainer().closest('.workspace') as HTMLElement | null
  const queue = workspace?.querySelector('.queue-panel') as HTMLElement | null
  const peek = workspace?.querySelector('.report-detail-peek') as HTMLElement | null
  const queueW = queue?.getBoundingClientRect().width ?? 380
  const peekW = peek ? peek.getBoundingClientRect().width + 12 : 0
  return queueW + peekW + 24
}

function flyPinIntoView(map: L.Map, latlng: L.LatLngExpression, animate: boolean) {
  const zoom = Math.max(map.getZoom(), 16)
  const size = map.getSize()
  const left = leftChromeWidth(map)
  const visible = Math.max(160, size.x - left)
  const desiredX = left + visible * 0.55
  const projected = map.project(latlng, zoom)
  const centerPoint = L.point(projected.x - desiredX + size.x / 2, projected.y)
  const center = map.unproject(centerPoint, zoom)
  if (animate) {
    map.flyTo(center, zoom, { animate: true, duration: 0.35, easeLinearity: 0.35 })
  } else {
    map.setView(center, zoom, { animate: false })
  }
}

function markerSymbol(incident: Incident): string {
  return incident.type === 'Medical' ? '+' : incident.type === 'Fire' ? '♨' : incident.type === 'Trapped' ? '!' : '•'
}

function markerClasses(incident: Incident, selectedId: string | null): string {
  return `geo-marker sos ${incident.type.toLowerCase()} ${incident.status === 'NEW' ? 'new' : ''} ${selectedId === incident.id ? 'chosen' : ''}`.trim()
}

function routePointCoordinates(route: RoutePoint[] | undefined): L.LatLngTuple[] {
  return (route ?? []).map(point => [point.lat, point.lon] as L.LatLngTuple)
}

function responderIcon() {
  return L.divIcon({
    className: 'responder-marker-host',
    html: '<span class="responder-marker"><i></i></span>',
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  })
}

export default function IncidentMap({ incidents, selectedId, onSelectIncident, route, responderPosition, onRouteChange }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Map<string, { marker: L.Marker; button: HTMLButtonElement }>>(new Map())
  const layerRef = useRef<L.LayerGroup | null>(null)
  const clusterLayerRef = useRef<L.LayerGroup | null>(null)
  const routeLayerRef = useRef<L.LayerGroup | null>(null)
  const responderMarkerRef = useRef<L.Marker | null>(null)
  const routeChangeRef = useRef(onRouteChange)
  const lastRouteSignatureRef = useRef('')
  const selectRef = useRef(onSelectIncident)
  const selectedRef = useRef(selectedId)
  const firstSelect = useRef(true)
  const [streetGraph, setStreetGraph] = useState<StreetGraph | null>(null)
  const [mapError, setMapError] = useState(false)

  selectRef.current = onSelectIncident
  selectedRef.current = selectedId
  routeChangeRef.current = onRouteChange

  useEffect(() => {
    const map = L.map(host.current!, {
      center: [33.771, -84.387],
      zoom: 15,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      minZoom: 11,
      maxZoom: 19,
      bounceAtZoomLimits: false,
      zoomControl: false,
      preferCanvas: true,
    })
    mapRef.current = map
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    map.attributionControl.setPrefix(false)

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_3z1f_1_5d09fcb81bc5744792fbd5f9', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map)

    clusterLayerRef.current = L.layerGroup().addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    routeLayerRef.current = L.layerGroup().addTo(map)

    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}maps/atlanta.geojson`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw Error('Local map unavailable')
        return response.json()
      })
      .then((data: FeatureCollection) => {
        if (controller.signal.aborted) return
        setStreetGraph(buildStreetGraph(data))
        const overlay = {
          type: 'FeatureCollection' as const,
          features: data.features.filter(feature => {
            const p = feature.properties
            return Boolean(p?.highway || p?.building || p?.leisure)
          }),
        }
        L.geoJSON(overlay, {
          interactive: false,
          style: feature => {
            const p = feature?.properties
            if (p?.highway) {
              return { color: '#65727a', weight: p.highway === 'footway' || p.highway === 'path' ? 0.7 : 1.1, opacity: 0.34, fillOpacity: 0 }
            }
            return p?.leisure
              ? { color: '#3f6250', weight: 1, fillColor: '#203a2a', fillOpacity: 0.55 }
              : { color: '#58616c', weight: 0.4, fillColor: '#2c333c', fillOpacity: 0.7 }
          },
        }).addTo(map)
      })
      .catch(error => {
        if (error.name !== 'AbortError') setMapError(true)
      })

    const onResize = () => map.invalidateSize({ pan: false })
    onResize()
    const observer = new ResizeObserver(onResize)
    observer.observe(host.current!)
    return () => {
      controller.abort()
      observer.disconnect()
      map.remove()
      mapRef.current = null
      layerRef.current = null
      clusterLayerRef.current = null
      routeLayerRef.current = null
      responderMarkerRef.current = null
      markersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    const clusters = clusterLayerRef.current
    if (!clusters) return
    clusters.clearLayers()
    clusterIncidents(incidents).forEach(cluster => {
      const color = cluster.critical ? '#f36d62' : '#e7bd50'
      L.circle(cluster.center, {
        radius: cluster.radius,
        color,
        weight: 2,
        opacity: 0.9,
        fillColor: color,
        fillOpacity: cluster.critical ? 0.14 : 0.12,
        dashArray: cluster.critical ? '8 6' : '5 7',
        interactive: true,
      }).bindPopup(clusterPopup(cluster), { className: 'cluster-popup' }).addTo(clusters)

      L.marker(cluster.center, {
        icon: L.divIcon({
          className: 'cluster-badge-host',
          html: `<span class="cluster-badge ${cluster.critical ? 'critical' : 'watch'}"><b>${cluster.incidents.length}</b><small>AGENT GROUP</small></span>`,
          iconSize: [94, 42],
          iconAnchor: [47, 21],
        }),
        interactive: true,
      }).bindPopup(clusterPopup(cluster), { className: 'cluster-popup' }).addTo(clusters)
    })
  }, [incidents])

  // Build / refresh markers only when the incident list changes — not on selection.
  useEffect(() => {
    const map = mapRef.current
    const layers = layerRef.current
    if (!map || !layers) return

    const nextIds = new Set(incidents.map(i => i.id))
    for (const [id, entry] of markersRef.current) {
      if (!nextIds.has(id)) {
        layers.removeLayer(entry.marker)
        markersRef.current.delete(id)
      }
    }

    incidents.forEach(incident => {
      const point = coordinates(incident)
      if (!point) return
      const existing = markersRef.current.get(incident.id)
      if (existing) {
        const current = existing.marker.getLatLng()
        if (current.lat !== point[0] || current.lng !== point[1]) {
          existing.marker.setLatLng(point)
        }
        existing.button.className = markerClasses(incident, selectedRef.current)
        existing.button.textContent = markerSymbol(incident)
        existing.button.title = `${incident.type} SOS ${incident.id}, ${incident.people} people`
        existing.button.setAttribute('aria-label', existing.button.title)
        return
      }

      const button = document.createElement('button')
      button.type = 'button'
      button.className = markerClasses(incident, selectedRef.current)
      button.textContent = markerSymbol(incident)
      button.title = `${incident.type} SOS ${incident.id}, ${incident.people} people`
      button.setAttribute('aria-label', button.title)
      button.onclick = event => {
        event.stopPropagation()
        selectRef.current(incident.id)
      }
      const marker = L.marker(point, {
        icon: L.divIcon({ className: 'geo-marker-host', html: button, iconSize: [36, 36], iconAnchor: [18, 18] }),
        keyboard: false,
      }).addTo(layers)
      markersRef.current.set(incident.id, { marker, button })
    })
  }, [incidents])

  // Selection highlight only — no marker teardown.
  useEffect(() => {
    for (const [id, entry] of markersRef.current) {
      entry.button.classList.toggle('chosen', id === selectedId)
    }
  }, [selectedId, incidents])

  // Smooth pan when the selected report changes (not when only status updates).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedId) return
    const entry = markersRef.current.get(selectedId)
    if (!entry) return
    const point = entry.marker.getLatLng()
    const frame = window.requestAnimationFrame(() => {
      flyPinIntoView(map, point, !firstSelect.current)
      firstSelect.current = false
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selectedId])

  // Draw the AI's preferred responder corridor and keep the responder marker
  // moving in demo mode when browser geolocation is unavailable.
  useEffect(() => {
    const map = mapRef.current
    const routeLayer = routeLayerRef.current
    if (!map || !routeLayer) return
    routeLayer.clearLayers()
    if (responderMarkerRef.current) {
      map.removeLayer(responderMarkerRef.current)
      responderMarkerRef.current = null
    }

    const incident = incidents.find(item => item.id === selectedId)
      ?? [...incidents]
        .filter(item => coordinates(item))
        .sort((left, right) => right.priority - left.priority)[0]
    const suppliedPoints = routePointCoordinates(route)
    const target = incident ? coordinates(incident) : null
    const suppliedStart = responderPosition
      ?? suppliedPoints[0]
      ?? (target ? [target[0] + 0.0012, target[1] - 0.0012] as L.LatLngTuple : null)
    const path = streetGraph && suppliedStart && target
      ? findStreetRoute(streetGraph, suppliedStart, target)
      : []
    // Never fall back to a line between buildings. Until the local street
    // graph is ready, keep the route hidden rather than showing unsafe geometry.
    const routePath = path.length >= 2 ? path : (streetGraph ? suppliedPoints : [])
    if (routePath.length < 2) return

    const streetWaypoints = path.length >= 2 ? routePoints(path) : []
    if (streetWaypoints.length) {
      const signature = streetWaypoints.map(point => `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`).join('|')
      const suppliedSignature = suppliedPoints.map(point => `${point[0].toFixed(5)},${point[1].toFixed(5)}`).join('|')
      if (signature !== lastRouteSignatureRef.current || signature !== suppliedSignature) {
        lastRouteSignatureRef.current = signature
        routeChangeRef.current?.(streetWaypoints)
      }
    }

    L.polyline(routePath, {
      color: '#8de0af',
      weight: 5,
      opacity: 0.18,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(routeLayer)
    L.polyline(routePath, {
      color: '#b8f2c5',
      weight: 2,
      opacity: 0.95,
      dashArray: '8 9',
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(routeLayer)

    routePath.slice(1, -1).forEach(point => {
      L.circleMarker(point, {
        radius: 4,
        color: '#d9f7df',
        weight: 1,
        fillColor: '#8de0af',
        fillOpacity: 1,
      }).addTo(routeLayer)
    })

    const destination = routePath[routePath.length - 1]
    L.circleMarker(destination, {
      radius: 10,
      color: '#f6d48a',
      weight: 2,
      fillColor: '#c68b46',
      fillOpacity: 0.22,
    }).addTo(routeLayer)

    const marker = L.marker(routePath[0], { icon: responderIcon(), zIndexOffset: 900 }).addTo(routeLayer)
    responderMarkerRef.current = marker
    let frame = 0
    let progress = 0
    let last = performance.now()
    const animate = (now: number) => {
      const elapsed = now - last
      last = now
      if (!responderPosition) {
        progress = (progress + elapsed / 18000) % 1
        const segmentFloat = progress * (routePath.length - 1)
        const segment = Math.min(routePath.length - 2, Math.floor(segmentFloat))
        const segmentProgress = segmentFloat - segment
        const from = routePath[segment]
        const to = routePath[segment + 1]
        marker.setLatLng([
          from[0] + (to[0] - from[0]) * segmentProgress,
          from[1] + (to[1] - from[1]) * segmentProgress,
        ])
      } else {
        marker.setLatLng(responderPosition)
      }
      frame = window.requestAnimationFrame(animate)
    }
    frame = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(frame)
  }, [incidents, route, selectedId, responderPosition, streetGraph])

  function fitIncidents() {
    const points = incidents.flatMap(incident => {
      const point = coordinates(incident)
      return point ? [point] : []
    })
    if (!points.length || !mapRef.current) return
    const map = mapRef.current
    const left = leftChromeWidth(map)
    map.fitBounds(L.latLngBounds(points).pad(0.15), {
      paddingTopLeft: [left, 32],
      paddingBottomRight: [32, 32],
      animate: true,
      duration: 0.35,
    })
  }

  const clusterCount = clusterIncidents(incidents).length

  return (
    <section className="panel map-panel geographic-panel" aria-label="Incident map">
      <div className="geo-canvas" ref={host} />
      <button type="button" className="fit-network" onClick={fitIncidents} aria-label="Fit incidents" title="Fit incidents">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
          <path d="M2 6V2h4M12 2h4v4M16 12v4h-4M6 16H2v-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="9" cy="9" r="2.25" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      {mapError && <p className="geo-warning">Local map could not load. Emergency markers remain available.</p>}
      {route?.length || incidents.some(incident => incident.id === selectedId && coordinates(incident)) ? (
        <div className="map-route-legend" aria-label="Responder route legend">
          <span className="map-route-line" />
          <span><strong>Best street route</strong> · streets + accessible ways</span>
          <span className="map-responder-key"><i /> {responderPosition ? 'Live position' : 'Demo movement'}</span>
        </div>
      ) : null}
      {clusterCount > 0 && (
        <div className="cluster-legend" aria-label="Incident cluster legend">
          <span><i className="watch" /> Linked reports</span>
          <span><i className="critical" /> Critical cluster</span>
          <strong>{clusterCount} AI-linked area{clusterCount === 1 ? '' : 's'}</strong>
        </div>
      )}
    </section>
  )
}
