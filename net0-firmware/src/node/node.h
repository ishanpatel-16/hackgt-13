// Interface between the mesh side (main.cpp) and the web side (web.cpp).
// The web servers run on their own FreeRTOS tasks, so these functions lock
// the shared state (pending reports, dedup buffer) before touching it.
#pragma once
#include <stdint.h>

struct GpsFix {
  bool valid;
  float lat;
  float lon;
  uint16_t accuracy_m;
};

struct ReportInfo {
  uint16_t userId;
  uint8_t category;  // backend Category number, 0 = unknown
  uint8_t people;    // 0 = unknown
  const char *location;
  const char *message;
  GpsFix gps;
};

// Floods a new report and keeps retrying it until ACKed. Returns its msg_id.
uint32_t nodeSendReport(const ReportInfo &r);

// False if the msg_id is unknown (never sent here, or pushed out of the list).
bool nodeReportStatus(uint32_t msgId, bool &delivered, uint8_t &attempts);

// Starts the HTTP (port 80) and, if a certificate is uploaded, HTTPS (443) servers.
void webBegin();
