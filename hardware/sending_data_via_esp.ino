#include <WiFi.h>
#include <HTTPClient.h>
#include <Wire.h>

#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <utility/imumaths.h>
#include <DHT11.h>

#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// Hotspot config
const char* ssid = "Testing";
const char* password = "123456789";
const char* serverUrl = "http://10.12.65.253:3000/api/sensors";

// Hardware pins
#define DHT_PIN     4
#define MQ2_PIN     34
#define MQ135_PIN   35

// Objects
Adafruit_BNO055 bno = Adafruit_BNO055(55, 0x28, &Wire);
DHT11 dht11(DHT_PIN);

// Send data every 5 seconds
unsigned long lastSend = 0; // only non-negative
const unsigned long interval = 5000; // 5 sec (only non-negative)

// Setup
void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // disable brownout detector

  Serial.begin(115200);
  delay(2000);

  // I2C (communication channel with sensors)
  Wire.begin(21, 22);

  // ADC setup (Analog-Digital Converter)
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  // BNO055
  if (!bno.begin()) {
    Serial.println("❌ BNO055 not detected");
    while (1);
  }
  bno.setExtCrystalUse(true);
  Serial.println("✅ BNO055 ready");

  // WiFi
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(ssid, password);

  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\n✅ WiFi Connected");
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  Serial.println("🔥 MQ sensors warming up...");
  delay(20000);
}

// Loop
void loop() {
  if (millis() - lastSend >= interval) {
    lastSend = millis();

    sensors_event_t orientation, gyro, accel;
    bno.getEvent(&orientation, Adafruit_BNO055::VECTOR_EULER);
    bno.getEvent(&gyro, Adafruit_BNO055::VECTOR_GYROSCOPE);
    bno.getEvent(&accel, Adafruit_BNO055::VECTOR_ACCELEROMETER);

    int bnoTemp = bno.getTemp();

    uint8_t sys, g, a, m;
    bno.getCalibration(&sys, &g, &a, &m);

    // DHT11
    int dhtTemp = dht11.readTemperature();

    // MQ Sensors
    int mq2 = analogRead(MQ2_PIN);
    int mq135 = analogRead(MQ135_PIN);

    // Debug
    Serial.println("\nSending sensor data:");
    Serial.print("MQ2: "); Serial.print(mq2);
    Serial.print(" | MQ135: "); Serial.println(mq135);
    Serial.print("DHT Temp: "); Serial.println(dhtTemp);

    // Send to server
    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.begin(serverUrl);
      http.addHeader("Content-Type", "application/json");

      String payload =
        "{"
        "\"mq2\":" + String(mq2) + "," +
        "\"mq135\":" + String(mq135) + "," +
        "\"dhtTemp\":" + String(dhtTemp) + "," +

        "\"orientation\":{"
          "\"x\":" + String(orientation.orientation.x) + "," +
          "\"y\":" + String(orientation.orientation.y) + "," +
          "\"z\":" + String(orientation.orientation.z) +
        "}," +

        "\"gyro\":{"
          "\"x\":" + String(gyro.gyro.x) + "," +
          "\"y\":" + String(gyro.gyro.y) + "," +
          "\"z\":" + String(gyro.gyro.z) +
        "}," +

        "\"accel\":{"
          "\"x\":" + String(accel.acceleration.x) + "," +
          "\"y\":" + String(accel.acceleration.y) + "," +
          "\"z\":" + String(accel.acceleration.z) +
        "}," +

        "\"bnoTemp\":" + String(bnoTemp) + "," +
        "\"calibration\":{"
          "\"sys\":" + String(sys) + "," +
          "\"gyro\":" + String(g) + "," +
          "\"accel\":" + String(a) + "," +
          "\"mag\":" + String(m) +
        "}"
        "}";

      int httpCode = http.POST(payload);

      Serial.print("HTTP Response: ");
      Serial.println(httpCode);

      http.end();
    } else {
      Serial.println("❌ WiFi disconnected");
    }
  }
}
