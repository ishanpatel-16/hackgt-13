// BLE link from the gateway to the laptop backend (portal-end/backend/esp_manager.py).
#pragma once
#include <stddef.h>
#include <stdint.h>

void setupBluetooth();
bool bluetoothConnected();

// Frames the payload as [uint16 length][payload] and sends it as BLE
// notifications, split into MTU-sized chunks. Dropped if no laptop is connected.
void sendToBackend(const uint8_t *payload, size_t len);
