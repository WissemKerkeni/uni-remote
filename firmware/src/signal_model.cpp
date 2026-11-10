#include "signal_model.h"

#include <errno.h>
#include <stdlib.h>

namespace signal_model {
namespace {

// Keep in sync with the `proto[]` table in rc-switch 2.6.4 (RCSwitch.cpp).
const ProtocolTiming kTimings[kProtocolCount] = {
    {350, 1, 31, 1, 3, 3, 1, false, "PT2262/EV1527"},     // 1
    {650, 1, 10, 1, 2, 2, 1, false, "rc-switch #2"},      // 2
    {100, 30, 71, 4, 11, 9, 6, false, "rc-switch #3"},    // 3
    {380, 1, 6, 1, 3, 3, 1, false, "rc-switch #4"},       // 4
    {500, 6, 14, 1, 2, 2, 1, false, "rc-switch #5"},      // 5
    {450, 23, 1, 1, 2, 2, 1, true, "HT6P20B"},            // 6
    {150, 2, 62, 1, 6, 6, 1, false, "HS2303-PT"},         // 7
    {200, 3, 130, 7, 16, 3, 16, false, "Conrad RS-200 RX"},  // 8
    {200, 130, 7, 16, 7, 16, 3, true, "Conrad RS-200 TX"},   // 9
    {365, 18, 1, 3, 1, 1, 3, true, "1ByOne doorbell"},    // 10
    {270, 36, 1, 1, 2, 2, 1, true, "HT12E"},              // 11
    {320, 36, 1, 1, 2, 2, 1, true, "SM5212"},             // 12
};

}  // namespace

const ProtocolTiming* timing(uint8_t protocol) {
  if (protocol < 1 || protocol > kProtocolCount) return nullptr;
  return &kTimings[protocol - 1];
}

const char* protocolName(uint8_t protocol) {
  const ProtocolTiming* t = timing(protocol);
  return t ? t->name : "unknown";
}

bool validate(const RfSignal& s, ErrorInfo& e) {
  if (!timing(s.protocol)) {
    e.set(err::kUnsupportedProtocol, "protocol %u not supported (1..%u)", s.protocol, kProtocolCount);
    return false;
  }
  if (s.bitLength < 1 || s.bitLength > 32) {
    e.set(err::kInvalidSignal, "bitLength must be 1..32");
    return false;
  }
  if (s.bitLength < 32 && (s.value >> s.bitLength) != 0) {
    e.set(err::kInvalidSignal, "value does not fit in %u bits", s.bitLength);
    return false;
  }
  if (s.pulseLength != 0 && (s.pulseLength < UR_TX_MIN_PULSE_US || s.pulseLength > UR_TX_MAX_PULSE_US)) {
    e.set(err::kInvalidSignal, "pulseLength must be %d..%d us", UR_TX_MIN_PULSE_US, UR_TX_MAX_PULSE_US);
    return false;
  }
  if (s.repeat < 1 || s.repeat > UR_TX_MAX_REPEAT) {
    e.set(err::kInvalidSignal, "repeat must be 1..%d", UR_TX_MAX_REPEAT);
    return false;
  }
  return true;
}

uint32_t estimateAirtimeMs(const RfSignal& s) {
  const ProtocolTiming* t = timing(s.protocol);
  if (!t) return 0;
  const uint32_t pulse = s.pulseLength ? s.pulseLength : t->defaultPulseUs;
  const uint32_t zero = t->zeroHigh + t->zeroLow;
  const uint32_t one = t->oneHigh + t->oneLow;
  const uint32_t perBit = zero > one ? zero : one;
  const uint32_t perFrame = (perBit * s.bitLength + t->syncHigh + t->syncLow) * pulse;  // us
  return (perFrame * s.repeat + 999) / 1000;
}

bool fromJson(JsonObjectConst o, RfSignal& out, ErrorInfo& e) {
  if (o.isNull()) {
    e.set(err::kBadRequest, "missing signal object");
    return false;
  }
  RfSignal s;
  if (!o["protocol"].is<unsigned int>() || !o["bitLength"].is<unsigned int>()) {
    e.set(err::kBadRequest, "signal.protocol and signal.bitLength must be integers");
    return false;
  }
  unsigned int protocol = o["protocol"].as<unsigned int>();
  unsigned int bits = o["bitLength"].as<unsigned int>();
  if (protocol > 255 || bits > 255) {
    e.set(err::kInvalidSignal, "protocol/bitLength out of range");
    return false;
  }
  s.protocol = (uint8_t)protocol;
  s.bitLength = (uint8_t)bits;

  JsonVariantConst v = o["value"];
  if (v.is<const char*>()) {
    const char* str = v.as<const char*>();
    if (!str || !*str) {
      e.set(err::kBadRequest, "signal.value is empty");
      return false;
    }
    for (const char* p = str; *p; p++) {
      if (*p < '0' || *p > '9') {
        e.set(err::kBadRequest, "signal.value must be a decimal string");
        return false;
      }
    }
    errno = 0;
    unsigned long long parsed = strtoull(str, nullptr, 10);
    if (errno == ERANGE || parsed > 0xFFFFFFFFULL) {
      e.set(err::kInvalidSignal, "signal.value exceeds 32 bits");
      return false;
    }
    s.value = (uint32_t)parsed;
  } else if (v.is<uint32_t>()) {
    s.value = v.as<uint32_t>();
  } else {
    e.set(err::kBadRequest, "signal.value must be a decimal string");
    return false;
  }

  if (!o["pulseLength"].isNull()) {
    if (!o["pulseLength"].is<unsigned int>() || o["pulseLength"].as<unsigned int>() > 65535) {
      e.set(err::kBadRequest, "signal.pulseLength must be an integer");
      return false;
    }
    s.pulseLength = (uint16_t)o["pulseLength"].as<unsigned int>();
  }
  if (!o["repeat"].isNull()) {
    if (!o["repeat"].is<unsigned int>() || o["repeat"].as<unsigned int>() > 255) {
      e.set(err::kBadRequest, "signal.repeat must be an integer");
      return false;
    }
    s.repeat = (uint8_t)o["repeat"].as<unsigned int>();
  }
  if (!validate(s, e)) return false;
  out = s;
  return true;
}

void toJson(const RfSignal& s, JsonObject o) {
  char buf[12];
  snprintf(buf, sizeof(buf), "%lu", (unsigned long)s.value);
  o["protocol"] = s.protocol;
  o["protocolName"] = protocolName(s.protocol);
  o["bitLength"] = s.bitLength;
  o["value"] = buf;  // copied by ArduinoJson
  o["pulseLength"] = s.pulseLength;
  o["repeat"] = s.repeat;
}

void addDecodedViews(const RfSignal& s, JsonObject o) {
  char hex[11];
  snprintf(hex, sizeof(hex), "0x%0*lX", (s.bitLength + 3) / 4, (unsigned long)s.value);
  o["hex"] = hex;

  char bin[33];
  for (uint8_t i = 0; i < s.bitLength && i < 32; i++) {
    bin[i] = (s.value >> (s.bitLength - 1 - i)) & 1 ? '1' : '0';
  }
  bin[s.bitLength < 32 ? s.bitLength : 32] = '\0';
  o["binary"] = bin;

  // PT2262-style tri-state view: each tri-state symbol is 2 bits
  // (00 = '0', 11 = '1', 01 = 'F'; 10 is invalid -> no tri-state view).
  if (s.protocol == 1 && s.bitLength % 2 == 0 && s.bitLength <= 32) {
    char tri[17];
    bool valid = true;
    uint8_t n = 0;
    for (uint8_t i = 0; i < s.bitLength; i += 2) {
      uint8_t pair = (s.value >> (s.bitLength - 2 - i)) & 0x3;
      if (pair == 0) tri[n++] = '0';
      else if (pair == 3) tri[n++] = '1';
      else if (pair == 1) tri[n++] = 'F';
      else { valid = false; break; }
    }
    if (valid) {
      tri[n] = '\0';
      o["triState"] = tri;
    }
  }
}

}  // namespace signal_model
