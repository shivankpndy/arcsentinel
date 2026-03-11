import { useEffect, useRef, useCallback } from 'react'
import { useTelemetryStore } from './store'

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8765'
const RECONNECT_DELAY = 3000

export function useGroundStationWS() {
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const {
    setConnected,
    setWsStatus,
    addPacket,
    setStats,
    setImage,
    loadHistory,
    addLog,
  } = useTelemetryStore()

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    setWsStatus('connecting')
    addLog({ ts: new Date().toLocaleTimeString(), type: 'sys', summary: `Connecting to ${WS_URL}...` })

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      setWsStatus('connected')
      addLog({ ts: new Date().toLocaleTimeString(), type: 'sys', summary: 'WebSocket connected to ground bridge' })
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)

        switch (msg.type) {
          case 'packet':
            if (msg.data.type === 'IMG') {
              setImage(msg.data)
            } else {
              addPacket(msg.data)
            }
            if (msg.stats) setStats(msg.stats)
            break

          case 'history':
            if (msg.packets?.length > 0) {
              loadHistory(msg.packets, msg.stats)
            }
            break

          case 'status':
            if (msg.stats) setStats(msg.stats)
            break

          default:
            break
        }
      } catch (e) {
        console.error('[WS] Parse error:', e)
      }
    }

    ws.onerror = (err) => {
      setWsStatus('error')
      addLog({ ts: new Date().toLocaleTimeString(), type: 'err', summary: 'WebSocket error — is the bridge running?' })
    }

    ws.onclose = () => {
      setConnected(false)
      setWsStatus('disconnected')
      addLog({ ts: new Date().toLocaleTimeString(), type: 'sys', summary: `Disconnected. Reconnecting in ${RECONNECT_DELAY / 1000}s...` })
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  const sendCommand = useCallback((cmd) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd))
    }
  }, [])

  return { sendCommand }
}
