// BLE GATT transport (NimBLE). One service, two characteristics:
//   RX  (write / write-without-response): app -> device bytes
//   TX  (notify):                          device -> app bytes
// Messages are UTF-8 JSON terminated by '\n' and split into MTU-sized chunks
// in both directions (see docs/BLE_PROTOCOL.md).
#pragma once

#include <Arduino.h>

#include <string>

class BleService {
 public:
  bool begin(const char* deviceName);
  void loop();  // restarts advertising if needed

  bool connected() const;
  bool subscribed() const;
  uint16_t mtu() const;

  // Reads bytes received from the app (non-blocking). Returns byte count.
  size_t read(uint8_t* buf, size_t maxLen);
  // Number of bytes dropped because loop() did not keep up (since last call).
  uint32_t takeDroppedBytes();

  // Sends one complete message; '\n' is appended. Blocks until all chunks are
  // queued in the BLE stack (retries on buffer exhaustion).
  bool sendLine(const std::string& line);

  const char* name() const { return name_; }
  const char* address() const { return address_; }

 private:
  char name_[32] = {0};
  char address_[18] = {0};
};

extern BleService ble;
