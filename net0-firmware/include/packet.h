// Shared packet format for every net0 board.
// Any change to the over-the-air format happens HERE only (and tell Ishan).
#pragma once
#include <stdint.h>

#define NET0_MAGIC    0x4E30  // "N0" — anything else is dropped
#define NET0_VERSION  1

#define PKT_REPORT    1
#define PKT_HEARTBEAT 2

#define DEFAULT_TTL   6
#define MAX_PATH      8
#define LOCATION_LEN  64
#define MESSAGE_LEN   400

#define WIFI_CHANNEL  6       // AP and ESP-NOW must share one channel on every board
#define HEARTBEAT_MS  10000

// "packed" = no padding bytes between fields, so every board lays the bytes
// out identically and we can memcpy the struct straight onto the radio.
typedef struct __attribute__((packed)) {
  uint16_t magic;
  uint8_t  version;
  uint8_t  type;                  // PKT_REPORT or PKT_HEARTBEAT
  uint32_t msg_id;                // random, never 0; used for duplicate suppression
  uint8_t  origin;                // node that created it
  uint8_t  last_hop;              // node that last transmitted it
  uint8_t  ttl;                   // hops left
  uint8_t  path_len;
  uint8_t  path[MAX_PATH];        // node IDs visited, in order
  char     location[LOCATION_LEN];
  char     message[MESSAGE_LEN];
} Packet;

// ESP-NOW v2 allows 1470 bytes per frame (v1 only 250).
static_assert(sizeof(Packet) <= 1470, "Packet too big for ESP-NOW v2");
