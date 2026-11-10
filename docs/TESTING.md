# Testing

Results are split by how they were verified. **No physical hardware was available while V1 was developed.** Nothing in section 3 has been run yet, and no claim is made that RF or BLE works on real devices until you complete it.

## 1. Verified by compilation / static checks ✅

| Check | Command | Result (2026-11-10) |
|---|---|---|
| Firmware, classic ESP32 | `pio run -e esp32dev` | ✅ builds: Flash 49.5 %, RAM 13.1 % |
| Firmware, ESP32-S3 | `pio run -e esp32s3` | ✅ builds: Flash 16.6 %, RAM 11.3 % |
| Firmware, ESP32-C3 | `pio run -e esp32c3` | ✅ builds: Flash 41.4 %, RAM 9.4 % |
| Firmware with BLE pairing enabled | `PLATFORMIO_BUILD_FLAGS=-DUR_BLE_REQUIRE_PAIRING=1 pio run -e esp32dev` | ✅ builds |
| Firmware warnings in project sources | full rebuild | ✅ none in `src/` |
| App type check | `npm run typecheck` (TypeScript 6, strict) | ✅ 0 errors |
| Expo project health | `npx expo-doctor` | ✅ 20/20 checks |
| Android JS bundle | `npx expo export --platform android` | ✅ Hermes bytecode bundle produced (2.9 MB) |
| PC test tool | `python -m py_compile tools/uniremote_cli.py` | ✅ syntax only (not run against a device) |

## 2. Verified by simulation ✅

### Automated tests: `cd mobile && npm test` (49 tests, all passing)

| Suite | What it covers |
|---|---|
| `protocol.test.ts` | UTF-8 and base64 round trips. Reassembly when a message is split at every byte boundary (including inside multi-byte characters). Several messages per chunk. Overflow discard and recovery. Encoder size limit. Inbound message validation (6 malformed cases). Signal rules (protocol, bits, value range, pulse, repeat). Airtime estimate equals the firmware formula. Hex, binary and tri-state formatting. |
| `client.test.ts` | **Milestone-1 flow** against the protocol simulator: `get_info` → `learn_start` → `learn_state` → `signal_received` (decoded and timings) → `learn_state{captured}` → `transmit` → `ack` → `tx_done`. Also: device errors become typed `DeviceError`s; the 10 % duty-cycle limiter returns `rate_limited` with `retryAfterMs`; a lost response is retried with the same id and the request is **not executed twice**; timeouts; pending requests are rejected on link loss; GPIO allow-list validation with the pending-reboot state; `learn_stop` reason. |
| `templates.test.ts` | Custom-grid row packing: wrapping, span clamping, full-width headings. `columnsFor` for all layouts. Every template is well-formed (valid colours, icons and roles; spans fit; no bundled signals). The media d-pad lines up through its spacers. Fob and climate templates define the roles their layouts place. Import keeps or sanitizes `columns`, `span`, `shape`, `kind` and `role`. |
| `profileFile.test.ts` | Export/import round trip. Unsupported signals (66-bit, unknown protocol) are removed with warnings. Enum sanitizing. Foreign, future and invalid files are rejected. |

The simulator (`mobile/src/transport/MockDevice.ts`) re-implements the firmware's protocol rules: validation, de-duplication cache, learning states, duty-cycle limiter and pin allow-lists. It is a model of the firmware, not the firmware itself. **The C++ code was not executed**, because this machine has no host C++ compiler for native unit tests and no ESP32.

### Manual UI walkthrough (web build + simulator, 375×812 viewport)

Done in the built-in browser with `npm run web`:

1. Device tab → Scan → *UniRemote-DEMO (simulator)* → Connect. Status changed to **Connected**, and the firmware/radio info appeared.
2. Diagnostics → Run test: 5/5 pings at about 42 ms (40 ms simulated latency), with counters and log shown.
3. Learn → Start listening. A simulated button press was captured and learning stopped automatically (`captured`). The decoded view showed value 5393, `0x001511`, binary, tri-state `00000FFF0F0F`, 320 µs, 6 frames, 433.92 MHz (nominal), and the waveform.
4. Send on the capture went from *Sending* to ✓ after `tx_done`.
5. Save was blocked until the "I own this device or am authorized" switch was on, then the signal was saved to the library as "Lamp ON".
6. New remote "Living room" (On/Off template) → On button editor → Learn / pick → Use "Lamp ON". The button showed the signal summary.
7. Done (left edit mode) → tapped **On**: spinner, then ✓. The dashboard showed the remote under *Recently used*, with "1/2 buttons ready".
8. Browser console: no errors.

Fixed during the walkthrough: buttons had no accessible names, and the dashboard said "Simulator · simulator".

### Redesign walkthrough (2026-11-10, web + simulator, 375×812)

Done after the Stitch redesign:
- **Dashboard:** device card with mono specs, layout tags, mini previews and the + button.
- **Template picker:** all 8 templates with previews; selection mark and caveat chips.
- **General – 4 channel:** pill grid with All ON / All OFF.
- **Key fob:** assigned a captured signal to LOCK and pressed it. The row showed `0x001511`, a ✓ with mint ring, "Lock · sent 0s ago" and the protocol strip.
- **Climate:** LCD panel, power pill, Warmer/Cooler panel and the 2×2 grid, matching the Stitch screen.
- **Custom:** added a spacer and a button, then set the button to width 2 and pill shape. The grid laid out as a 1 + 2 column row.
- **Console:** no errors from the app. There were connection-refused entries, which came only from a stopped dev server.

Fixed during this walkthrough: the edit badge overlapped pill labels, and the empty custom remote in edit mode said "Tap Edit".

## 2b. Verified on real hardware ✅ (2026-11-10)

Board: ESP32-WROOM-32 DevKit (chip ESP32-D0WD rev1, 4 MB flash, USB-serial WCH CH9102 on COM6). Flashed with `pio run -e esp32dev -t upload --upload-port COM6`.

| Step | Result |
|---|---|
| H1: firmware flashes and boots | ✅ Flash hash verified. The boot log shows `rf: ready rx=GPIO27(ok) tx=GPIO26(ok)`, `ble: advertising as UniRemote-2154 ... ok` and free heap 218 kB. |
| Serial protocol: `get_info` | ✅ Correct `device_info` (ESP32-D0WD rev1, fw 1.0.0, RX 27 / TX 26) |
| Serial protocol: `ping` ×5 | ✅ 15–16 ms round trip |
| `rx_probe` before wiring | `floating`: nothing was driving D27. The probe correctly detected the missing receiver. |
| `rx_probe` with the XY-MK-5V on 3V3 (no resistors) | `quiet`: about 31 edges/s and HIGH 88%. The receiver drives the pin and reaches valid logic levels. |
| **Loopback self-test** (`uniremote_cli.py loopback`, TX on VIN/D26, RX on 3V3/D27) | ✅ **3/3 PASS.** Random 24-bit protocol-1 codes were decoded exactly, with a measured pulse of 350–352 µs (350 µs sent). Only 1–2 of 8 frames decoded per run: reception is modest at 3.3 V, but it works. |
| Learning from a real remote (two 30–45 s windows) | ⏳ 0 frames decoded. It is unknown whether a remote was pressed, or whether it was a compatible fixed-code 433 MHz remote. Still to do. |

Fixed on hardware: the device's duplicate-request cache matched on request id only. The PC tool reused `cli-1` across runs, so a later `get_diagnostics` was answered with a cached `ack`. The cache now matches on id **and** type and is cleared on BLE disconnect, and the PC tool uses random ids. A regression test was added.

Fixed while flashing: on first boot the Arduino core logged 33 `nvs ... NOT_FOUND` errors, which cluttered the serial JSON stream. Empty slots are now skipped with `isKey()`, and the config namespace is opened read-write. The boot log is now clean.

## 3. Requires physical hardware ⏳ (not yet done)

Follow these steps in order. Each one isolates a single subsystem. The PC tool needs `pip install pyserial bleak`.

### H1: ESP32 boots
- Flash with `pio run -e <env> -t upload`, then `pio device monitor`.
- **Pass:** you see the `ready` log line, `rf: ready rx=GPIO27(ok) tx=GPIO26(ok)` and `ble: advertising ... ok`. The LED blinks every 2 s (classic DevKit).
- Also confirm that `python tools/uniremote_cli.py --serial COMx info` returns `device_info`.

### H2: BLE link from a PC
- Run `python tools/uniremote_cli.py --ble ping`.
- **Pass:** 5 pongs, typically 30–100 ms.

### H3: Receiver
- **First run `uniremote_cli.py --serial COMx probe`**, or use Device → Receiver check in the app. Expect `active`. With your XY-MK-5V at 3.3 V (no resistors), `no_activity` means the module doesn't work at that voltage. See WIRING.md for the fixes.
- Run `uniremote_cli.py --serial COMx -v learn --timings` and press a fixed-code remote 10–50 cm from the receiver antenna.
- **Pass:** a `signal_received` with a plausible protocol/bit length (typically protocol 1, 24 bits, about 300–400 µs pulse). The same button should give the same value every time.
- **If it fails:** check `diag` (`rxFrames` and `rxNoise`), the wiring and voltage, and the antenna. Try a different remote (it may be rolling-code).

### H4: Transmitter
- Use a target receiver that learns codes, such as an RF socket in pairing mode, or a second ESP32 or an SDR. Run `uniremote_cli.py tx --protocol P --bits B --value V --pulse L`.
- **Pass:** the target reacts and the CLI prints "Transmission completed".
- Also try the loop-back test: on a second board running UniRemote, put that board in `learn` mode and transmit from the first. It should decode the same value.

### H5: Duty-cycle limiter on real hardware
- Send `tx` with `--repeat 20` repeatedly.
- **Pass:** after about 6 sends within a minute, you get `rate_limited` with `retryAfterMs`.

### H6: Phone app over BLE (milestone 1, end to end)
1. `npx expo run:android` on a phone with Bluetooth on, then grant the permissions.
2. Device → Scan → UniRemote-XXXX → Connect. The badge shows **Connected**, with the firmware version.
3. Device → Diagnostics → Run test. Pings are OK and the MTU is above 23 (Android).
4. Learn → Start, then press the remote. The decoded signal is displayed.
5. Save it after the authorization confirmation, and assign it to a button.
6. Tap the button. ✓ appears, and the target device reacts.
7. Turn Bluetooth off and on, or walk out of range. You see *Reconnecting*, then *Connected*.

### H7: Persistence
- Reboot the ESP32 and confirm that `list` still shows the stored slots and that `config` keeps changed pins. Kill and restart the app and confirm that the remotes are still there.
- Export a file, clear the data, and import the file again.

Record the results with the date, board and modules used, so the "requires hardware" items can be moved into section 1 or 2.

## 4. Known risks to check first on hardware

- **react-native-ble-plx with RN 0.88 / New Architecture.** The JS bundle builds, but no native Android or iOS build was done here. If `expo run:android` fails inside ble-plx, check its issue tracker for a release compatible with RN 0.88.
- **XY-MK-5V at 3.3 V without a divider** may receive nothing. Use the 5 V option with the 10 k/20 k divider (WIRING.md).
- **Raw timings** can contain edges from the next frame. They are for diagnosis only.
