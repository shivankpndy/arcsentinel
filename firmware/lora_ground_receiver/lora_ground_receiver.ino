/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║       CUBESAT GROUND STATION - LoRa Receiver Arduino        ║
 * ║   Upload to Arduino/ESP32 connected to your PC via USB      ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * WIRING (using ESP32 or Arduino + LoRa SX1276):
 *   LoRa VCC  → 3.3V
 *   LoRa GND  → GND
 *   LoRa SCK  → GPIO 18
 *   LoRa MISO → GPIO 19
 *   LoRa MOSI → GPIO 23
 *   LoRa NSS  → GPIO 5
 *   LoRa RST  → GPIO 14
 *   LoRa DIO0 → GPIO 2
 *
 * This sketch receives LoRa packets and forwards them to
 * the PC via USB Serial as JSON, with RSSI/SNR appended.
 */

#include <SPI.h>
#include <LoRa.h>
#include <ArduinoJson.h>

#define LORA_SCK    18
#define LORA_MISO   19
#define LORA_MOSI   23
#define LORA_CS      5
#define LORA_RST    14
#define LORA_DIO0    2
#define LORA_FREQ   433E6

// ─────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  while (!Serial);

  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_CS);
  LoRa.setPins(LORA_CS, LORA_RST, LORA_DIO0);

  while (!LoRa.begin(LORA_FREQ)) {
    Serial.println(F("[ERROR] LoRa init failed, retrying..."));
    delay(1000);
  }

  LoRa.setSpreadingFactor(10);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  LoRa.setSyncWord(0xF3);

  Serial.println(F("[GS] Ground station receiver ready"));
  Serial.printf("[GS] Frequency: %.0f MHz\n", LORA_FREQ / 1E6);
}

// ─────────────────────────────────────────────────────────────
void loop() {
  int packetSize = LoRa.parsePacket();
  if (packetSize == 0) return;

  String payload = "";
  while (LoRa.available()) {
    payload += (char)LoRa.read();
  }

  int rssi = LoRa.packetRssi();
  float snr = LoRa.packetSnr();

  // Inject RSSI/SNR into JSON before forwarding
  StaticJsonDocument<600> doc;
  DeserializationError err = deserializeJson(doc, payload);

  if (!err) {
    doc["rssi_gs"] = rssi;  // Ground station RSSI
    doc["snr"]     = snr;
    String enriched;
    serializeJson(doc, enriched);
    Serial.println(enriched);
  } else {
    // Forward raw if not valid JSON
    Serial.println(payload);
  }

  // Handle uplink commands from PC
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    if (cmd.length() > 0) {
      LoRa.beginPacket();
      LoRa.print(cmd);
      LoRa.endPacket();
    }
  }
}
