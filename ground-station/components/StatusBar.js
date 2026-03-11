import { useTelemetryStore } from '../lib/store'
import { useState, useEffect } from 'react'

const STATUS_COLORS = {
  connected:    '#34d399',
  connecting:   '#fbbf24',
  disconnected: '#f87171',
  error:        '#f87171',
}

const STATUS_LABELS = {
  connected:    'LINK ESTABLISHED',
  connecting:   'ACQUIRING SIGNAL',
  disconnected: 'NO SIGNAL',
  error:        'LINK ERROR',
}

export default function StatusBar({ demoMode, onToggleDemo, sendCommand }) {
  const { wsStatus, stats, latest } = useTelemetryStore()
  const [clock, setClock] = useState('')

  useEffect(() => {
    const tick = () => setClock(new Date().toUTCString().split(' ').slice(0, -1).join(' ') + ' UTC')
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [])

  const color = STATUS_COLORS[wsStatus]

  const handlePing = () => sendCommand({ cmd: 'PING' })
  const handleCam  = () => sendCommand({ cmd: 'CAM'  })

  return (
    <header style={{
      background: 'rgba(5, 13, 26, 0.95)',
      borderBottom: '1px solid rgba(34, 211, 238, 0.2)',
      backdropFilter: 'blur(10px)',
    }} className="sticky top-0 z-50 px-4 py-2 flex items-center justify-between">

      {/* Left: Logo */}
      <div className="flex items-center gap-3">
        <img src="/logo.png" alt="ARC Sentinel" style={{ width: 32, height: 32, objectFit: 'contain', filter: 'brightness(0) invert(1) sepia(1) saturate(3) hue-rotate(170deg)' }} />
        <div style={{ fontFamily: 'Orbitron, monospace', color: '#22d3ee', fontSize: 16, fontWeight: 900, letterSpacing: '0.12em' }}>
          ARC SENTINEL
        </div>
        <div style={{ width: 1, height: 24, background: 'rgba(34,211,238,0.2)' }} />
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'rgba(34,211,238,0.5)', letterSpacing: '0.1em' }}>
          GROUND STATION
        </div>
      </div>

      {/* Center: Status */}
      <div className="flex items-center gap-6">
        {/* Link status */}
        <div className="flex items-center gap-2">
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: color,
            boxShadow: `0 0 8px ${color}`,
            animation: wsStatus === 'connected' ? 'none' : 'blink 1s step-end infinite',
          }} />
          <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 9, letterSpacing: '0.12em', color }}>
            {STATUS_LABELS[wsStatus]}
          </span>
        </div>

        {/* Packet counter */}
        <div className="flex items-center gap-1" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
          <span style={{ color: 'rgba(34,211,238,0.4)' }}>PKT</span>
          <span style={{ color: '#e2e8f0' }}>{String(stats.total_packets).padStart(6, '0')}</span>
        </div>

        {/* Loss rate */}
        <div className="flex items-center gap-1" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
          <span style={{ color: 'rgba(34,211,238,0.4)' }}>LOSS</span>
          <span style={{ color: stats.loss_rate > 5 ? '#f87171' : '#34d399' }}>
            {stats.loss_rate?.toFixed(1) || '0.0'}%
          </span>
        </div>

        {/* RSSI */}
        {stats.last_rssi && (
          <div className="flex items-center gap-1" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
            <span style={{ color: 'rgba(34,211,238,0.4)' }}>RSSI</span>
            <span style={{ color: stats.last_rssi > -90 ? '#34d399' : '#fbbf24' }}>
              {stats.last_rssi} dBm
            </span>
          </div>
        )}

        {/* Demo badge */}
        {demoMode && (
          <div style={{
            background: 'rgba(251, 191, 36, 0.15)',
            border: '1px solid rgba(251, 191, 36, 0.4)',
            borderRadius: 2,
            padding: '2px 8px',
            fontFamily: 'Orbitron, monospace',
            fontSize: 9,
            color: '#fbbf24',
            letterSpacing: '0.12em',
          }}>
            ● DEMO MODE
          </div>
        )}
      </div>

      {/* Right: Controls + Clock */}
      <div className="flex items-center gap-3">
        <button onClick={handlePing} style={{
          background: 'rgba(34,211,238,0.1)',
          border: '1px solid rgba(34,211,238,0.3)',
          borderRadius: 2,
          padding: '4px 10px',
          fontFamily: 'Orbitron, monospace',
          fontSize: 9,
          color: '#22d3ee',
          letterSpacing: '0.1em',
          cursor: 'pointer',
        }}>
          PING
        </button>
        <button onClick={handleCam} style={{
          background: 'rgba(52,211,153,0.1)',
          border: '1px solid rgba(52,211,153,0.3)',
          borderRadius: 2,
          padding: '4px 10px',
          fontFamily: 'Orbitron, monospace',
          fontSize: 9,
          color: '#34d399',
          letterSpacing: '0.1em',
          cursor: 'pointer',
        }}>
          CAPTURE
        </button>

        <div style={{ width: 1, height: 20, background: 'rgba(34,211,238,0.15)' }} />

        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'rgba(34,211,238,0.4)' }}>
          {clock}
        </div>
      </div>
    </header>
  )
}
