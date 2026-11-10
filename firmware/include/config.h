// UniRemote - compile-time configuration.
//
// Everything that depends on your exact board / wiring is in this file.
// GPIO values here are only DEFAULTS: they can be changed at runtime with the
// `set_config` command (persisted in NVS) without reflashing.
#pragma once

#include <sdkconfig.h>

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
#define UR_FW_VERSION "1.0.0"
#define UR_PROTOCOL_VERSION 1
#define UR_DEVICE_NAME_PREFIX "UniRemote"  // advertised as UniRemote-XXXX

// ---------------------------------------------------------------------------
// Target detection and default pins
// ---------------------------------------------------------------------------
#if CONFIG_IDF_TARGET_ESP32S2
#error "ESP32-S2 has no Bluetooth radio. UniRemote needs an ESP32 with BLE (ESP32, ESP32-S3, ESP32-C3)."
#endif

#if CONFIG_IDF_TARGET_ESP32S3
#define UR_TARGET_NAME "ESP32-S3"
#ifndef UR_DEFAULT_RX_PIN
#define UR_DEFAULT_RX_PIN 5
#endif
#ifndef UR_DEFAULT_TX_PIN
#define UR_DEFAULT_TX_PIN 4
#endif
#ifndef UR_DEFAULT_LED_PIN
#define UR_DEFAULT_LED_PIN -1  // DevKitC-1 LED is addressable RGB, not a plain GPIO LED
#endif

#elif CONFIG_IDF_TARGET_ESP32C3
#define UR_TARGET_NAME "ESP32-C3"
#ifndef UR_DEFAULT_RX_PIN
#define UR_DEFAULT_RX_PIN 3
#endif
#ifndef UR_DEFAULT_TX_PIN
#define UR_DEFAULT_TX_PIN 4
#endif
#ifndef UR_DEFAULT_LED_PIN
#define UR_DEFAULT_LED_PIN -1
#endif

#elif CONFIG_IDF_TARGET_ESP32
#define UR_TARGET_NAME "ESP32"
#ifndef UR_DEFAULT_RX_PIN
#define UR_DEFAULT_RX_PIN 27
#endif
#ifndef UR_DEFAULT_TX_PIN
#define UR_DEFAULT_TX_PIN 26
#endif
#ifndef UR_DEFAULT_LED_PIN
#define UR_DEFAULT_LED_PIN 2  // on-board blue LED on most DevKit V1 / WROOM boards
#endif

#else
#error "Unsupported target. Supported: ESP32, ESP32-S3, ESP32-C3."
#endif

// ---------------------------------------------------------------------------
// Radio
// ---------------------------------------------------------------------------
// The cheap ASK/OOK modules (FS1000A, XY-MK-5V, RXB6, SYN480R...) cannot
// measure frequency. This value is reported as "nominal" information only.
#define UR_NOMINAL_FREQ_MHZ 433.92f
#define UR_DEFAULT_RX_TOLERANCE 60   // rc-switch receive tolerance in percent
#define UR_MIN_BIT_LENGTH 8          // shorter decodes are treated as noise
#define UR_BURST_GAP_MS 300          // identical frames closer than this = one button press
#define UR_MAX_TIMINGS 67            // == RCSWITCH_MAX_CHANGES

// ---------------------------------------------------------------------------
// Transmission policy (see docs/HARDWARE.md, "Regulatory notes")
// ---------------------------------------------------------------------------
#define UR_TX_DEFAULT_REPEAT 10
#define UR_TX_MAX_REPEAT 20
#define UR_TX_MIN_PULSE_US 50
#define UR_TX_MAX_PULSE_US 2000
#define UR_TX_MAX_AIRTIME_MS 2500    // single request
#define UR_TX_MIN_INTERVAL_MS 100
// Leaky-bucket duty-cycle limiter: 10 % over a 60 s window
// (EU 433.05-434.79 MHz SRD band allows <= 10 % duty cycle).
#define UR_DUTY_BUDGET_MS 6000
#define UR_DUTY_REFILL_MS_PER_S 100

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------
#define UR_MAX_MESSAGE_BYTES 4096    // one JSON message, excluding the '\n'
#define UR_BLE_RX_STREAM_BYTES 4096  // buffer between the BLE task and loop()
#define UR_REQUEST_CACHE 4           // responses remembered for duplicate request ids
#define UR_MAX_ID_LEN 32

// ---------------------------------------------------------------------------
// BLE
// ---------------------------------------------------------------------------
// GATT layout (see docs/BLE_PROTOCOL.md)
#define UR_BLE_SERVICE_UUID "6e7a0001-3c1b-4b8e-9d2f-5a4c1e0b7f30"
#define UR_BLE_RX_CHAR_UUID "6e7a0002-3c1b-4b8e-9d2f-5a4c1e0b7f30"  // app -> device (write)
#define UR_BLE_TX_CHAR_UUID "6e7a0003-3c1b-4b8e-9d2f-5a4c1e0b7f30"  // device -> app (notify)
#define UR_BLE_PREFERRED_MTU 247

// Set to 1 to require BLE pairing with a passkey before the app can talk to
// the device. The phone will show a system pairing dialog.
#ifndef UR_BLE_REQUIRE_PAIRING
#define UR_BLE_REQUIRE_PAIRING 0
#endif
#ifndef UR_BLE_PASSKEY
#define UR_BLE_PASSKEY 123456  // change before enabling pairing!
#endif

// ---------------------------------------------------------------------------
// Storage / diagnostics
// ---------------------------------------------------------------------------
#define UR_STORE_CAPACITY 32         // signals stored on the device (NVS)
#define UR_STORE_NAME_LEN 32
#define UR_LOG_LINES 40
#define UR_LOG_LINE_LEN 96
#define UR_LEARN_DEFAULT_TIMEOUT_MS 30000
#define UR_LEARN_MAX_TIMEOUT_MS 120000
