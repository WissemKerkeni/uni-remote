// UniRemote firmware entry point.
//
//   USB serial (115200) and BLE both accept the same newline-delimited JSON
//   messages (docs/BLE_PROTOCOL.md). Lines starting with "# " on the serial
//   output are human-readable logs.
#include <Arduino.h>

#include "app_config.h"
#include "ble_service.h"
#include "config.h"
#include "diagnostics.h"
#include "line_assembler.h"
#include "protocol_handler.h"
#include "rf_service.h"
#include "signal_store.h"
#include "status_led.h"

StatusLed statusLed;

namespace {

LineAssembler bleAssembler(UR_MAX_MESSAGE_BYTES);
LineAssembler serialAssembler(UR_MAX_MESSAGE_BYTES);

void onSignal(const CapturedSignal& c) { protocol.onSignal(c); }
void onLearnEnd(const char* reason) { protocol.onLearnEnd(reason); }

void feed(Channel ch, LineAssembler& asmb, const uint8_t* data, size_t len) {
  std::string line;
  for (size_t i = 0; i < len; i++) {
    switch (asmb.push((char)data[i], line)) {
      case LineAssembler::Result::Line:
        protocol.handleLine(ch, line);
        line.clear();
        break;
      case LineAssembler::Result::Overflow: {
        ErrorInfo e;
        e.set(err::kTooLarge, "message exceeds %d bytes", UR_MAX_MESSAGE_BYTES);
        protocol.sendError(ch, nullptr, e);
        break;
      }
      default:
        break;
    }
  }
}

void pollBle() {
  uint8_t buf[256];
  size_t n;
  while ((n = ble.read(buf, sizeof(buf))) > 0) feed(Channel::Ble, bleAssembler, buf, n);

  if (uint32_t dropped = ble.takeDroppedBytes()) {
    diag.c.rxOverflow += dropped;
    bleAssembler.reset();
    ErrorInfo e;
    e.set(err::kBusy, "%lu bytes dropped, resend", (unsigned long)dropped);
    protocol.sendError(Channel::Ble, nullptr, e);
  }

  // Stop a learning session if the phone went away mid-way.
  static bool wasConnected = false;
  const bool connected = ble.connected();
  if (wasConnected && !connected) {
    bleAssembler.reset();
    protocol.resetSession(Channel::Ble);
    if (rf.learning()) rf.stopLearning("disconnected");
  }
  wasConnected = connected;
}

void pollSerial() {
  uint8_t buf[128];
  int avail;
  while ((avail = Serial.available()) > 0) {
    size_t n = Serial.readBytes(buf, avail < (int)sizeof(buf) ? avail : sizeof(buf));
    feed(Channel::Serial, serialAssembler, buf, n);
  }
}

}  // namespace

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(5);
  delay(200);

  diag.begin();
  LOGI("sys", "UniRemote %s on %s rev%d, reset=%s, boot #%lu", UR_FW_VERSION, ESP.getChipModel(),
       ESP.getChipRevision(), diag.resetReason(), (unsigned long)diag.bootCount());

  config.begin();
  store.begin();

  statusLed.begin(config.active().ledPin);
  rf.setCallbacks(onSignal, onLearnEnd);
  if (!rf.begin(config.active())) LOGE("sys", "RF init incomplete, check GPIO config");

  // Unique, stable name from the factory MAC: UniRemote-XXXX
  uint64_t mac = ESP.getEfuseMac();
  char name[24];
  snprintf(name, sizeof(name), "%s-%02X%02X", UR_DEVICE_NAME_PREFIX, (uint8_t)(mac >> 32), (uint8_t)(mac >> 40));
  if (!ble.begin(name)) LOGE("sys", "BLE init failed");

  LOGI("sys", "ready, free heap %lu", (unsigned long)ESP.getFreeHeap());
}

void loop() {
  pollBle();
  pollSerial();
  rf.loop();
  ble.loop();
  protocol.loop();
  statusLed.loop();
  delay(1);  // yield; rc-switch decodes in the ISR so 1 ms latency is fine
}
