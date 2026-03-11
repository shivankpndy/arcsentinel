import { useTelemetryStore } from '../lib/store'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

function SignalStrengthBars({ rssi }) {
  // RSSI -50 = excellent, -70 = good, -85 = fair, -100 = poor
  const bars = [
    { threshold: -100, label: '1' },
    { threshold: -85,  label: '2' },
    { threshold: -70,  label: '3' },
    { threshold: -55,  label: '4' },
  ]
  const active = bars.filter(b => rssi >= b.threshold).length

  const colors = { 4: '#34d399', 3: '#86efac', 2: '#fbbf24', 1: '#f87171', 0: '#374151' }
  const barColor = colors[active] || '#374151'

  return (
    <div className="flex items-end gap-1" style={{ height: 24 }}>
      {bars.map((b, i) => (
        <div key={i} style={{
          width: 8,
          height: `${(i + 1) * 6}px`,
          background: i < active ? barColor : 'rgba(255,255,255,0.08)',
          borderRadius: 1,
          transition: 'background 0.3s ease',
        }} />
      ))}
    </div>
  )
}

function RSSILabel(rssi) {
  if (rssi >= -60) return { label: 'EXCELLENT', color: '#34d399' }
  if (rssi >= -70) return { label: 'GOOD',      color: '#86efac' }
  if (rssi >= -80) return { label: 'FAIR',      color: '#fbbf24' }
  if (rssi >= -90) return { label: 'POOR',      color: '#fb923c' }
  return { label: 'CRITICAL', color: '#f87171' }
}

export default function SignalPanel() {
  const { latest, rssiHistory, stats } = useTelemetryStore()

  const rssi = latest?.rssi ?? latest?.rssi_gs ?? null
  const snr  = latest?.snr ?? null
  const { label, color } = rssi != null ? RSSILabel(rssi) : { label: 'NO DATA', color: '#4b5563' }

  const chartData = rssiHistory.slice(-40).map((r, i) => ({ i, value: r.value }))

  return (
    <div className="panel panel-corner p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="hud-label">RF LINK QUALITY</span>
        <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 9, color, letterSpacing: '0.1em' }}>
          {label}
        </span>
      </div>

      {/* RSSI large display */}
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="hud-label mb-1">RSSI</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 32, fontWeight: 700, color, lineHeight: 1 }}>
            {rssi ?? '--'}
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginLeft: 4 }}>dBm</span>
          </div>
        </div>
        {rssi != null && <SignalStrengthBars rssi={rssi} />}
      </div>

      {/* SNR */}
      {snr != null && (
        <div className="flex justify-between items-center mb-3" style={{
          padding: '6px 10px',
          background: 'rgba(0,0,0,0.2)',
          borderRadius: 2,
        }}>
          <span className="hud-label">SNR</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, color: '#22d3ee' }}>
            {snr.toFixed(1)} dB
          </span>
        </div>
      )}

      {/* RSSI history chart */}
      {chartData.length > 1 && (
        <>
          <div className="hud-label mb-1">RSSI HISTORY</div>
          <ResponsiveContainer width="100%" height={70}>
            <LineChart data={chartData}>
              <XAxis dataKey="i" hide />
              <YAxis domain={[-110, -40]} hide />
              <ReferenceLine y={-90} stroke="rgba(251,191,36,0.3)" strokeDasharray="3 3" />
              <ReferenceLine y={-70} stroke="rgba(52,211,153,0.2)" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}

      {/* Uptime */}
      <div style={{
        marginTop: 8,
        borderTop: '1px solid rgba(34,211,238,0.1)',
        paddingTop: 8,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 8,
      }}>
        {[
          ['PKT RX', stats.total_packets],
          ['LOST',   stats.lost_packets],
        ].map(([label, val]) => (
          <div key={label}>
            <div className="hud-label">{label}</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 14, color: '#e2e8f0', marginTop: 2 }}>
              {val ?? 0}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
