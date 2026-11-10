# Wiring

> **Your parts (from photos):** ESP32-WROOM-32 DevKit (30-pin) · XY-MK-5V receiver · XY-FST/FS1000A transmitter. **No resistors on hand**, so the build below uses receiver **option C** (3.3 V).

### Your exact build (no resistors)

| From | To | Note |
|---|---|---|
| ESP32 **VIN** | TX **VCC** | 5 V from USB. More transmit range; DATA stays 3.3 V logic. |
| ESP32 **3V3** | RX **VCC** | **Not VIN.** At 3.3 V the receiver's output can never exceed 3.3 V, so the GPIO is safe without a divider. |
| ESP32 **GND** | TX **GND** and RX **GND** | Common ground |
| ESP32 **D26** | TX **DATA** | Direct |
| ESP32 **D27** | RX **DATA** (either middle pin; they are bridged) | Direct |
| TX **ANT** pad | 17.3 cm straight wire | Needed for any useful range |

```
 XKFST (TX)          ESP32 DevKit           XY-MK-5V (RX)
  VCC  ─────────────  VIN
  DATA ─────────────  D26
  GND  ─────────────  GND ─────────────────  GND
                      3V3 ─────────────────  VCC
                      D27 ─────────────────  DATA (inner pin)
  ANT  ── 17.3 cm wire                         (coil antenna fitted)
```

**What to expect at 3.3 V.** The XY-MK-5V is specified for 5 V. At 3.3 V:
- **Sensitivity drops.** Hold the original remote 10–50 cm from the receiver while learning.
- **The logic level may be marginal.** The LM358 output only swings to roughly VCC − 1 V, which is about 2.3 V against the ESP32's ~2.5 V HIGH threshold. Many units still work; some don't.

**Check it before learning:** in the app, go to **Device → Diagnostics → Probe receiver**, or run `uniremote_cli.py --serial COMx probe`. The probe watches D27 for 0.5 s:
- **`active`** (hundreds or thousands of edges per second): the receiver is alive. Super-regenerative receivers output noise constantly, which is normal. Go ahead and learn.
- **`no_activity`** (pin stays LOW, 0 edges): the module is not working at 3.3 V, or a wire is wrong. Re-check VCC, GND and DATA first.
- **`floating`**: nothing is connected to D27. Check the DATA wire and the common GND.
- **`stuck_high`**: wiring fault, or DATA is connected to VCC.

**If the probe stays at `no_activity`**, there are two cheap fixes:
- **Two resistors (10 kΩ + 20 kΩ, or three 10 kΩ):** power the receiver from VIN with the divider in option B below.
- **Replace the receiver** with a 3.3 V superheterodyne module (RXB6 or SYN480R). It wires exactly like the table above and is much more sensitive.

Do **not** power the XY-MK-5V from VIN while its DATA is connected straight to a GPIO.

> ⚠️ Disconnect USB while wiring. Double-check VCC/GND before powering: reversing them destroys the modules.

GPIO numbers below are the **defaults**. They can be changed without reflashing: in the app go to **Device → GPIO mapping**, or run `uniremote_cli.py setpins --rx N --tx M` and reboot. See section 4 for which pins are allowed.

## 1. Classic ESP32 DevKit (default `esp32dev`): RX GPIO27, TX GPIO26

### Transmitter (FS1000A / XY-FST)

| Module pin | ESP32 DevKit pin | Notes |
|---|---|---|
| VCC | **5V / VIN** (preferred, more range) or 3V3 | 5V/VIN carries 5 V only when the board is powered from USB |
| GND | GND | |
| DATA | **GPIO26** | 3.3 V logic drives the module directly |
| ANT | 17.3 cm straight wire | see HARDWARE.md §4 |

### Receiver

**Option A: super-heterodyne receiver (RXB6, SYN480R, SRX882), 3.3 V.** This is the recommended option and connects directly.

| Module pin | ESP32 pin |
|---|---|
| VCC | **3V3** |
| GND | GND |
| DATA (either DATA pin; they are bridged) | **GPIO27** |
| ANT | 17.3 cm wire |

**Option B: XY-MK-5V / MX-RM-5V at 5 V.** This option **requires a voltage divider.**

```
 XY-MK-5V                         ESP32
 VCC  ─────────────────────────── 5V / VIN
 GND  ─────────────────────────── GND ─────────┐
 DATA ──[ R1 10 kΩ ]──┬────────── GPIO27       │
                      └─[ R2 20 kΩ ]───────────┘
                (two 10 kΩ in series also make 20 kΩ)

 V(GPIO27) = 5 V × 20k / (10k + 20k) ≈ 3.33 V   (ESP32 HIGH threshold ≈ 2.5 V)
```
Never connect the DATA pin of a receiver powered from 5 V straight to a GPIO.

**Option C: XY-MK-5V at 3.3 V, without resistors.** This is outside the module's specification. Many units still work, but with lower sensitivity and range. You can use it for a first bench test if you have no resistors. Power VCC from 3V3 and connect DATA directly to GPIO27. If nothing is ever received in this setup, switch to option B.

### Complete diagram (classic ESP32, FS1000A + RXB6)

```
  FS1000A (TX)              ESP32 DevKit V1               RXB6 / SYN480R (RX)
  ┌──────────┐             ┌───────────────┐              ┌──────────┐
  │ VCC  ────┼─────────────┤ 5V / VIN      │              │          │
  │ DATA ────┼─────────────┤ GPIO26        │              │          │
  │ GND  ────┼──────┬──────┤ GND           │              │          │
  │ ANT ┐    │      │      │          3V3  ├──────────────┼──── VCC  │
  └─────┼────┘      │      │       GPIO27  ├──────────────┼──── DATA │
        │           └──────┤ GND           ├──────────────┼──── GND  │
        │                  └───────────────┘              │    ANT ┐ │
   17.3 cm wire                                           └────────┼─┘
                                                             17.3 cm wire
```
Nets: `5V → TX.VCC`, `3V3 → RX.VCC`, `GPIO26 → TX.DATA`, `GPIO27 → RX.DATA`, and `GND → TX.GND + RX.GND` (common ground).

The **status LED** is the onboard LED on GPIO2. It gives a short blink every 2 s while advertising, stays on steadily when connected, blinks fast while learning, and stays on during transmission.

## 2. ESP32-S3 DevKitC-1 (`esp32s3`): RX GPIO5, TX GPIO4

The connections are the same as above, using the board's `5V` and `3V3` pins. There is no plain status LED (the onboard LED is an addressable RGB). Avoid GPIO0, 3, 45 and 46 (strapping), 19 and 20 (USB), and 26–37 (flash/PSRAM).

## 3. ESP32-C3 DevKitM-1 / SuperMini (`esp32c3`): RX GPIO3, TX GPIO4

The connections are the same; use the `5V` and `3V3` pins. Avoid GPIO2, 8 and 9 (strapping) and 18–19 (USB).

## 4. Allowed pins (validated by the firmware)

| Chip | Receiver (input) | Transmitter (output) |
|---|---|---|
| ESP32 | 4, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39 | 4, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33 |
| ESP32-S3 | 1, 2, 4–18, 21, 38–42, 47, 48 | same |
| ESP32-C3 | 0, 1, 3, 4, 5, 6, 7, 10 | same |

Notes:
- The firmware excludes the flash pins (ESP32 GPIO6–11), the UART0 console pins and the boot strapping pins (ESP32 GPIO0, 2, 5, 12, 15). A receiver that drives GPIO12 high at boot would select 1.8 V flash and prevent the board from starting.
- ESP32 GPIO34–39 are input-only, so they can be used for the receiver but not for the transmitter.
- ESP32 GPIO16 and 17 are used by PSRAM on **WROVER** modules. Do not use them there.

## 5. Power

- USB from a computer or phone charger (≥ 500 mA) is enough. The ESP32 with BLE draws about 100–130 mA, the receiver about 5 mA, and the transmitter about 10–40 mA while sending.
- If transmissions cause resets (`resetReason: brownout` in Diagnostics), use a better USB cable or supply, or power the transmitter from 3.3 V.
