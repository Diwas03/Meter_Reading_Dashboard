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
#include "config.h"

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
