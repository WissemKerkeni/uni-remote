# UniRemote

UniRemote is an ESP32 + phone universal remote for **fixed-code 433 MHz ASK/OOK** devices: RF sockets, light switches, doorbells, blinds, and old fixed-code gates. It runs on an ordinary ESP32 board with a cheap 433 MHz transmitter and receiver pair.

```
 ┌────────────┐   BLE (JSON lines)   ┌──────────────────┐  GPIO   ┌──────────────────┐
 │ Phone app  │ ◄──────────────────► │ ESP32 firmware   │ ──────► │ 433 MHz TX       │ ))) target device
 │ Expo / RN  │                      │ NimBLE + rc-switch│ ◄────── │ 433 MHz RX       │ ((( original remote
 └────────────┘                      └──────────────────┘         └──────────────────┘
```

## Repository

| Path | Contents |
|---|---|
| `firmware/` | PlatformIO / Arduino firmware for ESP32, ESP32-S3 and ESP32-C3, plus `tools/uniremote_cli.py`, a PC test client for USB serial or BLE |
| `mobile/` | React Native + Expo (SDK 58) + TypeScript app, with a built-in device simulator |
| `docs/` | [HARDWARE](docs/HARDWARE.md) · [WIRING](docs/WIRING.md) · [FIRMWARE](docs/FIRMWARE.md) · [MOBILE](docs/MOBILE.md) · [BLE_PROTOCOL](docs/BLE_PROTOCOL.md) · [TESTING](docs/TESTING.md) |

## Quick start

1. **Wire it up.** See [docs/WIRING.md](docs/WIRING.md). By default the receiver DATA goes to GPIO27 and the transmitter DATA to GPIO26. **Never feed a 5 V receiver output directly into a GPIO.** Fit 17.3 cm wire antennas.
2. **Flash the firmware:**
   ```bash
   cd firmware
   pio run -e esp32dev -t upload && pio device monitor
   ```
3. **Test without the phone:**
   ```bash
   python firmware/tools/uniremote_cli.py --serial COM5 learn
   ```
4. **Run the app.** Use a development build for BLE: `cd mobile && npm install && npx expo run:android`. To try the UI without hardware, run `npm run web`, which uses the simulator.

## Milestone 1 status

| # | Goal | Status |
|---|---|---|
| 1 | ESP32 starts | Code done and builds for 3 chips. **Not yet run on hardware.** |
| 2 | App connects over BLE | Done. Verified against the simulator; real BLE not yet tested. |
| 3 | ESP32 receives a 433 MHz signal | Code done. Needs hardware. |
| 4 | Decoded info sent to the app | Done. Protocol verified by automated tests. |
| 5 | App displays and saves the signal | Done. Verified in a UI walkthrough. |
| 6 | App requests transmission | Done |
| 7 | ESP32 transmits | Code done. Needs hardware. |
| 8 | App receives the confirmation (`tx_done`) | Done. Verified against the simulator. |

See [docs/TESTING.md](docs/TESTING.md) for exactly what was verified by compilation, what was verified by simulation, and what still needs physical hardware.

## Honest limits

UniRemote decodes and re-sends only the **fixed-code** protocols that rc-switch knows, up to 32 bits.

**It does not support, by design:**
- Rolling-code or encrypted remotes: car keys, most garage and gate openers, KeeLoq, Somfy RTS.
- Raw waveform replay.

**It cannot handle, because of the hardware:**
- FSK remotes.
- Remotes on 315 or 868 MHz.
- Measuring frequency or RSSI.

Transmissions are limited to a 10 % duty cycle. Use it only with equipment you own or are authorized to control. Details are in [docs/HARDWARE.md](docs/HARDWARE.md).
