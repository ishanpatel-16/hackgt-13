// net0 node firmware. Every node is BOTH an access node and a relay:
// - Access: Wi-Fi AP "NET0-<id>" + captive portal + report form at 192.168.4.1
// - Relay: rebroadcasts every new packet exactly once (flooding)
#include "mesh.h"

#include <DNSServer.h>
#include <WebServer.h>
static WebServer server(80);
static DNSServer dns;

static uint32_t lastHeartbeat = 0;

static uint32_t newMsgId() {
  uint32_t id;
  do id = esp_random(); while (id == 0);
  return id;
}

// Create a brand-new packet from this node and flood it.
static uint32_t originate(uint8_t type, const char *location, const char *message) {
  Packet p = {};
  p.magic = NET0_MAGIC;
  p.version = NET0_VERSION;
  p.type = type;
  p.msg_id = newMsgId();
  p.origin = NODE_ID;
  p.last_hop = NODE_ID;
  p.ttl = DEFAULT_TTL;
  p.path[0] = NODE_ID;
  p.path_len = 1;
  strlcpy(p.location, location, LOCATION_LEN);
  strlcpy(p.message, message, MESSAGE_LEN);

  markSeen(p.msg_id);  // so we ignore our own echo
  sendPacket(p);
  Serial.printf("[tx] new %s id=%08X\n", typeName(type), p.msg_id);
  return p.msg_id;
}

// Flooding: forward each packet we haven't seen, once.
static void handleRx(RxItem &item) {
  Packet &p = item.pkt;
  if (!isValid(p)) return;
  if (p.origin == NODE_ID || p.last_hop == NODE_ID) return;
  if (!isNeighbor(p.last_hop)) return;  // filter BEFORE dedup, or a non-neighbor copy would "use up" the id
  if (alreadySeen(p.msg_id)) return;
  markSeen(p.msg_id);

  Serial.printf("[rx] %s id=%08X origin=%u from=%u ttl=%u rssi=%d\n",
                typeName(p.type), p.msg_id, p.origin, p.last_hop, p.ttl, item.rssi);

  if (p.ttl <= 1) {
    Serial.println("[rx] ttl expired, not forwarding");
    return;
  }
  p.ttl--;
  p.last_hop = NODE_ID;
  if (p.path_len < MAX_PATH) p.path[p.path_len++] = NODE_ID;

  delay(random(10, 61));  // jitter so neighbors don't all transmit at once
  sendPacket(p);
  Serial.printf("[fwd] id=%08X ttl=%u\n", p.msg_id, p.ttl);
}

static const char FORM_HTML[] PROGMEM = R"HTML(<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>net0 emergency report</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#111;color:#eee}
h1{font-size:1.4em;margin:0 0 4px}p{color:#aaa;margin:0 0 16px}
label{display:block;margin:12px 0 4px;font-weight:600}
input,textarea{width:100%;box-sizing:border-box;padding:10px;font-size:16px;border-radius:8px;border:1px solid #444;background:#222;color:#eee}
textarea{height:160px}
button{margin-top:16px;width:100%;padding:14px;font-size:18px;font-weight:700;border:0;border-radius:8px;background:#e53935;color:#fff}
</style></head><body>
<h1>net0 Emergency Report</h1>
<p>No internet needed. Your report is relayed to responders.</p>
<form method="POST" action="/send">
<label>Where are you?</label>
<input name="location" maxlength="63" placeholder="e.g. Klaus, Floor 3" required>
<label>What's happening?</label>
<textarea name="message" maxlength="399" placeholder="How many people, injuries, hazards..." required></textarea>
<button type="submit">Send report</button>
</form></body></html>)HTML";

static void handleRoot() {
  server.send_P(200, "text/html", FORM_HTML);
}

static void handleSend() {
  String location = server.arg("location");
  String message = server.arg("message");
  location.trim();
  message.trim();
  if (message.length() == 0) {
    server.send(400, "text/html", "<meta name=viewport content='width=device-width'><h2>Message is empty.</h2><a href='/'>Back</a>");
    return;
  }
  uint32_t id = originate(PKT_REPORT, location.c_str(), message.c_str());

  char page[400];
  snprintf(page, sizeof(page),
           "<meta name=viewport content='width=device-width,initial-scale=1'>"
           "<body style='font-family:system-ui;background:#111;color:#eee;padding:16px'>"
           "<h2>Report sent</h2><p>ID: %08X</p><p>It is being relayed to responders. "
           "Stay where you are if it is safe.</p><a style='color:#8cf' href='/'>Send another</a></body>",
           id);
  server.send(200, "text/html", page);
}

// Captive portal: any unknown URL (incl. phone OS connectivity checks) goes to the form.
static void handleNotFound() {
  server.sendHeader("Location", "http://192.168.4.1/", true);
  server.send(302, "text/plain", "");
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\n[boot] net0 node %d (access + relay)\n", NODE_ID);

  char apName[16];
  snprintf(apName, sizeof(apName), "NET0-%d", NODE_ID);
  initRadio(apName);

  dns.start(53, "*", WiFi.softAPIP());  // answer every DNS lookup with our IP
  server.on("/", HTTP_GET, handleRoot);
  server.on("/send", HTTP_POST, handleSend);
  server.onNotFound(handleNotFound);
  server.begin();
  Serial.printf("[boot] AP \"%s\" up at %s\n", apName, WiFi.softAPIP().toString().c_str());
}

void loop() {
  RxItem item;
  while (xQueueReceive(rxQueue, &item, 0) == pdTRUE) handleRx(item);

  dns.processNextRequest();
  server.handleClient();

  if (millis() - lastHeartbeat >= HEARTBEAT_MS) {
    lastHeartbeat = millis();
    originate(PKT_HEARTBEAT, "", "");
  }
  delay(1);
}
