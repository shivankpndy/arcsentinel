import { useTelemetryStore } from '../lib/store'

function ArtificialHorizon({ roll = 0, pitch = 0, size = 200 }) {
  const cx = size / 2
  const cy = size / 2
  const r  = size / 2 - 4

  // Sky/ground division y-offset based on pitch (1° = ~1.5px at this scale)
  const pitchOffset = (pitch / 90) * r * 0.8

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <clipPath id="horizon-clip">
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
        <radialGradient id="sky-grad" cx="50%" cy="30%">
          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#0369a1" stopOpacity="0.9" />
        </radialGradient>
        <radialGradient id="ground-grad" cx="50%" cy="70%">
          <stop offset="0%" stopColor="#92400e" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#78350f" stopOpacity="0.9" />
        </radialGradient>
      </defs>

      {/* Rotating group — roll */}
      <g transform={`rotate(${-roll}, ${cx}, ${cy})`} clipPath="url(#horizon-clip)">
        {/* Sky */}
        <rect
          x={0} y={0}
          width={size}
          height={cy + pitchOffset}
          fill="url(#sky-grad)"
        />
        {/* Ground */}
        <rect
          x={0}
          y={cy + pitchOffset}
          width={size}
          height={size - (cy + pitchOffset)}
          fill="url(#ground-grad)"
        />
        {/* Horizon line */}
        <line
          x1={0} y1={cy + pitchOffset}
          x2={size} y2={cy + pitchOffset}
          stroke="rgba(255,255,255,0.7)"
          strokeWidth={1.5}
        />

        {/* Pitch ladder */}
        {[-30, -20, -10, 10, 20, 30].map(deg => {
          const y = cy + pitchOffset + (deg / 90) * r * 0.8
          const w = deg % 20 === 0 ? 40 : 25
          return (
            <g key={deg}>
              <line
                x1={cx - w} y1={y} x2={cx + w} y2={y}
                stroke="rgba(255,255,255,0.4)" strokeWidth={1}
              />
              <text
                x={cx + w + 4} y={y + 3}
                fontSize={8}
                fill="rgba(255,255,255,0.5)"
                fontFamily="JetBrains Mono, monospace"
              >{Math.abs(deg)}</text>
            </g>
          )
        })}
      </g>

      {/* Static overlay: aircraft symbol */}
      <g>
        {/* Center dot */}
        <circle cx={cx} cy={cy} r={3} fill="#fbbf24" />
        {/* Left wing */}
        <line x1={cx - 30} y1={cy} x2={cx - 8} y2={cy} stroke="#fbbf24" strokeWidth={2.5} />
        {/* Right wing */}
        <line x1={cx + 8} y1={cy} x2={cx + 30} y2={cy} stroke="#fbbf24" strokeWidth={2.5} />
        {/* Vertical bar */}
        <line x1={cx} y1={cy - 8} x2={cx} y2={cy - 14} stroke="#fbbf24" strokeWidth={2.5} />
      </g>

      {/* Roll indicator arc */}
      {[-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].map(deg => {
        const rad = (deg - 90) * Math.PI / 180
        const x1 = cx + (r - 2) * Math.cos(rad)
        const y1 = cy + (r - 2) * Math.sin(rad)
        const x2 = cx + (r - (deg % 30 === 0 ? 10 : 6)) * Math.cos(rad)
        const y2 = cy + (r - (deg % 30 === 0 ? 10 : 6)) * Math.sin(rad)
        return (
          <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="rgba(255,255,255,0.5)" strokeWidth={deg % 30 === 0 ? 1.5 : 1} />
        )
      })}

      {/* Roll pointer */}
      <g transform={`rotate(${-roll}, ${cx}, ${cy})`}>
        <polygon
          points={`${cx},${cy - r + 3} ${cx - 4},${cy - r + 11} ${cx + 4},${cy - r + 11}`}
          fill="#22d3ee"
        />
      </g>

      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(34,211,238,0.5)" strokeWidth={1.5} />
    </svg>
  )
}

export default function AttitudeDisplay() {
  const { latest } = useTelemetryStore()

  const roll  = latest?.roll  ?? 0
  const pitch = latest?.pitch ?? 0
  const gyro  = latest?.gyro  || { x: 0, y: 0, z: 0 }

  return (
    <div className="panel panel-corner p-4" style={{ minHeight: 280 }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="hud-label">ATTITUDE DISPLAY</span>
        <div className="flex gap-2">
          <span className="hud-label">AHRS</span>
          <span style={{ color: '#34d399', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}>● NOMINAL</span>
        </div>
      </div>

      <div className="flex items-center gap-6">
        {/* Artificial Horizon */}
        <div style={{ position: 'relative' }}>
          <div className="scan-line" style={{ zIndex: 5 }} />
          <ArtificialHorizon roll={roll} pitch={pitch} size={220} />
        </div>

        {/* Numeric readouts */}
        <div className="flex-1 flex flex-col gap-4">
          {/* Roll */}
          <div>
            <div className="hud-label mb-1">ROLL</div>
            <div className="hud-value" style={{ color: '#22d3ee' }}>
              {roll.toFixed(1)}°
            </div>
            <div style={{ marginTop: 6, height: 3, background: 'rgba(34,211,238,0.1)', borderRadius: 1 }}>
              <div style={{
                height: '100%',
                width: `${Math.abs(roll) / 180 * 100}%`,
                marginLeft: roll < 0 ? `${50 - Math.abs(roll) / 180 * 100}%` : '50%',
                background: '#22d3ee',
                borderRadius: 1,
                maxWidth: '50%',
              }} />
            </div>
          </div>

          {/* Pitch */}
          <div>
            <div className="hud-label mb-1">PITCH</div>
            <div className="hud-value" style={{ color: '#22d3ee' }}>
              {pitch.toFixed(1)}°
            </div>
            <div style={{ marginTop: 6, height: 3, background: 'rgba(34,211,238,0.1)', borderRadius: 1 }}>
              <div style={{
                height: '100%',
                width: `${Math.abs(pitch) / 90 * 100}%`,
                marginLeft: '50%',
                background: '#a78bfa',
                borderRadius: 1,
                maxWidth: '50%',
              }} />
            </div>
          </div>

          {/* Angular rates */}
          <div style={{ borderTop: '1px solid rgba(34,211,238,0.1)', paddingTop: 12 }}>
            <div className="hud-label mb-2">ANGULAR RATE (°/s)</div>
            <div className="grid grid-cols-3 gap-2">
              {[['ωX', gyro.x, '#ef4444'], ['ωY', gyro.y, '#34d399'], ['ωZ', gyro.z, '#22d3ee']].map(([axis, val, color]) => (
                <div key={axis} style={{
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(34,211,238,0.1)',
                  padding: '6px 8px',
                  borderRadius: 2,
                }}>
                  <div style={{ fontSize: 9, fontFamily: 'Orbitron, monospace', color: 'rgba(255,255,255,0.3)', marginBottom: 2 }}>{axis}</div>
                  <div style={{ fontSize: 14, fontFamily: 'JetBrains Mono, monospace', color, fontWeight: 700 }}>
                    {(val ?? 0).toFixed(1)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
