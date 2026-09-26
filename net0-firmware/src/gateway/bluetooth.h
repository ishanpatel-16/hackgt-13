// BLE link from the gateway to the laptop backend (portal-end/backend/esp_manager.py).
#pragma once
#include <stddef.h>
#include <stdint.h>

void setupBluetooth();
bool bluetoothConnected();

// Adds a packet to the outgoing queue. A background task sends queued packets
// (oldest first) whenever a laptop is connected, and only removes each one
// after it has been sent. msgId != 0 skips packets whose msg_id is already
// waiting (retries of the same report). Returns false if the queue is full.
bool queueForBackend(const uint8_t *payload, size_t len, uint32_t msgId);
unsigned backendQueueDepth();

// Pops the next report msg_id the backend has ACKed (saved). Returns false if none.
// The gateway floods these back into the mesh so the origin node stops retrying.
bool nextBackendAck(uint32_t &msgId);
