// Optional status LED (any plain GPIO LED; disabled when ledPin = -1).
//   Idle, not connected : short blink every 2 s
//   Idle, connected     : steady on
//   Learning            : fast blink (4 Hz)
//   Transmitting        : on
//   Signal captured     : one 80 ms flash (off) over the current pattern
#pragma once

#include <Arduino.h>

enum class LedMode : uint8_t { Idle, Learning };

class StatusLed {
 public:
  void begin(int pin) {
    pin_ = pin;
    if (pin_ >= 0) {
      pinMode(pin_, OUTPUT);
      digitalWrite(pin_, LOW);
    }
  }
  void setMode(LedMode m) { mode_ = m; }
  void setConnected(bool c) { connected_ = c; }
  void setTransmitting(bool t) {
    transmitting_ = t;
    if (pin_ >= 0 && t) digitalWrite(pin_, HIGH);  // loop() is blocked during TX
  }
  void blink() { blinkUntil_ = millis() + 80; }

  void loop() {
    if (pin_ < 0) return;
    const uint32_t now = millis();
    bool on;
    if (transmitting_) on = true;
    else if ((int32_t)(blinkUntil_ - now) > 0) on = false;
    else if (mode_ == LedMode::Learning) on = (now / 125) % 2;
    else if (connected_) on = true;
    else on = (now % 2000) < 60;
    digitalWrite(pin_, on ? HIGH : LOW);
  }

 private:
  int pin_ = -1;
  LedMode mode_ = LedMode::Idle;
  bool connected_ = false;
  bool transmitting_ = false;
  uint32_t blinkUntil_ = 0;
};

extern StatusLed statusLed;
