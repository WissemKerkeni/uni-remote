// Diagnostics: ring-buffer log, counters and system information.
// Log lines are mirrored to Serial prefixed with "# " so that tools reading
// JSON lines from the serial port can ignore them.
#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>

#include "config.h"

enum class LogLevel : uint8_t { Debug = 0, Info, Warn, Error };

struct Counters {
  uint32_t rxFrames = 0;       // frames decoded by rc-switch (incl. repeats)
  uint32_t rxSignals = 0;      // button presses reported to the app
  uint32_t rxNoise = 0;        // decodes rejected as noise
  uint32_t txOk = 0;
  uint32_t txRejected = 0;
  uint32_t bleConnects = 0;
  uint32_t msgIn = 0;
  uint32_t msgOut = 0;
  uint32_t parseErrors = 0;
  uint32_t rxOverflow = 0;     // bytes dropped between BLE task and loop()
  uint32_t notifyRetries = 0;
  uint32_t notifyFailures = 0;
  uint32_t duplicateRequests = 0;
};

class Diagnostics {
 public:
  void begin();
  void log(LogLevel level, const char* tag, const char* fmt, ...) __attribute__((format(printf, 4, 5)));

  Counters c;

  uint32_t bootCount() const { return bootCount_; }
  const char* resetReason() const;
  const char* lastError() const { return lastError_; }

  // Fills `obj` with counters, memory and system info; `maxLogLines` most
  // recent log lines are appended as an array (0 = none).
  void toJson(JsonObject obj, size_t maxLogLines);

 private:
  struct Line {
    uint32_t ms;
    LogLevel level;
    char text[UR_LOG_LINE_LEN];
  };
  Line lines_[UR_LOG_LINES];
  size_t head_ = 0;   // next write position
  size_t count_ = 0;
  uint32_t bootCount_ = 0;
  char lastError_[UR_LOG_LINE_LEN] = {0};
  portMUX_TYPE mux_ = portMUX_INITIALIZER_UNLOCKED;
};

extern Diagnostics diag;

#define LOGD(tag, ...) diag.log(LogLevel::Debug, tag, __VA_ARGS__)
#define LOGI(tag, ...) diag.log(LogLevel::Info, tag, __VA_ARGS__)
#define LOGW(tag, ...) diag.log(LogLevel::Warn, tag, __VA_ARGS__)
#define LOGE(tag, ...) diag.log(LogLevel::Error, tag, __VA_ARGS__)
