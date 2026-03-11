#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════╗
║        ARC SENTINEL — LoRa OTA Ground Uplink Tool               ║
║                                                                  ║
║  Usage:                                                          ║
║    python arc_uplink.py flash-fc   path/to/sketch.ino           ║
║    python arc_uplink.py flash-cam  path/to/sketch.ino           ║
║    python arc_uplink.py flash-bin  path/to/firmware.bin  FC     ║
║    python arc_uplink.py status                                   ║
║    python arc_uplink.py ping                                     ║
║    python arc_uplink.py set interval 5000                       ║
║    python arc_uplink.py abort                                    ║
║                                                                  ║
║  SETUP:                                                          ║
║    pip install pyserial tqdm                                     ║
║    arduino-cli must be installed and in PATH                     ║
║    (https://arduino.github.io/arduino-cli/)                      ║
╚══════════════════════════════════════════════════════════════════╝
"""

import sys
import os
import json
import time
import hashlib
import base64
import struct
import argparse
import subprocess
import threading
import serial
import serial.tools.list_ports
from pathlib import Path
from tqdm import tqdm

# ─── Config ──────────────────────────────────────────────────
SERIAL_PORT   = "COM3"          # ← Change to your ground receiver port
SERIAL_BAUD   = 115200
CHUNK_SIZE    = 128             # bytes per LoRa OTA chunk
ACK_TIMEOUT   = 8.0            # seconds to wait for chunk ACK
MAX_RETRIES   = 5              # per chunk
LORA_TX_DELAY = 0.15           # seconds between LoRa transmissions

# Arduino CLI board FQBNs
FQBN_FC  = "esp32:esp32:esp32"                    # Generic ESP32
FQBN_CAM = "esp32:esp32:esp32cam"                 # AI Thinker ESP32-CAM

# ─── Colors ──────────────────────────────────────────────────
class C:
    CYAN    = '\033[96m'
    GREEN   = '\033[92m'
    YELLOW  = '\033[93m'
    RED     = '\033[91m'
    BOLD    = '\033[1m'
    RESET   = '\033[0m'
    DIM     = '\033[2m'

def info(msg):    print(f"{C.CYAN}[INFO]{C.RESET}  {msg}")
def ok(msg):      print(f"{C.GREEN}[OK]{C.RESET}    {msg}")
def warn(msg):    print(f"{C.YELLOW}[WARN]{C.RESET}  {msg}")
def err(msg):     print(f"{C.RED}[ERROR]{C.RESET} {msg}")
def step(msg):    print(f"\n{C.BOLD}{'─'*50}{C.RESET}\n{C.BOLD}{msg}{C.RESET}")

# ─────────────────────────────────────────────────────────────
class GroundUplink:
    def __init__(self, port: str, baud: int):
        self.port  = port
        self.baud  = baud
        self.ser   = None
        self._rx_buf    = []
        self._rx_lock   = threading.Lock()
        self._rx_thread = None

    def connect(self):
        try:
            self.ser = serial.Serial(self.port, self.baud, timeout=1)
            time.sleep(0.5)
            self._rx_thread = threading.Thread(
                target=self._reader, daemon=True)
            self._rx_thread.start()
            ok(f"Connected to {self.port} @ {self.baud} baud")
        except serial.SerialException as e:
            err(f"Cannot open {self.port}: {e}")
            self._list_ports()
            sys.exit(1)

    def _list_ports(self):
        print("\nAvailable serial ports:")
        for p in serial.tools.list_ports.comports():
            print(f"  {p.device:20} — {p.description}")

    def _reader(self):
        """Background thread: reads all incoming serial lines."""
        while True:
            try:
                line = self.ser.readline().decode("utf-8", errors="replace").strip()
                if line:
                    with self._rx_lock:
                        self._rx_buf.append(line)
            except Exception:
                break

    def send_json(self, obj: dict):
        """Send a JSON command over LoRa (via ground receiver serial)."""
        payload = json.dumps(obj, separators=(',', ':')) + '\n'
        self.ser.write(payload.encode())
        time.sleep(LORA_TX_DELAY)

    def wait_for(self, match_fn, timeout=8.0) -> dict | None:
        """Block until a received JSON packet matches match_fn or timeout."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._rx_lock:
                for i, line in enumerate(self._rx_buf):
                    if not line.startswith('{'):
                        continue
                    try:
                        pkt = json.loads(line)
                        if match_fn(pkt):
                            self._rx_buf.pop(i)
                            return pkt
                    except json.JSONDecodeError:
                        pass
            time.sleep(0.05)
        return None

    def drain_log(self):
        """Print and clear non-JSON serial lines (debug output)."""
        with self._rx_lock:
            remaining = []
            for line in self._rx_buf:
                if not line.startswith('{'):
                    print(f"  {C.DIM}[SAT LOG] {line}{C.RESET}")
                else:
                    remaining.append(line)
            self._rx_buf = remaining

    def close(self):
        if self.ser:
            self.ser.close()

# ─────────────────────────────────────────────────────────────
def compile_sketch(sketch_path: str, fqbn: str, output_dir: Path) -> Path:
    """
    Use arduino-cli to compile a sketch and return the .bin path.
    The .bin is the raw binary you flash over OTA.
    """
    step(f"Compiling {Path(sketch_path).name} for {fqbn}")

    output_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        "arduino-cli", "compile",
        "--fqbn", fqbn,
        "--output-dir", str(output_dir),
        "--export-binaries",
        sketch_path
    ]

    info(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        err("Compilation failed:")
        print(result.stderr)
        sys.exit(1)

    ok("Compilation successful")

    # Find the .bin file (arduino-cli names it <sketch>.ino.bin)
    bins = list(output_dir.glob("*.bin"))
    # Prefer the non-merged, non-bootloader bin
    for b in bins:
        if "bootloader" not in b.name and "partitions" not in b.name and "merged" not in b.name:
            info(f"Firmware binary: {b.name} ({b.stat().st_size:,} bytes)")
            return b

    if bins:
        info(f"Using: {bins[0].name}")
        return bins[0]

    err("No .bin file found after compilation")
    sys.exit(1)

# ─────────────────────────────────────────────────────────────
def compute_md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, 'rb') as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()

# ─────────────────────────────────────────────────────────────
def split_into_chunks(firmware_path: Path, chunk_size: int):
    """Split firmware binary into base64-encoded chunks."""
    chunks = []
    with open(firmware_path, 'rb') as f:
        i = 0
        while True:
            raw = f.read(chunk_size)
            if not raw:
                break
            chunks.append({
                'seq':  i,
                'data': base64.b64encode(raw).decode(),
                'len':  len(raw),
            })
            i += 1
    return chunks

# ─────────────────────────────────────────────────────────────
def flash_firmware(uplink: GroundUplink, firmware_path: Path, target: str):
    """
    Full OTA flash sequence:
    1. Compute MD5
    2. Split into chunks
    3. Send OTA_BEGIN
    4. Send each chunk, wait for ACK, retry on failure
    5. Send OTA_END
    6. Monitor for SUCCESS reply
    """
    firmware_path = Path(firmware_path)
    if not firmware_path.exists():
        err(f"Firmware not found: {firmware_path}")
        sys.exit(1)

    size   = firmware_path.stat().st_size
    md5sum = compute_md5(firmware_path)
    chunks = split_into_chunks(firmware_path, CHUNK_SIZE)

    step(f"ARC Sentinel OTA — Target: {target}")
    info(f"File:   {firmware_path.name}")
    info(f"Size:   {size:,} bytes")
    info(f"MD5:    {md5sum}")
    info(f"Chunks: {len(chunks)} × {CHUNK_SIZE}B")

    # ─── 1. Send OTA_BEGIN ───────────────────────────────────
    step("Phase 1/3: Handshake")
    uplink.send_json({
        "cmd":    "OTA_BEGIN",
        "target": target,
        "size":   size,
        "chunks": len(chunks),
        "md5":    md5sum,
    })

    reply = uplink.wait_for(
        lambda p: p.get("type") in ("OTA_REPLY", "OTA_STATUS"),
        timeout=10.0
    )

    if not reply:
        err("No response to OTA_BEGIN — is satellite in range?")
        uplink.drain_log()
        sys.exit(1)

    if reply.get("status") == "ERROR":
        err(f"Satellite rejected OTA_BEGIN: {reply.get('msg')}")
        sys.exit(1)

    ok(f"Satellite ready — {reply.get('msg', '')}")

    # ─── 2. Send chunks ──────────────────────────────────────
    step("Phase 2/3: Uploading firmware")
    print(f"  Sending {len(chunks)} chunks via LoRa...\n")

    bar = tqdm(
        total=len(chunks),
        unit="chunk",
        bar_format="{l_bar}{bar}| {n_fmt}/{total_fmt} [{elapsed}<{remaining}, {rate_fmt}]",
        colour="cyan",
    )

    i = 0
    retries = 0

    while i < len(chunks):
        chunk = chunks[i]
        uplink.send_json({
            "cmd":  "OTA_CHUNK",
            "seq":  chunk['seq'],
            "data": chunk['data'],
        })

        # Wait for ACK or RETRY request
        ack = uplink.wait_for(
            lambda p: (
                (p.get("type") == "OTA_ACK" and p.get("seq") == chunk['seq'])
                or p.get("type") == "OTA_RETRY"
                or (p.get("type") == "OTA_REPLY" and p.get("status") == "ERROR")
            ),
            timeout=ACK_TIMEOUT
        )

        if ack is None:
            # No response — retransmit
            retries += 1
            if retries > MAX_RETRIES:
                bar.close()
                err(f"No ACK for chunk {i} after {MAX_RETRIES} retries — aborting")
                uplink.send_json({"cmd": "OTA_ABORT"})
                sys.exit(1)
            warn(f"No ACK for chunk {i}, retransmitting ({retries}/{MAX_RETRIES})")
            continue

        if ack.get("type") == "OTA_REPLY" and ack.get("status") == "ERROR":
            bar.close()
            err(f"Satellite error: {ack.get('msg')}")
            sys.exit(1)

        if ack.get("type") == "OTA_RETRY":
            # Satellite requested specific chunk
            retry_seq = ack.get("seq", i)
            warn(f"Satellite requested retry of chunk {retry_seq}")
            i = retry_seq
            retries += 1
            if retries > MAX_RETRIES * 3:
                bar.close()
                err("Too many retries — link too lossy, aborting")
                uplink.send_json({"cmd": "OTA_ABORT"})
                sys.exit(1)
            continue

        # Good ACK
        retries = 0
        i += 1
        bar.update(1)
        bar.set_postfix(pct=f"{ack.get('pct', 0)}%")

        # Slight delay to avoid flooding LoRa
        time.sleep(LORA_TX_DELAY * 2)

    bar.close()
    ok(f"All {len(chunks)} chunks transmitted")

    # ─── 3. Send OTA_END ─────────────────────────────────────
    step("Phase 3/3: Finalizing")
    uplink.send_json({
        "cmd": "OTA_END",
        "md5": md5sum,
    })

    # Wait for success or error (satellite may take a few seconds to validate)
    result = uplink.wait_for(
        lambda p: p.get("type") == "OTA_REPLY",
        timeout=20.0
    )

    if not result:
        warn("No final reply received — satellite may be rebooting")
        warn("Check telemetry packets for new firmware version")
    elif result.get("status") == "SUCCESS":
        print()
        ok("=" * 50)
        ok(f"  OTA COMPLETE — {result.get('msg', '')}")
        ok("=" * 50)
        info("Satellite will reboot into new firmware.")
        info("Watch telemetry for updated 'ver' field to confirm.")
    else:
        err(f"OTA failed: {result.get('msg')}")
        sys.exit(1)

    # Drain any final satellite logs
    time.sleep(2)
    uplink.drain_log()

# ─────────────────────────────────────────────────────────────
def cmd_status(uplink: GroundUplink):
    step("Requesting OTA status")
    uplink.send_json({"cmd": "OTA_STATUS"})
    reply = uplink.wait_for(lambda p: p.get("type") == "OTA_STATUS", timeout=8.0)

    if not reply:
        err("No status reply — satellite may be out of range")
        return

    print(f"\n  {'Satellite:':15} {reply.get('id', '?')}")
    print(f"  {'Firmware:':15} {reply.get('ver', '?')}")
    print(f"  {'Partition:':15} {reply.get('part', '?')}")
    state_names = {0: 'IDLE', 1: 'RECEIVING_FC', 2: 'RECEIVING_CAM',
                   3: 'VALIDATING', 4: 'COMPLETE', 5: 'ERROR'}
    state = state_names.get(reply.get('state', 0), '?')
    print(f"  {'OTA State:':15} {state}")
    if reply.get('total', 0) > 0:
        pct = reply.get('rx', 0) / reply.get('total', 1) * 100
        print(f"  {'Progress:':15} {reply.get('rx')}/{reply.get('total')} chunks ({pct:.1f}%)")

# ─────────────────────────────────────────────────────────────
def cmd_ping(uplink: GroundUplink):
    step("Pinging satellite")
    uplink.send_json({"cmd": "PING"})
    reply = uplink.wait_for(lambda p: p.get("ack") == "PONG", timeout=8.0)
    if reply:
        ok(f"PONG received from {reply.get('id')} — PKT #{reply.get('pkt')}")
    else:
        err("No response — satellite out of range or offline")

# ─────────────────────────────────────────────────────────────
def cmd_set(uplink: GroundUplink, key: str, val: str):
    step(f"Setting {key} = {val}")
    try:
        val_typed = int(val)
    except ValueError:
        try:
            val_typed = float(val)
        except ValueError:
            val_typed = val

    uplink.send_json({"cmd": "SET", "key": key, "val": val_typed})
    reply = uplink.wait_for(lambda p: p.get("ack") == "SET_OK", timeout=6.0)
    if reply:
        ok(f"Parameter {key} updated on satellite")
    else:
        warn("No acknowledgement received")

# ─────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="ARC Sentinel — LoRa OTA Ground Uplink Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
  flash-fc   <sketch.ino>          Compile & flash flight computer
  flash-cam  <sketch.ino>          Compile & flash ESP32-CAM (via FC relay)
  flash-bin  <firmware.bin> <FC|CAM>  Flash a pre-compiled binary
  status                           Query OTA status from satellite
  ping                             Ping satellite
  set <key> <value>                Set runtime parameter
  abort                            Abort ongoing OTA session

Examples:
  python arc_uplink.py flash-fc flight_computer_ota.ino
  python arc_uplink.py flash-cam esp32cam_ota.ino
  python arc_uplink.py flash-bin firmware.bin FC
  python arc_uplink.py set interval 5000
  python arc_uplink.py ping
        """
    )
    parser.add_argument("command",   help="Command to execute")
    parser.add_argument("args",      nargs="*", help="Command arguments")
    parser.add_argument("--port",    default=SERIAL_PORT,
                        help=f"Serial port (default: {SERIAL_PORT})")
    parser.add_argument("--baud",    type=int, default=SERIAL_BAUD,
                        help=f"Baud rate (default: {SERIAL_BAUD})")
    parser.add_argument("--chunk",   type=int, default=CHUNK_SIZE,
                        help=f"Chunk size in bytes (default: {CHUNK_SIZE})")

    args = parser.parse_args()

    print(f"""
{C.BOLD}{C.CYAN}
  ╔═══════════════════════════════════════╗
  ║   ARC SENTINEL  LoRa Uplink Tool     ║
  ║   Ground Station → Satellite OTA     ║
  ╚═══════════════════════════════════════╝
{C.RESET}""")

    uplink = GroundUplink(args.port, args.baud)
    uplink.connect()

    try:
        cmd = args.command.lower()

        if cmd == "ping":
            cmd_ping(uplink)

        elif cmd == "status":
            cmd_status(uplink)

        elif cmd == "abort":
            step("Sending abort")
            uplink.send_json({"cmd": "OTA_ABORT"})
            ok("Abort sent")

        elif cmd == "set":
            if len(args.args) < 2:
                err("Usage: set <key> <value>")
                sys.exit(1)
            cmd_set(uplink, args.args[0], args.args[1])

        elif cmd == "flash-fc":
            if not args.args:
                err("Usage: flash-fc <sketch.ino>")
                sys.exit(1)
            out = Path("./build_output_fc")
            bin_path = compile_sketch(args.args[0], FQBN_FC, out)
            flash_firmware(uplink, bin_path, "FC")

        elif cmd == "flash-cam":
            if not args.args:
                err("Usage: flash-cam <sketch.ino>")
                sys.exit(1)
            out = Path("./build_output_cam")
            bin_path = compile_sketch(args.args[0], FQBN_CAM, out)
            flash_firmware(uplink, bin_path, "CAM")

        elif cmd == "flash-bin":
            if len(args.args) < 2:
                err("Usage: flash-bin <firmware.bin> <FC|CAM>")
                sys.exit(1)
            flash_firmware(uplink, Path(args.args[0]), args.args[1].upper())

        else:
            err(f"Unknown command: {cmd}")
            parser.print_help()
            sys.exit(1)

    except KeyboardInterrupt:
        print("\n")
        warn("Interrupted by user")
        uplink.send_json({"cmd": "OTA_ABORT"})

    finally:
        uplink.close()

if __name__ == "__main__":
    main()
