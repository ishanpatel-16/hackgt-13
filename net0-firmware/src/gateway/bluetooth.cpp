// BLE GATT server the backend connects to (from Ishan's gateway-esp).
// The laptop scans for SERVICE_UUID, connects, and subscribes to
// notifications on CHARACTERISTIC_UUID. Uplink = notify, downlink = write.
#include "bluetooth.h"

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#if defined(CONFIG_BLUEDROID_ENABLED)
#include <BLE2902.h>
#endif

// -- configuration (must match esp_manager.py) --
#define SERVICE_UUID        "7b2f3a91-8c64-4f2e-a7d1-91c8e7b5d421"
#define CHARACTERISTIC_UUID "a12b3c45-6789-4def-8123-456789abcdef"
#define DEVICE_NAME         "Gateway-Node"

#define DOWNLINK_ACK 4  // packet_codec.py PKT_ACK

static volatile bool connected = false;
static BLEServer *server = nullptr;
static BLECharacteristic *characteristic = nullptr;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *s) override {
    connected = true;
    Serial.println("[ble] laptop connected");
  }

  void onDisconnect(BLEServer *s) override {
    connected = false;
    Serial.println("[ble] laptop disconnected, advertising again");
    s->startAdvertising();
  }
};

// Backend -> gateway. For now we only log it; forwarding acks back
// to the phone over the mesh is a stretch goal.
class DownlinkCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    String v = c->getValue();
    const uint8_t *d = (const uint8_t *)v.c_str();
    // frame: [u16 len][type u8][target_node u8][user_id u16][acked_msg_id u32]
    if (v.length() >= 10 && d[2] == DOWNLINK_ACK) {
      uint32_t acked = d[6] | (d[7] << 8) | (d[8] << 16) | ((uint32_t)d[9] << 24);
      Serial.printf("[ble] ack from backend: msg %08X for node %u\n", acked, d[3]);
    } else {
      Serial.printf("[ble] downlink %u bytes\n", (unsigned)v.length());
    }
  }
};

void setupBluetooth() {
  BLEDevice::init(DEVICE_NAME);
  BLEDevice::setMTU(517);  // let the laptop negotiate big packets

  server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService *service = server->createService(SERVICE_UUID);
  characteristic = service->createCharacteristic(
      CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE |
          BLECharacteristic::PROPERTY_WRITE_NR | BLECharacteristic::PROPERTY_NOTIFY);
#if defined(CONFIG_BLUEDROID_ENABLED)
  characteristic->addDescriptor(new BLE2902());  // lets the laptop subscribe to notify
#endif
  characteristic->setCallbacks(new DownlinkCallbacks());
  characteristic->setValue("Gateway online");
  service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.printf("[ble] advertising as \"%s\"\n", DEVICE_NAME);
}

bool bluetoothConnected() {
  return connected;
}

void sendToBackend(const uint8_t *payload, size_t len) {
  if (!connected) return;

  static uint8_t frame[2 + 1024];
  if (len > sizeof(frame) - 2) return;
  frame[0] = len & 0xFF;
  frame[1] = len >> 8;
  memcpy(frame + 2, payload, len);
  size_t total = len + 2;

  // One notification carries at most MTU - 3 bytes.
  uint16_t mtu = server->getPeerMTU(server->getConnId());
  size_t chunk = (mtu > 3) ? mtu - 3 : 20;

  for (size_t off = 0; off < total; off += chunk) {
    size_t n = min(chunk, total - off);
    characteristic->setValue(frame + off, n);
    characteristic->notify();
    delay(5);  // give the BLE stack time to send before the next chunk
  }
}
