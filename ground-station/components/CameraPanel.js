import { useTelemetryStore } from '../lib/store'
import { useState } from 'react'

export default function CameraPanel({ sendCommand }) {
  const { lastImage } = useTelemetryStore()
  const [requesting, setRequesting] = useState(false)

  const handleCapture = () => {
    setRequesting(true)
    sendCommand({ cmd: 'CAM' })
    setTimeout(() => setRequesting(false), 5000)
  }

  return (
    <div className="panel panel-corner p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="hud-label">CAMERA — ESP32-CAM</span>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 9,
          color: lastImage ? '#34d399' : 'rgba(34,211,238,0.3)',
        }}>
          {lastImage ? '● IMAGE RX' : '○ STANDBY'}
        </span>
      </div>

      {/* Image display */}
      <div style={{
        width: '100%',
        aspectRatio: '4/3',
        background: 'rgba(0,0,0,0.4)',
        border: '1px solid rgba(34,211,238,0.1)',
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {lastImage?.chunk ? (
          <img
            src={`data:image/jpeg;base64,${lastImage.chunk}`}
            alt="CubeSAT camera"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ textAlign: 'center' }}>
            {/* Camera SVG icon */}
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" style={{ opacity: 0.2 }}>
              <rect x="4" y="10" width="32" height="24" rx="3" stroke="#22d3ee" strokeWidth="1.5"/>
              <circle cx="20" cy="22" r="7" stroke="#22d3ee" strokeWidth="1.5"/>
              <circle cx="20" cy="22" r="3" fill="#22d3ee" fillOpacity="0.3"/>
              <rect x="14" y="7" width="8" height="4" rx="1" stroke="#22d3ee" strokeWidth="1.5"/>
              <circle cx="32" cy="14" r="2" fill="#22d3ee" fillOpacity="0.4"/>
            </svg>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: 'rgba(34,211,238,0.3)', marginTop: 8 }}>
              NO IMAGE
            </div>
          </div>
        )}

        {/* Scan line overlay */}
        {requesting && <div className="scan-line" />}

        {/* Overlay info */}
        {lastImage && (
          <div style={{
            position: 'absolute',
            bottom: 4, left: 4, right: 4,
            padding: '3px 6px',
            background: 'rgba(0,0,0,0.7)',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 9,
            color: '#22d3ee',
            display: 'flex',
            justifyContent: 'space-between',
          }}>
            <span>PKT #{lastImage.pkt}</span>
            <span>{lastImage.size} B</span>
          </div>
        )}
      </div>

      {/* Capture button */}
      <button
        onClick={handleCapture}
        disabled={requesting}
        style={{
          marginTop: 10,
          width: '100%',
          padding: '8px',
          background: requesting ? 'rgba(52,211,153,0.05)' : 'rgba(52,211,153,0.1)',
          border: `1px solid ${requesting ? 'rgba(52,211,153,0.2)' : 'rgba(52,211,153,0.4)'}`,
          borderRadius: 2,
          fontFamily: 'Orbitron, monospace',
          fontSize: 9,
          letterSpacing: '0.12em',
          color: requesting ? 'rgba(52,211,153,0.4)' : '#34d399',
          cursor: requesting ? 'not-allowed' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        {requesting ? (
          <>
            <span className="blink">●</span> ACQUIRING...
          </>
        ) : (
          <>◉ CAPTURE IMAGE</>
        )}
      </button>
    </div>
  )
}
