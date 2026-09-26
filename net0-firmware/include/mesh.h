// Shared mesh plumbing used by both node and gateway firmware:
// radio setup, receive queue, duplicate suppression, neighbor filter.
// Header-only on purpose: each env compiles exactly one main.cpp.
#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include "packet.h"

#ifndef NODE_ID
#error "NODE_ID must be set in platformio.ini build_flags"
#endif
#ifndef NEIGHBORS
#define NEIGHBORS "0"
#endif

static const uint8_t BROADCAST_MAC[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// ---------- receive queue ----------
// The ESP-NOW callback runs on the Wi-Fi task. We only copy the packet into
// a FreeRTOS queue there and do the real work in loop().
struct RxItem {
  Packet pkt;
  int8_t rssi;
};
static QueueHandle_t rxQueue;

static void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len != sizeof(Packet)) return;
  RxItem item;
  memcpy(&item.pkt, data, sizeof(Packet));
  item.rssi = info->rx_ctrl->rssi;
  xQueueSend(rxQueue, &item, 0);  // never block inside the callback
}

// ---------- duplicate suppression (ring buffer of last 64 msg_ids) ----------
static uint32_t seenIds[64];
static uint8_t seenNext = 0;

static bool alreadySeen(uint32_t id) {
  for (uint32_t s : seenIds)
    if (s == id) return true;
  return false;
}

static void markSeen(uint32_t id) {
  seenIds[seenNext] = id;
  seenNext = (seenNext + 1) % 64;
}

// ---------- neighbor filter (fakes a topology on one table) ----------
static uint8_t neighbors[MAX_PATH];
static uint8_t neighborCount = 0;
static bool acceptAll = false;

static void parseNeighbors() {
  const char *s = NEIGHBORS;
  while (*s) {
    int id = atoi(s);
    if (id == 0) acceptAll = true;
    else if (neighborCount < MAX_PATH) neighbors[neighborCount++] = id;
    const char *comma = strchr(s, ',');
    if (!comma) break;
    s = comma + 1;
  }
  if (neighborCount == 0) acceptAll = true;
}

static bool isNeighbor(uint8_t id) {
  if (acceptAll) return true;
  for (uint8_t i = 0; i < neighborCount; i++)
    if (neighbors[i] == id) return true;
  return false;
}

// ---------- packet checks ----------
static bool isValid(Packet &p) {
  if (p.magic != NET0_MAGIC || p.version != NET0_VERSION) return false;
  if (p.msg_id == 0 || p.path_len > MAX_PATH) return false;
  if (p.type != PKT_REPORT && p.type != PKT_HEARTBEAT) return false;
  p.location[LOCATION_LEN - 1] = '\0';  // never trust strings off the air
  p.message[MESSAGE_LEN - 1] = '\0';
  return true;
}

static const char *typeName(uint8_t type) {
  return type == PKT_REPORT ? "report" : "heartbeat";
}

// ---------- radio ----------
static void sendPacket(const Packet &p) {
  esp_err_t err = esp_now_send(BROADCAST_MAC, (const uint8_t *)&p, sizeof(Packet));
  if (err != ESP_OK) Serial.printf("[tx] esp_now_send failed: %s\n", esp_err_to_name(err));
}

// modemSleep must be true when Bluetooth is also running (the ESP32 aborts
// otherwise). It doesn't hurt ESP-NOW receive: with no AP connection the
// radio stays awake and time-shares between Wi-Fi and BLE.
static void initRadio(const char *apName, bool modemSleep = false) {
  if (apName) {
    // Node: Wi-Fi AP for phones + ESP-NOW on the same radio/channel.
    WiFi.mode(WIFI_AP_STA);
    WiFi.softAP(apName, nullptr, WIFI_CHANNEL);  // open network, no password
  } else {
    // Gateway: no AP, ESP-NOW only.
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    esp_wifi_set_channel(WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
  }
  WiFi.setSleep(modemSleep);

  if (esp_now_init() != ESP_OK) {
    Serial.println("[boot] ESP-NOW init failed, restarting");
    delay(1000);
    ESP.restart();
  }

  uint32_t ver = 0;
  esp_now_get_version(&ver);
  Serial.printf("[boot] ESP-NOW version %u\n", ver);
  if (ver < 2) Serial.println("[boot] WARNING: ESP-NOW v1 (250 B max). Use the pioarduino platform!");

  rxQueue = xQueueCreate(10, sizeof(RxItem));
  esp_now_register_recv_cb(onRecv);

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST_MAC, 6);
  peer.channel = 0;  // 0 = "whatever channel we're on" (6)
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  esp_now_add_peer(&peer);

  parseNeighbors();
  Serial.printf("[boot] node %d, channel %d, neighbors \"%s\", MAC %s\n",
                NODE_ID, WIFI_CHANNEL, NEIGHBORS, WiFi.macAddress().c_str());
}
