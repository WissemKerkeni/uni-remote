#include "signal_store.h"

#include <Preferences.h>

#include "diagnostics.h"

SignalStore store;

namespace {

constexpr uint8_t kBlobVersion = 1;
constexpr const char* kNamespace = "ur_sig";

struct __attribute__((packed)) Blob {
  uint8_t version;
  uint8_t protocol;
  uint8_t bitLength;
  uint8_t repeat;
  uint16_t pulseLength;
  uint32_t value;
  char name[UR_STORE_NAME_LEN + 1];
};

void keyFor(int slot, char* key) { snprintf(key, 6, "s%02d", slot); }

}  // namespace

void SignalStore::begin() {
  Preferences p;
  if (!p.begin(kNamespace, false)) {
    LOGE("store", "NVS open failed");
    return;
  }
  int loaded = 0;
  for (int i = 0; i < UR_STORE_CAPACITY; i++) {
    char key[6];
    keyFor(i, key);
    Blob b;
    if (!p.isKey(key)) {  // avoid core error logs for empty slots
      slots_[i].used = false;
      continue;
    }
    if (p.getBytesLength(key) != sizeof(Blob) || p.getBytes(key, &b, sizeof(b)) != sizeof(b) ||
        b.version != kBlobVersion) {
      slots_[i].used = false;
      continue;
    }
    StoredSignal& s = slots_[i];
    s.signal.protocol = b.protocol;
    s.signal.bitLength = b.bitLength;
    s.signal.repeat = b.repeat;
    s.signal.pulseLength = b.pulseLength;
    s.signal.value = b.value;
    memcpy(s.name, b.name, sizeof(s.name));
    s.name[UR_STORE_NAME_LEN] = '\0';
    ErrorInfo e;
    s.used = signal_model::validate(s.signal, e);
    if (s.used) loaded++;
  }
  p.end();
  LOGI("store", "%d/%d signals loaded", loaded, UR_STORE_CAPACITY);
}

int SignalStore::count() const {
  int n = 0;
  for (const auto& s : slots_)
    if (s.used) n++;
  return n;
}

const StoredSignal* SignalStore::get(int slot) const {
  if (slot < 0 || slot >= UR_STORE_CAPACITY || !slots_[slot].used) return nullptr;
  return &slots_[slot];
}

int SignalStore::save(int slot, const char* name, const RfSignal& sig, ErrorInfo& e) {
  if (!signal_model::validate(sig, e)) return -1;
  if (slot == -1) {
    for (int i = 0; i < UR_STORE_CAPACITY; i++) {
      if (!slots_[i].used) {
        slot = i;
        break;
      }
    }
    if (slot == -1) {
      e.set(err::kStorageFull, "all %d slots are used", UR_STORE_CAPACITY);
      return -1;
    }
  }
  if (slot < 0 || slot >= UR_STORE_CAPACITY) {
    e.set(err::kBadRequest, "slot must be 0..%d", UR_STORE_CAPACITY - 1);
    return -1;
  }
  StoredSignal& s = slots_[slot];
  s.used = true;
  s.signal = sig;
  strlcpy(s.name, name ? name : "", sizeof(s.name));
  if (!writeSlot(slot)) {
    s.used = false;
    e.set(err::kInternal, "NVS write failed");
    return -1;
  }
  return slot;
}

bool SignalStore::remove(int slot) {
  if (!get(slot)) return false;
  slots_[slot].used = false;
  Preferences p;
  if (p.begin(kNamespace, false)) {
    char key[6];
    keyFor(slot, key);
    p.remove(key);
    p.end();
  }
  return true;
}

void SignalStore::clear() {
  for (auto& s : slots_) s.used = false;
  Preferences p;
  if (p.begin(kNamespace, false)) {
    p.clear();
    p.end();
  }
  LOGI("store", "cleared");
}

bool SignalStore::writeSlot(int slot) {
  const StoredSignal& s = slots_[slot];
  Blob b{};
  b.version = kBlobVersion;
  b.protocol = s.signal.protocol;
  b.bitLength = s.signal.bitLength;
  b.repeat = s.signal.repeat;
  b.pulseLength = s.signal.pulseLength;
  b.value = s.signal.value;
  memcpy(b.name, s.name, sizeof(b.name));

  Preferences p;
  if (!p.begin(kNamespace, false)) return false;
  char key[6];
  keyFor(slot, key);
  size_t written = p.putBytes(key, &b, sizeof(b));
  p.end();
  return written == sizeof(b);
}

void SignalStore::toJson(JsonArray out) const {
  for (int i = 0; i < UR_STORE_CAPACITY; i++) {
    if (!slots_[i].used) continue;
    JsonObject o = out.add<JsonObject>();
    o["slot"] = i;
    o["name"] = slots_[i].name;
    signal_model::toJson(slots_[i].signal, o["signal"].to<JsonObject>());
  }
}
