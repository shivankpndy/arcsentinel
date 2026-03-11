import { useTelemetryStore } from '../lib/store'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

function Gauge({ value, min, max, unit, label, color = '#22d3ee', warningAt, dangerAt }) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
  const status = dangerAt && value >= dangerAt ? 'danger'
               : warningAt && value >= warningAt ? 'warning'
               : 'ok'
  const statusColor = status === 'danger' ? '#f87171' : status === 'warning' ? '#fbbf24' : color

  return (
    <div style={{ padding: '12px 0' }}>
      <div className="flex items-end justify-between mb-2">
        <span className="hud-label">{label}</span>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 20, fontWeight: 700, color: statusColor, lineHeight: 1 }}>
          {value != null ? value.toFixed(1) : '--'}
          <span style={{ fontSize: 11, marginLeft: 2, color: 'rgba(255,255,255,0.4)' }}>{unit}</span>
        </div>
      </div>

      {/* Bar gauge */}
      <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${color}88, ${statusColor})`,
          borderRadius: 3,
          transition: 'width 0.5s ease',
        }} />
        {warningAt && (
          <div style={{
            position: 'absolute',
            left: `${((warningAt - min) / (max - min)) * 100}%`,
            top: 0, bottom: 0, width: 1,
            background: '#fbbf24',
            opacity: 0.5,
          }} />
        )}
      </div>
      <div className="flex justify-between mt-1" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: 'rgba(255,255,255,0.2)' }}>
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: '#050d1a',
      border: '1px solid rgba(34,211,238,0.2)',
      padding: '6px 10px',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
    }}>
      <div style={{ color: 'rgba(34,211,238,0.5)', marginBottom: 2 }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: {p.value?.toFixed(1)}
        </div>
      ))}
    </div>
  )
}

export default function EnvironmentPanel() {
  const { latest, tempHistory, humHistory } = useTelemetryStore()
  const env = latest?.env || {}

  // Interleave temp and hum into one chart dataset
  const chartData = tempHistory.slice(-40).map((t, i) => ({
    ts: t.ts,
    temp: t.value,
    hum: humHistory[humHistory.length - tempHistory.length + i]?.value ?? null,
  }))

  return (
    <div className="panel panel-corner p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="hud-label">ENVIRONMENTAL</span>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 9,
          color: env.temp != null ? '#34d399' : '#f87171',
        }}>
          {env.temp != null ? '● DHT11 ONLINE' : '○ DHT11 OFFLINE'}
        </span>
      </div>

      <Gauge
        label="TEMPERATURE" value={env.temp} min={-10} max={60}
        unit="°C" color="#22d3ee"
        warningAt={40} dangerAt={55}
      />
      <Gauge
        label="HUMIDITY" value={env.hum} min={0} max={100}
        unit="%" color="#a78bfa"
        warningAt={80} dangerAt={95}
      />
      <Gauge
        label="HEAT INDEX" value={env.hi} min={-10} max={65}
        unit="°C" color="#fb923c"
        warningAt={41} dangerAt={54}
      />

      {/* Chart */}
      {chartData.length > 1 && (
        <div style={{ marginTop: 12, borderTop: '1px solid rgba(34,211,238,0.1)', paddingTop: 12 }}>
          <div className="hud-label mb-2">TREND (LAST {chartData.length} SAMPLES)</div>
          <ResponsiveContainer width="100%" height={80}>
            <LineChart data={chartData}>
              <XAxis dataKey="ts" hide />
              <YAxis hide />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="temp" stroke="#22d3ee" strokeWidth={1.5} dot={false} name="Temp °C" />
              <Line type="monotone" dataKey="hum" stroke="#a78bfa" strokeWidth={1.5} dot={false} name="Hum %" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* MPU temp */}
      {latest?.mpu_temp != null && (
        <div style={{ marginTop: 8, borderTop: '1px solid rgba(34,211,238,0.1)', paddingTop: 8 }}>
          <div className="flex justify-between">
            <span className="hud-label">MPU6050 DIE TEMP</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: '#fbbf24' }}>
              {latest.mpu_temp.toFixed(1)} °C
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
