#include "diagnostics.h"

#include <Preferences.h>
#include <esp_system.h>

Diagnostics diag;

namespace {
const char* levelName(LogLevel l) {
  switch (l) {
    case LogLevel::Debug: return "D";
    case LogLevel::Info: return "I";
    case LogLevel::Warn: return "W";
    default: return "E";
  }
}
}  // namespace

void Diagnostics::begin() {
  Preferences prefs;
  if (prefs.begin("ur_diag", false)) {
    bootCount_ = prefs.getUInt("boots", 0) + 1;
    prefs.putUInt("boots", bootCount_);
    prefs.end();
  }
}

void Diagnostics::log(LogLevel level, const char* tag, const char* fmt, ...) {
  char text[UR_LOG_LINE_LEN];
  int n = snprintf(text, sizeof(text), "%s/%s: ", levelName(level), tag);
  if (n < 0) n = 0;
  if (n < (int)sizeof(text)) {
    va_list args;
    va_start(args, fmt);
    vsnprintf(text + n, sizeof(text) - n, fmt, args);
    va_end(args);
  }
  const uint32_t now = millis();

  portENTER_CRITICAL(&mux_);
  Line& line = lines_[head_];
  line.ms = now;
  line.level = level;
  memcpy(line.text, text, sizeof(text));
  head_ = (head_ + 1) % UR_LOG_LINES;
  if (count_ < UR_LOG_LINES) count_++;
  if (level == LogLevel::Error) memcpy(lastError_, text, sizeof(text));
  portEXIT_CRITICAL(&mux_);

  Serial.printf("# %lu %s\n", (unsigned long)now, text);
}

const char* Diagnostics::resetReason() const {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "power_on";
    case ESP_RST_EXT: return "external";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "interrupt_watchdog";
    case ESP_RST_TASK_WDT: return "task_watchdog";
    case ESP_RST_WDT: return "watchdog";
    case ESP_RST_DEEPSLEEP: return "deep_sleep";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_SDIO: return "sdio";
    default: return "unknown";
  }
}

void Diagnostics::toJson(JsonObject obj, size_t maxLogLines) {
  obj["uptimeMs"] = millis();
  obj["bootCount"] = bootCount_;
  obj["resetReason"] = resetReason();
  obj["freeHeap"] = ESP.getFreeHeap();
  obj["minFreeHeap"] = ESP.getMinFreeHeap();
  obj["cpuMhz"] = getCpuFrequencyMhz();

  JsonObject k = obj["counters"].to<JsonObject>();
  k["rxFrames"] = c.rxFrames;
  k["rxSignals"] = c.rxSignals;
  k["rxNoise"] = c.rxNoise;
  k["txOk"] = c.txOk;
  k["txRejected"] = c.txRejected;
  k["bleConnects"] = c.bleConnects;
  k["msgIn"] = c.msgIn;
  k["msgOut"] = c.msgOut;
  k["parseErrors"] = c.parseErrors;
  k["rxOverflow"] = c.rxOverflow;
  k["notifyRetries"] = c.notifyRetries;
  k["notifyFailures"] = c.notifyFailures;
  k["duplicateRequests"] = c.duplicateRequests;

  if (lastError_[0]) obj["lastError"] = lastError_;

  if (maxLogLines == 0) return;
  JsonArray arr = obj["log"].to<JsonArray>();
  // Copy under lock, serialize outside.
  Line copy[UR_LOG_LINES];
  size_t n;
  portENTER_CRITICAL(&mux_);
  n = count_ < maxLogLines ? count_ : maxLogLines;
  for (size_t i = 0; i < n; i++) {
    size_t idx = (head_ + UR_LOG_LINES - n + i) % UR_LOG_LINES;
    copy[i] = lines_[idx];
  }
  portEXIT_CRITICAL(&mux_);
  for (size_t i = 0; i < n; i++) {
    JsonObject l = arr.add<JsonObject>();
    l["ms"] = copy[i].ms;
    l["msg"] = copy[i].text;
  }
}
