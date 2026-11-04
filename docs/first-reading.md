# First ESP32 upload: end-to-end setup

## What is deployed

Supabase project `qivwjkqkeipaivztgbyy`: PostgreSQL schema/RLS, `provision` and `ingest` functions, Auth redirect configuration, and bounded 30-day raw retention are deployed. Hosted two-user isolation, token lifecycle, persisted zero/null readings, chart queries and export queries were tested using temporary fixtures, then removed. No real gateway or owner login was invented.

The dashboard is being published from the clean static `gh-pages` branch of `Diwas03/Meter_Reading_Dashboard`, per the owner’s latest choice. Until deployment is verified, treat `https://diwas03.github.io/Meter_Reading_Dashboard/` as an expected destination, not a working link. The static publishing branch contains no private source, original Git history or administrative credentials. Other branches/history remain in the original repository; rotate previously committed credentials before making it public.

## 1. Create your dashboard login

Open https://supabase.com/dashboard/project/qivwjkqkeipaivztgbyy/auth/users and use **Add user → Create new user**. Enter your own email and choose a strong password in Supabase, not in chat. If an “Auto Confirm User” option appears, enable it for your personally created account, or complete the email confirmation flow. This creates an app login; your Supabase website login is a separate account. Public app signup is disabled. No shared default password is provided.

When the dashboard is live, click **Connect your meters** (it initially opens a clearly labelled local demo). Sign in with that email/password. Demo data never enters the production DB.

## 2. Register the gateway

In **Devices & setup** enter a name, for example “Main gateway”, and slave IDs `1`. Click **Register gateway**. Save:

- Gateway UUID → firmware `DEVICE_ID`.
- One-time device upload token beginning `mg_` → firmware `UPLOAD_TOKEN`.

This token belongs only to this ESP32 gateway and its registered meters. It is **not** the Supabase account access token, publishable key or service-role key. Copy it immediately; the server stores only its hash. If lost, rotate it in the setup panel.

## 3. Configure the firmware

Use the source in the working repository, under `firmware/meter_gateway/` (the public dashboard repository contains static web assets only).

1. Copy `config.example.h` to `config.h` in the same folder. `config.h` is ignored by Git.
2. Fill in these settings locally:

   ```cpp
   static const char WIFI_SSID[] = "YOUR_WIFI";
   static const char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";
   static const char DEVICE_ID[] = "YOUR_GATEWAY_UUID";
   static const char UPLOAD_TOKEN[] = "YOUR_ONE_TIME_DEVICE_TOKEN";
   static const char INGEST_URL[] = "https://qivwjkqkeipaivztgbyy.supabase.co/functions/v1/ingest";
   ```

3. Keep `#include "trusted_roots.h"`, `NTP_SERVER`, `SLAVE_IDS={1}` and the accepted register addresses. The public trust roots are bundled, with provenance/fingerprints in `docs/firmware-trust.md`. Do not use `setInsecure()` or a development proxy CA. UDP NTP access is needed for the clock before HTTPS.
4. Keep your working wiring: MAX485 RO → RX GPIO16 through the existing suitable level conversion, TX GPIO17 → DI, joined DE and /RE → GPIO18. Maintain the verified RS485 connections and logic-voltage compatibility. UART stays 9600, 8N1.

## 4. Install packages and upload

Arduino IDE Boards Manager:

- **esp32 by Espressif Systems 3.3.0**, board **ESP32 Dev Module**.

Library Manager:

- **ModbusMaster by Doc Walker 2.0.1**.
- **ArduinoJson by Benoit Blanchon 7.4.2**.

WiFi/TLS/HTTP/SNTP/FreeRTOS are included with the ESP32 board package. ThingSpeak is not needed for this sketch. Open `meter_gateway.ino`, choose the ESP32's actual USB port, compile and upload. Open Serial Monitor at **115200 baud**.

The exact sketch compiled successfully for `esp32:esp32:esp32` in the cloud. No ESP32 was physically attached or flashed here. Compiler warnings originated in the pinned board/library code, including an unused `ModbusMaster::requestFrom` implementation; this sketch uses `readHoldingRegisters`.

## 5. Confirm data arrives

Serial should show local measurements or Modbus errors, Wi-Fi connection/UTC synchronization, then **`HTTPS acknowledged 1 samples`** (the number may vary with queued/multiple-meter batches). It polls around every 60 seconds and uses a separate upload task so network failures do not stop polling.

Refresh the signed-in dashboard, select your gateway and meter, and check the latest received timestamp. In Supabase **Table Editor → public.readings**, confirm a new row with your gateway and meter UUIDs. All 16 values for one meter sample are in one row. Real zeros remain numeric zero; unsuccessful fields are NULL with a reason in `errors`. Device time and server-received time are separate.

Troubleshooting:

| Symptom | Check |
|---|---|
| Modbus timeout | Slave ID, wiring, A/B polarity, direction pin and UART settings; offline slaves skip remaining reads |
| Wi-Fi unavailable | SSID/password, signal and compatible ESP32 Wi-Fi network |
| Clock synchronization never completes | Allow the configured NTP server; polling continues, TLS upload waits for a valid clock |
| Negative HTTPS status | Certificate trust, DNS/network reachability and endpoint URL; never disable TLS verification |
| 401 | Gateway UUID/token mismatch, rotation or revocation; use the device token, not a Supabase key |
| 403 | Slave ID not registered under this gateway |
| 429 | Wait for retry/backoff; keep the same sample IDs |
| Dashboard shows local demo | Choose Connect your meters, sign in and select your gateway |
| Supabase login fails | Create an application user under Authentication → Users; verify password and confirmation |

Retries use the same sample IDs and are deduplicated. Buffering is bounded RAM (32 queued + up to 4 pending); overflow/reset can lose readings. Default scheduled retention permanently deletes raw readings after 30 days in bounded batches.

## 6. Add another meter

Set the additional physical meter to a different Modbus slave address, for example **2**. In Devices & setup select the same gateway and add slave ID `2`. Change ignored `config.h` to `SLAVE_IDS[] = {1,2}` and upload again. Leave the gateway UUID/token unchanged. A second ESP32 is a new gateway and may independently use slave ID 1.

Nonzero measurement mapping, low-word-first decoding and scaling still need comparison against the physical meter display. The owner's working reference was auxiliary-powered; do not treat the installation as calibrated.
