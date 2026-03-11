/**
 * Mock telemetry generator for development/demo mode.
 * Simulates realistic CubeSAT sensor data when no bridge is connected.
 */

let packetCount = 0
let gyroX = 0, gyroY = 0, gyroZ = 0
let accelX = 0, accelY = 0.1, accelZ = 1.0
let roll = 0, pitch = 0
let temp = 22.5, hum = 55.0

export function generateMockPacket() {
  packetCount++

  // Simulate slow tumbling rotation
  gyroX += (Math.random() - 0.5) * 0.5
  gyroY += (Math.random() - 0.5) * 0.5
  gyroZ += (Math.random() - 0.5) * 0.3
  gyroX = Math.max(-30, Math.min(30, gyroX))
  gyroY = Math.max(-30, Math.min(30, gyroY))
  gyroZ = Math.max(-20, Math.min(20, gyroZ))

  // Simulate slight accel variation
  accelX = (Math.random() - 0.5) * 0.1
  accelY = 0.05 + (Math.random() - 0.5) * 0.05
  accelZ = 0.98 + (Math.random() - 0.5) * 0.02

  roll  = Math.atan2(accelY, accelZ) * 180 / Math.PI
  pitch = Math.atan2(-accelX, Math.sqrt(accelY**2 + accelZ**2)) * 180 / Math.PI

  // Drift temp/humidity slowly
  temp += (Math.random() - 0.5) * 0.2
  hum  += (Math.random() - 0.5) * 0.3
  temp = Math.max(18, Math.min(35, temp))
  hum  = Math.max(40, Math.min(80, hum))

  const rssi = -80 + Math.floor(Math.random() * 20)

  return {
    id:    'ARC-SENTINEL-01',
    pkt:   packetCount,
    t:     packetCount * 2,
    v:     1,
    type:  'telemetry',
    accel: {
      x: +accelX.toFixed(3),
      y: +accelY.toFixed(3),
      z: +accelZ.toFixed(3),
    },
    gyro: {
      x: +gyroX.toFixed(2),
      y: +gyroY.toFixed(2),
      z: +gyroZ.toFixed(2),
    },
    roll:      +roll.toFixed(1),
    pitch:     +pitch.toFixed(1),
    mpu_temp:  +(25 + Math.random() * 2).toFixed(1),
    env: {
      temp: +temp.toFixed(1),
      hum:  +hum.toFixed(1),
      hi:   +(temp + 1.5).toFixed(1),
    },
    rssi,
    rssi_gs: rssi - 3,
    snr:  +(5 + Math.random() * 5).toFixed(1),
    _rx_time: new Date().toISOString(),
    _rx_ts:   Date.now() / 1000,
    _demo:    true,
  }
}
