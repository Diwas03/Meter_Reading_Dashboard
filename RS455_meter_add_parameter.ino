#include <Arduino.h>
#include <ModbusMaster.h>
#include <cstring>
#include <cmath>

// ESP32 / MAX485 connections
constexpr int RX_PIN = 16;
constexpr int TX_PIN = 17;
constexpr int DE_RE_PIN = 18;

// All meters on this bus must use these serial settings.
constexpr uint32_t METER_BAUD = 9600;
constexpr uint32_t METER_FORMAT = SERIAL_8N1;

// Currently reads only meter ID 1.
// For three meters, change this to: {1, 2, 3}
const uint8_t METER_IDS[] = {1};

HardwareSerial meterSerial(2);
ModbusMaster meter;

struct Measurement {
  const char* name;
  uint16_t address;
  const char* unit;
};

// Uses the address convention that worked on your meter.
// Each measurement occupies two registers.
const Measurement measurements[] = {
  {"R-N voltage",     99,  "V"},
  {"Y-N voltage",     101, "V"},
  {"B-N voltage",     103, "V"},
  {"Average voltage", 105, "V"},

  {"R-Y voltage",     107, "V"},
  {"Y-B voltage",     109, "V"},
  {"B-R voltage",     111, "V"},

  {"R current",       113, "A"},
  {"Y current",       115, "A"},
  {"B current",       117, "A"},
  {"Neutral current", 119, "A"},

  {"R power factor",  133, ""},
  {"Y power factor",  135, ""},
  {"B power factor",  137, ""},
  {"Avg power factor",139, ""},

  {"Frequency",       171, "Hz"}
};

void preTransmission() {
  digitalWrite(DE_RE_PIN, HIGH);
  delayMicroseconds(100);
}

void postTransmission() {
  digitalWrite(DE_RE_PIN, LOW);
}

float decodeLowWordFirst(uint16_t lowWord, uint16_t highWord) {
  uint32_t bits =
      (static_cast<uint32_t>(highWord) << 16) | lowWord;

  float value;
  memcpy(&value, &bits, sizeof(value));
  return value;
}

// Returns false for a timeout so an offline meter can be skipped.
bool readMeasurement(const Measurement& item) {
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
    return result != 0xE2;
  }

  uint16_t lowWord = meter.getResponseBuffer(0);
  uint16_t highWord = meter.getResponseBuffer(1);

  float value = decodeLowWordFirst(lowWord, highWord);

  if (std::isfinite(value)) {
    Serial.printf("%-19s : %10.3f %s\n",
                  item.name, value, item.unit);
  } else {
    Serial.printf(
      "%-19s : Invalid float; raw: 0x%04X 0x%04X\n",
      item.name, lowWord, highWord
    );
  }

  return true;
}

void readMeter(uint8_t slaveId) {
  // Select which meter receives the following requests.
  meter.begin(slaveId, meterSerial);

  // Apply direction-control callbacks for this meter.
  meter.preTransmission(preTransmission);
  meter.postTransmission(postTransmission);

  Serial.printf("\n-------- Meter ID %u --------\n", slaveId);

  for (const Measurement& item : measurements) {
    bool continueReading = readMeasurement(item);

    // Allow a gap between Modbus requests.
    delay(100);

    if (!continueReading) {
      Serial.println("Skipping remaining readings after timeout.");
      break;
    }
  }
}

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

  delay(1000);

  Serial.println("\nElite 300 multi-meter reader");
  Serial.println("RS485: 9600 baud, 8N1");
  Serial.println("RX: GPIO16 | TX: GPIO17 | DE/RE: GPIO18");
}

void loop() {
  for (uint8_t slaveId : METER_IDS) {
    readMeter(slaveId);
    delay(100);
  }

  delay(2000);
}