#!/usr/bin/env python3
"""UniRemote PC test client.

Talks the UniRemote JSON protocol (docs/BLE_PROTOCOL.md) to the ESP32 over
USB serial (pyserial) or Bluetooth LE (bleak). Lets you bring up and test the
hardware without the phone app.

    pip install pyserial bleak

Examples:
    python uniremote_cli.py --serial COM5 info
    python uniremote_cli.py --serial COM5 probe     # is the receiver alive? (wiring / 3.3 V check)
    python uniremote_cli.py --serial /dev/ttyUSB0 learn --timeout 20
    python uniremote_cli.py --ble info              # first UniRemote found
    python uniremote_cli.py --serial COM5 tx --protocol 1 --bits 24 --value 5393 --pulse 320
    python uniremote_cli.py --serial COM5 selftest  # milestone-1 flow, interactive
"""
from __future__ import annotations

import argparse
import asyncio
import itertools
import json
import secrets
import sys
import time

SERVICE_UUID = "6e7a0001-3c1b-4b8e-9d2f-5a4c1e0b7f30"
RX_UUID = "6e7a0002-3c1b-4b8e-9d2f-5a4c1e0b7f30"  # write (app -> device)
TX_UUID = "6e7a0003-3c1b-4b8e-9d2f-5a4c1e0b7f30"  # notify (device -> app)


class Link:
    """Async line-based link. Subclasses feed bytes into self._feed()."""

    def __init__(self) -> None:
        self._buf = bytearray()
        self.queue: asyncio.Queue[dict] = asyncio.Queue()
        self.verbose = False

    def _feed(self, data: bytes) -> None:
        self._buf.extend(data)
        while b"\n" in self._buf:
            line, _, rest = self._buf.partition(b"\n")
            self._buf = bytearray(rest)
            text = line.decode("utf-8", "replace").strip()
            if not text:
                continue
            if text.startswith("# "):  # firmware log line (serial only)
                if self.verbose:
                    print(f"  \033[2m{text}\033[0m")
                continue
            try:
                self.queue.put_nowait(json.loads(text))
            except json.JSONDecodeError:
                print(f"  ! non-JSON line: {text[:120]}")

    async def write(self, data: bytes) -> None:  # pragma: no cover - abstract
        raise NotImplementedError

    async def close(self) -> None:
        pass


class SerialLink(Link):
    def __init__(self, port: str) -> None:
        super().__init__()
        import serial  # type: ignore

        self.ser = serial.Serial(port, 115200, timeout=0)
        self._task = asyncio.get_event_loop().create_task(self._reader())

    async def _reader(self) -> None:
        while True:
            data = self.ser.read(4096)
            if data:
                self._feed(data)
            await asyncio.sleep(0.01)

    async def write(self, data: bytes) -> None:
        self.ser.write(data)

    async def close(self) -> None:
        self._task.cancel()
        self.ser.close()


class BleLink(Link):
    def __init__(self) -> None:
        super().__init__()
        self.client = None
        self.chunk = 20

    async def open(self, address: str | None) -> None:
        from bleak import BleakClient, BleakScanner  # type: ignore

        if not address:
            print("Scanning for UniRemote devices...")
            dev = await BleakScanner.find_device_by_filter(
                lambda d, ad: SERVICE_UUID in [u.lower() for u in ad.service_uuids]
                or (d.name or "").startswith("UniRemote"),
                timeout=10,
            )
            if not dev:
                sys.exit("No UniRemote device found.")
            address = dev.address
            print(f"Found {dev.name} [{address}]")
        self.client = BleakClient(address)
        await self.client.connect()
        self.chunk = max(20, self.client.mtu_size - 3)
        await self.client.start_notify(TX_UUID, lambda _h, d: self._feed(bytes(d)))
        print(f"Connected, MTU {self.client.mtu_size}")

    async def write(self, data: bytes) -> None:
        for i in range(0, len(data), self.chunk):
            await self.client.write_gatt_char(RX_UUID, data[i : i + self.chunk], response=True)

    async def close(self) -> None:
        if self.client:
            await self.client.disconnect()


class Client:
    _ids = itertools.count(1)
    _session = secrets.token_hex(2)  # unique per run: device de-duplicates by id

    def __init__(self, link: Link) -> None:
        self.link = link

    async def send(self, type_: str, **body) -> str:
        rid = f"cli{self._session}-{next(self._ids)}"
        msg = {"v": 1, "id": rid, "type": type_, **{k: v for k, v in body.items() if v is not None}}
        await self.link.write((json.dumps(msg, separators=(",", ":")) + "\n").encode())
        return rid

    async def wait(self, pred, timeout: float) -> dict:
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                raise TimeoutError("no matching message")
            msg = await asyncio.wait_for(self.link.queue.get(), left)
            if pred(msg):
                return msg
            show(msg, prefix="  (event) ")

    async def request(self, type_: str, timeout: float = 4, **body) -> dict:
        rid = await self.send(type_, **body)
        msg = await self.wait(lambda m: m.get("id") == rid and m.get("type") != "tx_done", timeout)
        if msg["type"] == "error":
            raise RuntimeError(f"{msg['code']}: {msg['message']}")
        return msg


def show(msg: dict, prefix: str = "") -> None:
    print(prefix + json.dumps(msg, indent=2 if not prefix else None))


async def cmd_learn(c: Client, args) -> dict | None:
    await c.request("learn_start", timeoutMs=args.timeout * 1000, single=not args.multi, includeTimings=args.timings)
    print(f"Listening for {args.timeout}s - press a button on your remote...")
    got = None
    while True:
        m = await c.wait(lambda m: m["type"] in ("signal_received", "learn_state"), args.timeout + 5)
        if m["type"] == "signal_received":
            s, d = m["signal"], m["decoded"]
            print(
                f"\n  protocol {s['protocol']} ({s['protocolName']}), {s['bitLength']} bits, value {s['value']} "
                f"{d['hex']}\n  binary {d['binary']}  tri-state {d.get('triState', '-')}\n"
                f"  pulse {s['pulseLength']} us, {m['frames']} frames in {m['durationMs']} ms, "
                f"{m['frequencyMHz']} MHz ({m['frequencySource']})"
            )
            got = m
        elif not m["active"]:
            print(f"Learning ended: {m.get('reason')}")
            return got


async def cmd_tx(c: Client, signal: dict) -> None:
    rid = await c.send("transmit", signal=signal)
    ack = await c.wait(lambda m: m.get("id") == rid and m["type"] in ("ack", "error"), 4)
    if ack["type"] == "error":
        raise RuntimeError(f"{ack['code']}: {ack['message']}")
    print(f"Accepted, estimated airtime {ack.get('estimatedAirtimeMs')} ms")
    done = await c.wait(lambda m: m.get("id") == rid and m["type"] == "tx_done", ack.get("estimatedAirtimeMs", 0) / 1000 + 5)
    print("Transmission completed" if done["ok"] else f"Transmission failed: {done.get('error')}", f"({done['durationMs']} ms)")


async def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--serial", metavar="PORT")
    g.add_argument("--ble", nargs="?", const="", metavar="ADDRESS")
    ap.add_argument("-v", "--verbose", action="store_true", help="show firmware log lines (serial)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("info")
    sub.add_parser("ping")
    sub.add_parser("diag")
    pp = sub.add_parser("probe", help="watch the RX pin for raw activity (receiver power/wiring check)")
    pp.add_argument("--ms", type=int, default=500)
    sub.add_parser("loopback", help="self-test: send a test code on our TX and decode it on our RX")
    sub.add_parser("config")
    sub.add_parser("list")
    sp = sub.add_parser("setpins")
    sp.add_argument("--rx", type=int)
    sp.add_argument("--tx", type=int)
    sub.add_parser("reboot")
    lp = sub.add_parser("learn")
    lp.add_argument("--timeout", type=int, default=30)
    lp.add_argument("--multi", action="store_true", help="keep listening after the first signal")
    lp.add_argument("--timings", action="store_true")
    tp = sub.add_parser("tx")
    tp.add_argument("--protocol", type=int, default=1)
    tp.add_argument("--bits", type=int, required=True)
    tp.add_argument("--value", required=True, help="decimal")
    tp.add_argument("--pulse", type=int, default=0)
    tp.add_argument("--repeat", type=int)
    sub.add_parser("selftest", help="interactive milestone-1 test: info, learn, store, transmit")
    args = ap.parse_args()

    if args.serial:
        link: Link = SerialLink(args.serial)
        await asyncio.sleep(0.3)
    else:
        link = BleLink()
        await link.open(args.ble or None)
    link.verbose = args.verbose
    c = Client(link)
    try:
        if args.cmd == "info":
            show(await c.request("get_info"))
        elif args.cmd == "ping":
            for i in range(5):
                t0 = time.monotonic()
                await c.request("ping", echo=i)
                print(f"pong {i}: {(time.monotonic() - t0) * 1000:.0f} ms")
        elif args.cmd == "probe":
            r = await c.request("rx_probe", timeout=args.ms / 1000 + 4, durationMs=args.ms)
            hints = {
                "active": "receiver output is toggling - OK, go ahead and learn",
                "quiet": "receiver connected, low background noise (typical for XY-MK-5V on 3.3 V) - run `loopback` to confirm decoding",
                "no_activity": "pin stays LOW - check VCC/GND/DATA; an XY-MK-5V may not work at 3.3 V",
                "floating": "nothing drives the pin - receiver DATA not connected to this GPIO (or no common GND)",
                "stuck_high": "pin stuck HIGH - check that DATA is not wired to VCC",
            }
            print(f"GPIO{r['rxPin']}: {r['edges']} edges in {r['durationMs']} ms ({r['edgesPerSecond']}/s), "
                  f"HIGH {r['highRatio'] * 100:.0f}% -> {r['verdict']}")
            print("  " + hints.get(r["verdict"], ""))
        elif args.cmd == "loopback":
            r = await c.request("loopback_test", timeout=8)
            sent = r["sent"]
            print(f"sent  P{sent['protocol']} {sent['bitLength']}-bit value {sent['value']} (x{sent['repeat']} frames)")
            if r.get("got"):
                g = r["got"]
                print(f"got   P{g['protocol']} {g['bitLength']}-bit value {g['value']} pulse {g['pulseLength']} us")
            print(f"frames decoded: {r['framesDecoded']}")
            if r["match"]:
                print("PASS - transmitter and receiver both work")
            elif r["received"]:
                print("PARTIAL - something decoded, but not the code we sent (interference or timing)")
            else:
                print("FAIL - nothing decoded: check TX wiring (VIN/GND/D26), antennas, and the receiver (see probe)")
        elif args.cmd == "diag":
            show(await c.request("get_diagnostics", logLines=40))
        elif args.cmd == "config":
            show(await c.request("get_config"))
        elif args.cmd == "setpins":
            cfg = {k: v for k, v in (("rxPin", args.rx), ("txPin", args.tx)) if v is not None}
            show(await c.request("set_config", config=cfg))
            print("Run 'reboot' to apply.")
        elif args.cmd == "list":
            show(await c.request("list_stored"))
        elif args.cmd == "reboot":
            show(await c.request("reboot"))
        elif args.cmd == "learn":
            await cmd_learn(c, args)
        elif args.cmd == "tx":
            await cmd_tx(c, {"protocol": args.protocol, "bitLength": args.bits, "value": args.value, "pulseLength": args.pulse, "repeat": args.repeat})
        elif args.cmd == "selftest":
            info = await c.request("get_info")
            pr = await c.request("rx_probe", timeout=5, durationMs=500)
            print(f"[0] Receiver probe: {pr['verdict']} ({pr['edgesPerSecond']} edges/s)")
            print(f"[1] Device OK: {info['name']} fw {info['firmwareVersion']} on {info['chipModel']}, "
                  f"RX GPIO{info['radio']['rxPin']} ready={info['radio']['rxReady']}, TX GPIO{info['radio']['txPin']} ready={info['radio']['txReady']}")
            args.timeout, args.multi, args.timings = 30, False, True
            m = await cmd_learn(c, args)
            if not m:
                sys.exit("[2] FAILED: no signal received (check receiver wiring, antenna, distance, remote type)")
            print("[2] Signal received")
            ack = await c.request("store_signal", name="selftest", signal=m["signal"])
            print(f"[3] Stored on device in slot {ack['slot']}")
            input("[4] Put the target device (e.g. RF socket) in range and press Enter to transmit...")
            await cmd_tx(c, m["signal"])
            print("[5] Done. Did the target device react? (only a person can verify this step)")
    finally:
        await link.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (RuntimeError, TimeoutError) as e:
        sys.exit(f"Error: {e}")
