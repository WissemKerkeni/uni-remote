# UniRemote BLE protocol (v1)

The app and the firmware only share this document. Either side can be rewritten as long as it follows it.
Reference implementations: `firmware/src/protocol_handler.cpp` (device side), `mobile/src/services/DeviceClient.ts` (app side), and `mobile/src/transport/MockDevice.ts` (simulator).

## 1. Transport

### GATT layout

| Item | UUID | Properties | Direction |
|---|---|---|---|
| Service | `6e7a0001-3c1b-4b8e-9d2f-5a4c1e0b7f30` | primary | |
| RX characteristic | `6e7a0002-3c1b-4b8e-9d2f-5a4c1e0b7f30` | Write, Write Without Response | app → device |
| TX characteristic | `6e7a0003-3c1b-4b8e-9d2f-5a4c1e0b7f30` | Notify | device → app |

- **Advertising:** the advertisement carries the 128-bit service UUID. The scan response carries the name `UniRemote-XXXX` (the last 2 bytes of the MAC).
- **Connections:** one at a time. The device requests a 15–30 ms connection interval.
- **MTU:** the device prefers 247. The app requests it on Android; iOS negotiates it automatically.
- **Pairing:** off by default. Build with `-DUR_BLE_REQUIRE_PAIRING=1` to require passkey pairing (MITM, secure connections) before writes are accepted.

The same protocol also runs over USB serial at 115200 baud. Firmware log lines on serial start with `# ` and are not protocol messages.

### Framing

- Each message is one compact UTF-8 JSON object followed by `\n` (0x0A). JSON escapes newlines inside strings, so `\n` can only appear as the terminator.
- A message can be split across any number of BLE writes or notifications, at any byte boundary, including inside a multi-byte UTF-8 character. The receiver buffers bytes until it sees `\n`.
- **Chunk size** is ATT MTU − 3 bytes. The app writes chunks sequentially with Write-with-Response, which gives ordering and flow control. The device sends notifications sequentially and retries when the BLE stack runs out of buffers.
- **Maximum message size** is 4096 bytes, excluding the terminator. A larger message is discarded up to the next `\n`, and the device answers `error/too_large`.
- `\r` is ignored and empty lines are skipped.

## 2. Envelope

```json
{ "v": 1, "id": "k3f9-12", "type": "transmit", ... }
```

| Field | Rule |
|---|---|
| `v` | Protocol version. Optional on requests; when present it must be `1`. The device always sends it. |
| `type` | Message type (string). |
| `id` | Request id: a string of at most 32 characters, unique per request. The device copies it into the response and into related completion events. Events that are not tied to a request have no `id`. |

### Request rules

1. Every request gets exactly one immediate response. That is either the typed response (`device_info`, `pong`, `diagnostics`, `stored_list`, `config`), an `ack`, or an `error`.
2. Long operations then send a completion event with the same `id` (`tx_done`). Learning sends `learn_state`/`signal_received` events.
3. **Timeouts:** the app waits 4 s for a response by default. For `tx_done` it waits `estimatedAirtimeMs + 4 s`.
4. **Retries and de-duplication:** after a timeout, the app may resend the same request with the same `id`. The device keeps the responses to its last 4 state-changing requests (`transmit`, `learn_start`, `store_signal`, `delete_stored`, `clear_stored`, `set_config`, `reset_config`, `reboot`). For a repeated `id` it replays the cached response instead of running the request again. This is why a retried `transmit` never transmits twice.
5. Unknown fields are ignored. Unknown `type` values return `error/unknown_type`.

## 3. Signal object

```json
{ "protocol": 1, "protocolName": "PT2262/EV1527", "bitLength": 24, "value": "5393", "pulseLength": 320, "repeat": 10 }
```

| Field | Type | Range | Notes |
|---|---|---|---|
| `protocol` | int | 1..12 | rc-switch protocol number (see `device_info.capabilities.protocols`) |
| `bitLength` | int | 1..32 | |
| `value` | string | decimal, < 2^bitLength | A decimal string, which avoids JSON number precision issues. Devices also accept an integer. |
| `pulseLength` | int | 0 or 50..2000 µs | `0` means the protocol default. Captured signals carry the measured pulse. |
| `repeat` | int | 1..20 | Frames sent per transmission. If omitted, the device's `defaultRepeat` is used. |
| `protocolName` | string | | Informational. Sent by the device and ignored on input. |

The firmware rejects a frame whose estimated airtime (`repeat × frame time`) is over 2500 ms.

## 4. Messages: app → device

| type | Body | Response | Then |
|---|---|---|---|
| `get_info` | | `device_info` | |
| `ping` | `echo?` | `pong` | |
| `get_diagnostics` | `logLines?` (0–40, default 20) | `diagnostics` | |
| `rx_probe` | `durationMs?` (100–2000, default 500) | `rx_probe_result` | Pauses decoding while it runs |
| `loopback_test` | `signal?` (default: random 24-bit protocol-1 code, 8 frames) | `loopback_result` | Transmits on the device's own TX while its RX listens. Duty-cycle limits apply. |
| `learn_start` | `timeoutMs?` (1000–120000, default 30000), `single?` (default true), `includeTimings?` (default false) | `ack` | `learn_state{active:true}`, then 0..n `signal_received`, then `learn_state{active:false}` |
| `learn_stop` | | `ack{wasLearning}` | `learn_state{active:false, reason:"stopped"}` |
| `transmit` | `signal` | `ack{estimatedAirtimeMs}` or `error` | `tx_done` |
| `transmit_stored` | `slot` | `ack` or `error` | `tx_done` |
| `store_signal` | `name`, `signal`, `slot?` (-1 or omitted = first free slot) | `ack{slot}` | |
| `list_stored` | | `stored_list` | |
| `delete_stored` | `slot` | `ack` | |
| `clear_stored` | | `ack` | |
| `get_config` | | `config` | |
| `set_config` | `config{rxPin?, txPin?, ledPin?, rxTolerance?, defaultRepeat?}` | `config` | Pin changes apply after `reboot` |
| `reset_config` | | `config` | |
| `reboot` | | `ack` | The device restarts about 0.5 s later |

**Message names in the project brief.** "Save profile" corresponds to `store_signal` (a signal backed up on the device). Full remote profiles, with their buttons and layout, are stored in the app and exported as files (see MOBILE.md). "Start learning" is `learn_start`. "Transmission completed" is `tx_done`.

## 5. Messages: device → app

### `device_info`
```json
{"v":1,"type":"device_info","id":"..","name":"UniRemote-A1B2","firmwareVersion":"1.0.0","protocolVersion":1,
 "target":"ESP32","chipModel":"ESP32-D0WD-V3","chipRevision":3,"cpuCores":2,"flashSize":4194304,
 "bleAddress":"a1:b2:..","sdk":"v4.4.7","uptimeMs":12345,
 "radio":{"frequencyMHz":433.92,"frequencySource":"nominal","modulation":"ASK/OOK","rxReady":true,"txReady":true,"rxPin":27,"txPin":26},
 "capabilities":{"maxMessageBytes":4096,"maxRepeat":20,"maxBitLength":32,"storeCapacity":32,
   "rawReplay":false,"rollingCode":false,"protocols":[{"id":1,"name":"PT2262/EV1527","pulseLength":350}, ...]}}
```
`frequencySource` is always `"nominal"` with ASK/OOK data-pin modules, because they cannot measure frequency.

### `rx_probe_result`
`{"v":1,"type":"rx_probe_result","id":"..","rxPin":27,"durationMs":500,"edges":1043,"edgesPerSecond":2086,"highRatio":0.41,"verdict":"active"}`

This checks raw activity on the receiver DATA pin, with no decoding. Use it to confirm that the receiver is powered and wired.

| `verdict` | Meaning |
|---|---|
| `active` | 50 or more edges per second. Super-regenerative receivers output noise constantly, so this is the normal result. |
| `quiet` | Some activity, but less than 50 edges per second |
| `no_activity` | No edges, and the pin stays LOW even with the internal pull-up on, so the receiver drives it LOW. This means the receiver is connected but gives no output. |
| `floating` | No edges, and the pin reads HIGH once the internal pull-up is on, so nothing is connected to it |
| `stuck_high` | No edges and the pin reads HIGH |

### `loopback_result`
`{"type":"loopback_result","match":true,"received":true,"framesDecoded":2,"sent":{...signal},"got":{...signal}}`

This is a self-test that needs no remote. `match` is true when the receiver decoded exactly the code that was sent, which proves that both modules and the decoder work.

### `ack`
`{"v":1,"type":"ack","id":"..","ok":true}`. Optional fields: `slot`, `estimatedAirtimeMs`, `wasLearning`.

### `error`
```json
{"v":1,"type":"error","id":"..","code":"rate_limited","message":"duty-cycle budget exhausted (10% limit)","retryAfterMs":2310}
```
`id` is missing when the error is not tied to a request (for example, a JSON parse error).

### `learn_state`
`{"type":"learn_state","active":true,"requestId":"..","timeoutMs":30000,"single":true}`

`{"type":"learn_state","active":false,"reason":"captured"}`

`reason` is one of `timeout`, `captured`, `stopped`, `restarted` or `disconnected`.

### `signal_received`
```json
{"v":1,"type":"signal_received","requestId":"..",
 "signal":{"protocol":1,"protocolName":"PT2262/EV1527","bitLength":24,"value":"5393","pulseLength":318,"repeat":10},
 "frames":6,"durationMs":238,"frequencyMHz":433.92,"frequencySource":"nominal","modulation":"ASK/OOK","encoding":"fixed_code",
 "decoded":{"hex":"0x001511","binary":"000000000001010100010001","triState":"00000FFF0F0F"},
 "timings":[9939,320,960, ...]}
```
- One message is sent per **button press**. Remotes repeat each frame 4–20 times, and the firmware merges identical frames that arrive less than 300 ms apart. `frames` is how many it received.
- `signal.repeat` is the suggested transmit repeat count (the device default). It is not `frames`.
- `timings` is only sent when it was requested. It holds the edge durations of the first frame in µs: `[syncGap, high, low, high, low, ...]`. These values are best effort, because the decoder's buffer is shared with the interrupt handler.

### `tx_done`
`{"v":1,"type":"tx_done","id":"<transmit id>","ok":true,"durationMs":409,"repeat":10}`

On failure, `ok` is `false` and an `error{code,message,retryAfterMs?}` object is included.

### `stored_list`
`{"type":"stored_list","capacity":32,"count":1,"items":[{"slot":0,"name":"Lamp","signal":{...}}]}`

### `diagnostics`
This message includes:
- `uptimeMs`, `bootCount`, `resetReason`, `freeHeap`, `minFreeHeap` and `cpuMhz`
- `counters`: `rxFrames`, `rxSignals`, `rxNoise`, `txOk`, `txRejected`, `bleConnects`, `msgIn`, `msgOut`, `parseErrors`, `rxOverflow`, `notifyRetries`, `notifyFailures` and `duplicateRequests`
- `lastError`
- `log[{ms,msg}]`
- `ble{connected,subscribed,mtu}`
- `rf{rxReady,txReady,learning,dutyBudgetMs,dutyBudgetMaxMs}`
- `store{count,capacity}`

### `config`
`{"type":"config","config":{"rxPin":27,"txPin":26,"ledPin":2,"rxTolerance":60,"defaultRepeat":10,"rebootRequired":false,"allowedRxPins":[...],"allowedTxPins":[...]}}`

When a change is waiting for a reboot, `config` also contains `pending{rxPin,txPin,ledPin,rxTolerance}`.

## 6. Error codes

| code | Meaning |
|---|---|
| `bad_json` | The line is not valid JSON |
| `bad_request` | A field is missing or has the wrong type |
| `unknown_type` | The message type is not supported |
| `too_large` | The message is longer than 4096 bytes |
| `busy` | Bytes were dropped between the BLE task and the main loop. Resend. |
| `invalid_signal` | The signal is outside the limits in §3 |
| `unsupported_protocol` | The protocol is not 1..12 |
| `rate_limited` | Sending too fast (more than one transmission per 100 ms) or the 10 % duty-cycle budget is used up. See `retryAfterMs`. |
| `storage_full` | All 32 device slots are used |
| `not_found` | There is nothing in that slot |
| `invalid_config` | The pin is not in the allow-list, or RX and TX use the same pin |
| `hardware_error` | The RX or TX pin is not configured |
| `internal` | NVS write failure or a similar device fault |

App-side codes (never sent by the device): `timeout`, `disconnected`, `write_failed`.

## 7. Example session

```
→ {"v":1,"id":"a-1","type":"get_info"}
← {"v":1,"type":"device_info","id":"a-1",...}
→ {"v":1,"id":"a-2","type":"learn_start","timeoutMs":30000,"single":true}
← {"v":1,"type":"ack","id":"a-2","ok":true}
← {"v":1,"type":"learn_state","active":true,"requestId":"a-2","timeoutMs":30000,"single":true}
   (user presses the remote)
← {"v":1,"type":"signal_received","requestId":"a-2","signal":{...},"frames":6,...}
← {"v":1,"type":"learn_state","active":false,"reason":"captured","requestId":"a-2"}
→ {"v":1,"id":"a-3","type":"transmit","signal":{"protocol":1,"bitLength":24,"value":"5393","pulseLength":318,"repeat":10}}
← {"v":1,"type":"ack","id":"a-3","ok":true,"estimatedAirtimeMs":407}
← {"v":1,"type":"tx_done","id":"a-3","ok":true,"durationMs":405,"repeat":10}
```

## 8. Versioning

Additive changes, such as new optional fields or new message types, keep `v: 1`. Clients must ignore fields they do not know. A breaking change increments `v`. The device rejects requests with a different `v` and lists its version in `device_info.protocolVersion`.
