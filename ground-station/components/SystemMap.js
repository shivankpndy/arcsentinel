import { useTelemetryStore } from '../lib/store'

const SUBSYSTEMS = [
  { id: 'lora',  label: 'LoRa SX1276', icon: '📡', okKey: null,        errKey: null },
  { id: 'mpu',   label: 'MPU6050 IMU',  icon: '🔄', okKey: 'gyro',     errKey: 'mpu_err' },
  { id: 'dht',   label: 'DHT11 Sensor', icon: '🌡️', okKey: 'env',      errKey: 'dht_err' },
  { id: 'cam',   label: 'ESP32-CAM',    icon: '📷', okKey: null,        errKey: null },
  { id: 'mcu',   label: 'ESP32 MCU',    icon: '⚙️', okKey: 'pkt',      errKey: null },
]

export default function SystemMap() {
  const { latest, wsStatus } = useTelemetryStore()

  const getStatus = (sub) => {
    if (!latest) return 'unknown'
    if (sub.errKey && latest[sub.errKey]) return 'error'
    if (sub.okKey && latest[sub.okKey] != null) return 'ok'
    if (sub.id === 'lora') return wsStatus === 'connected' || latest ? 'ok' : 'error'
    if (sub.id === 'cam') return latest?.lastImage ? 'ok' : 'standby'
    return 'ok'
  }

  const statusColor = {
    ok:      '#34d399',
    error:   '#f87171',
    standby: '#fbbf24',
    unknown: '#4b5563',
  }

  const uptime = latest?.t != null
    ? (() => {
        const s = Math.floor(latest.t)
        const m = Math.floor(s / 60)
        const h = Math.floor(m / 60)
        return `${String(h).padStart(2,'0')}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`
      })()
    : '--:--:--'

  return (
    <div className="panel panel-corner p-4">
      <div className="hud-label mb-3">SYSTEM STATUS</div>

      {/* Satellite icon */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <svg width="80" height="80" viewBox="0 0 80 80" fill="none" style={{ animation: 'float 6s ease-in-out infinite' }}>
          {/* Main body */}
          <rect x="25" y="25" width="30" height="30" rx="3" fill="rgba(34,211,238,0.1)" stroke="#22d3ee" strokeWidth="1.5"/>

          {/* Solar panels left */}
          <rect x="2" y="32" width="20" height="16" rx="1" fill="rgba(34,211,238,0.05)" stroke="#22d3ee" strokeWidth="1"/>
          <line x1="22" y1="40" x2="25" y2="40" stroke="#22d3ee" strokeWidth="1.5"/>

          {/* Solar panels right */}
          <rect x="58" y="32" width="20" height="16" rx="1" fill="rgba(34,211,238,0.05)" stroke="#22d3ee" strokeWidth="1"/>
          <line x1="55" y1="40" x2="58" y2="40" stroke="#22d3ee" strokeWidth="1.5"/>

          {/* Panel grid lines */}
          {[7, 12, 17].map(x => (
            <line key={x} x1={x} y1="32" x2={x} y2="48" stroke="#22d3ee" strokeWidth="0.5" opacity="0.4"/>
          ))}
          {[63, 68, 73].map(x => (
            <line key={x} x1={x} y1="32" x2={x} y2="48" stroke="#22d3ee" strokeWidth="0.5" opacity="0.4"/>
          ))}

          {/* Antenna */}
          <line x1="40" y1="25" x2="40" y2="12" stroke="#22d3ee" strokeWidth="1.5"/>
          <circle cx="40" cy="10" r="3" fill="none" stroke="#22d3ee" strokeWidth="1"/>
          <circle cx="40" cy="10" r="1.5" fill="#22d3ee" opacity="0.6"/>

          {/* Thruster bottom */}
          <line x1="40" y1="55" x2="40" y2="65" stroke="#22d3ee" strokeWidth="1.5"/>
          <polygon points="35,65 45,65 47,70 33,70" fill="rgba(34,211,238,0.1)" stroke="#22d3ee" strokeWidth="1"/>

          {/* Signal rings */}
          <circle cx="40" cy="10" r="8"  fill="none" stroke="#22d3ee" strokeWidth="0.5" opacity="0.3"/>
          <circle cx="40" cy="10" r="13" fill="none" stroke="#22d3ee" strokeWidth="0.5" opacity="0.15"/>

          {/* MCU indicator in body */}
          <rect x="33" y="33" width="14" height="14" rx="1" fill="rgba(34,211,238,0.15)" stroke="#22d3ee" strokeWidth="0.5"/>
          <text x="40" y="43" textAnchor="middle" fontSize="7" fill="#22d3ee" fontFamily="monospace">ESP32</text>
        </svg>
      </div>

      {/* Mission time */}
      <div style={{
        textAlign: 'center',
        marginBottom: 12,
        padding: '6px',
        background: 'rgba(0,0,0,0.3)',
        borderRadius: 2,
      }}>
        <div className="hud-label">MISSION ELAPSED TIME</div>
        <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 18, color: '#22d3ee', fontWeight: 700, marginTop: 2 }}>
          {uptime}
        </div>
      </div>

      {/* Subsystem status list */}
      <div className="flex flex-col gap-1">
        {SUBSYSTEMS.map(sub => {
          const status = getStatus(sub)
          const color = statusColor[status]
          return (
            <div key={sub.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '5px 8px',
              background: status === 'error' ? 'rgba(248,113,113,0.05)' : 'rgba(0,0,0,0.2)',
              borderRadius: 2,
              border: `1px solid ${status === 'error' ? 'rgba(248,113,113,0.2)' : 'rgba(34,211,238,0.05)'}`,
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%',
                background: color,
                boxShadow: status === 'ok' ? `0 0 6px ${color}` : 'none',
                flexShrink: 0,
                animation: status === 'error' ? 'blink 0.8s step-end infinite' : 'none',
              }} />
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#94a3b8', flex: 1 }}>
                {sub.label}
              </span>
              <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 8, color, letterSpacing: '0.1em' }}>
                {status.toUpperCase()}
              </span>
            </div>
          )
        })}
      </div>

      {/* Packet number */}
      {latest?.pkt && (
        <div style={{
          marginTop: 10,
          textAlign: 'center',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 9,
          color: 'rgba(34,211,238,0.3)',
        }}>
          LAST PKT #{String(latest.pkt).padStart(6, '0')} · {latest._rx_time?.slice(11, 19)} UTC
        </div>
      )}
    </div>
  )
}
