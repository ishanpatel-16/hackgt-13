# net0 — HackGT 13 (Social Good)

Off-grid emergency reporting. A phone joins a nearby ESP32's Wi-Fi, submits a distress report, and the report hops across ESP32s over ESP-NOW until it reaches a gateway plugged into a laptop. The laptop saves the report and shows it in an AI responder dashboard.

```
Phone → Node (Wi-Fi AP + web form) → other Node(s) relaying → Gateway ESP32 → Bluetooth (BLE) → FastAPI → SQLite → AI → React dashboard
```

**Core principle:** prove the delivery path first, then make the data useful, then make the dashboard impressive. Everything local must keep working when the internet / cloud AI is down.

## Team
- **Aadi:** access and relay node firmware (this repo's `src/node/`)
- **Ishan:** gateway firmware (`src/gateway/`) + backend (FastAPI, SQLite, API routes)
- Two other teammates own the React dashboard and the AI extraction

## How to work with me
- I'm a first-year CS student, so explain new concepts briefly (what it is, why we use it) before or alongside the code.
- Keep answers short. It's a 36-hour hackathon: working > perfect.
- If there's a clearly better alternative to what I asked for, say so in one or two lines, then do what I asked unless I switch.
- Don't overbuild: no general-purpose routing protocol, no LoRa, no GPS hardware, no sensors, no displays.

## Hardware
- 6 × ESP32 DevKit boards (classic ESP32 / WROOM-32 → `board = esp32dev`)
- Built-in 2.4 GHz radio only. No extra hardware.

## Firmware decisions (locked)
- **Toolchain:** PlatformIO with the **pioarduino** platform (Arduino-ESP32 core 3.x):
  `platform = https://github.com/pioarduino/platform-espressif32/releases/download/stable/platform-espressif32.zip`
  The official `platform = espressif32` ships core 2.x = ESP-NOW v1 only. **Don't use it.**
- **Transport:** ESP-NOW **v2** (payload up to 1470 bytes; v1 max is 250). Print `esp_now_get_version()` at boot and warn if < 2.
- **Routing:** **flooding** over broadcast (`FF:FF:FF:FF:FF:FF`). Every node rebroadcasts a packet it hasn't seen before, exactly once. Loop protection:
  - **Duplicate suppression:** a random 32-bit `msg_id` per message; each node keeps a ring buffer of the last 64 IDs.
  - **TTL:** decremented each hop; drop the packet when it reaches ≤ 1.
  - **Jitter:** random 10–60 ms delay before rebroadcasting to avoid collisions.
- **Separate firmware** for nodes vs. gateway, in one PlatformIO project:
  - `src/node/`: **every node is BOTH access and relay** (no role flag). Each runs a Wi-Fi AP `NET0-<id>`, a captive-portal DNS, a web form at 192.168.4.1, and floods/relays packets.
  - `src/gateway/`: receive-only. Never rebroadcasts. Dedups, then sends each packet to the backend over **BLE** (`bluetooth.cpp`, encoded by `backend_codec.h`) and also prints a JSON debug line over USB serial. Uses `huge_app.csv` partitions (Wi-Fi + BLE is too big for the default).
  - `include/packet.h`: **shared** packet struct + constants. Any packet format change happens here only.
- **Per-board config** lives in `platformio.ini` `build_flags`, one `[env:...]` per physical board. Don't hardcode per-board values in `.cpp` files.
- **Wi-Fi channel:** fixed at 6 on every board (the AP and ESP-NOW must share one channel). `WiFi.setSleep(false)` on nodes; the gateway must use `setSleep(true)` because BLE is on (ESP32 aborts otherwise).
- **ESP-NOW receive callback:** only copy the packet into a FreeRTOS queue. Process it in `loop()`. Never do slow work (Serial, delays, sends) inside the callback.
- **Callback signature (core 3.x):** `void onRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len)`. RSSI comes from `info->rx_ctrl->rssi`.

## Packet (`include/packet.h`, packed struct, ~486 bytes)
| Field | Type | Notes |
|---|---|---|
| magic | uint16 | `0x4E30`, drop anything else |
| version | uint8 | `1` |
| type | uint8 | `1` = report, `2` = heartbeat |
| msg_id | uint32 | random, never 0 |
| origin | uint8 | node that created it |
| last_hop | uint8 | node that last transmitted it |
| ttl | uint8 | default 6 |
| path_len, path[8] | uint8 | node IDs the packet passed through, in order |
| location | char[64] | user-typed text (GPS later) |
| message | char[400] | user-typed report |

Nodes send a heartbeat every 10 s (used for the node-status panel on the dashboard).

## Board map / demo topology
Every board sits on one table, so they can all hear each other directly. The `NEIGHBORS` build flag fakes a topology by accepting packets only from the listed `last_hop` IDs (`0` = accept from anyone). This forces real multi-hop delivery and makes the failover demo possible.

Current setup: 3 boards in a line, `node2 → node1 → gateway`. Every node is access + relay (phones can join any `NET0-<id>`).

| Env | NODE_ID | Role | NEIGHBORS |
|---|---|---|---|
| gateway | 0 | Gateway on laptop | 1 |
| node1 | 1 | Access + relay | 2 |
| node2 | 2 | Access + relay | 1 |
| node3 | 3 | Spare (access + relay) | 0 |
| node4 | 4 | Spare (access + relay) | 0 |
| node5 | 5 | Spare (access + relay) | 0 |

## Gateway → backend contract (BLE)
The backend (`portal-end/backend/esp_manager.py`, Ishan) scans for BLE service `7b2f3a91-8c64-4f2e-a7d1-91c8e7b5d421`, device `Gateway-Node`, and subscribes to notifications on characteristic `a12b3c45-6789-4def-8123-456789abcdef`.
- **Uplink (gateway → backend):** notifications carrying frames `[uint16 len][payload]`, split into MTU-sized chunks. Payload layouts are defined by `portal-end/backend/packet_codec.py` (report = type 1, 705 B; heartbeat = type 3, 23 B). `src/gateway/backend_codec.h` must match it.
- **Downlink (backend → gateway):** writes to the same characteristic (acks, type 4). Currently only logged; forwarding them to the phone is a stretch goal.
- Fields our mesh packet doesn't carry yet (name, phone, category, severity, people, needs, GPS, clients, uptime, tx/rx, neighbors) are sent as unknown/0. `user_id` is derived from `msg_id`. The gateway (ID 0) is **not** added to `path` because the backend only accepts node IDs 1–254.
- USB serial (115200) still prints one JSON line per packet for debugging:
```json
{"type":"report","msg_id":"A83F29C1","origin":2,"hops":2,"rssi":-48,"path":[2,1,0],"location":"Klaus, Floor 3","message":"Two people trapped, one injured"}
```
Coordinate with Ishan before changing either format.

## Commands
```bash
pio run -e node2                          # build one board
pio run -e node2 -t upload                # flash (hold BOOT if stuck at "Connecting...")
pio device monitor -b 115200              # serial monitor
pio run                                   # build every env (do this before committing)
```
When more than one board is plugged in, add `--upload-port <port>` (list ports with `pio device list`).

## Build order (36 h plan)
1. ✅ Decide transport (ESP-NOW v2 + flooding) and packet format
2. Two boards: node2 → gateway directly (`NEIGHBORS=0`). Phone submits → JSON on serial
3. Add node1 + neighbor filters → report travels 2 → 1 → 0
4. Add node3 → unplug node1 → report reroutes 2 → 3 → 0 (**failover demo**)
5. Heartbeats → node status on the dashboard
6. Stretch: end-to-end ACK (gateway floods an ACK back; access node shows "delivered" on the phone), GPS via browser geolocation (needs HTTPS), gateway posting to the API over Wi-Fi instead of serial

## Demo success = 
Phone with no internet submits report → it visibly crosses ≥1 relay → backend saves the raw report → dashboard shows it → AI structures it → a second report reroutes after a relay is unplugged → the dashboard still works with cloud AI offline.
