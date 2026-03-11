import { useTelemetryStore } from '../lib/store'

const TYPE_COLORS = {
  telemetry: '#22d3ee',
  IMG:       '#a78bfa',
  sys:       'rgba(34,211,238,0.4)',
  err:       '#f87171',
}

const TYPE_ICONS = {
  telemetry: '▶',
  IMG:       '📷',
  sys:       '◉',
  err:       '✕',
}

export default function TelemetryLog() {
  const { log } = useTelemetryStore()

  return (
    <div className="panel panel-corner p-4 flex-1 flex flex-col" style={{ minHeight: 200 }}>
      <div className="flex items-center justify-between mb-3">
        <span className="hud-label">PACKET LOG</span>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: 'rgba(34,211,238,0.4)' }}>
          {log.length} entries
        </span>
      </div>

      {/* Scroll container */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        maxHeight: 260,
      }}>
        {log.length === 0 && (
          <div style={{ color: 'rgba(34,211,238,0.3)', padding: '12px 0', textAlign: 'center' }}>
            Waiting for telemetry...
            <span className="blink">_</span>
          </div>
        )}
        {log.map((entry, i) => (
          <div key={i} style={{
            display: 'flex',
            gap: 8,
            padding: '3px 6px',
            borderRadius: 1,
            background: i === 0 ? 'rgba(34,211,238,0.05)' : 'transparent',
            borderLeft: i === 0 ? '2px solid rgba(34,211,238,0.4)' : '2px solid transparent',
            alignItems: 'baseline',
          }}>
            <span style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0, fontSize: 9 }}>{entry.ts}</span>
            <span style={{ color: TYPE_COLORS[entry.type] || '#94a3b8', flexShrink: 0 }}>
              {TYPE_ICONS[entry.type] || '·'}
            </span>
            {entry.pkt != null && (
              <span style={{ color: 'rgba(34,211,238,0.4)', flexShrink: 0 }}>
                #{String(entry.pkt).padStart(4, '0')}
              </span>
            )}
            <span style={{ color: TYPE_COLORS[entry.type] || '#94a3b8', opacity: i === 0 ? 1 : 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.summary}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
