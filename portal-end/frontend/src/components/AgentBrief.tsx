import type { CoordinationBrief } from '../types/brief'

export default function AgentBrief({ brief }: { brief: CoordinationBrief }) {
  return (
    <section className="panel agent-panel" aria-labelledby="agent-heading">
      <div className="panel-heading">
        <h2 id="agent-heading">✦ Net0 Agent</h2>
        <span className="small-label">Synthesized from {brief.reportCount} reports + mesh status</span>
      </div>
      <div className="agent-content">
        <div className="brief-summary">
          <h3>Situation Brief</h3>
          <p className="agent-insight">{brief.insight}</p>
          <ul className="brief-highlights">{brief.highlights.map(highlight => <li key={highlight}>{highlight}</li>)}</ul>
          <p className="agent-explanation">{brief.summary}</p>
        </div>
        <div className="agent-support"><h3>Related Signals</h3><ul>{brief.signals.map(signal => <li key={signal}>{signal}</li>)}</ul></div>
        <div className="agent-support"><h3>Information to Verify</h3><ul>{brief.verify.map(item => <li key={item}>{item}</li>)}</ul></div>
      </div>
      <p className="agent-note">AI assists with information organization. Responders make operational decisions.</p>
    </section>
  )
}
