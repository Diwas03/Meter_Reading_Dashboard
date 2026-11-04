# Single-file ESP32 sketch

Open `meter_gateway_single.ino` in an Arduino sketch folder named `meter_gateway_single`. It contains all settings, trusted public CA certificates and gateway code. No `config.h` or other local header is required. The only external requirements are the Arduino board package and libraries below.

Before entering real credentials, save a private copy outside the Git checkout (or in ignored `firmware/meter_gateway_single_local/`, with the .ino renamed to match its folder). Do not commit the customized file.

1. Sign in to the dashboard and register a gateway with slave ID 1 in **Devices & setup**. Copy its UUID and one-time `mg_` upload token. Your Supabase account access token is not the device upload token.
2. Edit the four placeholders near the top: `WIFI_SSID`, `WIFI_PASSWORD`, `DEVICE_ID`, `UPLOAD_TOKEN`. The HTTPS ingestion URL is already configured for this project.
3. Install esp32 board package **3.3.0**, **ModbusMaster 2.0.1**, and **ArduinoJson 7.4.2**. Select **ESP32 Dev Module**, upload, and open Serial Monitor at **115200**.
4. Keep the embedded certificate roots and SNTP clock synchronization enabled. No insecure HTTPS mode is used.

Pins RX16/TX17/DE+RE18, 9600 8N1, accepted register addresses and low-word-first float decoder are unchanged. Uploads are approximately every 60s. Polling continues during network loss; RAM buffering is bounded and not lossless. Failed readings remain null, real zero remains zero. Register and configure additional unique slave IDs before adding them to `SLAVE_IDS`.

Compile-tested; not physically hardware-tested. Nonzero mapping/scaling/word order still need comparison against the meter display.

This placeholder-only template is generated from the maintained multi-file implementation with `python3 scripts/build-single-file-firmware.py`. Regeneration replaces template settings with safe placeholders. Public root fingerprints/provenance are in `docs/firmware-trust.md`.
