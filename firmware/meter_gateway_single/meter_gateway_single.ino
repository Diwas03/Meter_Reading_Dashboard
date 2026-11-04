// SINGLE-FILE ESP32 GATEWAY — no config.h or other sketch files required.
// Edit the four YOUR_ placeholders in the SETTINGS section below.
// Obtain DEVICE_ID and the mg_ upload token from dashboard → Devices & setup.
// Keep the customized file private; never commit real Wi-Fi/device credentials.
// Public certificate roots are embedded; keep TLS verification enabled.
// Compile-tested, not physically hardware-tested; nonzero calibration pending.

/* Secure Elite 300 → MAX485 → ESP32 → Supabase HTTPS.
 * Arduino-ESP32 3.3.0; ModbusMaster 2.0.1; ArduinoJson 7.4.2.
 * Low word first decoder and accepted protocol addresses are preserved.
 * Nonzero mapping/scaling is NOT hardware-verified. See README.
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ModbusMaster.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include <time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>
// ==================== SETTINGS — EDIT HERE ====================
static const char WIFI_SSID[] = "YOUR_WIFI";
static const char WIFI_PASSWORD[] = "YOUR_WIFI_PASSWORD";
static const char DEVICE_ID[] = "YOUR_GATEWAY_UUID";
static const char UPLOAD_TOKEN[] = "YOUR_DEVICE_SPECIFIC_TOKEN";
static const char INGEST_URL[] = "https://qivwjkqkeipaivztgbyy.supabase.co/functions/v1/ingest";
// Bundled public CA roots; keep updated. Never disable TLS validation.
static const char NTP_SERVER[] = "pool.ntp.org";
static const uint8_t SLAVE_IDS[] = {1}; // unique IDs, 1–247; at most 8 here
static const uint32_t POLL_INTERVAL_MS = 60000;
static const uint16_t REGISTER_ADDRESSES[] = {
  99,101,103,105,107,109,111,113,115,117,119,133,135,137,139,171
};
static const uint8_t UART_RX = 16, UART_TX = 17, RS485_DIRECTION = 18;
static const uint32_t MODBUS_BAUD = 9600;

// ==================== EMBEDDED PUBLIC TLS ROOTS ====================
// Public roots; provenance and SHA-256 fingerprints: docs/firmware-trust.md
static const char ROOT_CA[] = R"PEM(
-----BEGIN CERTIFICATE-----
MIIFVzCCAz+gAwIBAgINAgPlk28xsBNJiGuiFzANBgkqhkiG9w0BAQwFADBHMQsw
CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU
MBIGA1UEAxMLR1RTIFJvb3QgUjEwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw
MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp
Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjEwggIiMA0GCSqGSIb3DQEBAQUA
A4ICDwAwggIKAoICAQC2EQKLHuOhd5s73L+UPreVp0A8of2C+X0yBoJx9vaMf/vo
27xqLpeXo4xL+Sv2sfnOhB2x+cWX3u+58qPpvBKJXqeqUqv4IyfLpLGcY9vXmX7w
Cl7raKb0xlpHDU0QM+NOsROjyBhsS+z8CZDfnWQpJSMHobTSPS5g4M/SCYe7zUjw
TcLCeoiKu7rPWRnWr4+wB7CeMfGCwcDfLqZtbBkOtdh+JhpFAz2weaSUKK0Pfybl
qAj+lug8aJRT7oM6iCsVlgmy4HqMLnXWnOunVmSPlk9orj2XwoSPwLxAwAtcvfaH
szVsrBhQf4TgTM2S0yDpM7xSma8ytSmzJSq0SPly4cpk9+aCEI3oncKKiPo4Zor8
Y/kB+Xj9e1x3+naH+uzfsQ55lVe0vSbv1gHR6xYKu44LtcXFilWr06zqkUspzBmk
MiVOKvFlRNACzqrOSbTqn3yDsEB750Orp2yjj32JgfpMpf/VjsPOS+C12LOORc92
wO1AK/1TD7Cn1TsNsYqiA94xrcx36m97PtbfkSIS5r762DL8EGMUUXLeXdYWk70p
aDPvOmbsB4om3xPXV2V4J95eSRQAogB/mqghtqmxlbCluQ0WEdrHbEg8QOB+DVrN
VjzRlwW5y0vtOUucxD/SVRNuJLDWcfr0wbrM7Rv1/oFB2ACYPTrIrnqYNxgFlQID
AQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E
FgQU5K8rJnEaK0gnhS9SZizv8IkTcT4wDQYJKoZIhvcNAQEMBQADggIBAJ+qQibb
C5u+/x6Wki4+omVKapi6Ist9wTrYggoGxval3sBOh2Z5ofmmWJyq+bXmYOfg6LEe
QkEzCzc9zolwFcq1JKjPa7XSQCGYzyI0zzvFIoTgxQ6KfF2I5DUkzps+GlQebtuy
h6f88/qBVRRiClmpIgUxPoLW7ttXNLwzldMXG+gnoot7TiYaelpkttGsN/H9oPM4
7HLwEXWdyzRSjeZ2axfG34arJ45JK3VmgRAhpuo+9K4l/3wV3s6MJT/KYnAK9y8J
ZgfIPxz88NtFMN9iiMG1D53Dn0reWVlHxYciNuaCp+0KueIHoI17eko8cdLiA6Ef
MgfdG+RCzgwARWGAtQsgWSl4vflVy2PFPEz0tv/bal8xa5meLMFrUKTX5hgUvYU/
Z6tGn6D/Qqc6f1zLXbBwHSs09dR2CQzreExZBfMzQsNhFRAbd03OIozUhfJFfbdT
6u9AWpQKXCBfTkBdYiJ23//OYb2MI3jSNwLgjt7RETeJ9r/tSQdirpLsQBqvFAnZ
0E6yove+7u7Y/9waLd64NnHi/Hm3lCXRSHNboTXns5lndcEZOitHTtNCjv0xyBZm
2tIMPNuzjsmhDYAPexZ3FL//2wmUspO8IFgV6dtxQ/PeEMMA3KgqlbbC1j+Qa3bb
bP6MvPJwNQzcmRk13NfIRmPVNnGuV/u3gm3c
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIFVzCCAz+gAwIBAgINAgPlrsWNBCUaqxElqjANBgkqhkiG9w0BAQwFADBHMQsw
CQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEU
MBIGA1UEAxMLR1RTIFJvb3QgUjIwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAw
MDAwWjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZp
Y2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjIwggIiMA0GCSqGSIb3DQEBAQUA
A4ICDwAwggIKAoICAQDO3v2m++zsFDQ8BwZabFn3GTXd98GdVarTzTukk3LvCvpt
nfbwhYBboUhSnznFt+4orO/LdmgUud+tAWyZH8QiHZ/+cnfgLFuv5AS/T3KgGjSY
6Dlo7JUle3ah5mm5hRm9iYz+re026nO8/4Piy33B0s5Ks40FnotJk9/BW9BuXvAu
MC6C/Pq8tBcKSOWIm8Wba96wyrQD8Nr0kLhlZPdcTK3ofmZemde4wj7I0BOdre7k
RXuJVfeKH2JShBKzwkCX44ofR5GmdFrS+LFjKBC4swm4VndAoiaYecb+3yXuPuWg
f9RhD1FLPD+M2uFwdNjCaKH5wQzpoeJ/u1U8dgbuak7MkogwTZq9TwtImoS1mKPV
+3PBV2HdKFZ1E66HjucMUQkQdYhMvI35ezzUIkgfKtzra7tEscszcTJGr61K8Yzo
dDqs5xoic4DSMPclQsciOzsSrZYuxsN2B6ogtzVJV+mSSeh2FnIxZyuWfoqjx5RW
Ir9qS34BIbIjMt/kmkRtWVtd9QCgHJvGeJeNkP+byKq0rxFROV7Z+2et1VsRnTKa
G73VululycslaVNVJ1zgyjbLiGH7HrfQy+4W+9OmTN6SpdTi3/UGVN4unUu0kzCq
gc7dGtxRcw1PcOnlthYhGXmy5okLdWTK1au8CcEYof/UVKGFPP0UJAOyh9OktwID
AQABo0IwQDAOBgNVHQ8BAf8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4E
FgQUu//KjiOfT5nK2+JopqUVJxce2Q4wDQYJKoZIhvcNAQEMBQADggIBAB/Kzt3H
vqGf2SdMC9wXmBFqiN495nFWcrKeGk6c1SuYJF2ba3uwM4IJvd8lRuqYnrYb/oM8
0mJhwQTtzuDFycgTE1XnqGOtjHsB/ncw4c5omwX4Eu55MaBBRTUoCnGkJE+M3DyC
B19m3H0Q/gxhswWV7uGugQ+o+MePTagjAiZrHYNSVc61LwDKgEDg4XSsYPWHgJ2u
NmSRXbBoGOqKYcl3qJfEycel/FVL8/B/uWU9J2jQzGv6U53hkRrJXRqWbTKH7QMg
yALOWr7Z6v2yTcQvG99fevX4i8buMTolUVVnjWQye+mew4K6Ki3pHrTgSAai/Gev
HyICc/sgCq+dVEuhzf9gR7A/Xe8bVr2XIZYtCtFenTgCR2y59PYjJbigapordwj6
xLEokCZYCDzifqrXPW+6MYgKBesntaFJ7qBFVHvmJ2WZICGoo7z7GJa7Um8M7YNR
TOlZ4iBgxcJlkoKM8xAfDoqXvneCbT+PHV28SSe9zE8P4c52hgQjxcCMElv924Sg
JPFI/2R80L5cFtHvma3AH/vLrrw4IgYmZNralw4/KBVEqE8AyvCazM90arQ+POuV
7LXTWtiBmelDGDfrs7vRWGJB82bSj6p4lVQgw1oudCvV0b4YacCs1aTPObpRhANl
6WLAYv7YTVWW4tAR+kg0Eeye7QUd5MjWHYbL
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICCTCCAY6gAwIBAgINAgPluILrIPglJ209ZjAKBggqhkjOPQQDAzBHMQswCQYD
VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG
A1UEAxMLR1RTIFJvb3QgUjMwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw
WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz
IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjMwdjAQBgcqhkjOPQIBBgUrgQQAIgNi
AAQfTzOHMymKoYTey8chWEGJ6ladK0uFxh1MJ7x/JlFyb+Kf1qPKzEUURout736G
jOyxfi//qXGdGIRFBEFVbivqJn+7kAHjSxm65FSWRQmx1WyRRK2EE46ajA2ADDL2
4CejQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW
BBTB8Sa6oC2uhYHP0/EqEr24Cmf9vDAKBggqhkjOPQQDAwNpADBmAjEA9uEglRR7
VKOQFhG/hMjqb2sXnh5GmCCbn9MN2azTL818+FsuVbu/3ZL3pAzcMeGiAjEA/Jdm
ZuVDFhOD3cffL74UOO0BzrEXGhF16b0DjyZ+hOXJYKaV11RZt+cRLInUue4X
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD
VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG
A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw
WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz
IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi
AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi
QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR
HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW
BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D
9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8
p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICGzCCAaGgAwIBAgIQQdKd0XLq7qeAwSxs6S+HUjAKBggqhkjOPQQDAzBPMQsw
CQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFyY2gg
R3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBYMjAeFw0yMDA5MDQwMDAwMDBaFw00
MDA5MTcxNjAwMDBaME8xCzAJBgNVBAYTAlVTMSkwJwYDVQQKEyBJbnRlcm5ldCBT
ZWN1cml0eSBSZXNlYXJjaCBHcm91cDEVMBMGA1UEAxMMSVNSRyBSb290IFgyMHYw
EAYHKoZIzj0CAQYFK4EEACIDYgAEzZvVn4CDCuwJSvMWSj5cz3es3mcFDR0HttwW
+1qLFNvicWDEukWVEYmO6gbf9yoWHKS5xcUy4APgHoIYOIvXRdgKam7mAHf7AlF9
ItgKbppbd9/w+kHsOdx1ymgHDB/qo0IwQDAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0T
AQH/BAUwAwEB/zAdBgNVHQ4EFgQUfEKWrt5LSDv6kviejM9ti6lyN5UwCgYIKoZI
zj0EAwMDaAAwZQIwe3lORlCEwkSHRhtFcP9Ymd70/aTSVaYgLXTWNLxBo1BfASdW
tL4ndQavEi51mI38AjEAi/V3bNTIZargCyzuFJ0nN6T5U6VR5CmD1/iQMVtCnwr1
/q4AaOeMSQ+2b1tbFfLn
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIDjjCCAnagAwIBAgIQAzrx5qcRqaC7KGSxHQn65TANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xMzA4MDExMjAwMDBaFw0zODAxMTUxMjAwMDBaMGExCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xIDAeBgNVBAMTF0RpZ2lDZXJ0IEdsb2JhbCBSb290IEcyMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuzfNNNx7a8myaJCtSnX/RrohCgiN9RlUyfuI
2/Ou8jqJkTx65qsGGmvPrC3oXgkkRLpimn7Wo6h+4FR1IAWsULecYxpsMNzaHxmx
1x7e/dfgy5SDN67sH0NO3Xss0r0upS/kqbitOtSZpLYl6ZtrAGCSYP9PIUkY92eQ
q2EGnI/yuum06ZIya7XzV+hdG82MHauVBJVJ8zUtluNJbd134/tJS7SsVQepj5Wz
tCO7TG1F8PapspUwtP1MVYwnSlcUfIKdzXOS0xZKBgyMUNGPHgm+F6HmIcr9g+UQ
vIOlCsRnKPZzFBQ9RnbDhxSJITRNrw9FDKZJobq7nMWxM4MphQIDAQABo0IwQDAP
BgNVHRMBAf8EBTADAQH/MA4GA1UdDwEB/wQEAwIBhjAdBgNVHQ4EFgQUTiJUIBiV
5uNu5g/6+rkS7QYXjzkwDQYJKoZIhvcNAQELBQADggEBAGBnKJRvDkhj6zHd6mcY
1Yl9PMWLSn/pvtsrF9+wX3N3KjITOYFnQoQj8kVnNeyIv/iPsGEMNKSuIEyExtv4
NeF22d+mQrvHRAiGfzZ0JFrabA0UWTW98kndth/Jsw1HKj2ZL7tcu7XUIOGZX1NG
Fdtom/DzMNU+MeKNhJ7jitralj41E6Vf8PlwUHBHQRFXGU7Aj64GxJUTFy8bJZ91
8rGOmaFvE7FBcf6IKshPECBV1/MUReXgRPTqh5Uykw7+U0b6LJ3/iyK5S9kJRaTe
pLiaWN0bfVKfjllDiIGknibVb63dDcY3fe0Dkhvld1927jyNxF1WW6LZZm6zNTfl
MrY=
-----END CERTIFICATE-----
)PEM";

// ==================== GATEWAY IMPLEMENTATION ====================

constexpr size_t FIELD_COUNT = 16, QUEUE_CAPACITY = 32, BATCH_SIZE = 4;
constexpr size_t METER_COUNT = sizeof(SLAVE_IDS)/sizeof(SLAVE_IDS[0]);
static_assert(METER_COUNT > 0 && METER_COUNT <= 8, "Configure 1–8 meters");
static_assert(sizeof(REGISTER_ADDRESSES)/sizeof(REGISTER_ADDRESSES[0]) == FIELD_COUNT,"16 addresses required");
const char* FIELD_NAMES[FIELD_COUNT] = {"voltage_rn","voltage_yn","voltage_bn","voltage_avg","voltage_ry","voltage_yb","voltage_br","current_r","current_y","current_b","current_n","pf_r","pf_y","pf_b","pf_avg","frequency"};
struct Sample {
  char id[37]; uint8_t slave; time_t measuredAt; float values[FIELD_COUNT];
  bool valid[FIELD_COUNT]; uint8_t errors[FIELD_COUNT];
};
QueueHandle_t samples;
ModbusMaster master;
void transmit() { digitalWrite(RS485_DIRECTION,HIGH); delayMicroseconds(100); }
void receive() { Serial2.flush(); delayMicroseconds(100); digitalWrite(RS485_DIRECTION,LOW); }
void sampleId(char* out) {
  uint8_t b[16]; esp_fill_random(b,16); b[6]=(b[6]&15)|64; b[8]=(b[8]&63)|128;
  snprintf(out,37,"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",b[0],b[1],b[2],b[3],b[4],b[5],b[6],b[7],b[8],b[9],b[10],b[11],b[12],b[13],b[14],b[15]);
}
bool clockReady(time_t t) { return t >= 1735689600; } // 2025-01-01 UTC
void pollTask(void*) {
  TickType_t next = xTaskGetTickCount(); uint32_t dropped=0;
  for (;;) {
    for (size_t m=0;m<METER_COUNT;m++) {
      Sample s{};sampleId(s.id);s.slave=SLAVE_IDS[m];time_t t=time(nullptr);s.measuredAt=clockReady(t)?t:0;
      master.begin(s.slave,Serial2);master.preTransmission(transmit);master.postTransmission(receive);
      bool offline=false;
      Serial.printf("Polling slave %u\n",s.slave);
      for(size_t f=0;f<FIELD_COUNT;f++) {
        if(offline){s.errors[f]=ModbusMaster::ku8MBResponseTimedOut;continue;}
        uint8_t result=master.readHoldingRegisters(REGISTER_ADDRESSES[f],2);
        s.errors[f]=result;
        if(result==ModbusMaster::ku8MBSuccess) {
          uint32_t bits=(uint32_t(master.getResponseBuffer(1))<<16)|master.getResponseBuffer(0);
          float value;memcpy(&value,&bits,sizeof(value)); // IEEE754, low word first
          s.valid[f]=isfinite(value) && fabsf(value)<=1e9;
          if(s.valid[f]){s.values[f]=value;Serial.printf("  %s: %.4f\n",FIELD_NAMES[f],value);}
          else {s.errors[f]=0xFF;Serial.printf("  %s: invalid float\n",FIELD_NAMES[f]);}
        } else {
          Serial.printf("  %s: Modbus error 0x%02X\n",FIELD_NAMES[f],result);
          if(result==ModbusMaster::ku8MBResponseTimedOut){offline=true;Serial.println("  Timeout: skipping remaining registers this poll");}
        }
        vTaskDelay(pdMS_TO_TICKS(50));
      }
      if(xQueueSend(samples,&s,0)!=pdTRUE){Sample old;if(xQueueReceive(samples,&old,0)==pdTRUE)++dropped;if(xQueueSend(samples,&s,0)!=pdTRUE)++dropped;Serial.printf("RAM queue full; dropped total %lu\n",(unsigned long)dropped);}
    }
    // Network task cannot block this dedicated polling task.
    vTaskDelayUntil(&next,pdMS_TO_TICKS(POLL_INTERVAL_MS));
  }
}
void networkTask(void*) {
  Sample pending[BATCH_SIZE];size_t count=0;uint32_t backoff=5000, nextTry=0, wifiStarted=0, nextWifi=0;bool connecting=false,wasConnected=false;
  for(;;) {
    uint32_t ms=millis();
    if(WiFi.status()!=WL_CONNECTED) {
      wasConnected=false;
      if(!connecting && int32_t(ms-nextWifi)>=0){WiFi.begin(WIFI_SSID,WIFI_PASSWORD);connecting=true;wifiStarted=ms;}
      if(connecting && ms-wifiStarted>20000){WiFi.disconnect();connecting=false;nextWifi=ms+30000;Serial.println("Wi-Fi unavailable; local polling continues");}
      vTaskDelay(pdMS_TO_TICKS(250));continue;
    }
    connecting=false;
    if(!wasConnected){wasConnected=true;configTime(0,0,NTP_SERVER);Serial.println("Wi-Fi connected; synchronizing UTC clock");}
    // TLS certificate dates need a valid clock. Polling still records null device
    // time if SNTP is unavailable; never bypass certificate verification.
    if(!clockReady(time(nullptr))){vTaskDelay(pdMS_TO_TICKS(500));continue;}
    if(int32_t(ms-nextTry)<0){vTaskDelay(pdMS_TO_TICKS(250));continue;}
    while(count<BATCH_SIZE && xQueueReceive(samples,&pending[count],0)==pdTRUE)count++;
    if(!count){vTaskDelay(pdMS_TO_TICKS(250));continue;}
    // The API accepts timestamps at most 7 days old. Discard expired RAM samples.
    size_t kept=0;for(size_t i=0;i<count;i++){if(pending[i].measuredAt && time(nullptr)-pending[i].measuredAt>6*86400){Serial.println("Discarding expired sample");continue;}pending[kept++]=pending[i];}count=kept;if(!count)continue;
    JsonDocument doc;doc["device_id"]=DEVICE_ID;JsonArray batch=doc["samples"].to<JsonArray>();
    for(size_t i=0;i<count;i++) {
      const Sample& s=pending[i];JsonObject item=batch.add<JsonObject>();item["sample_id"]=s.id;item["slave_id"]=s.slave;
      if(s.measuredAt){char iso[25];struct tm utc;gmtime_r(&s.measuredAt,&utc);strftime(iso,sizeof(iso),"%Y-%m-%dT%H:%M:%SZ",&utc);item["measured_at"]=iso;}else item["measured_at"]=nullptr;
      JsonObject values=item["values"].to<JsonObject>(),errors=item["errors"].to<JsonObject>();
      for(size_t f=0;f<FIELD_COUNT;f++){if(s.valid[f])values[FIELD_NAMES[f]]=s.values[f];else{values[FIELD_NAMES[f]]=nullptr;char reason[32];snprintf(reason,sizeof(reason),"modbus_or_float_0x%02X",s.errors[f]);errors[FIELD_NAMES[f]]=reason;}}
    }
    String payload;serializeJson(doc,payload);
    WiFiClientSecure tls;tls.setCACert(ROOT_CA);tls.setHandshakeTimeout(8);tls.setTimeout(5000);
    HTTPClient http;http.setConnectTimeout(5000);http.setTimeout(5000);http.setReuse(false);
    bool success=false;int status=-1;
    if(http.begin(tls,INGEST_URL)) {
      http.addHeader("Content-Type","application/json");http.addHeader("Authorization",String("Bearer ")+UPLOAD_TOKEN);
      status=http.POST(payload);
      if(status==200){JsonDocument response;DeserializationError err=deserializeJson(response,http.getString());success=!err && response["ok"]==true && response["inserted"].as<int>()+response["duplicates"].as<int>()==int(count);}
      http.end();
    }
    if(success){Serial.printf("HTTPS acknowledged %u samples\n",unsigned(count));count=0;backoff=5000;nextTry=millis()+10000;}
    else if(status==400||status==403||status==413||status==415){Serial.printf("HTTPS rejected batch (%d); discarding %u samples. Check configuration.\n",status,unsigned(count));count=0;nextTry=millis()+60000;}
    else {Serial.printf("HTTPS failure (%d); retrying SAME sample IDs in %lus\n",status,(unsigned long)(backoff/1000));nextTry=millis()+backoff+(esp_random()%1000);backoff=min(backoff*2,uint32_t(300000));}
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}
void setup() {
  Serial.begin(115200);pinMode(RS485_DIRECTION,OUTPUT);digitalWrite(RS485_DIRECTION,LOW);
  Serial2.begin(MODBUS_BAUD,SERIAL_8N1,UART_RX,UART_TX);
  if(POLL_INTERVAL_MS<60000){Serial.println("Set POLL_INTERVAL_MS >= 60000");while(true)delay(1000);}
  for(size_t i=0;i<METER_COUNT;i++){if(SLAVE_IDS[i]<1||SLAVE_IDS[i]>247){Serial.println("Invalid slave ID");while(true)delay(1000);}for(size_t j=0;j<i;j++)if(SLAVE_IDS[i]==SLAVE_IDS[j]){Serial.println("Duplicate slave ID");while(true)delay(1000);}}
  samples=xQueueCreate(QUEUE_CAPACITY,sizeof(Sample));
  if(!samples){Serial.println("Queue allocation failed");while(true)delay(1000);}
  WiFi.mode(WIFI_STA);WiFi.setAutoReconnect(false);
  if(xTaskCreate(pollTask,"modbus-poll",6144,nullptr,1,nullptr)!=pdPASS||xTaskCreate(networkTask,"https-upload",16384,nullptr,1,nullptr)!=pdPASS){Serial.println("Task allocation failed");while(true)delay(1000);}
}
void loop(){vTaskDelay(pdMS_TO_TICKS(1000));}
