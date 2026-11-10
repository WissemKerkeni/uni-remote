// RF service: wraps rc-switch for a plain ASK/OOK 433 MHz receiver + transmitter
// pair connected to two GPIOs (no SPI radio).
//
// Receive path:  receiver DATA -> GPIO interrupt -> rc-switch decoder ->
//                burst aggregation (one button press = many identical frames)
//                -> onSignal callback (only while learning).
// Transmit path: validated fixed-code signal -> duty-cycle limiter ->
//                rc-switch send() (bit-banged, blocking for the frame time).
#pragma once

#include <Arduino.h>
#include <RCSwitch.h>

#include "app_config.h"
#include "config.h"
#include "error_info.h"
#include "signal_model.h"

struct CapturedSignal {
  RfSignal signal;          // pulseLength = average measured pulse
  uint16_t frames = 0;      // identical frames received during the burst
  uint32_t durationMs = 0;  // first to last frame
  uint16_t timings[UR_MAX_TIMINGS];  // raw edge durations of the first frame (us), best effort
  uint8_t timingCount = 0;
};

// Raw activity on the receiver DATA pin, independent of any decoding.
// Used to check that the receiver is powered and wired (e.g. an XY-MK-5V run
// from 3.3 V without a level divider may produce no usable output).
struct ProbeResult {
  uint32_t edges = 0;          // level changes counted by interrupt
  uint16_t highPermille = 0;   // share of samples read as HIGH (0..1000)
  uint32_t durationMs = 0;
  const char* verdict = "";    // active | quiet | no_activity | floating | stuck_high
};

// Self-test: transmit a known code on our own TX while our RX listens.
struct LoopbackResult {
  RfSignal sent;
  bool received = false;
  bool match = false;
  RfSignal got;              // valid when received
  uint32_t rxFramesDecoded = 0;  // any frames decoded during the test
};

struct TxResult {
  uint32_t estimatedAirtimeMs = 0;
  uint32_t durationMs = 0;
};

class RfService {
 public:
  using SignalCallback = void (*)(const CapturedSignal&);
  using LearnEndCallback = void (*)(const char* reason);

  bool begin(const RuntimeConfig& cfg);
  void setCallbacks(SignalCallback onSignal, LearnEndCallback onLearnEnd) {
    onSignal_ = onSignal;
    onLearnEnd_ = onLearnEnd;
  }

  // single = stop learning after the first captured button press.
  void startLearning(uint32_t timeoutMs, bool single, bool includeTimings);
  void stopLearning(const char* reason);
  bool learning() const { return learning_; }
  uint32_t learnRemainingMs() const;

  // Validation + rate limiting only (no RF activity).
  bool precheck(const RfSignal& s, uint32_t& airtimeMs, ErrorInfo& e);
  bool transmit(const RfSignal& s, TxResult& result, ErrorInfo& e);
  uint32_t dutyBudgetMs();  // remaining airtime budget

  // Blocks for `ms` (100..2000) watching the RX pin. Pauses decoding meanwhile.
  bool probe(uint32_t ms, ProbeResult& out, ErrorInfo& e);

  // Sends `s` with our own bit-banging (receiver stays enabled, unlike
  // rc-switch send()) and checks whether our receiver decodes it.
  bool loopback(const RfSignal& s, LoopbackResult& out, ErrorInfo& e);

  bool rxReady() const { return rxReady_; }
  bool txReady() const { return txReady_; }

  void loop();

 private:
  void enableRx();
  void disableRx();
  void flushBurst();
  void refillBudget();

  RCSwitch rc_;
  int rxPin_ = -1;
  int txPin_ = -1;
  bool rxReady_ = false;
  bool txReady_ = false;
  bool rxEnabled_ = false;

  bool learning_ = false;
  bool single_ = true;
  bool includeTimings_ = false;
  uint32_t learnStartMs_ = 0;
  uint32_t learnTimeoutMs_ = 0;

  bool burstActive_ = false;
  CapturedSignal burst_;
  uint32_t burstFirstMs_ = 0;
  uint32_t burstLastMs_ = 0;
  uint32_t burstPulseSum_ = 0;

  float budgetMs_ = UR_DUTY_BUDGET_MS;
  uint32_t budgetUpdatedMs_ = 0;
  uint32_t lastTxEndMs_ = 0;

  SignalCallback onSignal_ = nullptr;
  LearnEndCallback onLearnEnd_ = nullptr;
};

extern RfService rf;
