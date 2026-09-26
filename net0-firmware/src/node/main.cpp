// net0 node firmware. Every node is BOTH an access node and a relay:
// - Access: Wi-Fi AP "NET0-<id>" + captive portal + report form (web.cpp)
// - Relay: rebroadcasts every new packet exactly once (flooding)
// Reports are resent (same msg_id, attempt+1) until the gateway floods back an ACK.
#include "mesh.h"
#include "node.h"

#include <DNSServer.h>
static DNSServer dns;

// The web servers call into this file from their own tasks; loop() runs on
// another. This lock guards pending[] and the dedup buffer.
static SemaphoreHandle_t lock;

static uint32_t lastHeartbeat = 0;

// ---------- reports waiting for an ACK ----------
#define MAX_PENDING 8

struct Pending {
  bool used;
  bool delivered;
  Packet pkt;
  uint32_t nextSend;  // millis() when the next retry is due
  uint32_t interval;  // current wait between retries (doubles each time)
};
static Pending pending[MAX_PENDING];
static uint8_t pendingNext = 0;

static Pending *findPending(uint32_t msgId) {
  for (Pending &e : pending)
    if (e.used && e.pkt.msg_id == msgId) return &e;
  return nullptr;
}

// Take a free (or already delivered) slot; if all are busy, reuse the oldest.
static Pending &takeSlot() {
  for (Pending &e : pending)
    if (!e.used || e.delivered) return e;
  Pending &e = pending[pendingNext];
  Serial.printf("[retry] queue full, giving up on %08X\n", e.pkt.msg_id);
  pendingNext = (pendingNext + 1) % MAX_PENDING;
  return e;
}

static void transmit(Packet &p) {
  markSeen(p);  // so we ignore our own echo
  sendPacket(p);
  Serial.printf("[tx] %s id=%08X attempt=%u\n", typeName(p.type), p.msg_id, p.attempt);
}

uint32_t nodeSendReport(const ReportInfo &r) {
  xSemaphoreTake(lock, portMAX_DELAY);
  Pending &e = takeSlot();
  e.used = true;
  e.delivered = false;
  e.pkt = newPacket(PKT_REPORT);
  e.pkt.user_id = r.userId;
  e.pkt.category = r.category;
  e.pkt.people = r.people;
  e.pkt.has_gps = r.gps.valid;
  e.pkt.lat = r.gps.lat;
  e.pkt.lon = r.gps.lon;
  e.pkt.accuracy_m = r.gps.accuracy_m;
  strlcpy(e.pkt.location, r.location, LOCATION_LEN);
  strlcpy(e.pkt.message, r.message, MESSAGE_LEN);
  e.interval = RETRY_FIRST_MS;
  e.nextSend = millis() + e.interval;
  transmit(e.pkt);
  uint32_t id = e.pkt.msg_id;
  xSemaphoreGive(lock);
  return id;
}

bool nodeReportStatus(uint32_t msgId, bool &delivered, uint8_t &attempts) {
  xSemaphoreTake(lock, portMAX_DELAY);
  Pending *e = findPending(msgId);
  if (e) {
    delivered = e->delivered;
    attempts = e->pkt.attempt + 1;
  }
  xSemaphoreGive(lock);
  return e != nullptr;
}

// Resend every unACKed report whose timer is up. Backoff: 3 s, 6 s, 12 s ... 30 s.
static void retryPending() {
  uint32_t now = millis();
  for (Pending &e : pending) {
    if (!e.used || e.delivered || (int32_t)(now - e.nextSend) < 0) continue;
    if (e.pkt.attempt >= MAX_ATTEMPTS) {
      Serial.printf("[retry] %08X: out of attempts\n", e.pkt.msg_id);
      e.used = false;
      continue;
    }
    // Same msg_id so the backend can dedup; fresh path/ttl for the new trip.
    e.pkt.attempt++;
    e.pkt.last_hop = NODE_ID;
    e.pkt.ttl = DEFAULT_TTL;
    e.pkt.path_len = 1;
    e.pkt.path[0] = NODE_ID;
    transmit(e.pkt);
    e.interval = min<uint32_t>(e.interval * 2, RETRY_MAX_MS);
    e.nextSend = now + e.interval + random(0, 500);  // jitter so nodes don't retry in sync
  }
}

// ---------- mesh receive ----------
static void handleRx(RxItem &item) {
  Packet &p = item.pkt;
  if (!isValid(p)) return;
  if (p.origin == NODE_ID || p.last_hop == NODE_ID) return;
  if (!isNeighbor(p.last_hop)) return;  // filter BEFORE dedup, or a non-neighbor copy would "use up" the id
  if (alreadySeen(p)) return;
  markSeen(p);

  Serial.printf("[rx] %s id=%08X attempt=%u origin=%u from=%u ttl=%u rssi=%d\n",
                typeName(p.type), p.msg_id, p.attempt, p.origin, p.last_hop, p.ttl, item.rssi);

  // An ACK for one of OUR reports: stop retrying. No need to forward it further.
  if (p.type == PKT_ACK) {
    Pending *e = findPending(p.ref_id);
    if (e) {
      if (!e->delivered) Serial.printf("[ack] %08X delivered after %u attempt(s)\n", p.ref_id, e->pkt.attempt + 1);
      e->delivered = true;
      return;
    }
  }

  if (p.ttl <= 1) {
    Serial.println("[rx] ttl expired, not forwarding");
    return;
  }
  p.ttl--;
  p.last_hop = NODE_ID;
  if (p.path_len < MAX_PATH) p.path[p.path_len++] = NODE_ID;

  delay(random(10, 61));  // jitter so neighbors don't all transmit at once
  sendPacket(p);
  Serial.printf("[fwd] %s id=%08X ttl=%u\n", typeName(p.type), p.msg_id, p.ttl);
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n[boot] net0 node %d (access + relay)\n", NODE_ID);
  lock = xSemaphoreCreateMutex();

  char apName[16];
  snprintf(apName, sizeof(apName), "NET0-%d", NODE_ID);
  initRadio(apName);
  Serial.printf("[boot] AP \"%s\" up at %s\n", apName, WiFi.softAPIP().toString().c_str());

  dns.start(53, "*", WiFi.softAPIP());  // answer every DNS lookup with our IP (captive portal)
  webBegin();
}

void loop() {
  dns.processNextRequest();

  xSemaphoreTake(lock, portMAX_DELAY);
  RxItem item;
  while (xQueueReceive(rxQueue, &item, 0) == pdTRUE) handleRx(item);
  retryPending();
  if (millis() - lastHeartbeat >= HEARTBEAT_MS) {
    lastHeartbeat = millis();
    Packet hb = newPacket(PKT_HEARTBEAT);
    transmit(hb);
  }
  xSemaphoreGive(lock);

  delay(1);
}
