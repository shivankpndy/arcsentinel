import { create } from 'zustand'

export const MAX_HISTORY = 120 // ~4 minutes at 2s intervals

export const useTelemetryStore = create((set, get) => ({
  // Connection
  connected: false,
  wsStatus: 'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'error'

  // Latest packet
  latest: null,

  // History arrays (for charts)
  history: [],          // last N telemetry packets
  tempHistory: [],
  humHistory: [],
  gyroHistory: [],
  accelHistory: [],
  rssiHistory: [],

  // Station stats
  stats: {
    total_packets: 0,
    lost_packets: 0,
    loss_rate: 0,
    last_packet_time: null,
    last_rssi: null,
    uptime_start: null,
  },

  // Images
  lastImage: null,

  // Log
  log: [],

  // ─── Actions ────────────────────────────────────────────────
  setConnected: (v) => set({ connected: v }),
  setWsStatus: (s) => set({ wsStatus: s }),

  addPacket: (packet) => set((state) => {
    const ts = new Date(packet._rx_time || Date.now()).toLocaleTimeString()
    const point = { ts, ...packet }

    const history = [...state.history, packet].slice(-MAX_HISTORY)

    const tempHistory = packet.env
      ? [...state.tempHistory, { ts, value: packet.env.temp }].slice(-MAX_HISTORY)
      : state.tempHistory

    const humHistory = packet.env
      ? [...state.humHistory, { ts, value: packet.env.hum }].slice(-MAX_HISTORY)
      : state.humHistory

    const gyroHistory = packet.gyro
      ? [...state.gyroHistory, {
          ts,
          x: packet.gyro.x,
          y: packet.gyro.y,
          z: packet.gyro.z,
        }].slice(-MAX_HISTORY)
      : state.gyroHistory

    const accelHistory = packet.accel
      ? [...state.accelHistory, {
          ts,
          x: packet.accel.x,
          y: packet.accel.y,
          z: packet.accel.z,
        }].slice(-MAX_HISTORY)
      : state.accelHistory

    const rssiHistory = packet.rssi != null
      ? [...state.rssiHistory, { ts, value: packet.rssi }].slice(-MAX_HISTORY)
      : state.rssiHistory

    const logEntry = {
      ts,
      pkt: packet.pkt,
      type: packet.type || 'telemetry',
      summary: packet.env
        ? `T=${packet.env.temp}°C H=${packet.env.hum}% RSSI=${packet.rssi}dBm`
        : JSON.stringify(packet).substring(0, 60),
    }

    return {
      latest: packet,
      history,
      tempHistory,
      humHistory,
      gyroHistory,
      accelHistory,
      rssiHistory,
      log: [logEntry, ...state.log].slice(0, 200),
    }
  }),

  setStats: (stats) => set({ stats }),

  setImage: (imgData) => set({ lastImage: imgData }),

  loadHistory: (packets, stats) => {
    const store = get()
    packets.forEach(p => store.addPacket(p))
    set({ stats })
  },

  addLog: (entry) => set((state) => ({
    log: [entry, ...state.log].slice(0, 200),
  })),
}))
