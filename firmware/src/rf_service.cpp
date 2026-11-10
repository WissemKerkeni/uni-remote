#include "rf_service.h"

#include "diagnostics.h"
#include "status_led.h"

RfService rf;

namespace {
volatile uint32_t gProbeEdges = 0;
void IRAM_ATTR probeIsr() { gProbeEdges = gProbeEdges + 1; }
}  // namespace

bool RfService::loopback(const RfSignal& s, LoopbackResult& out, ErrorInfo& e) {
  if (!rxReady_) {
    e.set(err::kHardware, "receiver not configured");
    return false;
  }
  if (learning_) {
    e.set(err::kBusy, "stop learning first");
    return false;
  }
  uint32_t airtime = 0;
  if (!precheck(s, airtime, e)) {
    diag.c.txRejected++;
    return false;
  }
  out.sent = s;

  const ProtocolTiming* t = signal_model::timing(s.protocol);
  const uint32_t pulse = s.pulseLength ? s.pulseLength : t->defaultPulseUs;
  const uint8_t on = t->inverted ? LOW : HIGH;
  const uint8_t off = t->inverted ? HIGH : LOW;
  auto emit = [&](uint8_t hi, uint8_t lo) {
    digitalWrite(txPin_, on);
    delayMicroseconds(pulse * hi);
    digitalWrite(txPin_, off);
    delayMicroseconds(pulse * lo);
  };

  enableRx();
  rc_.resetAvailable();
  statusLed.setTransmitting(true);
  const uint32_t t0 = millis();
  for (uint8_t r = 0; r < s.repeat; r++) {
    for (int i = s.bitLength - 1; i >= 0; i--) {
      if ((s.value >> i) & 1u) emit(t->oneHigh, t->oneLow);
      else emit(t->zeroHigh, t->zeroLow);
    }
    emit(t->syncHigh, t->syncLow);
    if (rc_.available()) {
      out.rxFramesDecoded++;
      if (!out.received) {
        out.received = true;
        out.got.protocol = (uint8_t)rc_.getReceivedProtocol();
        out.got.bitLength = (uint8_t)rc_.getReceivedBitlength();
        out.got.value = (uint32_t)rc_.getReceivedValue();
        out.got.pulseLength = (uint16_t)rc_.getReceivedDelay();
        out.got.repeat = 1;
      }
      rc_.resetAvailable();
    }
  }
  digitalWrite(txPin_, LOW);
  const uint32_t duration = millis() - t0;
  // A decode can complete on the final sync gap: give the ISR a moment.
  delay(20);
  if (rc_.available()) {
    out.rxFramesDecoded++;
    if (!out.received) {
      out.received = true;
      out.got.protocol = (uint8_t)rc_.getReceivedProtocol();
      out.got.bitLength = (uint8_t)rc_.getReceivedBitlength();
      out.got.value = (uint32_t)rc_.getReceivedValue();
      out.got.pulseLength = (uint16_t)rc_.getReceivedDelay();
      out.got.repeat = 1;
    }
    rc_.resetAvailable();
  }
  disableRx();
  statusLed.setTransmitting(false);

  out.match = out.received && out.got.protocol == s.protocol && out.got.bitLength == s.bitLength && out.got.value == s.value;
  lastTxEndMs_ = millis();
  budgetMs_ -= duration > airtime ? duration : airtime;
  if (budgetMs_ < 0) budgetMs_ = 0;
  diag.c.txOk++;
  diag.c.rxFrames += out.rxFramesDecoded;
  LOGI("rf", "loopback value=%lu: %s (%lu frames decoded)", (unsigned long)s.value,
       out.match ? "MATCH" : out.received ? "mismatch" : "nothing received", (unsigned long)out.rxFramesDecoded);
  return true;
}

bool RfService::probe(uint32_t ms, ProbeResult& out, ErrorInfo& e) {
  if (!rxReady_) {
    e.set(err::kHardware, "receiver not configured");
    return false;
  }
  if (ms < 100) ms = 100;
  if (ms > 2000) ms = 2000;

  const bool resume = rxEnabled_;
  disableRx();  // detach rc-switch, attach our counter instead
  gProbeEdges = 0;
  attachInterrupt(digitalPinToInterrupt(rxPin_), probeIsr, CHANGE);

  uint32_t samples = 0, highs = 0;
  const uint32_t t0 = millis();
  while (millis() - t0 < ms) {
    highs += digitalRead(rxPin_) == HIGH ? 1 : 0;
    samples++;
    delayMicroseconds(50);
  }
  detachInterrupt(digitalPinToInterrupt(rxPin_));
  out.durationMs = millis() - t0;
  out.edges = gProbeEdges;
  out.highPermille = samples ? (uint16_t)((uint64_t)highs * 1000 / samples) : 0;

  const uint32_t perSecond = out.durationMs ? out.edges * 1000 / out.durationMs : 0;
  if (out.edges == 0 && out.highPermille >= 995) out.verdict = "stuck_high";
  else if (out.edges == 0) {
    // Distinguish "nothing connected" from "receiver drives the line LOW":
    // with the internal pull-up (~45 kOhm) a floating pin reads HIGH, while a
    // connected receiver output (LM358 sinks mA) keeps it LOW.
    pinMode(rxPin_, INPUT_PULLUP);
    delay(5);
    uint32_t highs2 = 0;
    for (int i = 0; i < 200; i++) {
      highs2 += digitalRead(rxPin_) == HIGH ? 1 : 0;
      delayMicroseconds(50);
    }
    pinMode(rxPin_, INPUT);
    out.verdict = highs2 > 190 ? "floating" : "no_activity";
  }
  else if (perSecond < 50) out.verdict = "quiet";
  else out.verdict = "active";

  if (resume) enableRx();
  LOGI("rf", "probe GPIO%d: %lu edges in %lums, high %u/1000 -> %s", rxPin_, (unsigned long)out.edges,
       (unsigned long)out.durationMs, out.highPermille, out.verdict);
  return true;
}

bool RfService::begin(const RuntimeConfig& cfg) {
  rxPin_ = cfg.rxPin;
  txPin_ = cfg.txPin;

  if (ConfigStore::isValidTxPin(txPin_)) {
    pinMode(txPin_, OUTPUT);
    digitalWrite(txPin_, LOW);  // transmitter idle = carrier off
    rc_.enableTransmit(txPin_);
    txReady_ = true;
  } else {
    LOGE("rf", "invalid TX pin %d", txPin_);
  }

  if (ConfigStore::isValidRxPin(rxPin_)) {
    pinMode(rxPin_, INPUT);
    rc_.setReceiveTolerance(cfg.rxTolerance);
    rxReady_ = true;
  } else {
    LOGE("rf", "invalid RX pin %d", rxPin_);
  }

  budgetUpdatedMs_ = millis();
  LOGI("rf", "ready rx=GPIO%d(%s) tx=GPIO%d(%s)", rxPin_, rxReady_ ? "ok" : "off", txPin_, txReady_ ? "ok" : "off");
  return rxReady_ && txReady_;
}

void RfService::enableRx() {
  if (!rxReady_ || rxEnabled_) return;
  rc_.enableReceive(digitalPinToInterrupt(rxPin_));
  rc_.resetAvailable();
  rxEnabled_ = true;
}

void RfService::disableRx() {
  if (!rxEnabled_) return;
  rc_.disableReceive();
  rxEnabled_ = false;
}

void RfService::startLearning(uint32_t timeoutMs, bool single, bool includeTimings) {
  learning_ = true;
  single_ = single;
  includeTimings_ = includeTimings;
  learnStartMs_ = millis();
  learnTimeoutMs_ = timeoutMs;
  burstActive_ = false;
  enableRx();
  statusLed.setMode(LedMode::Learning);
  LOGI("rf", "learning started (timeout=%lums single=%d)", (unsigned long)timeoutMs, single);
}

void RfService::stopLearning(const char* reason) {
  if (!learning_) return;
  // Report a burst that is still being aggregated, unless the user cancelled.
  const bool flush = burstActive_ && strcmp(reason, "stopped") != 0;
  learning_ = false;  // set first so flushBurst() does not re-enter stopLearning()
  if (flush) flushBurst();
  burstActive_ = false;
  disableRx();
  statusLed.setMode(LedMode::Idle);
  LOGI("rf", "learning stopped (%s)", reason);
  if (onLearnEnd_) onLearnEnd_(reason);
}

uint32_t RfService::learnRemainingMs() const {
  if (!learning_) return 0;
  uint32_t elapsed = millis() - learnStartMs_;
  return elapsed >= learnTimeoutMs_ ? 0 : learnTimeoutMs_ - elapsed;
}

void RfService::flushBurst() {
  if (!burstActive_) return;
  burstActive_ = false;
  CapturedSignal& b = burst_;
  b.durationMs = burstLastMs_ - burstFirstMs_;
  b.signal.pulseLength = (uint16_t)(burstPulseSum_ / (b.frames ? b.frames : 1));
  b.signal.repeat = config.active().defaultRepeat;
  diag.c.rxSignals++;
  statusLed.blink();
  LOGI("rf", "signal proto=%u bits=%u value=%lu pulse=%u frames=%u", b.signal.protocol, b.signal.bitLength,
       (unsigned long)b.signal.value, b.signal.pulseLength, b.frames);
  if (onSignal_) onSignal_(b);
  if (single_ && learning_) stopLearning("captured");
}

void RfService::loop() {
  const uint32_t now = millis();

  if (rxEnabled_ && rc_.available()) {
    const uint32_t value = (uint32_t)rc_.getReceivedValue();
    const uint8_t bits = (uint8_t)rc_.getReceivedBitlength();
    const uint8_t proto = (uint8_t)rc_.getReceivedProtocol();
    const uint16_t pulse = (uint16_t)rc_.getReceivedDelay();
    uint16_t timings[UR_MAX_TIMINGS];
    uint8_t timingCount = 0;
    if (includeTimings_) {
      // Raw buffer is shared with the ISR and may already contain the next
      // frame's edges; it is diagnostic information only.
      const unsigned int* raw = rc_.getReceivedRawdata();
      unsigned int n = 2u * bits + 2u;
      if (n > UR_MAX_TIMINGS) n = UR_MAX_TIMINGS;
      for (unsigned int i = 0; i < n; i++) timings[i] = raw[i] > 0xFFFF ? 0xFFFF : (uint16_t)raw[i];
      timingCount = (uint8_t)n;
    }
    rc_.resetAvailable();
    diag.c.rxFrames++;

    if (learning_) {
      if (bits < UR_MIN_BIT_LENGTH || !signal_model::timing(proto)) {
        diag.c.rxNoise++;
      } else if (burstActive_ && burst_.signal.protocol == proto && burst_.signal.bitLength == bits &&
                 burst_.signal.value == value) {
        burst_.frames++;
        burstLastMs_ = now;
        burstPulseSum_ += pulse;
      } else {
        flushBurst();  // a different code arrived: report the previous one
        if (learning_) {
          burstActive_ = true;
          burst_ = CapturedSignal();
          burst_.signal.protocol = proto;
          burst_.signal.bitLength = bits;
          burst_.signal.value = value;
          burst_.frames = 1;
          burstFirstMs_ = burstLastMs_ = now;
          burstPulseSum_ = pulse;
          if (timingCount) {
            memcpy(burst_.timings, timings, timingCount * sizeof(uint16_t));
            burst_.timingCount = timingCount;
          }
        }
      }
    }
  }

  if (burstActive_ && now - burstLastMs_ > UR_BURST_GAP_MS) flushBurst();
  if (learning_ && now - learnStartMs_ >= learnTimeoutMs_) stopLearning("timeout");
}

void RfService::refillBudget() {
  const uint32_t now = millis();
  budgetMs_ += (now - budgetUpdatedMs_) * (UR_DUTY_REFILL_MS_PER_S / 1000.0f);
  if (budgetMs_ > UR_DUTY_BUDGET_MS) budgetMs_ = UR_DUTY_BUDGET_MS;
  budgetUpdatedMs_ = now;
}

uint32_t RfService::dutyBudgetMs() {
  refillBudget();
  return (uint32_t)budgetMs_;
}

bool RfService::precheck(const RfSignal& s, uint32_t& airtimeMs, ErrorInfo& e) {
  if (!txReady_) {
    e.set(err::kHardware, "transmitter not configured");
    return false;
  }
  if (!signal_model::validate(s, e)) return false;

  airtimeMs = signal_model::estimateAirtimeMs(s);
  if (airtimeMs > UR_TX_MAX_AIRTIME_MS) {
    e.set(err::kInvalidSignal, "frame too long (%lums > %dms), reduce repeat", (unsigned long)airtimeMs,
          UR_TX_MAX_AIRTIME_MS);
    return false;
  }
  const uint32_t now = millis();
  if (lastTxEndMs_ && now - lastTxEndMs_ < UR_TX_MIN_INTERVAL_MS) {
    e.set(err::kRateLimited, "transmitting too fast");
    e.retryAfterMs = UR_TX_MIN_INTERVAL_MS - (now - lastTxEndMs_);
    return false;
  }
  refillBudget();
  if (budgetMs_ < airtimeMs) {
    e.set(err::kRateLimited, "duty-cycle budget exhausted (10%% limit)");
    e.retryAfterMs = (unsigned long)((airtimeMs - budgetMs_) * 1000.0f / UR_DUTY_REFILL_MS_PER_S) + 1;
    return false;
  }
  return true;
}

bool RfService::transmit(const RfSignal& s, TxResult& result, ErrorInfo& e) {
  uint32_t airtime = 0;
  if (!precheck(s, airtime, e)) {
    diag.c.txRejected++;
    return false;
  }
  result.estimatedAirtimeMs = airtime;

  const bool resumeRx = rxEnabled_;
  disableRx();  // do not decode our own transmission
  statusLed.setTransmitting(true);

  const ProtocolTiming* t = signal_model::timing(s.protocol);
  rc_.setProtocol(s.protocol);  // also resets pulse length to the protocol default
  rc_.setPulseLength(s.pulseLength ? s.pulseLength : t->defaultPulseUs);
  rc_.setRepeatTransmit(s.repeat);

  const uint32_t t0 = millis();
  rc_.send(s.value, s.bitLength);
  digitalWrite(txPin_, LOW);
  result.durationMs = millis() - t0;

  statusLed.setTransmitting(false);
  if (resumeRx) enableRx();

  lastTxEndMs_ = millis();
  budgetMs_ -= result.durationMs > airtime ? result.durationMs : airtime;
  if (budgetMs_ < 0) budgetMs_ = 0;
  diag.c.txOk++;
  LOGI("rf", "tx proto=%u bits=%u value=%lu pulse=%u x%u in %lums", s.protocol, s.bitLength,
       (unsigned long)s.value, s.pulseLength, s.repeat, (unsigned long)result.durationMs);
  return true;
}
