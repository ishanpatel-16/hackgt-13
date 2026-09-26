import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import type { FeatureCollection } from 'geojson'
import 'leaflet/dist/leaflet.css'
import type { Incident } from '../types/incident'

interface Props {
  incidents: Incident[]
  selectedId: string | null
  onSelectIncident: (id: string) => void
}

function coordinates(incident: Incident): L.LatLngTuple | null {
  const values = incident.location.split(',').map(Number)
  return values.length === 2 && values.every(Number.isFinite) && Math.abs(values[0]) <= 90 && Math.abs(values[1]) <= 180
    ? [values[0], values[1]]
    : null
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

export default function IncidentMap({ incidents, selectedId, onSelectIncident }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Map<string, { marker: L.Marker; button: HTMLButtonElement }>>(new Map())
  const layerRef = useRef<L.LayerGroup | null>(null)
  const selectRef = useRef(onSelectIncident)
  const selectedRef = useRef(selectedId)
  const firstSelect = useRef(true)
  const [mapError, setMapError] = useState(false)

  selectRef.current = onSelectIncident
  selectedRef.current = selectedId

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

    layerRef.current = L.layerGroup().addTo(map)

    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}maps/atlanta.geojson`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw Error('Local map unavailable')
        return response.json()
      })
      .then((data: FeatureCollection) => {
        if (controller.signal.aborted) return
        L.geoJSON(data, {
          interactive: false,
          style: feature => {
            const p = feature?.properties
            return p?.building
              ? { color: '#58616c', weight: 0.5, fillColor: '#353d47', fillOpacity: 0.75 }
              : p?.leisure
                ? { color: '#3f6250', weight: 1, fillColor: '#203a2a', fillOpacity: 0.65 }
                : {
                    color: ['motorway', 'trunk', 'primary'].includes(p?.highway) ? '#b4bdc8' : '#747f8d',
                    weight: ['motorway', 'trunk', 'primary'].includes(p?.highway) ? 3 : 1.2,
                    opacity: 0.85,
                  }
          },
          onEachFeature: (feature, layer) => {
            if (
              feature.properties?.name &&
              feature.properties?.highway &&
              ['primary', 'secondary', 'tertiary'].includes(feature.properties.highway)
            ) {
              const label = document.createElement('span')
              label.textContent = feature.properties.name
              layer.bindTooltip(label, { permanent: false, className: 'geo-label' })
            }
          },
        }).addTo(map)
        const names = new Set<string>()
        data.features.forEach(feature => {
          const p = feature.properties
          if (
            !p?.name ||
            names.has(p.name) ||
            !['primary', 'secondary'].includes(p.highway) ||
            feature.geometry.type !== 'LineString'
          )
            return
          names.add(p.name)
          const point = feature.geometry.coordinates[Math.floor(feature.geometry.coordinates.length / 2)]
          const label = document.createElement('span')
          label.textContent = p.name
          L.marker([point[1], point[0]], {
            interactive: false,
            icon: L.divIcon({ className: 'street-name', html: label, iconSize: [140, 20] }),
          }).addTo(map)
        })
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
      markersRef.current.clear()
    }
  }, [])

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
