#include <Arduino.h>

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

// -- configuration --
#define SERVICE_UUID        "7b2f3a91-8c64-4f2e-a7d1-91c8e7b5d421"
#define CHARACTERISTIC_UUID "a12b3c45-6789-4def-8123-456789abcdef"

#define DEVICE_NAME         "Gateway-Node"

// -- bluetooth status --
bool bluetoothConnected = false;

BLEServer *server = nullptr;
BLECharacteristic *characteristic = nullptr;


// -- bluetooth callbacks --
class ServerCallbacks : public BLEServerCallbacks {

  void onConnect(BLEServer *server) override {
    bluetoothConnected = true;

    Serial.println("Laptop connected via Bluetooth");
  }

  void onDisconnect(BLEServer *server) override {
    bluetoothConnected = false;

    Serial.println("Laptop disconnected from Bluetooth");

    server->startAdvertising();

    Serial.println("Bluetooth advertising restarted");
  }
};


// -- bluetooth --
void setupBluetooth() {

  Serial.println("Starting Bluetooth...");

  // initialize bluetooth
  BLEDevice::init(DEVICE_NAME);

  // create server
  server = BLEDevice::createServer();

  server->setCallbacks(
    new ServerCallbacks()
  );

  // create service
  BLEService *service = server->createService(
    SERVICE_UUID
  );

  // create characteristic
  characteristic = service->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_WRITE |
    BLECharacteristic::PROPERTY_NOTIFY
  );

  characteristic->setValue(
    "Gateway online"
  );

  // start service
  service->start();

  // configure advertising
  BLEAdvertising *advertising =
    BLEDevice::getAdvertising();

  advertising->addServiceUUID(
    SERVICE_UUID
  );

  advertising->setScanResponse(true);

  // start advertising
  BLEDevice::startAdvertising();

  Serial.println("Bluetooth advertising started");
}


// -- bluetooth loop --
void handleBluetooth() {

  // bluetooth events are handled
  // through callbacks for now
}