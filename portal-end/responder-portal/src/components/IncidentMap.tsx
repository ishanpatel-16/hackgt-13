import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import type { FeatureCollection } from 'geojson'
import 'leaflet/dist/leaflet.css'
import type { AiResponder, Incident } from '../types/incident'
import { emergencyIconHtml } from './EmergencyIcon'
import { AI_RESPONDERS, RESPONDER_COLOR, RESPONDER_LABEL, RESPONDER_SHORT } from '../utils/responders'

interface Props {
  incidents: Incident[]
  selectedId: string | null
  onSelectIncident: (id: string) => void
}

interface IncidentCluster {
  id: string
  incidents: Incident[]
  center: L.LatLngTuple
  radius: number
  critical: boolean
}

function coordinates(incident: Incident): L.LatLngTuple | null {
  if (
    incident.lat != null &&
    incident.lon != null &&
    Number.isFinite(incident.lat) &&
    Number.isFinite(incident.lon) &&
    Math.abs(incident.lat) <= 90 &&
    Math.abs(incident.lon) <= 180
  ) {
    return [incident.lat, incident.lon]
  }
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
  const groups = new Map<string, { incidents: Incident[]; points: L.LatLngTuple[] }>()
  incidents.forEach(incident => {
    const point = coordinates(incident)
    if (!point || !incident.clusterId) return
    const existing = groups.get(incident.clusterId)
    if (existing) {
      existing.incidents.push(incident)
      existing.points.push(point)
    } else {
      groups.set(incident.clusterId, { incidents: [incident], points: [point] })
    }
  })

  return [...groups.entries()]
    .filter(([, group]) => group.incidents.length > 1)
    .map(([id, group]) => {
      const center: L.LatLngTuple = [
        group.points.reduce((sum, point) => sum + point[0], 0) / group.points.length,
        group.points.reduce((sum, point) => sum + point[1], 0) / group.points.length,
      ]
      return {
        id,
        incidents: group.incidents,
        center,
        radius: Math.max(100, Math.min(300, Math.max(...group.points.map(point => distanceMeters(center, point))) + 75)),
        critical: group.incidents.some(
          incident => (incident.priority ?? 0) >= 4 || incident.type === 'Fire' || incident.type === 'Trapped',
        ),
      }
    })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] ?? character)
}

/** Union of per-report AI responders already on cluster members — no Gemini re-tag. */
function clusterRespondersFromIncidents(incidents: Incident[]): AiResponder[] {
  const seen = new Set<AiResponder>()
  for (const incident of incidents) {
    for (const responder of incident.aiResponders) seen.add(responder)
  }
  return AI_RESPONDERS.filter(responder => seen.has(responder))
}

function responderPillsHtml(responders: AiResponder[]): string {
  if (!responders.length) {
    return '<span class="cluster-popup-meta">Responder tags pending</span>'
  }
  const pills = responders.map(responder => {
    const color = RESPONDER_COLOR[responder]
    return `<span class="responder-pill" title="${escapeHtml(RESPONDER_LABEL[responder])}" style="background:${color.bg};color:${color.fg}">${escapeHtml(RESPONDER_SHORT[responder])}</span>`
  }).join('')
  return `<div class="responder-pills cluster-popup-pills">${pills}</div>`
}

/** Anchor on the northern edge of the circle so the popup sits immediately above it. */
function clusterPopupAnchor(center: L.LatLngTuple, radiusMeters: number): L.LatLngTuple {
  return [center[0] + radiusMeters / 111_000, center[1]]
}

function clusterPopup(cluster: IncidentCluster): string {
  const people = cluster.incidents.reduce((sum, incident) => sum + incident.people, 0)
  const summary =
    cluster.incidents.find(incident => incident.clusterSummary)?.clusterSummary
    || cluster.incidents.find(incident => incident.aiSummary)?.aiSummary
    || 'Nearby reports share this area.'
  const responders = clusterRespondersFromIncidents(cluster.incidents)
  return `<div class="cluster-popup-content">
    <span class="cluster-popup-kicker">${cluster.incidents.length} linked reports</span>
    <strong>${escapeHtml(summary)}</strong>
    <span class="cluster-popup-meta">${people} ${people === 1 ? 'person' : 'people'} reported</span>
    ${responderPillsHtml(responders)}
  </div>`
}

function clusterSignature(cluster: IncidentCluster): string {
  const responders = clusterRespondersFromIncidents(cluster.incidents).join(',')
  const summary =
    cluster.incidents.find(incident => incident.clusterSummary)?.clusterSummary
    || cluster.incidents.find(incident => incident.aiSummary)?.aiSummary
    || ''
  const people = cluster.incidents.reduce((sum, incident) => sum + incident.people, 0)
  return [
    cluster.id,
    cluster.incidents.length,
    cluster.center[0].toFixed(5),
    cluster.center[1].toFixed(5),
    cluster.radius,
    cluster.critical ? 1 : 0,
    people,
    summary,
    responders,
  ].join('|')
}

function leftChromeWidth(map: L.Map): number {
  const workspace = map.getContainer().closest('.workspace') as HTMLElement | null
  const queue = workspace?.querySelector('.queue-panel') as HTMLElement | null
  const peek = workspace?.querySelector('.report-detail-peek') as HTMLElement | null
  const queueW = queue?.getBoundingClientRect().width ?? 380
  const peekW = peek ? peek.getBoundingClientRect().width + 12 : 0
  return queueW + peekW + 24
}

const PIN_FOCUS_ZOOM = 17.5
const CLUSTER_FOCUS_ZOOM = 17.25
/** Vertical room reserved above the cluster for the info popup. */
const CLUSTER_POPUP_TOP_PAD = 150

function flyPinIntoView(
  map: L.Map,
  latlng: L.LatLngExpression,
  animate: boolean,
  options?: { zoom?: number; topPad?: number },
) {
  const zoom = Math.max(map.getZoom(), options?.zoom ?? PIN_FOCUS_ZOOM)
  const size = map.getSize()
  const left = leftChromeWidth(map)
  const visible = Math.max(160, size.x - left)
  const desiredX = left + visible * 0.55
  // Shift the target down so content above it (cluster popup) stays in frame.
  const topPad = options?.topPad ?? 0
  const desiredY = size.y / 2 + topPad / 2
  const projected = map.project(latlng, zoom)
  const centerPoint = L.point(
    projected.x - desiredX + size.x / 2,
    projected.y - desiredY + size.y / 2,
  )
  const center = map.unproject(centerPoint, zoom)
  if (animate) {
    map.flyTo(center, zoom, { animate: true, duration: 0.35, easeLinearity: 0.35 })
  } else {
    map.setView(center, zoom, { animate: false })
  }
}

function markerTitle(incident: Incident): string {
  const sos = incident.msgId != null ? incident.msgId : incident.id
  const people = incident.people > 0 ? `${incident.people} people` : 'people unknown'
  return `${incident.type} SOS ${sos}, ${people}`
}

function markerClasses(incident: Incident, selectedId: string | null): string {
  return `geo-marker sos ${incident.type.toLowerCase()} ${incident.status === 'NEW' ? 'new' : ''} ${selectedId === incident.id ? 'chosen' : ''}`.trim()
}

export default function IncidentMap({ incidents, selectedId, onSelectIncident }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Map<string, { marker: L.Marker; button: HTMLButtonElement }>>(new Map())
  const layerRef = useRef<L.LayerGroup | null>(null)
  const clusterLayerRef = useRef<L.LayerGroup | null>(null)
  const clusterCirclesRef = useRef<Map<string, { circle: L.Circle; signature: string; popup: L.Popup }>>(new Map())
  const openClusterIdRef = useRef<string | null>(null)
  const savedViewRef = useRef<{ center: L.LatLng; zoom: number } | null>(null)
  const savedClusterViewRef = useRef<{ center: L.LatLng; zoom: number } | null>(null)
  const suppressRestoreRef = useRef(false)
  const selectRef = useRef(onSelectIncident)
  const selectedRef = useRef(selectedId)
  const firstSelect = useRef(true)
  const didFit = useRef(false)
  const [mapError, setMapError] = useState(false)

  selectRef.current = onSelectIncident
  selectedRef.current = selectedId

  function captureView(map: L.Map) {
    if (savedViewRef.current) return
    savedViewRef.current = { center: map.getCenter(), zoom: map.getZoom() }
  }

  function restoreView(map: L.Map) {
    const saved = savedViewRef.current
    if (!saved) return
    savedViewRef.current = null
    map.flyTo(saved.center, saved.zoom, { animate: true, duration: 0.35, easeLinearity: 0.35 })
  }

  function restoreViewIfIdle(map: L.Map) {
    if (suppressRestoreRef.current) return
    if (selectedRef.current != null || openClusterIdRef.current != null) return
    restoreView(map)
  }

  function restoreClusterView(map: L.Map) {
    const saved = savedClusterViewRef.current
    savedClusterViewRef.current = null
    if (!saved || suppressRestoreRef.current) return
    map.flyTo(saved.center, saved.zoom, { animate: true, duration: 0.35, easeLinearity: 0.35 })
  }

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

    map.on('popupclose', event => {
      for (const [id, entry] of clusterCirclesRef.current) {
        if (entry.popup !== event.popup) continue
        openClusterIdRef.current = null
        restoreClusterView(map)
        break
      }
    })

    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}maps/atlanta.geojson`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw Error('Local map unavailable')
        return response.json()
      })
      .then((data: FeatureCollection) => {
        if (controller.signal.aborted) return
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
      clusterCirclesRef.current.clear()
      openClusterIdRef.current = null
      savedViewRef.current = null
      savedClusterViewRef.current = null
      markersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const clusters = clusterLayerRef.current
    if (!map || !clusters) return

    const next = clusterIncidents(incidents)
    const nextIds = new Set(next.map(cluster => cluster.id))
    const reopenId = openClusterIdRef.current

    for (const [id, entry] of clusterCirclesRef.current) {
      if (!nextIds.has(id)) {
        clusters.removeLayer(entry.circle)
        clusterCirclesRef.current.delete(id)
        if (openClusterIdRef.current === id) {
          openClusterIdRef.current = null
          map.closePopup(entry.popup)
          restoreClusterView(map)
        }
      }
    }

    next.forEach(cluster => {
      const signature = clusterSignature(cluster)
      const color = cluster.critical ? '#f36d62' : '#e7bd50'
      const anchor = clusterPopupAnchor(cluster.center, cluster.radius)
      const existing = clusterCirclesRef.current.get(cluster.id)

      if (existing && existing.signature === signature) {
        return
      }

      if (existing) {
        clusters.removeLayer(existing.circle)
      }

      const popup = L.popup({
        className: 'cluster-popup',
        closeButton: true,
        autoClose: true,
        closeOnClick: true,
        autoPan: false,
        offset: L.point(0, -6),
      }).setContent(clusterPopup(cluster))

      // SVG renderer avoids the Canvas + popup race where the map click closes the popup immediately.
      const circle = L.circle(cluster.center, {
        radius: cluster.radius,
        color,
        weight: 2,
        opacity: 0.9,
        fillColor: color,
        fillOpacity: cluster.critical ? 0.14 : 0.12,
        dashArray: cluster.critical ? '8 6' : '5 7',
        interactive: true,
        renderer: L.svg({ padding: 0.5 }),
      })

      circle.on('click', event => {
        L.DomEvent.stopPropagation(event.originalEvent)
        // Always snapshot the view right before cluster focus so close can restore it,
        // even if an incident detail selection is already holding savedViewRef.
        savedClusterViewRef.current = { center: map.getCenter(), zoom: map.getZoom() }
        openClusterIdRef.current = cluster.id
        popup.setLatLng(anchor).openOn(map)
        flyPinIntoView(map, cluster.center, true, {
          zoom: CLUSTER_FOCUS_ZOOM,
          topPad: CLUSTER_POPUP_TOP_PAD,
        })
        firstSelect.current = false
      })

      circle.addTo(clusters)
      clusterCirclesRef.current.set(cluster.id, { circle, signature, popup })

      if (reopenId === cluster.id) {
        openClusterIdRef.current = cluster.id
        popup.setLatLng(anchor).openOn(map)
      }
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
        existing.button.innerHTML = emergencyIconHtml(incident.type)
        existing.button.title = markerTitle(incident)
        existing.button.setAttribute('aria-label', existing.button.title)
        existing.button.onclick = event => {
          event.stopPropagation()
          suppressRestoreRef.current = true
          map.closePopup()
          openClusterIdRef.current = null
          suppressRestoreRef.current = false
          selectRef.current(incident.id)
        }
        return
      }

      const button = document.createElement('button')
      button.type = 'button'
      button.className = markerClasses(incident, selectedRef.current)
      button.innerHTML = emergencyIconHtml(incident.type)
      button.title = markerTitle(incident)
      button.setAttribute('aria-label', button.title)
      button.onclick = event => {
        event.stopPropagation()
        suppressRestoreRef.current = true
        map.closePopup()
        openClusterIdRef.current = null
        suppressRestoreRef.current = false
        selectRef.current(incident.id)
      }
      const marker = L.marker(point, {
        icon: L.divIcon({ className: 'geo-marker-host', html: button, iconSize: [36, 36], iconAnchor: [18, 18] }),
        keyboard: false,
      }).addTo(layers)
      markersRef.current.set(incident.id, { marker, button })
    })
  }, [incidents])

  useEffect(() => {
    const map = mapRef.current
    if (!map || didFit.current || selectedRef.current) return
    const points = incidents.flatMap(incident => {
      const point = coordinates(incident)
      return point ? [point] : []
    })
    if (!points.length) return
    didFit.current = true
    const left = leftChromeWidth(map)
    map.fitBounds(L.latLngBounds(points).pad(0.2), {
      paddingTopLeft: [left, 32],
      paddingBottomRight: [32, 32],
      animate: false,
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
    if (!map) return

    if (!selectedId) {
      restoreViewIfIdle(map)
      return
    }

    const entry = markersRef.current.get(selectedId)
    if (!entry) return
    const point = entry.marker.getLatLng()
    const frame = window.requestAnimationFrame(() => {
      captureView(map)
      flyPinIntoView(map, point, !firstSelect.current)
      firstSelect.current = false
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selectedId])

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
    </section>
  )
}
