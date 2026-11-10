// Signal model: the only kind of signal UniRemote V1 handles is a FIXED-CODE
// OOK frame decodable by rc-switch (PT2262 / EV1527 / HT12E style encoders).
//
// Raw waveform capture-and-replay is intentionally NOT implemented: it is the
// mechanism used to replay rolling-code / access-control remotes, and it is
// also unreliable with super-regenerative receivers.
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "config.h"
#include "error_info.h"

struct RfSignal {
  uint8_t protocol = 1;      // rc-switch protocol number (1..kProtocolCount)
  uint8_t bitLength = 0;     // 1..32
  uint32_t value = 0;        // code, LSB = last transmitted bit
  uint16_t pulseLength = 0;  // microseconds; 0 = protocol default
  uint8_t repeat = UR_TX_DEFAULT_REPEAT;
};

// Timing description mirrored from rc-switch 2.6.4 (pulse multiples).
struct ProtocolTiming {
  uint16_t defaultPulseUs;
  uint8_t syncHigh, syncLow;
  uint8_t zeroHigh, zeroLow;
  uint8_t oneHigh, oneLow;
  bool inverted;
  const char* name;
};

namespace signal_model {

constexpr uint8_t kProtocolCount = 12;  // protocols compiled into rc-switch 2.6.4

const ProtocolTiming* timing(uint8_t protocol);  // nullptr if unsupported
const char* protocolName(uint8_t protocol);

// Validates a signal for transmission. Returns false and fills `e` on error.
bool validate(const RfSignal& s, ErrorInfo& e);

// Conservative on-air time estimate in ms (used by the duty-cycle limiter).
uint32_t estimateAirtimeMs(const RfSignal& s);

// Parses {protocol, bitLength, value, pulseLength?, repeat?} and validates it.
// `value` must be a decimal string (preferred) or a non-negative integer.
bool fromJson(JsonObjectConst o, RfSignal& out, ErrorInfo& e);

// Writes the canonical JSON representation used in all messages.
void toJson(const RfSignal& s, JsonObject o);

// Extra human-readable fields: hex, binary, tri-state (PT2262) when applicable.
void addDecodedViews(const RfSignal& s, JsonObject o);

}  // namespace signal_model
