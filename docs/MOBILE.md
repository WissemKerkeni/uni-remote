# Mobile app

React Native 0.88 + Expo SDK 58 + TypeScript (strict), using Expo Router, zustand and react-native-ble-plx.

## Run

```bash
cd mobile
npm install
npm test               # protocol + simulator tests (Jest)
npm run typecheck
npm run web            # UI in a browser, using the simulator (no BLE on web)
npx expo run:android   # development build on a phone (needs Android SDK) - required for BLE
```

**BLE needs a development build.** `react-native-ble-plx` contains native code, so it does **not** work in Expo Go. Build with `npx expo run:android` / `npx expo run:ios` (macOS), or in the cloud with `npx eas-cli@latest build --profile development`.

**Demo mode.** Settings → Transport → *Demo simulator* runs an in-app simulated device that speaks the full protocol. Use it to try the UI without hardware, including in Expo Go and on web. The simulator is clearly labelled and never touches a radio.

## Structure

```
mobile/src
├── app/                     Expo Router routes (screens only)
│   ├── _layout.tsx          root stack, bootstrap (transport init, auto-connect)
│   ├── (tabs)/index.tsx     Dashboard: connection card, recently used, remotes
│   ├── (tabs)/learn.tsx     Signal learning
│   ├── (tabs)/device.tsx    Scan/connect, firmware info, diagnostics, GPIO config, on-device store
│   ├── (tabs)/settings.tsx  Transport, export/import, backup to device, clear data, safe-use notice
│   └── remote/              new.tsx · [id].tsx (control + edit) · button.tsx (editor) · learn.tsx (assign)
├── components/              ui primitives, ConnectionBadge, RemoteButtonTile, SignalDetails, PulseView
├── features/LearnPanel.tsx  learn UI shared by the tab and the assign modal
├── domain/                  types.ts (Remote, RemoteButton, RfSignal…), signal.ts (rules mirrored from firmware)
├── protocol/                constants (UUIDs), messages (typed catalogue), framing, bytes (UTF-8/base64), validate
├── transport/               Transport interface · BleTransport (ble-plx) · MockTransport + MockDevice (simulator)
├── services/                DeviceClient (ids/acks/timeouts/retries) · deviceManager (orchestration → stores)
│                            profileFile (export/import format) · fileIO (share / document picker)
├── store/                   zustand: remotes (persisted), settings (persisted), device (live)
├── theme/                   colours, spacing, typography
└── __tests__/               Jest tests
```

### Layering

`screens → stores + deviceManager → DeviceClient → Transport (BLE | Mock)`

- **Transport** moves bytes only (it chunks writes to the MTU and serializes writes).
- **DeviceClient** knows the protocol: framing, request ids, response matching, timeouts, same-id retries, the `tx_done` wait, and validation of inbound messages.
- **deviceManager** turns client calls and events into store updates (connection status, captures, transmission state per button) and handles auto-reconnect: three attempts at 1, 3 and 6 s.
- Screens read stores and call deviceManager functions. They never touch BLE directly.

Because the app depends only on the documented protocol (docs/BLE_PROTOCOL.md), the firmware can change freely behind it.

## Features

| Area | What it does |
|---|---|
| Dashboard | Device card (status, firmware, target), recently used remotes, remote grid, empty state |
| Add remote | Name, plus a picker of 8 templates with live layout previews (general, light, media, blinds, key fob, climate, custom) |
| Learning | Start/stop with a countdown, single or continuous mode, timeout, optional raw timings. Each capture shows the value, hex, grouped binary, PT2262 tri-state, protocol, bit length, measured pulse, frames, modulation, nominal frequency, airtime estimate and a waveform. You can test-send it, or save it after confirming that you own or are authorized to control the device. |
| Remote control | Tap to transmit. Each tile shows sending / ✓ / error, and a banner shows when you are offline. In edit mode you can change name, category and layout, and add, edit or reorder buttons. Buttons without a signal open the editor. |
| Button editor | Label, 6 colours, 39 icons, width and shape (custom grid), role (key fob and climate), learn or pick a signal from the library, repeat count, move earlier/later, delete. Headings and spacers have a smaller editor. |
| Device | Adapter state, scan (filtered by service UUID), connect/disconnect, MTU, firmware/chip/radio info, diagnostics (5-ping round trip, heap, reset reason, duty budget, counters, log), GPIO mapping editor with the allowed pins, reboot, and the list/delete of signals stored on the device |
| Settings | Choose BLE or simulator, auto-reconnect, export to JSON (share sheet), import (validated merge or replace), back up the library to the device, clear all data, safe-use notice |

## Remote layouts

The look follows the Stitch design system in [design/](design/README.md).

| Layout | How it is drawn | Templates |
|---|---|---|
| `custom` | Free grid with 1–5 columns (stepper). Each item has a **width** (1…columns), a **shape** (rounded, circle, pill) and a **kind**: `button` sends a signal, `label` is a full-width section heading, and `spacer` is an empty cell used for d-pads and alignment. Items flow left to right and wrap (`packRows`). | General – 4 channel · Simple On/Off · Light & dimmer · General – media style (d-pad) · Blinds/gate · Custom (empty) |
| `keyfob` | A fob body with an RF-TX LED that lights while sending. Each row shows an icon, a label and the code in hex. Buttons are ordered by **role**: lock, unlock, trunk, aux, panic. | Key fob |
| `climate` | Last-command LCD panel, power pill, a temperature panel (temp_up / temp_down), a 2×2 grid (mode / fan / swing / timer), then extra buttons such as sleep and eco. Buttons are placed by **role**. | Climate |
| `grid2` / `grid3` / `list` | Older fixed grids. They are still drawn, and support headings and spacers. | – |

- **Templates are plain data** in `src/domain/templates.ts`. A remote created from a template is fully editable and exports like any other remote. Templates never contain signals: every button has to be learned from your own remote.
- **Key fob caveat:** the layout only works with fixed-code fobs (EV1527/PT2262 style). Car keys and most garage openers use rolling codes. The receiver cannot decode those, and the firmware refuses to replay them.
- **Climate caveat:** the layout is for 433 MHz fans, heaters and RF controllers. Most air-conditioners use infrared, which this hardware does not cover. 433 MHz is one-way, so the panel shows the *last command sent*, not the device's actual state.

## Storage and export format

Data is stored in AsyncStorage under the keys `uniremote.remotes.v1` and `uniremote.settings.v1`.

```json
{
  "format": "uniremote.profiles", "version": 1, "exportedAt": "2026-11-10T…", "app": "UniRemote 1.0.0",
  "remotes": [{ "id": "r_…", "name": "Living room", "category": "Lights", "layout": "grid2",
                "buttons": [{ "id": "b_…", "label": "On", "color": "mint", "icon": "power",
                              "signal": { "protocol": 1, "bitLength": 24, "value": "5393", "pulseLength": 320, "repeat": 10 } }],
                "createdAt": 0, "updatedAt": 0 }],
  "signals": [{ "id": "s_…", "name": "Lamp ON", "signal": { … }, "createdAt": 0 }]
}
```

Import is strict:
- Foreign files and newer versions are rejected.
- Signals the firmware would refuse (unknown protocol, more than 32 bits, out-of-range pulse or repeat) are removed, with a warning.
- Unknown categories, layouts and colours are replaced with defaults.
- Merge keeps both copies when ids collide.

## Permissions

These are configured by the `react-native-ble-plx` config plugin in `app.json`:
- **Android 12+:** `BLUETOOTH_SCAN` with `neverForLocation`, and `BLUETOOTH_CONNECT`, both requested at runtime when scanning.
- **Android ≤ 11:** `ACCESS_FINE_LOCATION`, which BLE scanning requires.
- **iOS:** `NSBluetoothAlwaysUsageDescription`.

## Known limitations

- `react-native-ble-plx` 3.5.1 has not been built natively against RN 0.88 in this environment (there is no Android SDK or Xcode here). If the native build fails, see TESTING.md §4.
- One device connection at a time, matching the firmware.
- Web is for UI and simulator use only.
