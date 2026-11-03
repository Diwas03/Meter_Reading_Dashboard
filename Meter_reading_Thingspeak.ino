#include <Arduino.h>
#include <WiFi.h>
#include <ThingSpeak.h>
#include <ModbusMaster.h>
#include <cstring>
#include <cmath>

// ============================================================
// ENTER YOUR SETTINGS HERE
// ============================================================

#include "legacy_thingspeak_config.h" // ignored local credentials; see example

// ============================================================
// ESP32 / MAX485 CONNECTIONS
// ============================================================

constexpr int RX_PIN = 16;       // RX2 <- MAX485 RO via voltage divider
constexpr int TX_PIN = 17;       // TX2 -> MAX485 DI
constexpr int DE_RE_PIN = 18;    // MAX485 DE and /RE joined together

// ============================================================
// METER SETTINGS
// ============================================================

constexpr uint8_t METER_ID = 1;
constexpr uint32_t METER_BAUD = 9600;
constexpr uint32_t METER_FORMAT = SERIAL_8N1;

// Minimum time between complete meter scans.
constexpr uint32_t READ_INTERVAL_MS = 5000;

// Upload no faster than once every 60 seconds.
constexpr uint32_t UPLOAD_INTERVAL_MS = 60000;

// Retry Wi-Fi connection every 20 seconds if disconnected.
constexpr uint32_t WIFI_RETRY_INTERVAL_MS = 20000;

HardwareSerial meterSerial(2);
ModbusMaster meter;

// Basic HTTP client: traffic is not encrypted.
WiFiClient cloudClient;

struct Measurement {
  const char* name;
  uint16_t address;
  const char* unit;
  uint8_t thingSpeakField; // 0 = Serial Monitor only
};

// Addresses follow the convention accepted by your meter.
// The register mapping and float decoding still need comparison
// with the meter display once nonzero inputs are available.
const Measurement measurements[] = {
  {"R-N voltage",      99,  "V",  1},
  {"Y-N voltage",      101, "V",  2},
  {"B-N voltage",      103, "V",  3},
  {"Average voltage",  105, "V",  0},

  {"R-Y voltage",      107, "V",  0},
  {"Y-B voltage",      109, "V",  0},
  {"B-R voltage",      111, "V",  0},

  {"R current",        113, "A",  4},
  {"Y current",        115, "A",  5},
  {"B current",        117, "A",  6},
  {"Neutral current",  119, "A",  0},

  {"R power factor",   133, "",   0},
  {"Y power factor",   135, "",   0},
  {"B power factor",   137, "",   0},
  {"Avg power factor", 139, "",   8},

  {"Frequency",        171, "Hz", 7}
};

uint32_t lastReadFinished = 0;
uint32_t lastUploadAttempt = 0;
uint32_t lastWiFiAttempt = 0;

bool firstScan = true;
bool uploadAttempted = false;
bool wifiWasConnected = false;

// ============================================================
// RS485 DIRECTION CONTROL
// ============================================================

void preTransmission() {
  digitalWrite(DE_RE_PIN, HIGH);
  delayMicroseconds(100);
}

void postTransmission() {
  digitalWrite(DE_RE_PIN, LOW);
}

// ============================================================
// DATA DECODING
// ============================================================

float decodeLowWordFirst(uint16_t lowWord, uint16_t highWord) {
  uint32_t bits =
      (static_cast<uint32_t>(highWord) << 16) | lowWord;

  float value;
  memcpy(&value, &bits, sizeof(value));
  return value;
}

// ============================================================
// WI-FI CONNECTION
// ============================================================

void maintainWiFi() {
  bool connected = WiFi.status() == WL_CONNECTED;

  if (connected) {
    if (!wifiWasConnected) {
      Serial.println("\nWi-Fi connected.");
      Serial.print("ESP32 IP: ");
      Serial.println(WiFi.localIP());
    }

    wifiWasConnected = true;
    return;
  }

  if (wifiWasConnected) {
    Serial.println("\nWi-Fi disconnected.");
  }

  wifiWasConnected = false;

  uint32_t now = millis();

  if (now - lastWiFiAttempt >= WIFI_RETRY_INTERVAL_MS) {
    lastWiFiAttempt = now;
    Serial.println("Retrying Wi-Fi...");
    WiFi.reconnect();
  }
}

// ============================================================
// READ ONE MEASUREMENT
// ============================================================

bool readMeasurement(const Measurement& item, float& value) {
  while (meterSerial.available()) {
    meterSerial.read();
  }

  uint8_t result = meter.readHoldingRegisters(item.address, 2);

  if (result != meter.ku8MBSuccess) {
    Serial.printf("%-19s : ERROR 0x%02X",
                  item.name, result);

    switch (result) {
      case 0x01:
        Serial.print(" (illegal function)");
        break;

      case 0x02:
        Serial.print(" (invalid register address)");
        break;

      case 0xE2:
        Serial.print(" (response timeout)");
        break;

      case 0xE3:
        Serial.print(" (CRC error)");
        break;
    }

    Serial.println();
    return false;
  }

  uint16_t lowWord = meter.getResponseBuffer(0);
  uint16_t highWord = meter.getResponseBuffer(1);

  value = decodeLowWordFirst(lowWord, highWord);

  if (!std::isfinite(value)) {
    Serial.printf(
      "%-19s : Invalid float; raw 0x%04X 0x%04X\n",
      item.name, lowWord, highWord
    );
    return false;
  }

  Serial.printf("%-19s : %10.3f %s\n",
                item.name, value, item.unit);

  return true;
}

// ============================================================
// UPLOAD ONE COMPLETE SET OF EIGHT FIELDS
// ============================================================

void uploadToThingSpeak(const float values[8],
                        const bool valid[8]) {
  uint32_t now = millis();

  if (uploadAttempted &&
      now - lastUploadAttempt < UPLOAD_INTERVAL_MS) {
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Cloud upload skipped: Wi-Fi unavailable.");
    return;
  }

  if (THINGSPEAK_CHANNEL_ID == 0 ||
      strlen(THINGSPEAK_WRITE_KEY) == 0 ||
      strcmp(THINGSPEAK_WRITE_KEY, "YOUR_WRITE_API_KEY") == 0) {
    Serial.println(
      "Cloud upload disabled: enter Channel ID and Write API Key."
    );
    return;
  }

  // Use only readings from this scan.
  // Never substitute zero for a failed reading.
  for (int i = 0; i < 8; i++) {
    if (!valid[i]) {
      Serial.printf(
        "Cloud upload skipped: field %d has no valid reading.\n",
        i + 1
      );
      return;
    }
  }

  uploadAttempted = true;
  lastUploadAttempt = now;

  for (int i = 0; i < 8; i++) {
    ThingSpeak.setField(i + 1, values[i]);
  }

  ThingSpeak.setStatus("Elite 300 | Slave ID 1");

  Serial.println("Uploading eight fields to ThingSpeak...");

  int result = ThingSpeak.writeFields(
    THINGSPEAK_CHANNEL_ID,
    THINGSPEAK_WRITE_KEY
  );

  if (result == 200) {
    Serial.println("ThingSpeak upload SUCCESS.");
  } else {
    Serial.printf("ThingSpeak upload FAILED: code %d\n", result);
    Serial.println(
      "Check internet access, Channel ID, Write API Key and channel limits."
    );
  }
}

// ============================================================
// SETUP
// ============================================================

void setup() {
  Serial.begin(115200);

  pinMode(DE_RE_PIN, OUTPUT);
  digitalWrite(DE_RE_PIN, LOW);

  meterSerial.begin(
    METER_BAUD,
    METER_FORMAT,
    RX_PIN,
    TX_PIN
  );

  meter.begin(METER_ID, meterSerial);
  meter.preTransmission(preTransmission);
  meter.postTransmission(postTransmission);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWiFiAttempt = millis();

  ThingSpeak.begin(cloudClient);

  delay(1000);

  Serial.println("\nElite 300 -> ESP32 -> ThingSpeak");
  Serial.println("Meter ID: 1 | Meter baud: 9600 | Format: 8N1");
  Serial.println("RX: GPIO16 | TX: GPIO17 | DE/RE: GPIO18");
  Serial.println("Serial Monitor: 115200 baud");
  Serial.println("Cloud upload interval: 60 seconds");
  Serial.println("Connecting to Wi-Fi...");
}

// ============================================================
// MAIN LOOP
// ============================================================

void loop() {
  maintainWiFi();

  uint32_t now = millis();

  if (!firstScan &&
      now - lastReadFinished < READ_INTERVAL_MS) {
    delay(10);
    return;
  }

  firstScan = false;

  // Fresh arrays for each scan prevent stale cloud readings.
  float cloudValues[8] = {};
  bool cloudValid[8] = {};

  Serial.printf("\n-------- Meter ID %u --------\n", METER_ID);

  for (const Measurement& item : measurements) {
    float value = 0.0f;
    bool success = readMeasurement(item, value);

    if (item.thingSpeakField > 0) {
      int index = item.thingSpeakField - 1;

      cloudValid[index] = success;

      if (success) {
        cloudValues[index] = value;
      }
    }

    delay(100);
  }

  maintainWiFi();
  uploadToThingSpeak(cloudValues, cloudValid);

  lastReadFinished = millis();
}