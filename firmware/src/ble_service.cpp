#include "ble_service.h"

#include <NimBLEDevice.h>
#include <freertos/FreeRTOS.h>
#include <freertos/stream_buffer.h>

#include "config.h"
#include "diagnostics.h"
#include "status_led.h"

BleService ble;

namespace {

NimBLEServer* gServer = nullptr;
NimBLECharacteristic* gTxChar = nullptr;
StreamBufferHandle_t gRxStream = nullptr;

volatile bool gConnected = false;
volatile bool gSubscribed = false;
volatile uint16_t gConnHandle = BLE_HS_CONN_HANDLE_NONE;
volatile uint16_t gMtu = 23;
volatile uint32_t gDropped = 0;

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, NimBLEConnInfo& info) override {
    gConnected = true;
    gConnHandle = info.getConnHandle();
    gMtu = info.getMTU();
    diag.c.bleConnects++;
    statusLed.setConnected(true);
    // 15-30 ms interval, no latency, 4 s supervision timeout.
    server->updateConnParams(info.getConnHandle(), 12, 24, 0, 400);
    LOGI("ble", "connected %s", info.getAddress().toString().c_str());
  }

  void onDisconnect(NimBLEServer*, NimBLEConnInfo& info, int reason) override {
    gConnected = false;
    gSubscribed = false;
    gConnHandle = BLE_HS_CONN_HANDLE_NONE;
    gMtu = 23;
    statusLed.setConnected(false);
    LOGI("ble", "disconnected (reason 0x%02x)", reason);
    // Advertising restarts automatically (advertiseOnDisconnect) and in loop().
  }

  void onMTUChange(uint16_t mtu, NimBLEConnInfo&) override {
    gMtu = mtu;
    LOGI("ble", "MTU %u", mtu);
  }

  uint32_t onPassKeyDisplay() override { return UR_BLE_PASSKEY; }

  void onAuthenticationComplete(NimBLEConnInfo& info) override {
#if UR_BLE_REQUIRE_PAIRING
    if (!info.isEncrypted() || !info.isAuthenticated()) {
      LOGW("ble", "pairing failed, disconnecting");
      NimBLEDevice::getServer()->disconnect(info.getConnHandle());
    }
#endif
  }
};

class RxCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo&) override {
    // Runs in the NimBLE host task: only copy bytes, parsing happens in loop().
    NimBLEAttValue v = c->getValue();
    size_t sent = xStreamBufferSend(gRxStream, v.data(), v.length(), 0);
    if (sent < v.length()) gDropped += v.length() - sent;
  }
};

class TxCallbacks : public NimBLECharacteristicCallbacks {
  void onSubscribe(NimBLECharacteristic*, NimBLEConnInfo&, uint16_t subValue) override {
    gSubscribed = (subValue & 0x0001) != 0;
    LOGI("ble", "notifications %s", gSubscribed ? "on" : "off");
  }
};

ServerCallbacks serverCallbacks;
RxCallbacks rxCallbacks;
TxCallbacks txCallbacks;

}  // namespace

bool BleService::begin(const char* deviceName) {
  strlcpy(name_, deviceName, sizeof(name_));
  gRxStream = xStreamBufferCreate(UR_BLE_RX_STREAM_BYTES, 1);
  if (!gRxStream) {
    LOGE("ble", "stream buffer alloc failed");
    return false;
  }

  NimBLEDevice::init(name_);
  NimBLEDevice::setMTU(UR_BLE_PREFERRED_MTU);
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
#if UR_BLE_REQUIRE_PAIRING
  NimBLEDevice::setSecurityAuth(true, true, true);  // bonding, MITM, secure connections
  NimBLEDevice::setSecurityPasskey(UR_BLE_PASSKEY);
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_DISPLAY_ONLY);
  const uint32_t rxProps = NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR | NIMBLE_PROPERTY::WRITE_ENC |
                           NIMBLE_PROPERTY::WRITE_AUTHEN;
#else
  const uint32_t rxProps = NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR;
#endif
  strlcpy(address_, NimBLEDevice::getAddress().toString().c_str(), sizeof(address_));

  gServer = NimBLEDevice::createServer();
  gServer->setCallbacks(&serverCallbacks, false);
  gServer->advertiseOnDisconnect(true);

  NimBLEService* svc = gServer->createService(UR_BLE_SERVICE_UUID);
  NimBLECharacteristic* rx = svc->createCharacteristic(UR_BLE_RX_CHAR_UUID, rxProps, 512);
  rx->setCallbacks(&rxCallbacks);
  gTxChar = svc->createCharacteristic(UR_BLE_TX_CHAR_UUID, NIMBLE_PROPERTY::NOTIFY, 512);
  gTxChar->setCallbacks(&txCallbacks);
  svc->start();

  // 128-bit service UUID in the advertisement, name in the scan response
  // (both together do not fit in 31 bytes).
  NimBLEAdvertisementData advData;
  advData.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP);
  advData.addServiceUUID(NimBLEUUID(UR_BLE_SERVICE_UUID));
  NimBLEAdvertisementData scanData;
  scanData.setName(name_);

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setAdvertisementData(advData);
  adv->setScanResponseData(scanData);
  adv->enableScanResponse(true);
  bool ok = adv->start();
  LOGI("ble", "advertising as %s (%s) %s", name_, address_, ok ? "ok" : "FAILED");
  return ok;
}

void BleService::loop() {
  static uint32_t lastCheck = 0;
  const uint32_t now = millis();
  if (now - lastCheck < 1000) return;
  lastCheck = now;
  if (!gConnected && !NimBLEDevice::getAdvertising()->isAdvertising()) {
    LOGW("ble", "advertising stopped, restarting");
    NimBLEDevice::getAdvertising()->start();
  }
}

bool BleService::connected() const { return gConnected; }
bool BleService::subscribed() const { return gConnected && gSubscribed; }
uint16_t BleService::mtu() const { return gMtu; }

size_t BleService::read(uint8_t* buf, size_t maxLen) {
  if (!gRxStream) return 0;
  return xStreamBufferReceive(gRxStream, buf, maxLen, 0);
}

uint32_t BleService::takeDroppedBytes() {
  uint32_t d = gDropped;
  gDropped = 0;
  return d;
}

bool BleService::sendLine(const std::string& line) {
  if (!subscribed() || !gTxChar) return false;
  size_t chunk = gMtu > 3 ? gMtu - 3 : 20;
  if (chunk > 512) chunk = 512;

  std::string framed = line;
  framed.push_back('\n');
  const uint8_t* p = reinterpret_cast<const uint8_t*>(framed.data());
  size_t remaining = framed.size();

  while (remaining) {
    size_t n = remaining < chunk ? remaining : chunk;
    int attempts = 0;
    // notify() fails when the host runs out of mbufs: back off and retry.
    while (!gTxChar->notify(p, n, gConnHandle)) {
      if (!gConnected || ++attempts > 100) {
        diag.c.notifyFailures++;
        return false;
      }
      diag.c.notifyRetries++;
      delay(5);
    }
    p += n;
    remaining -= n;
  }
  return true;
}
