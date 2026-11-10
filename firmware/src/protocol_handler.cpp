#include "protocol_handler.h"


#include "app_config.h"
#include "ble_service.h"
#include "diagnostics.h"
#include "signal_store.h"

ProtocolHandler protocol;

namespace {

bool readBool(JsonObjectConst o, const char* key, bool def) {
  JsonVariantConst v = o[key];
  return v.is<bool>() ? v.as<bool>() : def;
}

}  // namespace

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

JsonDocument ProtocolHandler::message(const char* type, const char* id) {
  JsonDocument doc;
  doc["v"] = UR_PROTOCOL_VERSION;
  doc["type"] = type;
  if (id && *id) doc["id"] = (char*)id;  // force copy
  return doc;
}

void ProtocolHandler::deliver(uint8_t channels, const std::string& line) {
  if (channels & (uint8_t)Channel::Ble) {
    if (ble.subscribed()) ble.sendLine(line);
  }
  if (channels & (uint8_t)Channel::Serial) {
    Serial.write((const uint8_t*)line.data(), line.size());
    Serial.write('\n');
  }
  diag.c.msgOut++;
}

void ProtocolHandler::send(Channel ch, JsonDocument& doc, const char* cacheId) {
  std::string out;
  if (measureJson(doc) > UR_MAX_MESSAGE_BYTES) {
    ErrorInfo e;
    e.set(err::kTooLarge, "response exceeds %d bytes", UR_MAX_MESSAGE_BYTES);
    sendError(ch, doc["id"] | "", e);
    return;
  }
  serializeJson(doc, out);
  if (cacheId && *cacheId) {
    CacheEntry& c = cache_[cacheNext_];
    strlcpy(c.id, cacheId, sizeof(c.id));
    strlcpy(c.type, currentType_, sizeof(c.type));
    c.channel = (uint8_t)ch;
    c.response = out;
    cacheNext_ = (cacheNext_ + 1) % UR_REQUEST_CACHE;
  }
  deliver((uint8_t)ch, out);
}

void ProtocolHandler::broadcast(JsonDocument& doc) {
  std::string out;
  serializeJson(doc, out);
  deliver((uint8_t)Channel::Ble | (uint8_t)Channel::Serial, out);
}

void ProtocolHandler::sendError(Channel ch, const char* id, const ErrorInfo& e) {
  JsonDocument doc = message("error", id);
  doc["code"] = e.code ? e.code : err::kInternal;
  doc["message"] = (char*)e.message;
  if (e.retryAfterMs) doc["retryAfterMs"] = e.retryAfterMs;
  std::string out;
  serializeJson(doc, out);
  deliver((uint8_t)ch, out);
}

// ---------------------------------------------------------------------------
// Request dispatch
// ---------------------------------------------------------------------------

void ProtocolHandler::handleLine(Channel src, const std::string& line) {
  diag.c.msgIn++;
  ErrorInfo e;

  JsonDocument req;
  DeserializationError de = deserializeJson(req, line);
  if (de) {
    diag.c.parseErrors++;
    e.set(err::kBadJson, "%s", de.c_str());
    sendError(src, nullptr, e);
    return;
  }
  if (!req.is<JsonObject>()) {
    diag.c.parseErrors++;
    e.set(err::kBadRequest, "message must be a JSON object");
    sendError(src, nullptr, e);
    return;
  }
  JsonObjectConst r = req.as<JsonObjectConst>();

  // Request id: string (preferred) or integer, max UR_MAX_ID_LEN chars.
  char id[UR_MAX_ID_LEN + 1] = {0};
  JsonVariantConst vid = r["id"];
  if (vid.is<const char*>()) {
    const char* s = vid.as<const char*>();
    if (strlen(s) > UR_MAX_ID_LEN) {
      e.set(err::kBadRequest, "id longer than %d chars", UR_MAX_ID_LEN);
      sendError(src, nullptr, e);
      return;
    }
    strlcpy(id, s, sizeof(id));
  } else if (vid.is<long>()) {
    snprintf(id, sizeof(id), "%ld", vid.as<long>());
  } else if (!vid.isNull()) {
    e.set(err::kBadRequest, "id must be a string");
    sendError(src, nullptr, e);
    return;
  }

  const char* type = r["type"].is<const char*>() ? r["type"].as<const char*>() : nullptr;
  if (!type) {
    e.set(err::kBadRequest, "missing type");
    sendError(src, id, e);
    return;
  }
  if (!r["v"].isNull() && r["v"].as<int>() != UR_PROTOCOL_VERSION) {
    e.set(err::kBadRequest, "unsupported protocol version (device speaks v%d)", UR_PROTOCOL_VERSION);
    sendError(src, id, e);
    return;
  }

  strlcpy(currentType_, type, sizeof(currentType_));

  // Duplicate request (app retried because the response was lost): replay
  // the cached response, do not execute twice.
  if (id[0]) {
    for (auto& c : cache_) {
      if (c.channel == (uint8_t)src && strcmp(c.id, id) == 0 && strcmp(c.type, type) == 0 && !c.response.empty()) {
        diag.c.duplicateRequests++;
        deliver((uint8_t)src, c.response);
        return;
      }
    }
  }

  if (!strcmp(type, "get_info")) {
    handleGetInfo(src, id);
  } else if (!strcmp(type, "ping")) {
    JsonDocument d = message("pong", id);
    d["uptimeMs"] = millis();
    if (!r["echo"].isNull()) d["echo"] = r["echo"];
    send(src, d);
  } else if (!strcmp(type, "get_diagnostics")) {
    handleDiagnostics(src, id, r);
  } else if (!strcmp(type, "rx_probe")) {
    uint32_t ms = r["durationMs"].is<uint32_t>() ? r["durationMs"].as<uint32_t>() : 500;
    ProbeResult pr;
    if (!rf.probe(ms, pr, e)) {
      sendError(src, id, e);
      return;
    }
    JsonDocument d = message("rx_probe_result", id);
    d["rxPin"] = config.active().rxPin;
    d["durationMs"] = pr.durationMs;
    d["edges"] = pr.edges;
    d["edgesPerSecond"] = pr.durationMs ? pr.edges * 1000 / pr.durationMs : 0;
    d["highRatio"] = pr.highPermille / 1000.0f;
    d["verdict"] = pr.verdict;
    send(src, d);
  } else if (!strcmp(type, "loopback_test")) {
    // Fixed self-test pattern unless a signal is given: 24-bit EV1527-style.
    RfSignal s;
    s.protocol = 1;
    s.bitLength = 24;
    s.value = 0xA5C3F0 ^ (esp_random() & 0x00000F);
    s.pulseLength = 350;
    s.repeat = 8;
    if (!r["signal"].isNull() && !signal_model::fromJson(r["signal"], s, e)) {
      sendError(src, id, e);
      return;
    }
    LoopbackResult lr;
    if (!rf.loopback(s, lr, e)) {
      sendError(src, id, e);
      return;
    }
    JsonDocument d = message("loopback_result", id);
    d["match"] = lr.match;
    d["received"] = lr.received;
    d["framesDecoded"] = lr.rxFramesDecoded;
    signal_model::toJson(lr.sent, d["sent"].to<JsonObject>());
    if (lr.received) signal_model::toJson(lr.got, d["got"].to<JsonObject>());
    send(src, d);
  } else if (!strcmp(type, "learn_start")) {
    handleLearnStart(src, id, r);
  } else if (!strcmp(type, "learn_stop")) {
    handleLearnStop(src, id);
  } else if (!strcmp(type, "transmit")) {
    RfSignal s;
    if (!signal_model::fromJson(r["signal"], s, e)) {
      sendError(src, id, e);
      return;
    }
    if (r["signal"]["repeat"].isNull()) s.repeat = config.active().defaultRepeat;
    handleTransmit(src, id, s);
  } else if (!strcmp(type, "transmit_stored")) {
    const StoredSignal* st = r["slot"].is<int>() ? store.get(r["slot"].as<int>()) : nullptr;
    if (!st) {
      e.set(err::kNotFound, "no stored signal in that slot");
      sendError(src, id, e);
      return;
    }
    handleTransmit(src, id, st->signal);
  } else if (!strcmp(type, "store_signal")) {
    handleStore(src, id, r);
  } else if (!strcmp(type, "list_stored")) {
    JsonDocument d = message("stored_list", id);
    d["capacity"] = store.capacity();
    d["count"] = store.count();
    store.toJson(d["items"].to<JsonArray>());
    send(src, d);
  } else if (!strcmp(type, "delete_stored")) {
    if (!r["slot"].is<int>() || !store.remove(r["slot"].as<int>())) {
      e.set(err::kNotFound, "no stored signal in that slot");
      sendError(src, id, e);
      return;
    }
    JsonDocument d = message("ack", id);
    d["ok"] = true;
    send(src, d, id);
  } else if (!strcmp(type, "clear_stored")) {
    store.clear();
    JsonDocument d = message("ack", id);
    d["ok"] = true;
    send(src, d, id);
  } else if (!strcmp(type, "get_config")) {
    JsonDocument d = message("config", id);
    config.toJson(d["config"].to<JsonObject>());
    send(src, d);
  } else if (!strcmp(type, "set_config") || !strcmp(type, "reset_config")) {
    if (type[0] == 'r') {
      config.resetToDefaults();
    } else if (!r["config"].is<JsonObjectConst>()) {
      e.set(err::kBadRequest, "missing config object");
      sendError(src, id, e);
      return;
    } else if (!config.update(r["config"], e)) {
      sendError(src, id, e);
      return;
    }
    JsonDocument d = message("config", id);
    config.toJson(d["config"].to<JsonObject>());
    send(src, d, id);
  } else if (!strcmp(type, "reboot")) {
    JsonDocument d = message("ack", id);
    d["ok"] = true;
    send(src, d, id);
    rebootAtMs_ = millis() + 500;  // let the ack leave first
    if (!rebootAtMs_) rebootAtMs_ = 1;
  } else {
    e.set(err::kUnknownType, "unknown message type '%.40s'", type);
    sendError(src, id, e);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

void ProtocolHandler::handleGetInfo(Channel ch, const char* id) {
  JsonDocument d = message("device_info", id);
  d["name"] = (char*)ble.name();
  d["firmwareVersion"] = UR_FW_VERSION;
  d["protocolVersion"] = UR_PROTOCOL_VERSION;
  d["target"] = UR_TARGET_NAME;
  d["chipModel"] = ESP.getChipModel();
  d["chipRevision"] = ESP.getChipRevision();
  d["cpuCores"] = ESP.getChipCores();
  d["flashSize"] = ESP.getFlashChipSize();
  d["bleAddress"] = (char*)ble.address();
  d["sdk"] = ESP.getSdkVersion();
  d["uptimeMs"] = millis();

  JsonObject radio = d["radio"].to<JsonObject>();
  radio["frequencyMHz"] = UR_NOMINAL_FREQ_MHZ;
  radio["frequencySource"] = "nominal";  // OOK modules cannot measure frequency
  radio["modulation"] = "ASK/OOK";
  radio["rxReady"] = rf.rxReady();
  radio["txReady"] = rf.txReady();
  radio["rxPin"] = config.active().rxPin;
  radio["txPin"] = config.active().txPin;

  JsonObject cap = d["capabilities"].to<JsonObject>();
  cap["maxMessageBytes"] = UR_MAX_MESSAGE_BYTES;
  cap["maxRepeat"] = UR_TX_MAX_REPEAT;
  cap["maxBitLength"] = 32;
  cap["storeCapacity"] = store.capacity();
  cap["rawReplay"] = false;    // intentionally not supported
  cap["rollingCode"] = false;  // intentionally not supported
  JsonArray protos = cap["protocols"].to<JsonArray>();
  for (uint8_t p = 1; p <= signal_model::kProtocolCount; p++) {
    const ProtocolTiming* t = signal_model::timing(p);
    JsonObject o = protos.add<JsonObject>();
    o["id"] = p;
    o["name"] = t->name;
    o["pulseLength"] = t->defaultPulseUs;
  }
  send(ch, d);
}

void ProtocolHandler::handleDiagnostics(Channel ch, const char* id, JsonObjectConst req) {
  int lines = req["logLines"].is<int>() ? req["logLines"].as<int>() : 20;
  if (lines < 0) lines = 0;
  if (lines > UR_LOG_LINES) lines = UR_LOG_LINES;

  JsonDocument d = message("diagnostics", id);
  diag.toJson(d.as<JsonObject>(), (size_t)lines);
  JsonObject b = d["ble"].to<JsonObject>();
  b["connected"] = ble.connected();
  b["subscribed"] = ble.subscribed();
  b["mtu"] = ble.mtu();
  JsonObject rr = d["rf"].to<JsonObject>();
  rr["rxReady"] = rf.rxReady();
  rr["txReady"] = rf.txReady();
  rr["learning"] = rf.learning();
  rr["dutyBudgetMs"] = rf.dutyBudgetMs();
  rr["dutyBudgetMaxMs"] = UR_DUTY_BUDGET_MS;
  JsonObject st = d["store"].to<JsonObject>();
  st["count"] = store.count();
  st["capacity"] = store.capacity();
  send(ch, d);
}

void ProtocolHandler::handleLearnStart(Channel ch, const char* id, JsonObjectConst req) {
  ErrorInfo e;
  if (!rf.rxReady()) {
    e.set(err::kHardware, "receiver not configured");
    sendError(ch, id, e);
    return;
  }
  uint32_t timeout = UR_LEARN_DEFAULT_TIMEOUT_MS;
  if (!req["timeoutMs"].isNull()) {
    if (!req["timeoutMs"].is<uint32_t>()) {
      e.set(err::kBadRequest, "timeoutMs must be an integer");
      sendError(ch, id, e);
      return;
    }
    timeout = req["timeoutMs"].as<uint32_t>();
    if (timeout < 1000 || timeout > UR_LEARN_MAX_TIMEOUT_MS) {
      e.set(err::kBadRequest, "timeoutMs must be 1000..%d", UR_LEARN_MAX_TIMEOUT_MS);
      sendError(ch, id, e);
      return;
    }
  }
  const bool single = readBool(req, "single", true);
  const bool timings = readBool(req, "includeTimings", false);

  if (rf.learning()) rf.stopLearning("restarted");
  strlcpy(learnRequestId_, id ? id : "", sizeof(learnRequestId_));

  JsonDocument d = message("ack", id);
  d["ok"] = true;
  send(ch, d, id);

  rf.startLearning(timeout, single, timings);
  JsonDocument ev = message("learn_state", nullptr);
  ev["active"] = true;
  ev["requestId"] = (char*)learnRequestId_;
  ev["timeoutMs"] = timeout;
  ev["single"] = single;
  broadcast(ev);
}

void ProtocolHandler::handleLearnStop(Channel ch, const char* id) {
  const bool was = rf.learning();
  JsonDocument d = message("ack", id);
  d["ok"] = true;
  d["wasLearning"] = was;
  send(ch, d);
  if (was) rf.stopLearning("stopped");  // emits learn_state via onLearnEnd
}

void ProtocolHandler::handleTransmit(Channel ch, const char* id, const RfSignal& s) {
  ErrorInfo e;
  uint32_t airtime = 0;
  if (!rf.precheck(s, airtime, e)) {
    diag.c.txRejected++;
    sendError(ch, id, e);
    return;
  }
  JsonDocument ack = message("ack", id);
  ack["ok"] = true;
  ack["estimatedAirtimeMs"] = airtime;
  send(ch, ack, id);

  TxResult result;
  const bool ok = rf.transmit(s, result, e);
  JsonDocument done = message("tx_done", id);
  done["ok"] = ok;
  done["durationMs"] = result.durationMs;
  done["repeat"] = s.repeat;
  if (!ok) {
    JsonObject eo = done["error"].to<JsonObject>();
    eo["code"] = e.code;
    eo["message"] = (char*)e.message;
    if (e.retryAfterMs) eo["retryAfterMs"] = e.retryAfterMs;
  }
  send(ch, done);
}

void ProtocolHandler::handleStore(Channel ch, const char* id, JsonObjectConst req) {
  ErrorInfo e;
  RfSignal s;
  if (!signal_model::fromJson(req["signal"], s, e)) {
    sendError(ch, id, e);
    return;
  }
  const char* name = req["name"].is<const char*>() ? req["name"].as<const char*>() : "";
  int slot = -1;
  if (!req["slot"].isNull()) {
    if (!req["slot"].is<int>()) {
      e.set(err::kBadRequest, "slot must be an integer");
      sendError(ch, id, e);
      return;
    }
    slot = req["slot"].as<int>();
  }
  int saved = store.save(slot, name, s, e);
  if (saved < 0) {
    sendError(ch, id, e);
    return;
  }
  JsonDocument d = message("ack", id);
  d["ok"] = true;
  d["slot"] = saved;
  send(ch, d, id);
}

// ---------------------------------------------------------------------------
// RF events
// ---------------------------------------------------------------------------

void ProtocolHandler::onSignal(const CapturedSignal& c) {
  JsonDocument d = message("signal_received", nullptr);
  if (learnRequestId_[0]) d["requestId"] = (char*)learnRequestId_;
  signal_model::toJson(c.signal, d["signal"].to<JsonObject>());
  d["frames"] = c.frames;
  d["durationMs"] = c.durationMs;
  d["frequencyMHz"] = UR_NOMINAL_FREQ_MHZ;
  d["frequencySource"] = "nominal";
  d["modulation"] = "ASK/OOK";
  d["encoding"] = "fixed_code";
  signal_model::addDecodedViews(c.signal, d["decoded"].to<JsonObject>());
  if (c.timingCount) {
    JsonArray t = d["timings"].to<JsonArray>();
    for (uint8_t i = 0; i < c.timingCount; i++) t.add(c.timings[i]);
  }
  broadcast(d);
}

void ProtocolHandler::onLearnEnd(const char* reason) {
  JsonDocument d = message("learn_state", nullptr);
  d["active"] = false;
  d["reason"] = reason;  // timeout | captured | stopped | restarted | disconnected
  if (learnRequestId_[0]) d["requestId"] = (char*)learnRequestId_;
  broadcast(d);
}

void ProtocolHandler::resetSession(Channel ch) {
  for (auto& c : cache_) {
    if (c.channel == (uint8_t)ch) {
      c.id[0] = ' ';
      c.type[0] = ' ';
      c.response.clear();
    }
  }
}

void ProtocolHandler::loop() {
  if (rebootAtMs_ && (int32_t)(millis() - rebootAtMs_) >= 0) {
    LOGW("sys", "rebooting on request");
    Serial.flush();
    delay(50);
    ESP.restart();
  }
}
