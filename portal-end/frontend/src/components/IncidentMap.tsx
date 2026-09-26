import type { Incident } from '../types/incident'

export default function IncidentMap({ incidents, selectedId }: { incidents: Incident[]; selectedId: string }) {
  return (
    <section className="panel map-panel" aria-labelledby="map-heading">
      <div className="panel-heading"><div><h2 id="map-heading">Live Incident Map</h2></div></div>
      <div className="map-surface">
        <svg className="map-drawing" viewBox="0 0 800 460" role="img" aria-labelledby="map-title map-description">
          <title id="map-title">Illustrative emergency response map — selected SOS {selectedId}</title>
          <desc id="map-description">Mock Medical incident at Node 07, Fire at Node 12, and Trapped at Node 04. Dashed lines represent a sample mesh route, not real geography.</desc>
          <rect width="800" height="460" fill="#19252a" />
          <path d="M0 330C160 290 120 410 310 385S540 470 800 380V460H0Z" fill="#1a3442" />
          <path d="M0 0h190v100H0ZM615 230h185v100H615ZM80 220h105v75H80Z" fill="#24392f" />
          <g fill="#26333a" stroke="#304047" strokeWidth="1">
            {[40, 235, 435, 635].flatMap((x) => [35, 135, 245].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="100" height="55" rx="4" />))}
          </g>
          <g fill="none" stroke="#35444b" strokeWidth="21"><path d="M0 115H800M0 220H800M200 0v460M410 0v460M610 0v460M0 340h610" /></g>
          <g fill="none" stroke="#202e35" strokeWidth="17"><path d="M0 115H800M0 220H800M200 0v460M410 0v460M610 0v460M0 340h610" /></g>
          <g className="map-street-label"><text x="65" y="119">NORTH AVENUE</text><text x="450" y="224">CENTRAL AVENUE</text><text x="235" y="344">SOUTH STREET</text><text x="60" y="55">NORTH PARK</text><text x="650" y="280">EAST COMMON</text></g>
          <path d="M325 210 260 295 410 290 675 355M585 150 410 290M505 345 410 290" fill="none" stroke="#729f8e" strokeWidth="2" strokeDasharray="6 6" />
          {[[260, 295, 'R02'], [410, 290, 'R03'], [675, 355, 'GW']].map(([x, y, label]) => <g key={label} transform={`translate(${x} ${y})`}><rect x="-12" y="-12" width="24" height="24" rx="5" fill="#202e35" stroke="#89c4a4" strokeWidth="2" /><circle r="4" fill="#89c4a4" /><text className="map-node-label" y="29" textAnchor="middle">{label}</text></g>)}
          {incidents.map((incident) => <g key={incident.id} className={incident.type.toLowerCase()} transform={`translate(${incident.x} ${incident.y})`}>{incident.id === selectedId && <circle r="32" fill="none" stroke="#e5edf3" strokeWidth="3" />}<circle r="23" fill="var(--incident-color)" opacity=".1" /><circle r={incident.id === selectedId ? 23 : 17} fill="var(--incident-color)" stroke="#10161d" strokeWidth="3" /><text fill="#10161d" textAnchor="middle" y="5" fontSize="12" fontWeight="700">{incident.id}</text><rect x="-37" y="31" width="74" height="24" rx="4" fill="#202e35" stroke="#3d505c" /><text className="map-node-label" textAnchor="middle" y="47">NODE {incident.node}</text></g>)}
        </svg>
        <div className="map-caption"><span className="status-dot" /> Local mesh coverage</div>
        <div className="map-north" aria-label="North is up">N ↑</div>
      </div>
      <div className="map-legend"><span><i className="legend-incident" /> SOS</span><span><i className="legend-node" /> Mesh Node</span><span><i className="legend-link" /> Relay Link</span><span><b aria-hidden="true">GW</b> Gateway</span></div>
    </section>
  )
}

