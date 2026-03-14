<h1>
  <img src="logo.png" width="100" height="110" alt="ARC Sentinel">
  ARC SENTINEL
</h1>

> **Autonomous Remote CubeSAT — Sentinel Platform v1.0**


![Platform](https://img.shields.io/badge/Platform-ESP32-blue?style=flat-square&logo=espressif)
![Radio](https://img.shields.io/badge/Radio-LoRa%20433MHz-06b6d4?style=flat-square)
![Range](https://img.shields.io/badge/Range-5%20km-22c55e?style=flat-square)
![OTA](https://img.shields.io/badge/OTA-Enabled-f97316?style=flat-square)
![Dashboard](https://img.shields.io/badge/Dashboard-Next.js-000000?style=flat-square&logo=next.js)
![Cost](https://img.shields.io/badge/Build%20Cost-%2451-eab308?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-94a3b8?style=flat-square)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ARC SENTINEL SYSTEM                           │
└─────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────────┐        LoRa RF Link           ┌──────────────────┐
  │   ARC SENTINEL       │      433 MHz · 5 km           │  GROUND STATION  │
  │   Flight Computer    │◄─────────────────────────────►│  Arduino/ESP32   │
  │                      │   SF10 · BW125 · CR4/5        │  + LoRa Module   │
  │  ┌───────────────┐   │   SyncWord: 0xF3              └────────┬─────────┘
  │  │  MPU6050 IMU  │   │   TX Power: 20 dBm                     │
  │  │  DHT11 Sensor │   │   Packet interval: 2s                  │ USB Serial
  │  │  LoRa SX1276  │   │                                        │ 115200 baud
  │  └───────────────┘   │                               ┌────────▼─────────┐
  │         │            │                               │  ground_station  │
  │    Serial2 UART      │                               │  _bridge.py      │
  │         │            │                               │  WebSocket :8765 │
  │  ┌──────▼────────┐   │                               └────────┬─────────┘
  │  │  ESP32-CAM    │   │                                        │ WebSocket
  │  │  OV2640       │   │                               ┌────────▼─────────┐
  │  │  OTA receiver │   │                               │  Next.js UI      │
  │  └───────────────┘   │                               │  Dashboard :3000 │
  └──────────────────────┘                               └──────────────────┘

  OTA uplink via arc_uplink.py:
  PC ──► Ground Receiver (USB) ──► LoRa RF ──► Flight Computer ──► FC or CAM
```

**Downlink — satellite to ground**

1. Flight computer reads sensors every 2 seconds, serializes to JSON, transmits via LoRa
2. Ground receiver picks up the packet, injects RSSI/SNR, forwards over USB serial to PC
3. Python bridge reads serial, detects packet loss, broadcasts via WebSocket on port 8765
4. Next.js dashboard receives over WebSocket and updates all panels in real time

---


### Wiring — Flight Computer

```
LoRa SX1276 / Ra-02          MPU6050 Gyroscope and Accelerometer
────────────────────         ───────────────────────────────────
VCC  →  3.3V                 VCC  →  3.3V
GND  →  GND                  GND  →  GND
SCK  →  GPIO 18              SDA  →  GPIO 21
MISO →  GPIO 19              SCL  →  GPIO 22
MOSI →  GPIO 23
NSS  →  GPIO 5   (CS)        DHT11 Temperature and Humidity
RST  →  GPIO 14              ───────────────────────────────────
DIO0 →  GPIO 2               VCC  →  3.3V
                             GND  →  GND
ESP32-CAM via UART           DATA →  GPIO 4  with 10kΩ pull-up to 3.3V
────────────────────
5V   →  5V
GND  →  GND
TX   →  GPIO 16  (ESP32 RX2)
RX   →  GPIO 17  (ESP32 TX2)
```

---

### Wiring — Ground Receiver

Wire a second LoRa SX1276 to a spare Arduino or ESP32 sitting on your desk. Connect that board to your PC via USB. Use the same SPI pin mapping as the flight computer.

```
LoRa SX1276 → Ground Arduino or ESP32
──────────────────────────────────────
VCC  →  3.3V      SCK  →  GPIO 18
GND  →  GND       MISO →  GPIO 19
NSS  →  GPIO 5    MOSI →  GPIO 23
RST  →  GPIO 14   DIO0 →  GPIO 2
                          │
                    USB to PC
                          │
              ground_station_bridge.py
```

The ground receiver firmware injects `rssi_gs` and `snr` into each received JSON packet before forwarding to the PC at 115200 baud.

---

### Flight Computer Firmware

**File:** `firmware/flight_computer_ota/flight_computer_ota.ino`

The main ESP32 firmware. Every 2 seconds it reads all sensors, builds a JSON packet, and transmits over LoRa. Between transmissions it listens for uplink commands. It also maintains an OTA state machine capable of receiving full firmware binaries over the radio link.

Increment `APP_VERSION` before each OTA push — it shows up in every telemetry packet so you can confirm remotely that the flash succeeded.

```cpp
#define LORA_FREQ          433E6          // change to 915E6 for US / Canada
#define TELEMETRY_INTERVAL 2000           // milliseconds between packets
#define OTA_CHUNK_SIZE     128            // bytes per LoRa OTA chunk
#define APP_VERSION        "1.0.0"        // increment before each OTA push
#define SATELLITE_ID       "ARC-SENTINEL-01"
```

---

### ESP32-CAM Firmware

**File:** `firmware/esp32cam_ota/esp32cam_ota.ino`

Runs on the AI Thinker ESP32-CAM. Talks to the flight computer over UART on Serial. Listens for text commands:

| Command | Action |
|---|---|
| `CAPTURE` | Capture JPEG, base64-encode, send between `IMG_START` and `IMG_END` markers |
| `STATUS` | Reply with camera state and firmware version |
| `OTA_BEGIN <size> <chunks>` | Prepare to receive firmware |
| `OTA_CHUNK <seq> <len>` | Write chunk to OTA flash partition |
| `OTA_END <md5>` | Validate MD5 and reboot into new firmware |
| `OTA_ABORT` | Cancel OTA — stays on current firmware |

---

### Ground Receiver Firmware

**File:** `firmware/lora_ground_receiver/lora_ground_receiver.ino`

Runs on any Arduino or ESP32 connected to your PC via USB. Receives LoRa packets, injects `rssi_gs` and `snr` into the JSON, and forwards everything to the PC over serial. For uplink, reads JSON lines from serial and transmits them over LoRa.

> Must use **identical LoRa settings** as the flight computer — same frequency, SF, bandwidth, coding rate, and sync word `0xF3`.

---

### Ground Station Bridge

**File:** `ground-station/ground_station_bridge.py`

Sits between your USB serial port and the Next.js dashboard.

- Parses incoming JSON telemetry from the ground receiver
- Detects packet sequence gaps and tracks packet loss
- Broadcasts all packets to connected WebSocket clients on port 8765
- Forwards uplink commands from the UI back to serial

```bash
pip install pyserial websockets

python ground_station_bridge.py --port /dev/ttyUSB0    # Linux / Mac
python ground_station_bridge.py --port COM3             # Windows
```

Keep this running in a terminal while the dashboard is open.

---

### Ground Station UI

**File:** `ground-station/` — Next.js application

Real-time telemetry dashboard. All panels update live as packets arrive. If the bridge is not running, demo mode activates after 4 seconds with realistic simulated telemetry so you can develop and test without hardware.

```bash
cd ground-station
npm install
npm run dev
```

Open **http://localhost:3000**

To run the bridge on a different machine, set in `.env.local`:

```
NEXT_PUBLIC_WS_URL=ws://192.168.1.100:8765
```

---

### OTA Uplink Tool

**File:** `tools/arc_uplink.py`

Compiles Arduino sketches via `arduino-cli`, splits the resulting binary into 128-byte chunks, sends each chunk over LoRa with per-chunk ACK and retry, then validates the full MD5 before the satellite reboots.

```bash
pip install pyserial tqdm

python arc_uplink.py ping                                               # test link
python arc_uplink.py status                                             # firmware version
python arc_uplink.py flash-fc  firmware/flight_computer_ota/flight_computer_ota.ino
python arc_uplink.py flash-cam firmware/esp32cam_ota/esp32cam_ota.ino
python arc_uplink.py flash-bin my_firmware.bin FC                       # pre-compiled
python arc_uplink.py set interval 5000                                  # runtime param
python arc_uplink.py abort                                              # emergency stop
```

Edit `SERIAL_PORT` near the top of the file to match your ground receiver's USB port.

---

## LoRa Radio Configuration

Both radios must have **identical settings**. Any mismatch means they cannot decode each other's packets.

| Parameter | Value | Notes |
|---|---|---|
| Frequency | **433 MHz** | Change to `915E6` for US / Canada |
| Spreading Factor | **SF10** | SF7 is ~8× faster but shorter range |
| Bandwidth | **125 kHz** | Good noise rejection |
| Coding Rate | **4/5** | Forward error correction |
| TX Power | **20 dBm** | Maximum output |
| Sync Word | **0xF3** | Private network — ignores all other LoRa traffic |
| Telemetry Interval | 2000 ms | Changeable live via `SET` command without reflash |
| Expected Range | 5–15 km | Line of sight at 20 dBm SF10 |

---

## Telemetry Packet Format

```json
{
  "id":       "ARC-SENTINEL-01",
  "pkt":      42,
  "t":        84.0,
  "ver":      "1.0.0",
  "accel":    { "x": 0.010, "y": 0.050, "z": 0.980 },
  "gyro":     { "x": 1.23,  "y": -0.45, "z": 0.78  },
  "roll":     3.2,
  "pitch":    -1.1,
  "mpu_temp": 27.4,
  "env": {
    "temp":   22.5,
    "hum":    55.0,
    "hi":     24.1
  },
  "rssi":     -72,
  "rssi_gs":  -75,
  "snr":      8.5
}
```

| Field | Unit | Description |
|---|---|---|
| `id` | — | Satellite identifier |
| `pkt` | — | Sequence number — gaps indicate lost packets |
| `t` | s | Mission elapsed time since last boot |
| `ver` | — | Firmware version — changes after a successful OTA |
| `accel.x/y/z` | g | Accelerometer readings |
| `gyro.x/y/z` | °/s | Angular rate from gyroscope |
| `roll` / `pitch` | ° | Computed from accelerometer via atan2 |
| `mpu_temp` | °C | MPU6050 internal die temperature |
| `env.temp` | °C | DHT11 ambient temperature |
| `env.hum` | % RH | DHT11 relative humidity |
| `env.hi` | °C | Heat index — feels-like temperature |
| `rssi` | dBm | Signal strength measured on the satellite |
| `rssi_gs` | dBm | Signal strength measured at the ground station |
| `snr` | dB | Signal-to-noise ratio at ground |

---

## Uplink Commands

| Command | JSON | Effect |
|---|---|---|
| `PING` | `{"cmd":"PING"}` | Satellite replies PONG with packet count |
| `CAM` | `{"cmd":"CAM"}` | Triggers ESP32-CAM image capture |
| `SET` | `{"cmd":"SET","key":"interval","val":5000}` | Change telemetry interval live |
| `OTA_BEGIN` | `{"cmd":"OTA_BEGIN","target":"FC","size":98304,"chunks":768,"md5":"..."}` | Start OTA session |
| `OTA_CHUNK` | `{"cmd":"OTA_CHUNK","seq":0,"data":"<base64>"}` | Deliver one firmware chunk |
| `OTA_END` | `{"cmd":"OTA_END","md5":"abc123..."}` | Validate MD5 and reboot |
| `OTA_ABORT` | `{"cmd":"OTA_ABORT"}` | Cancel OTA — old firmware stays running |
| `OTA_STATUS` | `{"cmd":"OTA_STATUS"}` | Query firmware version and OTA state |
| `RESET_CTR` | `{"cmd":"RESET_CTR"}` | Reset packet counter to zero |

---

### OTA Time Estimates

Effective throughput at SF10 / BW125 / CR4-5 is approximately **400 bps**.

| Firmware Size | Chunks | Time at SF10 |
|---|---|---|
| 100 KB | 800 | ~35 min |
| 200 KB | 1,600 | ~70 min |
| 400 KB | 3,200 | ~140 min |

To speed up: switch both radios to SF7 for ~8× faster transfer while the satellite is nearby, then back to SF10 for normal operation.

---

## Setup and Installation

### Step 1 — Arduino IDE Setup

Add ESP32 board support. Go to File → Preferences → Additional Board Manager URLs and add:

```
https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
```

Then go to Tools → Board → Boards Manager, search **esp32**, and install the package by Espressif.

Install these libraries via Tools → Library Manager:

| Library | Author |
|---|---|
| LoRa | Sandeep Mistry |
| MPU6050 | Electronic Cats |
| DHT sensor library | Adafruit |
| ArduinoJson | Benoit Blanchon |
| Base64 | Agus Kurniawan |

**Set the OTA partition scheme before first flash** — do this for both the flight computer ESP32 and the ESP32-CAM:

```
Tools → Partition Scheme → Minimal SPIFFS (1.9MB APP with OTA)
```

Without this, `Update.begin()` fails at runtime and OTA will not work.

---

### Step 2 — Flash All Firmware via USB Once

After this initial USB flash, all future updates to the satellite go over LoRa.

| Sketch | Board in Arduino IDE | Target |
|---|---|---|
| `flight_computer_ota.ino` | ESP32 Dev Module | Main ESP32 flight computer |
| `esp32cam_ota.ino` | AI Thinker ESP32-CAM | ESP32-CAM module |
| `lora_ground_receiver.ino` | Match your ground board | Ground receiver |

> For the ESP32-CAM: pull IO0 LOW before uploading, then release it before pressing reset. Most AI Thinker boards have a PROG button for this.

---

### Step 3 — Python Ground Tools

```bash
pip install pyserial tqdm websockets
```

---

### Step 4 — arduino-cli for OTA Auto-Compile

Optional but recommended. Lets the uplink tool compile sketches automatically without opening the IDE.

```bash
# Windows
winget install arduino.arduinocli

# Mac
brew install arduino-cli

# Both platforms
arduino-cli core install esp32:esp32
```

If you prefer to compile manually, use Arduino IDE → Sketch → Export Compiled Binary, then run `arc_uplink.py flash-bin firmware.bin FC`.

---

### Step 5 — Run the Ground Station

```bash
# Terminal 1 — keep this running the whole time
python ground-station/ground_station_bridge.py --port /dev/ttyUSB0

# Terminal 2
cd ground-station
npm install
npm run dev
```

Open **http://localhost:3000** — if the bridge is not running, demo mode activates after 4 seconds.

---

### Step 6 — Your First OTA Update

```bash
# Confirm the satellite is in range
python tools/arc_uplink.py ping

# Check what firmware version is currently running
python tools/arc_uplink.py status

# Flash new flight computer firmware
python tools/arc_uplink.py flash-fc firmware/flight_computer_ota/flight_computer_ota.ino

# Flash new ESP32-CAM firmware — relayed through the flight computer
python tools/arc_uplink.py flash-cam firmware/esp32cam_ota/esp32cam_ota.ino
```

After success the satellite reboots. The `ver` field in the telemetry log changes to the new version within about 30 seconds.

---

## License

MIT License — build your own satellite.

```
Copyright (c) 2026 ARC Sentinel Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
```

---

`ARC SENTINEL v1.0 · 433 MHz · SF10 · BW125 · CR4/5 · OTA ENABLED`

*Open source. Built on ESP32 and LoRa.*
