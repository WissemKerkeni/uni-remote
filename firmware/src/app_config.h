// Runtime configuration (GPIO mapping, RF tuning), persisted in NVS.
// Pin changes are validated against a per-chip allow-list and take effect
// after a reboot.
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "error_info.h"

struct RuntimeConfig {
  int8_t rxPin;
  int8_t txPin;
  int8_t ledPin;          // -1 = no status LED
  uint8_t rxTolerance;    // rc-switch receive tolerance, percent
  uint8_t defaultRepeat;  // used when a transmit request has no `repeat`
};

class ConfigStore {
 public:
  void begin();
  const RuntimeConfig& active() const { return active_; }  // what is running now
  const RuntimeConfig& saved() const { return saved_; }    // what applies after reboot
  bool rebootRequired() const;

  // Applies a partial update {rxPin?, txPin?, ledPin?, rxTolerance?, defaultRepeat?}.
  bool update(JsonObjectConst patch, ErrorInfo& e);
  void resetToDefaults();
  void toJson(JsonObject o) const;

  static bool isValidRxPin(int pin);
  static bool isValidTxPin(int pin);

 private:
  void persist();
  RuntimeConfig active_{};
  RuntimeConfig saved_{};
};

extern ConfigStore config;
