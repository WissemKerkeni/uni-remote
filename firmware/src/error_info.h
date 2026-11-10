// Small error carrier used across modules. `code` is a stable machine-readable
// string sent to the app (see docs/BLE_PROTOCOL.md, "Error codes").
#pragma once

#include <stdarg.h>
#include <stdio.h>

struct ErrorInfo {
  const char* code = nullptr;
  char message[96] = {0};
  unsigned long retryAfterMs = 0;

  bool ok() const { return code == nullptr; }

  void set(const char* c, const char* fmt, ...) __attribute__((format(printf, 3, 4))) {
    code = c;
    va_list args;
    va_start(args, fmt);
    vsnprintf(message, sizeof(message), fmt, args);
    va_end(args);
  }
};

namespace err {
constexpr const char* kBadJson = "bad_json";
constexpr const char* kBadRequest = "bad_request";
constexpr const char* kUnknownType = "unknown_type";
constexpr const char* kTooLarge = "too_large";
constexpr const char* kBusy = "busy";
constexpr const char* kInvalidSignal = "invalid_signal";
constexpr const char* kUnsupportedProtocol = "unsupported_protocol";
constexpr const char* kRateLimited = "rate_limited";
constexpr const char* kStorageFull = "storage_full";
constexpr const char* kNotFound = "not_found";
constexpr const char* kInvalidConfig = "invalid_config";
constexpr const char* kHardware = "hardware_error";
constexpr const char* kInternal = "internal";
}  // namespace err
