import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import L from 'leaflet'
import type { FeatureCollection } from 'geojson'
import 'leaflet/dist/leaflet.css'
import { mockMapNodes } from '../data/mockMapNodes'
import { mockDeviceCoordinates } from '../data/mockDeviceCoordinates'
import { deviceName } from '../utils/networkLabels'
import type { Incident } from '../types/incident'
import type { NetworkNode } from '../types/network'

interface Props {
  incidents: Incident[]
  nodes: NetworkNode[]
  selectedId: string | null
  selectedNodeId: string | null
  onSelectNode: (id: string) => void
  onSelectIncident: (id: string) => void
  children?: ReactNode
}

function coordinates(incident: Incident): L.LatLngTuple | null {
  const values = incident.location.split(',').map(Number)
  return values.length === 2 && values.every(Number.isFinite) && Math.abs(values[0]) <= 90 && Math.abs(values[1]) <= 180
    ? [values[0], values[1]] : null
}

export default function IncidentMap({ incidents, nodes, selectedId, selectedNodeId, onSelectNode, onSelectIncident, children }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const [popupHost] = useState(() => document.createElement('div'))
  const [mapError, setMapError] = useState(false)
  const extent = L.latLngBounds([33.75, -84.405], [33.79, -84.365])

  useEffect(() => {
    const map = L.map(host.current!, { center: [33.771, -84.387], zoom: 15, minZoom: 14, maxZoom: 19, maxBounds: [[33.75, -84.405], [33.79, -84.365]], maxBoundsViscosity: 1, zoomControl: false, preferCanvas: true })
    mapRef.current = map
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    map.attributionControl.setPrefix(false)
    map.attributionControl.addAttribution('© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · Local extract')
    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}maps/atlanta.geojson`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw Error('Local map unavailable'); return response.json() })
      .then((data: FeatureCollection) => {
        if (controller.signal.aborted) return
        L.geoJSON(data, {
          interactive: false,
          style: feature => {
            const p = feature?.properties
            return p?.building ? { color: '#58616c', weight: .5, fillColor: '#353d47', fillOpacity: .9 }
              : p?.leisure ? { color: '#3f6250', weight: 1, fillColor: '#203a2a', fillOpacity: .8 }
              : { color: ['motorway', 'trunk', 'primary'].includes(p?.highway) ? '#b4bdc8' : '#747f8d', weight: ['motorway', 'trunk', 'primary'].includes(p?.highway) ? 3 : 1.2, opacity: .85 }
          },
          onEachFeature: (feature, layer) => {
            if (feature.properties?.name && feature.properties?.highway && ['primary', 'secondary', 'tertiary'].includes(feature.properties.highway)) {
              const label = document.createElement('span')
              label.textContent = feature.properties.name
              layer.bindTooltip(label, { permanent: false, className: 'geo-label' })
            }
          },
        }).addTo(map).bringToBack()
        // Sparse permanent geographic labels from real named roads, not invented places.
        const names = new Set<string>()
        data.features.forEach(feature => {
          const p = feature.properties
          if (!p?.name || names.has(p.name) || !['primary', 'secondary'].includes(p.highway) || feature.geometry.type !== 'LineString') return
          names.add(p.name)
          const point = feature.geometry.coordinates[Math.floor(feature.geometry.coordinates.length / 2)]
          const label = document.createElement('span'); label.textContent = p.name
          L.marker([point[1], point[0]], { interactive: false, icon: L.divIcon({ className: 'street-name', html: label, iconSize: [140, 20] }) }).addTo(map)
        })
      }).catch(error => { if (error.name !== 'AbortError') setMapError(true) })
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(host.current!)
    return () => { controller.abort(); observer.disconnect(); map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current!
    const layers = L.layerGroup().addTo(map)
    const status = (name: string) => nodes.find(node => deviceName(node.name) === deviceName(name))?.status
    const marker = (point: L.LatLngTuple, label: string, symbol: string, classes: string, action: () => void) => {
      const button = document.createElement('button')
      button.type = 'button'; button.className = `geo-marker ${classes}`
      button.textContent = symbol; button.setAttribute('aria-label', label); button.title = label
      button.onclick = event => { event.stopPropagation(); action() }
      return L.marker(point, { icon: L.divIcon({ className: 'geo-marker-host', html: button, iconSize: [36, 36], iconAnchor: [18, 18] }), keyboard: false }).addTo(layers)
    }
    const seen = new Set<string>()
    mockMapNodes.forEach(node => {
      const point = mockDeviceCoordinates[node.id]
      node.connections.forEach(name => {
        const other = mockMapNodes.find(item => item.name === name)
        if (!other) return
        const key = [node.id, other.id].sort().join('-')
        if (seen.has(key)) return
        seen.add(key)
        const offline = status(node.name) === 'OFFLINE' || status(other.name) === 'OFFLINE'
        L.polyline([point, mockDeviceCoordinates[other.id]], { color: offline ? '#77504f' : '#91b8a6', weight: 1, opacity: offline ? .25 : .4, dashArray: '4 7', interactive: false }).addTo(layers)
      })
      const state = status(node.name)
      marker(point, `${deviceName(node.name)} — ${state ?? 'status unavailable'}`, node.role === 'Gateway' ? '⌂' : node.role === 'Relay' ? '↔' : 'A', `device ${state?.toLowerCase() ?? 'unknown'} ${selectedNodeId === node.id ? 'chosen' : ''}`, () => onSelectNode(node.id))
    })
    const selected = incidents.find(incident => incident.id === selectedId)
    if (selected) {
      const path = selected.path.map(name => mockMapNodes.find(node => node.name === name))
      const origin = coordinates(selected)
      if (origin && path.every(node => node !== undefined)) {
        const points = [origin, ...path.map(node => mockDeviceCoordinates[node!.id])]
        const interrupted = path.some(node => status(node!.name) === 'OFFLINE')
        L.polyline(points, { color: interrupted ? '#d59b76' : '#c8e3f5', weight: 3, opacity: .9, dashArray: interrupted ? '4 8' : undefined, interactive: false }).addTo(layers)
      }
    }
    incidents.forEach(incident => {
      const point = coordinates(incident)
      if (!point) return
      marker(point, `${incident.type} SOS ${incident.id}, ${incident.people} people`, incident.type === 'Medical' ? '+' : incident.type === 'Fire' ? '♨' : incident.type === 'Trapped' ? '!' : '•', `sos ${incident.type.toLowerCase()} ${incident.status === 'NEW' ? 'new' : ''} ${selectedId === incident.id ? 'chosen' : ''}`, () => onSelectIncident(incident.id))
    })
    return () => { layers.remove() }
  }, [incidents, nodes, selectedId, selectedNodeId, onSelectNode, onSelectIncident])

  useEffect(() => {
    const map = mapRef.current!
    const incident = incidents.find(item => item.id === selectedId)
    const point = incident ? coordinates(incident) : selectedNodeId ? mockDeviceCoordinates[selectedNodeId] : null
    if (!point) return
    map.panTo(point, { animate: false })
    const popup = L.popup({ closeButton: false, autoClose: false, closeOnClick: false, closeOnEscapeKey: false, maxWidth: 340, minWidth: 260, maxHeight: 400, offset: [0, -20], autoPanPadding: [24, 24], className: 'net0-map-popup' }).setLatLng(point).setContent(popupHost).openOn(map)
    return () => { popup.remove() }
  }, [selectedId, selectedNodeId, popupHost, incidents])

  const interrupted = incidents.find(item => item.id === selectedId)?.path.some(name => nodes.some(node => deviceName(node.name) === deviceName(name) && node.status === 'OFFLINE'))
  return (
    <section className="panel map-panel geographic-panel" aria-label="Live Incident Map">
      <div className="geo-canvas" ref={host} />
      <div className="geo-title"><h2>Live Incident Map</h2><span>Atlanta · Local map</span></div>
      <button className="fit-network" onClick={() => mapRef.current?.fitBounds(L.latLngBounds([...Object.values(mockDeviceCoordinates), ...incidents.flatMap(incident => { const point = coordinates(incident); return point ? [point] : [] })]).pad(.15))}>Fit network</button>
      {mapError && <p className="geo-warning">Local map could not load. Emergency markers remain available.</p>}
      {interrupted && <p className="geo-warning">A device on this report’s path is offline. Delivery through another route is not confirmed.</p>}
      <div className="geo-legend">SOS · A Access Point · ↔ Relay · ⌂ Responder Station<span>Offline area: {extent.getSouth()}–{extent.getNorth()}° N</span></div>
      {createPortal(children, popupHost)}
    </section>
  )
}
