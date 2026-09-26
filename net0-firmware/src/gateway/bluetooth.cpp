// BLE GATT server the backend connects to (from Ishan's gateway-esp).
// The laptop scans for SERVICE_UUID, connects, and subscribes to
// notifications on CHARACTERISTIC_UUID. Uplink = notify, downlink = write.
#include "bluetooth.h"
#include "backend_codec.h"
#include "packet.h"

#include <Arduino.h>
#include <atomic>
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

// Up to 3 laptops can connect at once (ESP32 BLE limit). We keep advertising
// while connected, otherwise one stray connection hides the gateway from everyone.
#define MAX_CONNECTIONS 3

static std::atomic<int> connectionCount{0};  // written by BLE task, read by loop()
static BLEServer *server = nullptr;
static BLECharacteristic *characteristic = nullptr;

// Downlink (backend -> gateway) state, see DownlinkCallbacks below.
#define MAX_DOWNLINK_FRAME 1024
static QueueHandle_t ackQueue;
static QueueHandle_t messageQueue;  // items are BK_MESSAGE_LEN raw bytes
static uint8_t rxBuf[2 + MAX_DOWNLINK_FRAME];
static size_t rxLen = 0;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *s, esp_ble_gatts_cb_param_t *param) override {
    connectionCount++;
    const uint8_t *a = param->connect.remote_bda;
    Serial.printf("[ble] device connected: %02X:%02X:%02X:%02X:%02X:%02X (%d connected)\n",
                  a[0], a[1], a[2], a[3], a[4], a[5], connectionCount.load());
    if (connectionCount.load() < MAX_CONNECTIONS) s->startAdvertising();  // stay visible
  }

  void onDisconnect(BLEServer *s, esp_ble_gatts_cb_param_t *param) override {
    if (connectionCount > 0) connectionCount--;
    rxLen = 0;  // drop any half-received downlink frame
    Serial.printf("[ble] device disconnected (%d connected)\n", connectionCount.load());
    s->startAdvertising();
  }
};

// Backend -> gateway. Frames are [u16 len][payload]. One write may hold several
// frames, and a long frame (a 440-byte message) may be split over several writes,
// so bytes are collected in rxBuf until a whole frame is there.
// ACK and message frames go into queues; loop() turns them into mesh packets
// (never send ESP-NOW from inside a BLE callback).
//   ack:     [type][target_node][user_id u16][acked_msg_id u32]
//   message: [type][target_node][user_id u16][reply_to u32][sender 32][text 400]

static void handleDownlinkFrame(const uint8_t *f, size_t len) {
  if (f[0] == PKT_ACK && len >= 8) {
    uint32_t acked = f[4] | (f[5] << 8) | (f[6] << 16) | ((uint32_t)f[7] << 24);
    xQueueSend(ackQueue, &acked, 0);
  } else if (f[0] == PKT_MESSAGE && len >= BK_MESSAGE_LEN) {
    if (xQueueSend(messageQueue, f, 0) != pdTRUE) Serial.println("[ble] message queue full, dropped a message");
  } else {
    Serial.printf("[ble] ignored downlink type %u (%u bytes)\n", f[0], (unsigned)len);
  }
}

class DownlinkCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    String v = c->getValue();
    const uint8_t *d = (const uint8_t *)v.c_str();
    for (size_t i = 0; i < v.length(); i++) {
      if (rxLen < sizeof(rxBuf)) rxBuf[rxLen++] = d[i];
      // Peel off every complete frame collected so far.
      while (rxLen >= 2) {
        size_t len = rxBuf[0] | (rxBuf[1] << 8);
        if (len == 0 || len > MAX_DOWNLINK_FRAME) {  // garbage: drop a byte and resync
          memmove(rxBuf, rxBuf + 1, --rxLen);
          continue;
        }
        if (rxLen < 2 + len) break;  // rest of the frame is still coming
        handleDownlinkFrame(rxBuf + 2, len);
        rxLen -= 2 + len;
        memmove(rxBuf, rxBuf + 2 + len, rxLen);
      }
    }
  }
};

bool nextBackendAck(uint32_t &msgId) {
  return ackQueue && xQueueReceive(ackQueue, &msgId, 0) == pdTRUE;
}

bool nextBackendMessage(uint8_t *frame) {
  return messageQueue && xQueueReceive(messageQueue, frame, 0) == pdTRUE;
}

// ---------- outgoing queue ----------
// loop() puts frames in; senderTask() takes them out once they've been sent.
#define QUEUE_LEN 16
#define MAX_FRAME (2 + 1024)

struct Frame {
  uint32_t msgId;  // 0 = don't track (e.g. heartbeats)
  uint16_t len;
  uint8_t data[MAX_FRAME];  // [u16 length][payload]
};

static QueueHandle_t outQueue;
static uint32_t waitingIds[QUEUE_LEN];  // msg_ids currently in the queue
static portMUX_TYPE waitingLock = portMUX_INITIALIZER_UNLOCKED;

static bool isWaiting(uint32_t id) {
  bool found = false;
  portENTER_CRITICAL(&waitingLock);
  for (uint32_t w : waitingIds)
    if (w == id) found = true;
  portEXIT_CRITICAL(&waitingLock);
  return found;
}

static void setWaiting(uint32_t oldId, uint32_t newId) {
  portENTER_CRITICAL(&waitingLock);
  for (uint32_t &w : waitingIds) {
    if (w == oldId) {
      w = newId;
      break;
    }
  }
  portEXIT_CRITICAL(&waitingLock);
}

bool queueForBackend(const uint8_t *payload, size_t len, uint32_t msgId) {
  static Frame f;  // only called from loop(), so one buffer is enough
  if (len > MAX_FRAME - 2) return false;
  if (msgId && isWaiting(msgId)) return true;  // an earlier attempt is already queued

  f.msgId = msgId;
  f.len = len + 2;
  f.data[0] = len & 0xFF;
  f.data[1] = len >> 8;
  memcpy(f.data + 2, payload, len);
  if (xQueueSend(outQueue, &f, 0) != pdTRUE) return false;
  if (msgId) setWaiting(0, msgId);
  return true;
}

unsigned backendQueueDepth() {
  return outQueue ? uxQueueMessagesWaiting(outQueue) : 0;
}

// Sends one frame as BLE notifications, split into MTU-sized chunks.
static void sendFrame(const Frame &f) {
  // One notification carries at most MTU - 3 bytes. notify() goes to every
  // connected laptop, so use the smallest MTU among them.
  uint16_t mtu = 0;
  for (auto &peer : server->getPeerDevices(false))
    if (mtu == 0 || peer.second.mtu < mtu) mtu = peer.second.mtu;
  size_t chunk = (mtu > 3) ? mtu - 3 : 20;

  for (size_t off = 0; off < f.len; off += chunk) {
    size_t n = min(chunk, (size_t)(f.len - off));
    characteristic->setValue((uint8_t *)f.data + off, n);
    characteristic->notify();
    delay(5);  // give the BLE stack time to send before the next chunk
  }
}

// Runs on its own FreeRTOS task so slow BLE sends never block ESP-NOW receive.
static void senderTask(void *) {
  static Frame f;
  for (;;) {
    if (connectionCount == 0 || xQueuePeek(outQueue, &f, pdMS_TO_TICKS(100)) != pdTRUE) {
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }
    sendFrame(f);
    xQueueReceive(outQueue, &f, 0);  // dequeue only after it was sent
    if (f.msgId) setWaiting(f.msgId, 0);
    Serial.printf("[ble] sent %u bytes to backend (%u still queued)\n", f.len, backendQueueDepth());
  }
}

void setupBluetooth() {
  ackQueue = xQueueCreate(16, sizeof(uint32_t));
  messageQueue = xQueueCreate(4, BK_MESSAGE_LEN);
  outQueue = xQueueCreate(QUEUE_LEN, sizeof(Frame));
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

  xTaskCreate(senderTask, "ble_sender", 4096, nullptr, 1, nullptr);
}

bool bluetoothConnected() {
  return connectionCount > 0;
}
