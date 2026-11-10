# Firmware

PlatformIO project in `firmware/`. It uses the Arduino framework on ESP-IDF 4.4 (platform `espressif32@7.1.3`, Arduino core 2.0.17).

## Build and flash

```bash
pip install platformio          # or install the PlatformIO IDE extension in VS Code
cd firmware
pio run -e esp32dev             # build (esp32dev | esp32s3 | esp32c3)
pio run -e esp32dev -t upload   # flash (hold BOOT if upload does not start)
pio device monitor              # serial console at 115200
```

At boot the serial console should show lines similar to these:
```
# 212 I/sys: UniRemote 1.0.0 on ESP32-D0WD-V3 rev3, reset=power_on, boot #1
# 220 I/cfg: rx=27 tx=26 led=2 tol=60 rep=10
# 231 I/store: 0/32 signals loaded
# 233 I/rf: ready rx=GPIO27(ok) tx=GPIO26(ok)
# 512 I/ble: advertising as UniRemote-A1B2 (a1:b2:...) ok
# 513 I/sys: ready, free heap 2xxxxx
```
You can type JSON requests into the serial monitor, for example `{"id":"1","type":"get_info"}`, or use `tools/uniremote_cli.py`.

## Configuration

| Where | What |
|---|---|
| `include/config.h` | Defaults: pins per chip, limits, BLE UUIDs, duty-cycle budget, `UR_BLE_REQUIRE_PAIRING`, passkey |
| `platformio.ini` build flags | Overrides, e.g. `-DUR_DEFAULT_RX_PIN=14` or `-DUR_BLE_REQUIRE_PAIRING=1 -DUR_BLE_PASSKEY=482913` |
| Runtime (`set_config`) | `rxPin`, `txPin`, `ledPin`, `rxTolerance`, `defaultRepeat`. Stored in NVS and checked against the per-chip allow-list. Pin changes apply after `reboot`. |

## Architecture

```
main.cpp ── setup(): diag → config → store → status LED → RF → BLE
         └─ loop():  pollBle() → pollSerial() → rf.loop() → ble.loop() → protocol.loop() → led.loop()

 BLE (NimBLE host task)                       Arduino loop task
 ──────────────────────                       ─────────────────
 onWrite → xStreamBuffer ───────────────────► LineAssembler → ProtocolHandler ──► RfService
                                                    ▲                │      │        │ rc-switch
 USB serial bytes ──────────────────────────────────┘                │      │        ▼  ISR on RX pin
                                                                      │      └─► SignalStore (NVS)
 notify() ◄── BleService::sendLine (MTU chunks, retry) ◄──────────────┘
```

| Module | Responsibility |
|---|---|
| `config.h` | Compile-time constants and target detection (refuses to build for ESP32-S2) |
| `app_config.*` | Runtime config in NVS. Pin allow-lists per chip. Pending changes and the reboot-required flag. |
| `ble_service.*` | NimBLE GATT server and advertising (UUID in the advertisement, name in the scan response). Thread-safe hand-off of writes to `loop()` through a FreeRTOS stream buffer. MTU-chunked notifications with back-off on mbuf exhaustion. Optional passkey pairing. |
| `line_assembler.h` | Newline framing with a size cap and overflow recovery |
| `protocol_handler.*` | JSON dispatch, validation, request-id de-duplication cache, responses and events (docs/BLE_PROTOCOL.md) |
| `rf_service.*` | rc-switch wrapper: receive only while learning, burst aggregation (identical frames < 300 ms apart count as one press), noise filter (< 8 bits), mean pulse length, raw timings, transmit with receiver muted, duty-cycle limiter |
| `signal_model.*` | Signal struct, protocol timing table (a mirror of rc-switch), validation, airtime estimate, JSON, hex/binary/tri-state views |
| `signal_store.*` | 32 named slots in NVS (versioned packed blobs) |
| `diagnostics.*` | Ring log (40 lines, mirrored to serial as `# ...`), counters, reset reason, boot count |
| `status_led.h` | Non-blocking LED patterns |

### Design decisions

- **Receiver enabled only while learning.** Super-regenerative receivers output noise all the time, which would cost thousands of interrupts per second while idle.
- **Transmission is synchronous** in `loop()`: rc-switch bit-bangs with `delayMicroseconds`, for at most 2.5 s per request. The BLE stack runs in its own task, so the `ack` notification goes out before the transmission starts, and the link stays alive.
- **Fixed-code only, with an explicit allow-list** (rc-switch protocols 1–12, ≤ 32 bits). There is no raw replay path, and `device_info.capabilities.rawReplay` and `rollingCode` are both `false`.
- **Duty-cycle limiter**: a leaky bucket of 6000 ms that refills at 100 ms/s (10 %), with at least 100 ms between transmissions.
- **Idempotent retries**: the last 4 state-changing responses are cached by request id.

## Resource usage (measured at build time)

| Env | Flash | RAM (static) |
|---|---|---|
| esp32dev | 649 kB / 1.31 MB (49.5 %) | 43 kB (13.1 %) |
| esp32s3 | 556 kB / 3.34 MB (16.6 %) | 37 kB (11.3 %) |
| esp32c3 | 542 kB / 1.31 MB (41.4 %) | 31 kB (9.4 %) |

## Troubleshooting

| Symptom | Check |
|---|---|
| Nothing received while learning | Diagnostics `rxFrames`: if it stays 0, check wiring, receiver power, antenna and distance (10–50 cm). If `rxNoise` rises but there are no signals, the remote is probably not a supported fixed-code type. |
| Received, but the target does not react to the transmission | Antenna on the transmitter, 5 V on the transmitter VCC, more repeats (10 → 15 → 20), distance. Some receivers learn codes only in pairing mode. |
| `rate_limited` | The duty-cycle budget is used up. Wait `retryAfterMs`. |
| Boot loop after a pin change | Hold BOOT and reflash. To clear NVS, run `pio run -t erase` and then upload. |
| Not visible in the app | Check the serial log for `advertising ... ok`. On Android, Location/Nearby-devices permission must be granted. Only one phone can be connected at a time. |
