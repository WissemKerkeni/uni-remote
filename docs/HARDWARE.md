# Hardware

UniRemote V1 uses only the parts you already have: an ESP32 board, one 433 MHz transmitter module and one 433 MHz receiver module. No PCB or enclosure is needed. The only extra parts are **two resistors**, and you only need them if your receiver must run from 5 V (see WIRING.md).

## 1. Your hardware (identified from photos, 2026-11-10)

| Part | Identified as | Evidence | Consequence |
|---|---|---|---|
| ESP32 board | **ESP32-WROOM-32 on a 30-pin "DevKit V1" board** (micro-USB, EN + BOOT buttons, red power LED) | Module shield reads `ESP32-WROOM-32`; header labels VIN/GND/D13…D34/VN/VP/EN and 3V3/GND/D15…D23 | Classic ESP32 with BLE 4.2 → build env **`esp32dev`**. Default pins **D27 (RX)** and **D26 (TX)** are both on the left header. |
| Receiver ("Récepteur") | **XY-MK-5V / MX-RM-5V type, super-regenerative** | Green 4-pin board, 8-pin LM358 comparator, adjustable green coil, wound coil antenna already soldered | Specified for 5 V, where its DATA output reaches ≈ 5 V and would need a divider. **You have no resistors, so it runs from 3V3** (WIRING.md option C): GPIO-safe, but with lower sensitivity and a marginal logic level. Verify with the receiver probe. The middle two pins are both DATA. |
| Transmitter ("Émetteur") | **XY-FST / FS1000A equivalent ("XKFST")** | `R433S` SAW resonator, pins labelled DATA · VCC · GND, `ANT` pad with nothing soldered | 433.92 MHz ASK/OOK. Power from **VIN (5 V)**; DATA directly to D26. **Solder a 17.3 cm wire to ANT.** |

Still useful later (not blocking): the brand/model of the remotes you want to copy, so we can tell whether they are fixed-code (supported) or rolling-code (not supported).

## 2. Other variants the firmware supports

| Part | Most likely | Supply | Data logic | Notes |
|---|---|---|---|---|
| ESP32 | ESP32-WROOM-32 DevKit (classic, dual core, BLE 4.2) | 5 V USB, 3.3 V logic | 3.3 V, **not 5 V tolerant** | `esp32dev` environment |
| Transmitter | FS1000A ("Émetteur") | 3–12 V | Input, high when > ~2 V | ASK/OOK, SAW-stabilized 433.92 MHz |
| Receiver | XY-MK-5V ("Récepteur") | 5 V (4.5–5.5 V) | Output swings close to **VCC (≈5 V)** | Super-regenerative, noisy, approx. −105 dBm |

Also supported without code changes: ESP32-S3 (`esp32s3`), ESP32-C3 (`esp32c3`), RXB6/SYN480R/SRX882 receivers, and STX882/H34A transmitters.

## 3. Voltage compatibility

- **ESP32 GPIO absolute maximum is VDD + 0.3 V ≈ 3.6 V.** A 5 V signal on a GPIO can damage the chip over time or immediately. The firmware never assumes the receiver output is 3.3 V.
- **Receiver → ESP32 (input):** this is the only direction that needs care.
  - Super-heterodyne receivers (RXB6, SYN480R, SRX882) work from 3.0–5.5 V. Power them from **3.3 V**; their output is then 3.3 V and can connect directly.
  - XY-MK-5V is specified for 5 V. Powered from 5 V, its DATA output reaches about 4–5 V. You must use a **voltage divider** (10 kΩ series + 20 kΩ to GND → about 3.3 V; see WIRING.md). Some units work from 3.3 V without a divider, with reduced sensitivity. That is acceptable for a first test at short range, but it is outside the module's specification.
- **ESP32 → transmitter (output):** safe. FS1000A DATA is a high-impedance input that drives the oscillator transistor, and 3.3 V switches it fully. The transmitter can be powered from 5 V (more range) while DATA stays at 3.3 V, with no level shifter.
- **Common ground** between all three boards is required.

## 4. Antennas

The modules come without useful antennas, and range depends almost entirely on the antenna.

- Quarter-wave at 433.92 MHz: λ = 300 / 433.92 = 0.691 m → **λ/4 ≈ 17.3 cm** of solid copper wire, soldered to the `ANT` pad, kept straight.
- Put one on the **receiver** and one on the **transmitter**. A coiled 17.3 cm wire also works but performs worse.
- Keep the antennas away from the ESP32 board, the USB cable and other wires. Point them vertically, like the antenna of the remote you are copying.
- Typical range with 17.3 cm wires: 10–30 m (transmitter at 5 V), 3–10 m (transmitter at 3.3 V). Without antennas: under 1 m.
- The ESP32's own PCB antenna is for 2.4 GHz BLE and is not involved here.

## 5. What this hardware can and cannot do

**Works (fixed-code ASK/OOK, decoded by rc-switch):**
- EV1527, PT2262/SC2262, HT12E, HT6P20B, HS2303 and the other 12 rc-switch protocols
- Typical uses: cheap RF wall sockets, light switches, doorbells, some blinds and fans, and old fixed-code gate remotes
- Codes up to 32 bits

**Does not work, by hardware limitation:**
- **Frequency measurement.** These receivers are fixed-tuned and only output demodulated data, so the app shows 433.92 MHz as "nominal".
- **Other bands** (315 MHz, 868 MHz) and **FSK/GFSK** remotes (many modern devices, LoRa, most weather stations with FSK). An OOK receiver cannot demodulate them.
- Protocols rc-switch does not know: Manchester-coded sensors, Somfy RTS (rolling), and codes longer than 32 bits.
- Signal strength (RSSI). The data-pin modules do not provide it.
- Weak signals in a noisy environment. Super-regenerative receivers produce constant noise, and the firmware filters decodes shorter than 8 bits.

**Not implemented, deliberately:**
- **Rolling-code (KeeLoq/HCS301, Somfy RTS, car keys, most garage openers).** Even if received, replaying such a code would be an access-control bypass and is not supported.
- **Raw waveform capture-and-replay.** This is the generic way to replay unknown signals, including rolling codes, so V1 only re-transmits frames it decoded as a known fixed-code protocol.

A later version could use a CC1101 module (SPI, configurable frequency/modulation, RSSI, RadioLib support) to lift several of the hardware limits above. It is not needed for V1.

## 6. Regulatory notes

- The **433.05–434.79 MHz** band is a licence-free SRD/ISM band in ITU Region 1 (Europe, Africa, Middle East). It is limited to 10 mW e.r.p. and a **≤ 10 % duty cycle** (ETSI EN 300 220 / ERC REC 70-03).
- The FS1000A's output is in the low-mW range when powered at 5 V.
- The firmware enforces a 10 % duty cycle (6 s of airtime per rolling 60 s), at least 100 ms between transmissions, and at most 2.5 s of airtime per request.
- In the USA, 433 MHz falls under FCC §15.231 (momentary control signals). Other countries have their own rules. Check your local regulations.
- Only control equipment that you own or are authorized to operate. The app asks for this confirmation before it saves a signal.

## 7. Library choice

| Library | Fits our modules? | Decision |
|---|---|---|
| **rc-switch 2.6.4** | Yes. It decodes and encodes OOK on a single data GPIO, with an interrupt-driven decoder and 12 fixed-code protocols, and is ESP32-safe (IRAM ISR). | **Used** |
| RadioLib | It drives SPI radios (CC1101, SX127x, nRF24...). Its "direct mode" helpers do not decode rc-switch protocols. It is not useful with dumb OOK modules. | Not used; it would be the choice for a CC1101 upgrade |
| NimBLE-Arduino 2.x | BLE peripheral; uses about half the flash and about 100 kB less RAM than Bluedroid | **Used** |
| ArduinoJson 7 | JSON parsing and serialization | **Used** |
