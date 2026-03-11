#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════╗
║         CUBESAT GROUND STATION - LoRa Serial Bridge         ║
║   Receives LoRa packets via USB-connected LoRa module       ║
║   Forwards to Next.js ground station via WebSocket          ║
╚══════════════════════════════════════════════════════════════╝

HARDWARE: Connect a second LoRa SX1276 module to your PC via:
  Option A: USB-to-Serial adapter + Arduino (recommended)
  Option B: Raspberry Pi with SX1276 HAT
  Option C: Commercial LoRa USB dongle (RAK811, etc.)

For Option A, upload the companion sketch:
  firmware/lora_ground_receiver.ino  → to an Arduino/ESP32

INSTALL:
  pip install pyserial websockets asyncio

RUN:
  python3 ground_station_bridge.py --port /dev/ttyUSB0 --baud 115200
"""

import asyncio
import json
import serial
import serial.tools.list_ports
import websockets
import argparse
import time
import sys
from datetime import datetime
from collections import deque

# ─── Config ──────────────────────────────────────────────────
WS_HOST = "localhost"
WS_PORT = 8765
MAX_HISTORY = 500

# ─── State ───────────────────────────────────────────────────
connected_clients = set()
packet_history = deque(maxlen=MAX_HISTORY)
stats = {
    "total_packets": 0,
    "lost_packets": 0,
    "last_packet_time": None,
    "uptime_start": time.time(),
    "last_rssi": None,
    "last_snr": None,
}

# ─────────────────────────────────────────────────────────────
async def broadcast(message: dict):
    """Broadcast a message to all connected WebSocket clients."""
    if not connected_clients:
        return
    payload = json.dumps(message)
    disconnected = set()
    for ws in connected_clients:
        try:
            await ws.send(payload)
        except websockets.exceptions.ConnectionClosed:
            disconnected.add(ws)
    connected_clients -= disconnected

# ─────────────────────────────────────────────────────────────
async def handle_client(websocket, path):
    """Handle a new WebSocket client connection."""
    connected_clients.add(websocket)
    addr = websocket.remote_address
    print(f"[WS] Client connected: {addr}")

    # Send history on connect
    await websocket.send(json.dumps({
        "type": "history",
        "packets": list(packet_history),
        "stats": stats,
    }))

    try:
        async for message in websocket:
            # Handle uplink commands from UI
            try:
                cmd = json.loads(message)
                print(f"[CMD] Received from UI: {cmd}")
                # Commands would be forwarded to LoRa TX here
                # (requires separate TX implementation)
            except json.JSONDecodeError:
                pass
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)
        print(f"[WS] Client disconnected: {addr}")

# ─────────────────────────────────────────────────────────────
def parse_packet(raw: str) -> dict | None:
    """Parse a raw serial line into a telemetry packet."""
    raw = raw.strip()
    if not raw or not raw.startswith("{"):
        return None

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"[PARSE] JSON error: {e} | raw: {raw[:80]}")
        return None

    # Enrich with ground station metadata
    data["_rx_time"]  = datetime.utcnow().isoformat() + "Z"
    data["_rx_ts"]    = time.time()
    data["type"]      = data.get("type", "telemetry")

    return data

# ─────────────────────────────────────────────────────────────
async def serial_reader(port: str, baud: int):
    """Read from serial port and broadcast to WebSocket clients."""
    print(f"[SERIAL] Opening {port} @ {baud} baud...")

    try:
        ser = serial.Serial(port, baud, timeout=1)
    except serial.SerialException as e:
        print(f"[SERIAL] ERROR: {e}")
        print("\nAvailable ports:")
        for p in serial.tools.list_ports.comports():
            print(f"  {p.device:20} — {p.description}")
        sys.exit(1)

    print(f"[SERIAL] Connected to {port}")
    last_pkt_num = -1

    while True:
        try:
            line = ser.readline().decode("utf-8", errors="replace")
        except Exception as e:
            print(f"[SERIAL] Read error: {e}")
            await asyncio.sleep(1)
            continue

        if not line.strip():
            await asyncio.sleep(0.01)
            continue

        packet = parse_packet(line)
        if not packet:
            # Print non-JSON lines as debug
            if line.strip():
                print(f"[DBG] {line.strip()}")
            continue

        # ─── Packet loss detection ────────────────────────
        pkt_num = packet.get("pkt", -1)
        if last_pkt_num >= 0 and pkt_num > 0:
            expected = last_pkt_num + 1
            if pkt_num > expected:
                lost = pkt_num - expected
                stats["lost_packets"] += lost
                print(f"[WARN] Packet loss detected: {lost} packets missed")
        last_pkt_num = pkt_num

        # ─── Update stats ─────────────────────────────────
        stats["total_packets"] += 1
        stats["last_packet_time"] = packet["_rx_time"]
        if "rssi" in packet:
            stats["last_rssi"] = packet["rssi"]

        loss_rate = 0
        if stats["total_packets"] > 0:
            total = stats["total_packets"] + stats["lost_packets"]
            loss_rate = round(stats["lost_packets"] / total * 100, 1)
        stats["loss_rate"] = loss_rate

        # ─── Store and broadcast ──────────────────────────
        packet_history.append(packet)

        msg = {
            "type": "packet",
            "data": packet,
            "stats": stats,
        }

        await broadcast(msg)

        # Console summary
        pkt_type = packet.get("type", "telemetry")
        if pkt_type == "telemetry":
            env  = packet.get("env", {})
            gyro = packet.get("gyro", {})
            print(
                f"[RX #{pkt_num:04d}] "
                f"T={env.get('temp','?')}°C "
                f"H={env.get('hum','?')}% "
                f"Gy=({gyro.get('x','?')},{gyro.get('y','?')},{gyro.get('z','?')}) "
                f"RSSI={packet.get('rssi','?')}dBm"
            )
        elif pkt_type == "IMG":
            print(f"[RX IMG] size={packet.get('size','?')} bytes")

        await asyncio.sleep(0)  # Yield to event loop

# ─────────────────────────────────────────────────────────────
async def status_broadcaster():
    """Periodically broadcast station status."""
    while True:
        await asyncio.sleep(5)
        await broadcast({
            "type": "status",
            "stats": stats,
            "clients": len(connected_clients),
            "uptime": round(time.time() - stats["uptime_start"]),
        })

# ─────────────────────────────────────────────────────────────
async def main(port: str, baud: int):
    print("╔══════════════════════════════════════════╗")
    print("║   CUBESAT Ground Station Bridge v1.0    ║")
    print("╚══════════════════════════════════════════╝")
    print(f"  WebSocket: ws://{WS_HOST}:{WS_PORT}")
    print(f"  Serial:    {port} @ {baud}")
    print("─" * 44)

    ws_server = await websockets.serve(handle_client, WS_HOST, WS_PORT)

    await asyncio.gather(
        serial_reader(port, baud),
        status_broadcaster(),
    )

# ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CubeSAT Ground Station Bridge")
    parser.add_argument("--port",  default="/dev/ttyUSB0",
                        help="Serial port (e.g. COM3 or /dev/ttyUSB0)")
    parser.add_argument("--baud",  type=int, default=115200,
                        help="Baud rate (default: 115200)")
    args = parser.parse_args()

    try:
        asyncio.run(main(args.port, args.baud))
    except KeyboardInterrupt:
        print("\n[SYS] Ground station shut down.")
