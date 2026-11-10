// On-device signal library (NVS). The mobile app is the primary store for
// remote profiles; this store keeps a backup of individual signals on the
// ESP32 so they survive a phone change and can be listed/transmitted by slot.
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "config.h"
#include "error_info.h"
#include "signal_model.h"

struct StoredSignal {
  bool used = false;
  char name[UR_STORE_NAME_LEN + 1] = {0};
  RfSignal signal;
};

class SignalStore {
 public:
  void begin();
  int capacity() const { return UR_STORE_CAPACITY; }
  int count() const;
  const StoredSignal* get(int slot) const;

  // slot = -1 picks the first free slot. Returns the slot used, or -1.
  int save(int slot, const char* name, const RfSignal& s, ErrorInfo& e);
  bool remove(int slot);
  void clear();
  void toJson(JsonArray out) const;

 private:
  bool writeSlot(int slot);
  StoredSignal slots_[UR_STORE_CAPACITY];
};

extern SignalStore store;
