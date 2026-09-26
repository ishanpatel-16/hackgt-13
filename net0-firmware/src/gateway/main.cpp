// net0 gateway firmware. Never relays mesh traffic.
// Dedups packets (per msg_id + attempt), then:
//   - sends them to the backend over Bluetooth (binary, see backend_codec.h)
//   - prints one JSON line per packet over USB serial (for debugging)
// When the backend ACKs a report, floods a PKT_ACK so the origin node stops retrying.
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
  out += "\",\"attempt\":";
  out += p.attempt;
  out += ",\"origin\":";
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
    out += ",\"user_id\":";
    out += p.user_id;

    if (p.has_gps) {
      char gps[80];
      snprintf(gps, sizeof(gps), ",\"gps\":{\"lat\":%.6f,\"lon\":%.6f,\"accuracy_m\":%u}",
               p.lat, p.lon, p.accuracy_m);
      out += gps;
    }
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
  if (p.type == PKT_ACK) return;  // our own ACKs echoing back
  if (!isNeighbor(p.last_hop)) return;
  // Each retry (new attempt) goes to the backend: if our last ACK got lost,
  // the backend sees the duplicate msg_id, doesn't re-save it, and ACKs again.
  if (alreadySeen(p)) return;
  markSeen(p);
  printJson(p, item.rssi);

  // Old heartbeats are useless (the backend would think a node is alive now),
  // so only queue them while a laptop is connected. Reports always queue.
  if (p.type == PKT_HEARTBEAT && !bluetoothConnected()) return;

  static uint8_t payload[BK_MAX_PAYLOAD];
  size_t len = bkEncode(p, payload);
  if (!len) return;
  uint32_t trackId = p.type == PKT_REPORT ? p.msg_id : 0;
  if (queueForBackend(payload, len, trackId))
    Serial.printf("[ble] queued %s %08X (%u waiting)\n", typeName(p.type), p.msg_id, backendQueueDepth());
  else
    Serial.printf("[ble] queue full, dropped %08X (node will retry)\n", p.msg_id);
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n[boot] net0 gateway %d\n", NODE_ID);
  initRadio(nullptr, true);  // modem sleep required alongside Bluetooth
  setupBluetooth();
}

// Backend saved report `msgId`: flood an ACK so its origin node stops retrying.
static void floodAck(uint32_t msgId) {
  Packet ack = newPacket(PKT_ACK);
  ack.ref_id = msgId;
  markSeen(ack);
  sendPacket(ack);
  Serial.printf("[ack] backend saved %08X, flooding ack %08X\n", msgId, ack.msg_id);
}

void loop() {
  RxItem item;
  while (xQueueReceive(rxQueue, &item, 0) == pdTRUE) handleRx(item);

  uint32_t acked;
  while (nextBackendAck(acked)) floodAck(acked);

  // Gateway's own heartbeat on serial only (backend rejects node ID 0;
  // the BLE connection itself tells it the gateway is alive).
  if (millis() - lastHeartbeat >= HEARTBEAT_MS) {
    lastHeartbeat = millis();
    Serial.printf("{\"type\":\"heartbeat\",\"msg_id\":\"00000000\",\"origin\":%d,\"hops\":0,\"rssi\":0,\"path\":[%d]}\n",
                  NODE_ID, NODE_ID);
  }
  delay(1);
}
