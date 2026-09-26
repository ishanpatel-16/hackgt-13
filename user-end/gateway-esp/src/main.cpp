#include <Arduino.h>

#include "bluetooth.h"
#include "esp_now.h"

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("Starting gateway...");

  // start bluetooth
  setupBluetooth();

  // start esp-now

  Serial.println("Gateway setup complete");
}

void loop() {
  // handle bluetooth
  handleBluetooth();

  // handle esp-now

  delay(10);
}