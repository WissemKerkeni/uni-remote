// JSON message dispatcher shared by the BLE and USB-serial transports.
// Message catalogue: docs/BLE_PROTOCOL.md.
#pragma once

#include <ArduinoJson.h>

#include <string>

#include "config.h"
#include "error_info.h"
#include "rf_service.h"

enum class Channel : uint8_t { Ble = 1, Serial = 2 };

class ProtocolHandler {
 public:
  void handleLine(Channel src, const std::string& line);
  void sendError(Channel ch, const char* id, const ErrorInfo& e);

  // RF callbacks
  void onSignal(const CapturedSignal& c);
  void onLearnEnd(const char* reason);

  void loop();  // deferred actions (reboot)
  // Forget cached responses of a channel (new BLE connection = new client).
  void resetSession(Channel ch);

 private:
  JsonDocument message(const char* type, const char* id);
  void send(Channel ch, JsonDocument& doc, const char* cacheId = nullptr);
  void broadcast(JsonDocument& doc);
  void deliver(uint8_t channels, const std::string& line);

  void handleGetInfo(Channel ch, const char* id);
  void handleDiagnostics(Channel ch, const char* id, JsonObjectConst req);
  void handleLearnStart(Channel ch, const char* id, JsonObjectConst req);
  void handleLearnStop(Channel ch, const char* id);
  void handleTransmit(Channel ch, const char* id, const RfSignal& s);
  void handleStore(Channel ch, const char* id, JsonObjectConst req);

  struct CacheEntry {
    char id[UR_MAX_ID_LEN + 1];
    char type[24];  // request type: an id is only a duplicate if the type matches too
    uint8_t channel;
    std::string response;
  };
  CacheEntry cache_[UR_REQUEST_CACHE];
  size_t cacheNext_ = 0;

  char learnRequestId_[UR_MAX_ID_LEN + 1] = {0};
  char currentType_[24] = {0};  // type of the request being handled
  uint32_t rebootAtMs_ = 0;
};

extern ProtocolHandler protocol;
