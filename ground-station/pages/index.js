import { useEffect, useState } from 'react'
import Head from 'next/head'
import { useTelemetryStore } from '../lib/store'
import { useGroundStationWS } from '../lib/useWS'
import { generateMockPacket } from '../lib/mockData'

import StatusBar      from '../components/StatusBar'
import AttitudeDisplay from '../components/AttitudeDisplay'
import EnvironmentPanel from '../components/EnvironmentPanel'
import GyroPanel      from '../components/GyroPanel'
import SignalPanel    from '../components/SignalPanel'
import TelemetryLog   from '../components/TelemetryLog'
import CameraPanel    from '../components/CameraPanel'
import SystemMap      from '../components/SystemMap'

export default function Dashboard() {
  const { sendCommand } = useGroundStationWS()
  const { wsStatus, addPacket, setStats } = useTelemetryStore()
  const [demoMode, setDemoMode] = useState(false)

  // Auto-enable demo mode after 4s if no real connection
  useEffect(() => {
    const timer = setTimeout(() => {
      if (wsStatus !== 'connected') {
        setDemoMode(true)
      }
    }, 4000)
    return () => clearTimeout(timer)
  }, [wsStatus])

  // Demo packet generator
  useEffect(() => {
    if (!demoMode) return
    const interval = setInterval(() => {
      const pkt = generateMockPacket()
      addPacket(pkt)
      setStats({
        total_packets: pkt.pkt,
        lost_packets: Math.floor(pkt.pkt * 0.02),
        loss_rate: 2.0,
        last_packet_time: pkt._rx_time,
        last_rssi: pkt.rssi,
      })
    }, 2000)
    return () => clearInterval(interval)
  }, [demoMode, addPacket, setStats])

  return (
    <>
      <Head>
        <title>ARC Sentinel — Ground Station</title>
        <meta name="description" content="ARC Sentinel Ground Station — Real-Time Telemetry" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="relative min-h-screen" style={{ background: 'var(--color-bg)' }}>
        {/* Grid overlay */}
        <div className="fixed inset-0 pointer-events-none" style={{
          backgroundImage: `
            linear-gradient(rgba(34,211,238,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(34,211,238,0.03) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
          zIndex: 0,
        }} />

        <div className="relative z-10 flex flex-col min-h-screen">
          {/* ─── Status Bar ─── */}
          <StatusBar
            demoMode={demoMode}
            onToggleDemo={() => setDemoMode(d => !d)}
            sendCommand={sendCommand}
          />

          {/* ─── Main Grid ─── */}
          <main className="flex-1 p-3 grid gap-3" style={{
            gridTemplateColumns: '280px 1fr 280px',
            gridTemplateRows: 'auto auto auto',
          }}>

            {/* Left Column */}
            <div className="flex flex-col gap-3">
              <SystemMap />
              <SignalPanel />
              <CameraPanel sendCommand={sendCommand} />
            </div>

            {/* Center Column */}
            <div className="flex flex-col gap-3">
              <AttitudeDisplay />
              <GyroPanel />
            </div>

            {/* Right Column */}
            <div className="flex flex-col gap-3">
              <EnvironmentPanel />
              <TelemetryLog />
            </div>
          </main>

          {/* ─── Footer ─── */}
          <footer className="px-4 py-2 flex items-center justify-between terminal opacity-40">
            <span>ARC SENTINEL GROUND STATION v1.0</span>
            <span>433 MHz · SF10 · BW125 · CR4/5</span>
          </footer>
        </div>
      </div>
    </>
  )
}
