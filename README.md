<h1>
  <img src="logo.png" width="100" height="110" alt="ARC Sentinel">
  ARC SENTINEL
</h1>

> **Autonomous Remote CubeSAT — Sentinel Platform v1.0**

**A satellite you can build for $51. Flash new firmware from 5 kilometers away. No cables. No proximity. Just LoRa.**

![Platform](https://img.shields.io/badge/Platform-ESP32-blue?style=flat-square&logo=espressif)
![Radio](https://img.shields.io/badge/Radio-LoRa%20433MHz-06b6d4?style=flat-square)
![Range](https://img.shields.io/badge/Range-5%20km-22c55e?style=flat-square)
![OTA](https://img.shields.io/badge/OTA-Enabled-f97316?style=flat-square)
![Dashboard](https://img.shields.io/badge/Dashboard-Next.js-000000?style=flat-square&logo=next.js)
![Cost](https://img.shields.io/badge/Build%20Cost-%2451-eab308?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-94a3b8?style=flat-square)

---

## What Is ARC Sentinel?

ARC Sentinel is a fully open-source CubeSAT (nanosatellite) platform built entirely from consumer electronics. It transmits real-time telemetry — gyroscope data, temperature, humidity, camera images — to a ground station over a 433 MHz LoRa radio link up to 5 kilometers away.

What makes it unusual: you can **upload entirely new firmware to the satellite wirelessly, mid-flight**, over the same LoRa link. No USB cable. No physical access. The ground station tool compiles your Arduino sketch, splits the binary into chunks, sends it over LoRa with per-chunk acknowledgement and MD5 validation, and the satellite reboots into the new code — all while it's in the air.

The ground station is a **Next.js dashboard** that connects over WebSocket and shows live attitude, sensor readings, signal quality, and camera captures — with a demo mode that simulates realistic telemetry if no hardware is connected.

---

## Table of Contents

- [Features](#features)
- [System Architecture](#system-architecture)
- [Hardware](#hardware)
  - [Bill of Materials](#bill-of-materials)
  - [Wiring — Flight Computer](#wiring--flight-computer)
  - [Wiring — Ground Receiver](#wiring--ground-receiver)
- [Software](#software)
  - [Project Structure](#project-structure)
  - [Flight Computer Firmware](#flight-computer-firmware)
  - [ESP32-CAM Firmware](#esp32-cam-firmware)
  - [Ground Receiver Firmware](#ground-receiver-firmware)
  - [Ground Station Bridge](#ground-station-bridge)
  - [Ground Station UI](#ground-station-ui)
  - [OTA Uplink Tool](#ota-uplink-tool)
- [LoRa Radio Configuration](#lora-radio-configuration)
- [Telemetry Packet Format](#telemetry-packet-format)
- [Uplink Commands](#uplink-commands)
- [OTA Wireless Firmware Updates](#ota-wireless-firmware-updates)
  - [How OTA Works](#how-ota-works)
  - [OTA Safety](#ota-safety)
  - [OTA Time Estimates](#ota-time-estimates)
- [Setup and Installation](#setup-and-installation)
- [Ground Station Dashboard Panels](#ground-station-dashboard-panels)
- [Power Budget](#power-budget)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Features

| | Feature | Detail |
|---|---|---|
| 🛰️ | **Flight Computer** | ESP32 Xtensa LX6 240 MHz — reads all sensors, transmits telemetry, handles OTA |
| 📡 | **Radio Link** | LoRa SX1276 · 433 MHz · SF10 · 125 kHz BW · 20 dBm · up to 5–15 km line of sight |
| 🔄 | **IMU** | MPU6050 — 3-axis gyroscope ±500°/s · 3-axis accelerometer ±4g · roll and pitch computed |
| 🌡️ | **Environmental** | DHT11 — temperature ±2°C · humidity ±5% RH · heat index |
| 📷 | **Camera** | ESP32-CAM OV2640 — JPEG capture on command, base64-encoded, transmitted over LoRa |
| 🔁 | **OTA Updates** | Flash entirely new firmware from 5 km away over LoRa — no cables ever needed |
| 📊 | **Ground Station** | Next.js real-time dashboard — attitude, gyro charts, signal quality, camera panel |
| 🔌 | **WebSocket Bridge** | Python bridge — LoRa serial to WebSocket to dashboard, with packet loss detection |
| 🧪 | **Demo Mode** | Dashboard auto-enters demo mode with simulated telemetry if no hardware connected |

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

**Uplink — ground to satellite**

Commands (PING, CAM, OTA, SET) travel the reverse path: PC → serial → ground receiver → LoRa → satellite

---

## Hardware

### Bill of Materials

| Component | Purpose | Qty | Cost |
|---|---|:---:|---:|
| ESP32 Dev Board 38-pin | Main flight computer | 1 | $5 |
| LoRa SX1276 Ra-02 | 433 MHz radio, one for flight and one for ground | 2 | $6 each |
| MPU6050 | Gyroscope and accelerometer | 1 | $3 |
| DHT11 | Temperature and humidity sensor | 1 | $2 |
| AI Thinker ESP32-CAM | Camera module | 1 | $8 |
| Arduino Uno or ESP32 | Ground receiver connected to PC via USB | 1 | $5 |
| LiPo 3.7V 1000mAh | Flight battery | 1 | $8 |
| 220Ω resistors | LED current limiting | 3 | <$1 |
| 10kΩ resistor | DHT11 data line pull-up | 1 | <$1 |
| Breadboard and jumper wires | Prototyping | 1 set | $3 |
| **Total** | | | **~$51** |

> Two LoRa modules are required — one mounted on the satellite, one wired to your ground receiver and connected to your PC via USB.

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

> ⚠️ **The LoRa SX1276 runs on 3.3V only.** Connecting VCC to 5V will permanently destroy the module.

> ⚠️ **The ESP32-CAM requires 5V** on its power pin. Do not power it from the ESP32's 3.3V regulator. Use a dedicated 5V rail or USB power bank.

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

## Software

### Project Structure

```
arc-sentinel/
│
├── firmware/
│   ├── flight_computer_ota/
│   │   └── flight_computer_ota.ino     Main ESP32 — sensors, LoRa, OTA receiver
│   ├── esp32cam_ota/
│   │   └── esp32cam_ota.ino            ESP32-CAM — camera, OTA via Serial relay
│   └── lora_ground_receiver/
│       └── lora_ground_receiver.ino    Ground board — LoRa to USB Serial bridge
│
├── ground-station/
│   ├── pages/
│   │   ├── _app.js
│   │   └── index.js                    Main dashboard layout and demo mode
│   ├── components/
│   │   ├── AttitudeDisplay.js          Animated artificial horizon
│   │   ├── GyroPanel.js                3-axis gyro and accel live charts
│   │   ├── EnvironmentPanel.js         Temperature and humidity gauges
│   │   ├── SignalPanel.js              RSSI and SNR quality charts
│   │   ├── CameraPanel.js              Image viewer and capture button
│   │   ├── SystemMap.js                Satellite SVG and subsystem health
│   │   ├── StatusBar.js                Header with logo and live stats
│   │   └── TelemetryLog.js             Streaming packet log
│   ├── lib/
│   │   ├── store.js                    Zustand global telemetry state
│   │   ├── useWS.js                    WebSocket hook with auto-reconnect
│   │   └── mockData.js                 Demo mode telemetry generator
│   ├── public/
│   │   └── logo.png
│   ├── styles/
│   │   └── globals.css
│   └── ground_station_bridge.py        Serial to WebSocket bridge
│
├── tools/
│   └── arc_uplink.py                   OTA uplink tool — compile and flash over LoRa
│
├── logo.png
└── README.md
```

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

## OTA Wireless Firmware Updates

### How OTA Works

```
Ground PC               Ground Receiver          ARC Sentinel
──────────────────────  ────────────────────     ──────────────────────────────
arc_uplink.py
  1. Compile .ino
     → firmware.bin
  2. Compute MD5
  3. Split into
     128-byte chunks

  4. Send OTA_BEGIN ──► LoRa TX ────────────►   Receive OTA_BEGIN
                                                 Allocate OTA partition
                    ◄── LoRa RX ─────────────── Reply READY

  5. Send chunk #0 ───►                      ►   Write chunk to flash
     Wait for ACK   ◄────────────────────────── ACK { seq:0 }

  6. Send chunk #1 ───►                      ►   Write chunk to flash
     Wait for ACK   ◄────────────────────────── ACK { seq:1 }

     ... repeat for all N chunks ...

  7. Send OTA_END  ───►                      ►   Compute MD5 of received data
                                                 Compare to expected MD5
                    ◄────────────────────────── Reply SUCCESS

  8. Satellite reboots into new firmware
     Watch "ver" field in telemetry to confirm
```

When the target is `CAM`, the flight computer relays every chunk to the ESP32-CAM via Serial2. The CAM runs its own OTA receiver using the same protocol.

**Critical one-time setup** — before OTA will work, both ESP32s must be flashed once via USB with the correct partition scheme selected:

```
Arduino IDE → Tools → Partition Scheme → Minimal SPIFFS (1.9MB APP with OTA)
```

This creates two app partitions in the 4MB flash. The satellite runs from one while the other receives the update. If MD5 validation fails, the old partition is never touched.

---

### OTA Safety

| Feature | How It Works |
|---|---|
| MD5 validation | Firmware hash checked before reboot — corrupt firmware is never applied |
| Dual partition | Old firmware completely untouched until new one passes validation |
| Chunk sequencing | Out-of-order or missing chunks trigger automatic retry requests |
| Auto retry | Up to 5 retries per chunk before the session aborts gracefully |
| Abort command | `arc_uplink.py abort` at any time — satellite stays on current firmware |
| Version confirmation | `ver` field in telemetry changes after success — visible in the dashboard |

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

## Ground Station Dashboard Panels

| Panel | Position | What It Shows |
|---|---|---|
| Status Bar | Top, fixed | Logo · link status · packet count · loss % · RSSI · UTC clock · PING and CAPTURE buttons |
| System Map | Left column | Animated satellite SVG · subsystem health indicators · mission elapsed time |
| Signal Panel | Left column | RSSI bar graph · SNR readout · rolling RSSI history chart · packet statistics |
| Camera Panel | Left column | Last captured image · uplink CAPTURE button |
| Attitude Display | Center column | Animated artificial horizon · roll and pitch angles · angular rate bars |
| Gyro Panel | Center column | Live scrolling gyro X / Y / Z chart · live accel X / Y / Z chart · raw values |
| Environment Panel | Right column | Temperature gauge · humidity gauge · heat index · trend chart · MPU die temp |
| Telemetry Log | Right column | Timestamped streaming log of every received packet |

---

## Power Budget

| Component | Typical | Peak |
|---|---|---|
| ESP32 active | 80 mA | 240 mA |
| LoRa SX1276 transmitting | — | 120 mA |
| MPU6050 | 3.9 mA | 3.9 mA |
| DHT11 | 2.5 mA | 2.5 mA |
| ESP32-CAM active | 180 mA | 310 mA |
| **Total peak** | | **~680 mA** |

With a 1000 mAh LiPo at 80% usable capacity: approximately **1.2 hours runtime**.

To extend: increase the telemetry interval with `arc_uplink.py set interval 10000`, put the CAM in standby between captures, or use a higher capacity cell.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| `LoRa init failed` | Wrong wiring or 5V on VCC | Check SPI pins — LoRa VCC must be **3.3V** |
| `MPU6050 not found` | I2C wiring or wrong address | Confirm SDA=21 SCL=22, try address 0x68 or 0x69 |
| `DHT11 returns NaN` | Missing pull-up resistor | Add 10kΩ between DATA and 3.3V — wait 2s after power-on |
| No packets on ground | LoRa config mismatch | Both radios must match: frequency, SF, BW, sync word |
| `OTA_BEGIN` no response | Out of range or config mismatch | Run `ping` first to confirm link — check frequency and SF match |
| MD5 mismatch during OTA | Packet corruption | Retry the OTA — consider switching to SF12 for maximum reliability |
| `Update.begin() failed` | Wrong partition scheme | Re-flash via USB with OTA partition scheme set first |
| CAM OTA hangs | UART issue | Verify GPIO16 is RX2 and GPIO17 is TX2, confirm 115200 baud |
| Dashboard shows no data | Bridge not running | Start `ground_station_bridge.py` before opening the browser |
| WebSocket error in console | Port conflict | Check nothing else is using port 8765 |
| Camera image never appears | Power issue | ESP32-CAM needs stable 5V — use a dedicated supply |

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
