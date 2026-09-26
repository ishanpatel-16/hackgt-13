// Shared packet format for every net0 board.
// Any change to the over-the-air format happens HERE only (and tell Ishan).
#pragma once
#include <stdint.h>

#define NET0_MAGIC    0x4E30  // "N0" — anything else is dropped
#define NET0_VERSION  5       // v5: category + people

// Packet types. Same numbers as the backend (portal-end/backend/packet_codec.py)
// so a type means the same thing on the mesh and over Bluetooth.
#define PKT_REPORT     1
#define PKT_USER_REPLY 2      // reserved: user follow-up message (not implemented yet)
#define PKT_HEARTBEAT  3
#define PKT_ACK        4      // gateway -> origin node: "report ref_id was saved"
#define PKT_MESSAGE    5      // reserved: responder -> user message (not implemented yet)

#define GATEWAY_ID    0
#define DEFAULT_TTL   6
#define MAX_PATH      8
#define LOCATION_LEN  64
#define MESSAGE_LEN   400

#define WIFI_CHANNEL  6       // AP and ESP-NOW must share one channel on every board
#define HEARTBEAT_MS  10000

// Report retries: resend until ACKed, waiting 3 s, 6 s, 12 s ... capped at 30 s.
#define RETRY_FIRST_MS 3000
#define RETRY_MAX_MS   30000
#define MAX_ATTEMPTS   255

// "packed" = no padding bytes between fields, so every board lays the bytes
// out identically and we can memcpy the struct straight onto the radio.
typedef struct __attribute__((packed)) {
  uint16_t magic;
  uint8_t  version;
  uint8_t  type;                  // PKT_* above
  uint32_t msg_id;                // random, never 0; same on every retry of a report
  uint8_t  attempt;               // 0 = first send, +1 per retry
  uint8_t  origin;                // node that created it
  uint8_t  last_hop;              // node that last transmitted it
  uint8_t  ttl;                   // hops left
  uint16_t user_id;               // phone's user ID (reports only, 0 = unknown)
  uint32_t ref_id;                // ACK: the report msg_id being acknowledged
  uint8_t  category;              // reports: backend Category (0 unknown, 1 medical, 2 trapped, 3 fire, 8 other)
  uint8_t  people;                // reports: people needing help (0 = unknown)
  uint8_t  has_gps;               // reports: 1 if lat/lon/accuracy_m are set
  float    lat;                   // degrees, from the phone's browser (HTTPS page only)
  float    lon;
  uint16_t accuracy_m;            // phone's estimate of how far off the fix may be
  uint8_t  path_len;
  uint8_t  path[MAX_PATH];        // node IDs visited, in order
  char     location[LOCATION_LEN];
  char     message[MESSAGE_LEN];
} Packet;

// ESP-NOW v2 allows 1470 bytes per frame (v1 only 250).
static_assert(sizeof(Packet) <= 1470, "Packet too big for ESP-NOW v2");
