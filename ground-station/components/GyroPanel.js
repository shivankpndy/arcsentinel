import { useTelemetryStore } from '../lib/store'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from 'recharts'

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
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: {Number(p.value).toFixed(2)} °/s
        </div>
      ))}
    </div>
  )
}

function AxisBar({ label, value, max = 30, color }) {
  const pct = Math.min(100, (Math.abs(value) / max) * 100)
  const isPos = value >= 0

  return (
    <div className="flex items-center gap-3" style={{ height: 28 }}>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color, width: 24, flexShrink: 0 }}>{label}</span>

      {/* Negative side */}
      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{
          width: `${!isPos ? pct : 0}%`,
          height: 6,
          background: `${color}66`,
          borderRadius: '3px 0 0 3px',
          transition: 'width 0.3s ease',
        }} />
      </div>

      {/* Center */}
      <div style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.15)', flexShrink: 0 }} />

      {/* Positive side */}
      <div style={{ flex: 1 }}>
        <div style={{
          width: `${isPos ? pct : 0}%`,
          height: 6,
          background: color,
          borderRadius: '0 3px 3px 0',
          transition: 'width 0.3s ease',
        }} />
      </div>

      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color, width: 54, textAlign: 'right', flexShrink: 0 }}>
        {value >= 0 ? '+' : ''}{(value ?? 0).toFixed(1)}
      </span>
    </div>
  )
}

export default function GyroPanel() {
  const { latest, gyroHistory, accelHistory } = useTelemetryStore()
  const gyro  = latest?.gyro  || { x: 0, y: 0, z: 0 }
  const accel = latest?.accel || { x: 0, y: 0, z: 0 }

  const chartData = gyroHistory.slice(-60).map((g, i) => ({
    i,
    x: g.x,
    y: g.y,
    z: g.z,
  }))

  const accelData = accelHistory.slice(-60).map((a, i) => ({
    i,
    x: a.x,
    y: a.y,
    z: a.z,
  }))

  return (
    <div className="panel panel-corner p-4">
      <div className="flex items-center justify-between mb-4">
        <span className="hud-label">IMU — MPU6050</span>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 9,
          color: latest?.mpu_err ? '#f87171' : '#34d399',
        }}>
          {latest?.mpu_err ? '○ SENSOR ERROR' : '● NOMINAL'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Gyroscope */}
        <div>
          <div className="hud-label mb-3">GYROSCOPE (°/s)</div>
          <div className="flex flex-col gap-2">
            <AxisBar label="X" value={gyro.x} color="#ef4444" />
            <AxisBar label="Y" value={gyro.y} color="#34d399" />
            <AxisBar label="Z" value={gyro.z} color="#22d3ee" />
          </div>

          {chartData.length > 1 && (
            <div style={{ marginTop: 12 }}>
              <div className="hud-label mb-1">GYRO HISTORY</div>
              <ResponsiveContainer width="100%" height={90}>
                <LineChart data={chartData}>
                  <XAxis dataKey="i" hide />
                  <YAxis domain={[-30, 30]} hide />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
                  <Line type="monotone" dataKey="x" stroke="#ef4444" strokeWidth={1.5} dot={false} name="ωX" />
                  <Line type="monotone" dataKey="y" stroke="#34d399" strokeWidth={1.5} dot={false} name="ωY" />
                  <Line type="monotone" dataKey="z" stroke="#22d3ee" strokeWidth={1.5} dot={false} name="ωZ" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Accelerometer */}
        <div>
          <div className="hud-label mb-3">ACCELEROMETER (g)</div>
          <div className="flex flex-col gap-2">
            <AxisBar label="X" value={accel.x} max={2} color="#f97316" />
            <AxisBar label="Y" value={accel.y} max={2} color="#a78bfa" />
            <AxisBar label="Z" value={accel.z} max={2} color="#fbbf24" />
          </div>

          {accelData.length > 1 && (
            <div style={{ marginTop: 12 }}>
              <div className="hud-label mb-1">ACCEL HISTORY</div>
              <ResponsiveContainer width="100%" height={90}>
                <LineChart data={accelData}>
                  <XAxis dataKey="i" hide />
                  <YAxis domain={[-2, 2]} hide />
                  <Tooltip content={<CustomTooltip />} />
                  <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
                  <Line type="monotone" dataKey="x" stroke="#f97316" strokeWidth={1.5} dot={false} name="aX" />
                  <Line type="monotone" dataKey="y" stroke="#a78bfa" strokeWidth={1.5} dot={false} name="aY" />
                  <Line type="monotone" dataKey="z" stroke="#fbbf24" strokeWidth={1.5} dot={false} name="aZ" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Raw values footer */}
      <div style={{
        marginTop: 12,
        padding: '8px 10px',
        background: 'rgba(0,0,0,0.3)',
        borderRadius: 2,
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 10,
        color: 'rgba(34,211,238,0.5)',
        letterSpacing: '0.05em',
      }}>
        GYR [{gyro.x?.toFixed(2)}, {gyro.y?.toFixed(2)}, {gyro.z?.toFixed(2)}] °/s &nbsp;|&nbsp;
        ACC [{accel.x?.toFixed(3)}, {accel.y?.toFixed(3)}, {accel.z?.toFixed(3)}] g
      </div>
    </div>
  )
}
