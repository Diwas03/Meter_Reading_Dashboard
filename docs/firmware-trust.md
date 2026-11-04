# Firmware trust roots

Public CA roots from the managed system’s Mozilla-derived CA trust store, copied 2026-11-04. They are not credentials and do not include the session proxy CA. `WiFiClientSecure.setCACert` validates hostname, chain and validity dates against this PEM set; SNTP must establish UTC. No insecure fallback is permitted.

| Root | SHA-256 (DER) | Expires |
|---|---|---|
| GTS Root R1 | `d947432abde7b7fa90fc2e6b59101b1280e0e1c7e4e40fa3c6887fff57a7f4cf` | Jun 22 00:00:00 2036 GMT |
| GTS Root R2 | `8d25cd97229dbf70356bda4eb3cc734031e24cf00fafcfd32dc76eb5841c7ea8` | Jun 22 00:00:00 2036 GMT |
| GTS Root R3 | `34d8a73ee208d9bcdb0d956520934b4e40e69482596e8b6f73c8426b010a6f48` | Jun 22 00:00:00 2036 GMT |
| GTS Root R4 | `349dfa4058c5e263123b398ae795573c4e1313c83fe68f93556cd5e8031b3c7d` | Jun 22 00:00:00 2036 GMT |
| ISRG Root X1 | `96bcec06264976f37460779acf28c5a7cfe8a3c0aae11a8ffcee05c0bddf08c6` | Jun  4 11:04:38 2035 GMT |
| ISRG Root X2 | `69729b8e15a86efc177a57afb7171dfc64add28c2fca8cf1507e34453ccb1470` | Sep 17 16:00:00 2040 GMT |
| DigiCert Global Root G2 | `cb3ccbb76031e5e0138f8dd39a23f9de47ffc35e43c1144cea27d46a5ab1cb5f` | Jan 15 12:00:00 2038 GMT |

Google Trust Services, Let’s Encrypt and DigiCert roots cover common Supabase/Cloudflare chains. This is a maintained trust set, not a guarantee that a provider will never change its CA. If TLS validation fails, verify the actual endpoint chain and the CA’s official published fingerprint before updating these public roots. Never substitute a proxy interception CA from the development environment and never disable certificate verification. Physical ESP32 HTTPS has not been tested in this session.

References: https://pki.goog/repository/ · https://letsencrypt.org/certificates/ · https://www.digicert.com/kb/digicert-root-certificates.htm
