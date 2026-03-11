/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         ARC SENTINEL — ESP32-CAM OTA RECEIVER FIRMWARE          ║
 * ║                                                                  ║
 * ║  The CAM doesn't have LoRa. The Flight Computer relays          ║
 * ║  OTA chunks to this board via Serial (UART).                    ║
 * ║                                                                  ║
 * ║  Protocol over Serial2 from Flight Computer:                    ║
 * ║    "OTA_BEGIN <size> <chunks>\n"   → prepare                    ║
 * ║    "OTA_CHUNK <seq> <len>\n"       → followed by raw bytes      ║
 * ║    "OTA_END <md5>\n"              → validate and reboot         ║
 * ║    "OTA_ABORT\n"                  → cancel                      ║
 * ║    "CAPTURE\n"                    → take photo (normal ops)     ║
 * ║                                                                  ║
 * ║  PARTITION SCHEME: Same as flight computer —                    ║
 * ║  Tools → Partition Scheme → "Minimal SPIFFS (1.9MB APP w/OTA)" ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Board: AI Thinker ESP32-CAM
 */

#include "esp_camera.h"
#include <Update.h>
#include <MD5Builder.h>
#include <Base64.h>

// ─── AI Thinker ESP32-CAM pins ───────────────────────────────
#define PWDN_GPIO_NUM  32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM   0
#define SIOD_GPIO_NUM  26
#define SIOC_GPIO_NUM  27
#define Y9_GPIO_NUM    35
#define Y8_GPIO_NUM    34
#define Y7_GPIO_NUM    39
#define Y6_GPIO_NUM    36
#define Y5_GPIO_NUM    21
#define Y4_GPIO_NUM    19
#define Y3_GPIO_NUM    18
#define Y2_GPIO_NUM     5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM  23
#define PCLK_GPIO_NUM  22
#define LED_BUILTIN     4

// ─── OTA State ───────────────────────────────────────────────
enum OTAState { OTA_IDLE, OTA_RECEIVING, OTA_VALIDATING };
OTAState otaState    = OTA_IDLE;
uint32_t totalSize   = 0;
uint32_t totalChunks = 0;
uint32_t rxChunks    = 0;
String   expectedMD5 = "";
MD5Builder md5b;
bool     cameraReady = false;

// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200); // ← This is UART to flight computer
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  Serial.println("[CAM] ARC Sentinel CAM module — OTA enabled");
  initCamera();
}

// ─────────────────────────────────────────────────────────────
void loop() {
  if (!Serial.available()) return;

  // Read command line
  String line = Serial.readStringUntil('\n');
  line.trim();

  if (line.startsWith("OTA_BEGIN")) {
    handleOTABegin(line);

  } else if (line.startsWith("OTA_CHUNK")) {
    handleOTAChunk(line);

  } else if (line.startsWith("OTA_END")) {
    handleOTAEnd(line);

  } else if (line == "OTA_ABORT") {
    handleOTAAbort();

  } else if (line == "CAPTURE") {
    if (otaState == OTA_IDLE) captureAndSend();

  } else if (line == "STATUS") {
    Serial.printf("[CAM] state=%d cam=%d ver=%s\n",
                  otaState, cameraReady, CAM_VERSION);
  }
}

// ─────────────────────────────────────────────────────────────
void handleOTABegin(const String& line) {
  // "OTA_BEGIN <size> <chunks>"
  uint32_t size   = 0;
  uint32_t chunks = 0;
  sscanf(line.c_str(), "OTA_BEGIN %u %u", &size, &chunks);

  if (!size || !chunks) {
    Serial.println("[CAM] OTA_BEGIN parse error");
    return;
  }

  if (!Update.begin(size)) {
    Serial.printf("[CAM] OTA begin failed: %s\n", Update.errorString());
    return;
  }

  totalSize   = size;
  totalChunks = chunks;
  rxChunks    = 0;
  otaState    = OTA_RECEIVING;
  md5b.begin();

  Serial.printf("[CAM] OTA_BEGIN OK — size=%u chunks=%u\n", size, chunks);
}

// ─────────────────────────────────────────────────────────────
void handleOTAChunk(const String& line) {
  if (otaState != OTA_RECEIVING) {
    Serial.println("[CAM] Unexpected OTA_CHUNK");
    return;
  }

  // "OTA_CHUNK <seq> <len>"  followed by <len> raw bytes on Serial
  uint32_t seq = 0;
  uint32_t len = 0;
  sscanf(line.c_str(), "OTA_CHUNK %u %u", &seq, &len);

  if (!len || len > 256) {
    Serial.println("[CAM] Bad chunk len");
    return;
  }

  // Read raw bytes (with timeout)
  uint8_t buf[256];
  uint32_t deadline = millis() + 2000;
  size_t   got = 0;

  while (got < len && millis() < deadline) {
    if (Serial.available()) {
      buf[got++] = Serial.read();
    }
  }

  if (got != len) {
    Serial.printf("[CAM] Chunk %u: expected %u bytes, got %u\n", seq, len, got);
    Update.abort();
    otaState = OTA_IDLE;
    return;
  }

  size_t written = Update.write(buf, len);
  if (written != len) {
    Serial.printf("[CAM] Write failed at chunk %u\n", seq);
    Update.abort();
    otaState = OTA_IDLE;
    return;
  }

  md5b.add(buf, len);
  rxChunks++;

  uint8_t pct = (uint8_t)((rxChunks * 100) / totalChunks);
  Serial.printf("[CAM] Chunk %u OK — %u%%\n", seq, pct);
}

// ─────────────────────────────────────────────────────────────
void handleOTAEnd(const String& line) {
  // "OTA_END <md5>"
  char md5buf[64] = {0};
  sscanf(line.c_str(), "OTA_END %63s", md5buf);
  expectedMD5 = md5buf;
  otaState = OTA_VALIDATING;

  md5b.calculate();
  String computed = md5b.toString();

  Serial.printf("[CAM] MD5 expected: %s\n", expectedMD5.c_str());
  Serial.printf("[CAM] MD5 computed: %s\n", computed.c_str());

  if (computed != expectedMD5) {
    Serial.println("[CAM] MD5 MISMATCH — aborting");
    Update.abort();
    otaState = OTA_IDLE;
    return;
  }

  if (!Update.end(true)) {
    Serial.printf("[CAM] OTA end error: %s\n", Update.errorString());
    otaState = OTA_IDLE;
    return;
  }

  Serial.println("[CAM] OTA SUCCESS — rebooting in 2s");
  // Flash LED rapidly to indicate successful OTA
  for (int i = 0; i < 10; i++) {
    digitalWrite(LED_BUILTIN, HIGH); delay(100);
    digitalWrite(LED_BUILTIN, LOW);  delay(100);
  }
  ESP.restart();
}

// ─────────────────────────────────────────────────────────────
void handleOTAAbort() {
  if (otaState != OTA_IDLE) Update.abort();
  otaState = OTA_IDLE;
  Serial.println("[CAM] OTA aborted");
}

// ─────────────────────────────────────────────────────────────
void initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size   = FRAMESIZE_QQVGA;
  config.jpeg_quality = 20;
  config.fb_count     = 1;

  cameraReady = (esp_camera_init(&config) == ESP_OK);
  Serial.printf("[CAM] Camera init: %s\n", cameraReady ? "OK" : "FAILED");
}

// ─────────────────────────────────────────────────────────────
void captureAndSend() {
  if (!cameraReady) { Serial.println("[CAM] Not ready"); return; }

  digitalWrite(LED_BUILTIN, HIGH);
  camera_fb_t* fb = esp_camera_fb_get();
  digitalWrite(LED_BUILTIN, LOW);

  if (!fb) { Serial.println("[CAM] Capture failed"); return; }

  String encoded = base64::encode(fb->buf, fb->len);
  Serial.println("IMG_START");
  for (int i = 0; i < (int)encoded.length(); i += 64) {
    Serial.println(encoded.substring(i, i + 64));
    delay(5);
  }
  Serial.println("IMG_END");
  esp_camera_fb_return(fb);
}

#ifndef CAM_VERSION
  #define CAM_VERSION "1.0.0"
#endif
