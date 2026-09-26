// net0 gateway firmware: receive-only. Never rebroadcasts.
// Dedups packets, then:
//   - sends them to the backend over Bluetooth (binary, see backend_codec.h)
//   - prints one JSON line per packet over USB serial (for debugging)
#include "mesh.h"
#include "backend_codec.h"
#include "bluetooth.h"

static uint32_t lastHeartbeat = 0;

// Append s to out as a JSON string literal (with escaping).
static void jsonString(String &out, const char *s) {
  out += '"';
  for (; *s; s++) {
    char c = *s;
    switch (c) {
      case '"':  out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if ((uint8_t)c < 0x20) {
          char buf[7];
          snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out += c;
        }
    }
  }
  out += '"';
}

static void printJson(const Packet &p, int rssi) {
  char id[9];
  snprintf(id, sizeof(id), "%08X", p.msg_id);

  String out;
  out.reserve(1024);
  out += "{\"type\":\"";
  out += typeName(p.type);
  out += "\",\"msg_id\":\"";
  out += id;
  out += "\",\"origin\":";
  out += p.origin;
  out += ",\"hops\":";
  out += p.path_len;  // transmissions so far (gateway not counted)
  out += ",\"rssi\":";
  out += rssi;
  out += ",\"path\":[";
  for (uint8_t i = 0; i < p.path_len; i++) {
    out += p.path[i];
    out += ',';
  }
  out += NODE_ID;  // gateway is the last stop
  out += ']';
  if (p.type == PKT_REPORT) {
    out += ",\"location\":";
    jsonString(out, p.location);
    out += ",\"message\":";
    jsonString(out, p.message);
  }
  out += '}';
  Serial.println(out);
}

static void handleRx(RxItem &item) {
  Packet &p = item.pkt;
  if (!isValid(p)) return;
  if (!isNeighbor(p.last_hop)) return;
  if (alreadySeen(p.msg_id)) return;
  markSeen(p.msg_id);
  printJson(p, item.rssi);

  static uint8_t payload[BK_MAX_PAYLOAD];
  size_t len = bkEncode(p, payload);
  if (len && bluetoothConnected()) {
    sendToBackend(payload, len);
    Serial.printf("[ble] sent %s %08X (%u bytes)\n", typeName(p.type), p.msg_id, (unsigned)len);
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n[boot] net0 gateway %d\n", NODE_ID);
  initRadio(nullptr, true);  // modem sleep required alongside Bluetooth
  setupBluetooth();
}

void loop() {
  RxItem item;
  while (xQueueReceive(rxQueue, &item, 0) == pdTRUE) handleRx(item);

  // Gateway's own heartbeat on serial only (backend rejects node ID 0;
  // the BLE connection itself tells it the gateway is alive).
  if (millis() - lastHeartbeat >= HEARTBEAT_MS) {
    lastHeartbeat = millis();
    Serial.printf("{\"type\":\"heartbeat\",\"msg_id\":\"00000000\",\"origin\":%d,\"hops\":0,\"rssi\":0,\"path\":[%d]}\n",
                  NODE_ID, NODE_ID);
  }
  delay(1);
}
