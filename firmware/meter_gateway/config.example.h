#pragma once
// Copy to config.h (ignored by Git). Never commit the real file.
static const char WIFI_SSID[] = "YOUR_WIFI";
static const char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";
static const char DEVICE_ID[] = "YOUR_GATEWAY_UUID";
static const char UPLOAD_TOKEN[] = "YOUR_DEVICE_SPECIFIC_TOKEN";
static const char INGEST_URL[] = "https://qivwjkqkeipaivztgbyy.supabase.co/functions/v1/ingest";
// Bundled public CA roots; keep updated. Never disable TLS validation.
#include "trusted_roots.h"
static const char NTP_SERVER[] = "pool.ntp.org";
static const uint8_t SLAVE_IDS[] = {1}; // unique IDs, 1–247; at most 8 here
static const uint32_t POLL_INTERVAL_MS = 60000;
static const uint16_t REGISTER_ADDRESSES[] = {
  99,101,103,105,107,109,111,113,115,117,119,133,135,137,139,171
};
static const uint8_t UART_RX = 16, UART_TX = 17, RS485_DIRECTION = 18;
static const uint32_t MODBUS_BAUD = 9600;
