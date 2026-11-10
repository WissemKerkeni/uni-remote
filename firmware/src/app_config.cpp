#include "app_config.h"

#include <Preferences.h>

#include "config.h"
#include "diagnostics.h"

ConfigStore config;

namespace {

// Pins that are safe for a 433 MHz module DATA line on each chip.
// Excluded: flash/PSRAM pins, USB pins, UART0 console pins and strapping pins
// whose level at boot changes the boot mode / flash voltage.
#if CONFIG_IDF_TARGET_ESP32
// 34..39 are input-only (fine for the receiver, not for the transmitter).
// 16/17 are used by PSRAM on WROVER modules - avoid them there.
const int8_t kRxPins[] = {4, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39};
const int8_t kTxPins[] = {4, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33};
#elif CONFIG_IDF_TARGET_ESP32S3
const int8_t kRxPins[] = {1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 38, 39, 40, 41, 42, 47, 48};
const int8_t kTxPins[] = {1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 38, 39, 40, 41, 42, 47, 48};
#elif CONFIG_IDF_TARGET_ESP32C3
const int8_t kRxPins[] = {0, 1, 3, 4, 5, 6, 7, 10};
const int8_t kTxPins[] = {0, 1, 3, 4, 5, 6, 7, 10};
#endif

template <size_t N>
bool contains(const int8_t (&arr)[N], int v) {
  for (size_t i = 0; i < N; i++)
    if (arr[i] == v) return true;
  return false;
}

template <size_t N>
void listToJson(const int8_t (&arr)[N], JsonArray out) {
  for (size_t i = 0; i < N; i++) out.add(arr[i]);
}

RuntimeConfig defaults() {
  RuntimeConfig c;
  c.rxPin = UR_DEFAULT_RX_PIN;
  c.txPin = UR_DEFAULT_TX_PIN;
  c.ledPin = UR_DEFAULT_LED_PIN;
  c.rxTolerance = UR_DEFAULT_RX_TOLERANCE;
  c.defaultRepeat = UR_TX_DEFAULT_REPEAT;
  return c;
}

bool readInt(JsonObjectConst o, const char* key, int lo, int hi, int& out, bool& present, ErrorInfo& e) {
  JsonVariantConst v = o[key];
  present = !v.isNull();
  if (!present) return true;
  if (!v.is<int>()) {
    e.set(err::kInvalidConfig, "%s must be an integer", key);
    return false;
  }
  int x = v.as<int>();
  if (x < lo || x > hi) {
    e.set(err::kInvalidConfig, "%s must be %d..%d", key, lo, hi);
    return false;
  }
  out = x;
  return true;
}

}  // namespace

bool ConfigStore::isValidRxPin(int pin) { return contains(kRxPins, pin); }
bool ConfigStore::isValidTxPin(int pin) { return contains(kTxPins, pin); }

void ConfigStore::begin() {
  RuntimeConfig d = defaults();
  Preferences p;
  if (p.begin("ur_cfg", false)) {  // read-write: creates the namespace on first boot (no NOT_FOUND log)
    d.rxPin = p.getChar("rx", d.rxPin);
    d.txPin = p.getChar("tx", d.txPin);
    d.ledPin = p.getChar("led", d.ledPin);
    d.rxTolerance = p.getUChar("tol", d.rxTolerance);
    d.defaultRepeat = p.getUChar("rep", d.defaultRepeat);
    p.end();
  }
  // Defensive: never boot with an invalid mapping coming from NVS.
  RuntimeConfig def = defaults();
  if (!isValidRxPin(d.rxPin)) d.rxPin = def.rxPin;
  if (!isValidTxPin(d.txPin) || d.txPin == d.rxPin) d.txPin = def.txPin;
  if (d.ledPin != -1 && (!isValidTxPin(d.ledPin) || d.ledPin == d.rxPin || d.ledPin == d.txPin))
    d.ledPin = def.ledPin;
  if (d.rxTolerance < 10 || d.rxTolerance > 90) d.rxTolerance = def.rxTolerance;
  if (d.defaultRepeat < 1 || d.defaultRepeat > UR_TX_MAX_REPEAT) d.defaultRepeat = def.defaultRepeat;

  active_ = d;
  saved_ = d;
  LOGI("cfg", "rx=%d tx=%d led=%d tol=%u rep=%u", d.rxPin, d.txPin, d.ledPin, d.rxTolerance, d.defaultRepeat);
}

bool ConfigStore::rebootRequired() const {
  return saved_.rxPin != active_.rxPin || saved_.txPin != active_.txPin || saved_.ledPin != active_.ledPin ||
         saved_.rxTolerance != active_.rxTolerance;
}

bool ConfigStore::update(JsonObjectConst patch, ErrorInfo& e) {
  RuntimeConfig next = saved_;
  int v;
  bool present;

  if (!readInt(patch, "rxPin", 0, 48, v, present, e)) return false;
  if (present) next.rxPin = v;
  if (!readInt(patch, "txPin", 0, 48, v, present, e)) return false;
  if (present) next.txPin = v;
  if (!readInt(patch, "ledPin", -1, 48, v, present, e)) return false;
  if (present) next.ledPin = v;
  if (!readInt(patch, "rxTolerance", 10, 90, v, present, e)) return false;
  if (present) next.rxTolerance = v;
  if (!readInt(patch, "defaultRepeat", 1, UR_TX_MAX_REPEAT, v, present, e)) return false;
  if (present) next.defaultRepeat = v;

  if (!isValidRxPin(next.rxPin)) {
    e.set(err::kInvalidConfig, "GPIO%d is not allowed for the receiver", next.rxPin);
    return false;
  }
  if (!isValidTxPin(next.txPin)) {
    e.set(err::kInvalidConfig, "GPIO%d is not allowed for the transmitter", next.txPin);
    return false;
  }
  if (next.rxPin == next.txPin) {
    e.set(err::kInvalidConfig, "rxPin and txPin must differ");
    return false;
  }
  if (next.ledPin != -1 && (!isValidTxPin(next.ledPin) || next.ledPin == next.rxPin || next.ledPin == next.txPin)) {
    e.set(err::kInvalidConfig, "ledPin must be -1 or a free output GPIO");
    return false;
  }

  saved_ = next;
  // defaultRepeat does not touch hardware: apply immediately.
  active_.defaultRepeat = next.defaultRepeat;
  persist();
  LOGI("cfg", "saved rx=%d tx=%d led=%d tol=%u rep=%u", next.rxPin, next.txPin, next.ledPin, next.rxTolerance,
       next.defaultRepeat);
  return true;
}

void ConfigStore::resetToDefaults() {
  saved_ = defaults();
  active_.defaultRepeat = saved_.defaultRepeat;
  persist();
}

void ConfigStore::persist() {
  Preferences p;
  if (!p.begin("ur_cfg", false)) {
    LOGE("cfg", "NVS open failed");
    return;
  }
  p.putChar("rx", saved_.rxPin);
  p.putChar("tx", saved_.txPin);
  p.putChar("led", saved_.ledPin);
  p.putUChar("tol", saved_.rxTolerance);
  p.putUChar("rep", saved_.defaultRepeat);
  p.end();
}

void ConfigStore::toJson(JsonObject o) const {
  o["rxPin"] = active_.rxPin;
  o["txPin"] = active_.txPin;
  o["ledPin"] = active_.ledPin;
  o["rxTolerance"] = active_.rxTolerance;
  o["defaultRepeat"] = active_.defaultRepeat;
  o["rebootRequired"] = rebootRequired();
  if (rebootRequired()) {
    JsonObject p = o["pending"].to<JsonObject>();
    p["rxPin"] = saved_.rxPin;
    p["txPin"] = saved_.txPin;
    p["ledPin"] = saved_.ledPin;
    p["rxTolerance"] = saved_.rxTolerance;
  }
  listToJson(kRxPins, o["allowedRxPins"].to<JsonArray>());
  listToJson(kTxPins, o["allowedTxPins"].to<JsonArray>());
}
