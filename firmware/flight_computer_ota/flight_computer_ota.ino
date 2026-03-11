/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         ARC SENTINEL — FLIGHT COMPUTER OTA FIRMWARE             ║
 * ║                                                                  ║
 * ║  Receives firmware chunks over LoRa and reflashes itself        ║
 * ║  OR relays chunks to the ESP32-CAM via Serial2                  ║
 * ║                                                                  ║
 * ║  HOW IT WORKS:                                                   ║
 * ║  1. Ground tool compiles .bin, splits into 128-byte chunks      ║
 * ║  2. Sends OTA_BEGIN → chunks → OTA_END over LoRa               ║
 * ║  3. Flight computer writes chunks to OTA partition              ║
 * ║  4. On OTA_END: validates MD5, reboots into new firmware        ║
 * ║                                                                  ║
 * ║  NORMAL TELEMETRY continues between chunk windows (non-blocking)║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * EXTRA LIBRARIES NEEDED (on top of existing cubesat ones):
 *   - Update.h  (built into ESP32 Arduino core — no install needed)
 *   - MD5Builder.h (built into ESP32 Arduino core)
 *
 * PARTITION SCHEME:
 *   In Arduino IDE → Tools → Partition Scheme:
 *   Select "Minimal SPIFFS (1.9MB APP with OTA)"
 *   This gives you two app partitions so OTA works safely.
 *   If new firmware is corrupt, the old one still boots.
 */

#include <SPI.h>
#include <LoRa.h>
#include <Wire.h>
#include <MPU6050.h>
#include <DHT.h>
#include <ArduinoJson.h>
#include <Update.h>       // ESP32 OTA partition writer
#include <MD5Builder.h>   // Checksum validation

// ─── LoRa Pins (same as before) ──────────────────────────────
#define LORA_SCK    18
#define LORA_MISO   19
#define LORA_MOSI   23
#define LORA_CS      5
#define LORA_RST    14
#define LORA_DIO0    2
#define LORA_FREQ   433E6

// ─── Sensor Pins ─────────────────────────────────────────────
#define DHT_PIN      4
#define DHT_TYPE     DHT11

// ─── OTA Config ──────────────────────────────────────────────
#define OTA_CHUNK_SIZE     128    // bytes per LoRa chunk
#define OTA_ACK_TIMEOUT   3000   // ms to wait before requesting retry
#define OTA_MAX_RETRIES      5   // per chunk before aborting
#define SATELLITE_ID   "ARC-SENTINEL-01"

// ─── OTA Packet Types (uplink from ground) ───────────────────
// All uplink packets are JSON:
// {"cmd":"OTA_BEGIN","target":"FC","size":98304,"md5":"abc123...","chunks":768}
// {"cmd":"OTA_CHUNK","seq":0,"data":"<base64 128 bytes>"}
// {"cmd":"OTA_END","md5":"abc123..."}
// {"cmd":"OTA_ABORT"}
// {"cmd":"OTA_STATUS"}   → satellite replies with current OTA state

// ─── OTA State Machine ───────────────────────────────────────
enum OTAState {
  OTA_IDLE,
  OTA_RECEIVING_FC,   // Flashing this ESP32 (flight computer)
  OTA_RECEIVING_CAM,  // Relaying to ESP32-CAM via Serial2
  OTA_VALIDATING,
  OTA_COMPLETE,
  OTA_ERROR
};

struct OTASession {
  OTAState  state         = OTA_IDLE;
  String    target        = "";       // "FC" or "CAM"
  uint32_t  totalSize     = 0;        // full firmware bytes
  uint32_t  totalChunks   = 0;
  uint32_t  receivedChunks= 0;
  uint32_t  writtenBytes  = 0;
  String    expectedMD5   = "";
  uint32_t  nextExpectedSeq = 0;
  uint32_t  lastChunkTime = 0;
  uint8_t   retryCount    = 0;
  MD5Builder md5;
};

// ─── Objects ─────────────────────────────────────────────────
MPU6050   mpu;
DHT       dht(DHT_PIN, DHT_TYPE);
OTASession ota;

// ─── State ───────────────────────────────────────────────────
uint32_t packetCount     = 0;
uint32_t lastTelemetry   = 0;
bool     mpuReady        = false;
bool     loraReady       = false;
#define  TELEMETRY_INTERVAL  2000  // normal cadence

// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  Serial2.begin(115200, SERIAL_8N1, 16, 17); // → ESP32-CAM

  Serial.println(F("╔══════════════════════════════════╗"));
  Serial.println(F("║  ARC SENTINEL  Flight Computer  ║"));
  Serial.println(F("║  OTA-enabled firmware           ║"));
  Serial.println(F("╚══════════════════════════════════╝"));

  Wire.begin(21, 22);

  // MPU6050
  mpu.initialize();
  mpuReady = mpu.testConnection();
  if (mpuReady) {
    mpu.setFullScaleGyroRange(MPU6050_GYRO_FS_500);
    mpu.setFullScaleAccelRange(MPU6050_ACCEL_FS_4);
  }
  Serial.printf("[MPU6050] %s\n", mpuReady ? "OK" : "FAILED");

  // DHT11
  dht.begin();
  Serial.println(F("[DHT11] OK"));

  // LoRa
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_CS);
  LoRa.setPins(LORA_CS, LORA_RST, LORA_DIO0);
  if (LoRa.begin(LORA_FREQ)) {
    LoRa.setSpreadingFactor(10);
    LoRa.setSignalBandwidth(125E3);
    LoRa.setCodingRate4(5);
    LoRa.setTxPower(20);
    LoRa.setSyncWord(0xF3);
    loraReady = true;
  }
  Serial.printf("[LoRa] %s\n", loraReady ? "OK" : "FAILED");

  // Print current firmware version/partition info
  Serial.printf("[OTA] Running partition: %s\n",
    esp_ota_get_running_partition()->label);
  Serial.printf("[OTA] App version: %s\n", APP_VERSION);

  delay(1500);
}

// ─────────────────────────────────────────────────────────────
void loop() {
  uint32_t now = millis();

  // ─── Normal telemetry (suppressed during OTA) ────────────
  if (ota.state == OTA_IDLE || ota.state == OTA_COMPLETE) {
    if (now - lastTelemetry >= TELEMETRY_INTERVAL) {
      lastTelemetry = now;
      sendTelemetry();
    }
  }

  // ─── OTA chunk timeout / retry ───────────────────────────
  if (ota.state == OTA_RECEIVING_FC || ota.state == OTA_RECEIVING_CAM) {
    if (now - ota.lastChunkTime > OTA_ACK_TIMEOUT) {
      requestChunkRetry();
    }
  }

  // ─── Handle incoming LoRa packets ────────────────────────
  handleLoRaUplink();
}

// ─────────────────────────────────────────────────────────────
void handleLoRaUplink() {
  int packetSize = LoRa.parsePacket();
  if (packetSize == 0) return;

  String raw = "";
  while (LoRa.available()) raw += (char)LoRa.read();

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, raw) != DeserializationError::Ok) return;

  const char* cmd = doc["cmd"];
  if (!cmd) return;

  // ─── OTA Commands ────────────────────────────────────────
  if      (strcmp(cmd, "OTA_BEGIN")  == 0) handleOTABegin(doc);
  else if (strcmp(cmd, "OTA_CHUNK")  == 0) handleOTAChunk(doc);
  else if (strcmp(cmd, "OTA_END")    == 0) handleOTAEnd(doc);
  else if (strcmp(cmd, "OTA_ABORT")  == 0) handleOTAAbort();
  else if (strcmp(cmd, "OTA_STATUS") == 0) sendOTAStatus();

  // ─── Normal Commands ──────────────────────────────────────
  else if (strcmp(cmd, "PING") == 0)       sendACK("PONG");
  else if (strcmp(cmd, "CAM")  == 0)       Serial2.println("CAPTURE");
  else if (strcmp(cmd, "SET")  == 0)       handleSetParam(doc);
}

// ─────────────────────────────────────────────────────────────
// OTA_BEGIN — ground sends target, total size, chunk count, MD5
// ─────────────────────────────────────────────────────────────
void handleOTABegin(JsonDocument& doc) {
  if (ota.state != OTA_IDLE) {
    sendOTAReply("ERROR", "OTA already in progress");
    return;
  }

  const char* target = doc["target"]; // "FC" or "CAM"
  uint32_t size      = doc["size"];
  uint32_t chunks    = doc["chunks"];
  const char* md5    = doc["md5"];

  if (!target || !size || !chunks || !md5) {
    sendOTAReply("ERROR", "Missing OTA_BEGIN fields");
    return;
  }

  Serial.printf("[OTA] BEGIN — target=%s size=%u chunks=%u\n",
                target, size, chunks);

  if (strcmp(target, "FC") == 0) {
    // Begin ESP32 OTA update partition write
    if (!Update.begin(size)) {
      String err = Update.errorString();
      sendOTAReply("ERROR", err.c_str());
      return;
    }
    ota.state = OTA_RECEIVING_FC;

  } else if (strcmp(target, "CAM") == 0) {
    // Tell ESP32-CAM to prepare for OTA relay
    Serial2.printf("OTA_BEGIN %u %u\n", size, chunks);
    ota.state = OTA_RECEIVING_CAM;

  } else {
    sendOTAReply("ERROR", "Unknown target");
    return;
  }

  ota.target          = target;
  ota.totalSize       = size;
  ota.totalChunks     = chunks;
  ota.receivedChunks  = 0;
  ota.writtenBytes    = 0;
  ota.expectedMD5     = md5;
  ota.nextExpectedSeq = 0;
  ota.retryCount      = 0;
  ota.lastChunkTime   = millis();
  ota.md5.begin();

  sendOTAReply("READY", "Awaiting chunks");
}

// ─────────────────────────────────────────────────────────────
// OTA_CHUNK — ground sends base64-encoded chunk + sequence number
// ─────────────────────────────────────────────────────────────
void handleOTAChunk(JsonDocument& doc) {
  if (ota.state != OTA_RECEIVING_FC && ota.state != OTA_RECEIVING_CAM) {
    sendOTAReply("ERROR", "No OTA in progress");
    return;
  }

  uint32_t seq      = doc["seq"];
  const char* b64   = doc["data"];
  if (!b64) return;

  // ─── Sequence check ──────────────────────────────────────
  if (seq != ota.nextExpectedSeq) {
    // Out of order — request the expected chunk
    Serial.printf("[OTA] Seq mismatch: got %u expected %u\n",
                  seq, ota.nextExpectedSeq);
    requestChunkRetry();
    return;
  }

  // ─── Decode base64 ───────────────────────────────────────
  uint8_t buf[OTA_CHUNK_SIZE + 4];
  size_t  decodedLen = decodeBase64(b64, buf);

  if (decodedLen == 0) {
    sendOTAReply("ERROR", "Base64 decode failed");
    return;
  }

  // ─── Write to target ─────────────────────────────────────
  bool writeOK = false;

  if (ota.state == OTA_RECEIVING_FC) {
    // Write to ESP32 OTA flash partition
    size_t written = Update.write(buf, decodedLen);
    writeOK = (written == decodedLen);
    ota.md5.add(buf, decodedLen);

  } else {
    // Relay raw bytes to ESP32-CAM via Serial2
    // CAM firmware listens for OTA_CHUNK <seq> <len>\n<bytes>
    Serial2.printf("OTA_CHUNK %u %u\n", seq, decodedLen);
    Serial2.write(buf, decodedLen);
    writeOK = true; // assume relay ok (CAM will ACK separately)
  }

  if (!writeOK) {
    sendOTAReply("ERROR", "Write failed");
    handleOTAAbort();
    return;
  }

  ota.receivedChunks++;
  ota.writtenBytes  += decodedLen;
  ota.nextExpectedSeq++;
  ota.lastChunkTime  = millis();
  ota.retryCount     = 0;

  // ─── Send ACK with progress ───────────────────────────────
  uint8_t pct = (uint8_t)((ota.receivedChunks * 100) / ota.totalChunks);

  StaticJsonDocument<128> ack;
  ack["id"]   = SATELLITE_ID;
  ack["type"] = "OTA_ACK";
  ack["seq"]  = seq;
  ack["pct"]  = pct;

  String ackStr;
  serializeJson(ack, ackStr);
  LoRa.beginPacket();
  LoRa.print(ackStr);
  LoRa.endPacket();

  Serial.printf("[OTA] Chunk %u/%u (%u%%) written\n",
                ota.receivedChunks, ota.totalChunks, pct);
}

// ─────────────────────────────────────────────────────────────
// OTA_END — ground signals all chunks sent, provides final MD5
// ─────────────────────────────────────────────────────────────
void handleOTAEnd(JsonDocument& doc) {
  if (ota.state != OTA_RECEIVING_FC && ota.state != OTA_RECEIVING_CAM) {
    sendOTAReply("ERROR", "No OTA in progress");
    return;
  }

  const char* finalMD5 = doc["md5"];
  ota.state = OTA_VALIDATING;

  Serial.println(F("[OTA] Validating..."));

  if (ota.state == OTA_VALIDATING && ota.target == "FC") {
    // Validate MD5
    ota.md5.calculate();
    String computedMD5 = ota.md5.toString();

    Serial.printf("[OTA] Expected MD5: %s\n", ota.expectedMD5.c_str());
    Serial.printf("[OTA] Computed MD5: %s\n", computedMD5.c_str());

    if (computedMD5 != ota.expectedMD5) {
      sendOTAReply("ERROR", "MD5 mismatch — firmware corrupt");
      Update.abort();
      resetOTAState();
      return;
    }

    if (!Update.end(true)) { // true = set boot partition
      sendOTAReply("ERROR", Update.errorString());
      resetOTAState();
      return;
    }

    ota.state = OTA_COMPLETE;
    sendOTAReply("SUCCESS", "Rebooting into new firmware in 3s");
    Serial.println(F("[OTA] SUCCESS — rebooting"));

    // Give ground station time to receive the ACK
    delay(3000);
    ESP.restart();

  } else if (ota.target == "CAM") {
    // Tell CAM to finalize and reboot
    Serial2.printf("OTA_END %s\n", ota.expectedMD5.c_str());
    ota.state = OTA_COMPLETE;
    sendOTAReply("SUCCESS", "CAM OTA finalized — awaiting CAM reboot");
    resetOTAState();
  }
}

// ─────────────────────────────────────────────────────────────
void handleOTAAbort() {
  Serial.println(F("[OTA] ABORTED"));
  if (ota.state == OTA_RECEIVING_FC) Update.abort();
  if (ota.target == "CAM") Serial2.println("OTA_ABORT");
  sendOTAReply("ABORTED", "OTA session cancelled");
  resetOTAState();
}

// ─────────────────────────────────────────────────────────────
void requestChunkRetry() {
  ota.retryCount++;
  if (ota.retryCount > OTA_MAX_RETRIES) {
    Serial.println(F("[OTA] Max retries exceeded — aborting"));
    handleOTAAbort();
    return;
  }

  StaticJsonDocument<96> req;
  req["id"]      = SATELLITE_ID;
  req["type"]    = "OTA_RETRY";
  req["seq"]     = ota.nextExpectedSeq;
  req["attempt"] = ota.retryCount;

  String s;
  serializeJson(req, s);
  LoRa.beginPacket();
  LoRa.print(s);
  LoRa.endPacket();

  ota.lastChunkTime = millis();
  Serial.printf("[OTA] Retry request for chunk %u (attempt %u)\n",
                ota.nextExpectedSeq, ota.retryCount);
}

// ─────────────────────────────────────────────────────────────
void sendOTAStatus() {
  StaticJsonDocument<256> s;
  s["id"]     = SATELLITE_ID;
  s["type"]   = "OTA_STATUS";
  s["state"]  = (int)ota.state;
  s["target"] = ota.target;
  s["rx"]     = ota.receivedChunks;
  s["total"]  = ota.totalChunks;
  s["bytes"]  = ota.writtenBytes;
  s["part"]   = esp_ota_get_running_partition()->label;
  s["ver"]    = APP_VERSION;

  String str;
  serializeJson(s, str);
  LoRa.beginPacket();
  LoRa.print(str);
  LoRa.endPacket();
}

// ─────────────────────────────────────────────────────────────
void sendOTAReply(const char* status, const char* msg) {
  StaticJsonDocument<192> r;
  r["id"]     = SATELLITE_ID;
  r["type"]   = "OTA_REPLY";
  r["status"] = status;
  r["msg"]    = msg;

  String str;
  serializeJson(r, str);
  LoRa.beginPacket();
  LoRa.print(str);
  LoRa.endPacket();

  Serial.printf("[OTA] Reply: %s — %s\n", status, msg);
}

// ─────────────────────────────────────────────────────────────
void resetOTAState() {
  ota = OTASession(); // reset to defaults
}

// ─────────────────────────────────────────────────────────────
// Runtime parameter setter — no reflash needed
// {"cmd":"SET","key":"interval","val":5000}
// ─────────────────────────────────────────────────────────────
uint32_t telemetryInterval = TELEMETRY_INTERVAL;

void handleSetParam(JsonDocument& doc) {
  const char* key = doc["key"];
  if (!key) return;

  if (strcmp(key, "interval") == 0) {
    telemetryInterval = doc["val"] | TELEMETRY_INTERVAL;
    sendACK("SET_OK");
    Serial.printf("[SET] interval = %u ms\n", telemetryInterval);
  }
  // Add more runtime params here as needed
}

// ─────────────────────────────────────────────────────────────
void sendACK(const char* type) {
  StaticJsonDocument<96> a;
  a["id"]   = SATELLITE_ID;
  a["ack"]  = type;
  a["pkt"]  = packetCount;
  String s;
  serializeJson(a, s);
  LoRa.beginPacket();
  LoRa.print(s);
  LoRa.endPacket();
}

// ─────────────────────────────────────────────────────────────
// Normal telemetry — identical to original but uses variable interval
// ─────────────────────────────────────────────────────────────
void sendTelemetry() {
  StaticJsonDocument<512> doc;
  doc["id"]  = SATELLITE_ID;
  doc["pkt"] = ++packetCount;
  doc["t"]   = millis() / 1000.0;
  doc["ver"] = APP_VERSION;

  if (mpuReady) {
    int16_t ax, ay, az, gx, gy, gz;
    mpu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);
    JsonObject accel = doc.createNestedObject("accel");
    accel["x"] = ax / 8192.0f;
    accel["y"] = ay / 8192.0f;
    accel["z"] = az / 8192.0f;
    JsonObject gyro = doc.createNestedObject("gyro");
    gyro["x"] = gx / 65.5f;
    gyro["y"] = gy / 65.5f;
    gyro["z"] = gz / 65.5f;
    doc["roll"]  = atan2f(ay, az) * 180.0f / PI;
    doc["pitch"] = atan2f(-ax, sqrtf(ay*ay + az*az)) * 180.0f / PI;
  }

  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (!isnan(h) && !isnan(t)) {
    JsonObject env = doc.createNestedObject("env");
    env["temp"] = t;
    env["hum"]  = h;
  }

  doc["rssi"] = LoRa.rssi();

  String payload;
  serializeJson(doc, payload);
  LoRa.beginPacket();
  LoRa.print(payload);
  LoRa.endPacket();
}

// ─────────────────────────────────────────────────────────────
// Base64 decoder (minimal, no external lib needed)
// ─────────────────────────────────────────────────────────────
static const char b64chars[] =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

size_t decodeBase64(const char* src, uint8_t* dst) {
  size_t len = strlen(src);
  size_t out = 0;
  uint32_t val = 0;
  int bits = 0;

  for (size_t i = 0; i < len; i++) {
    char c = src[i];
    if (c == '=') break;
    const char* p = strchr(b64chars, c);
    if (!p) continue;
    val = (val << 6) | (p - b64chars);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      dst[out++] = (val >> bits) & 0xFF;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// APP_VERSION — increment this with every OTA push so you can
// confirm the new firmware is running via telemetry packets
// ─────────────────────────────────────────────────────────────
#ifndef APP_VERSION
  #define APP_VERSION "1.0.0"
#endif
