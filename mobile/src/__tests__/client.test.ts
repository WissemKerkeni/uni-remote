// End-to-end protocol tests: DeviceClient <-> MockTransport <-> MockDevice.
// This exercises the milestone-1 flow entirely in simulation.
import { DeviceClient, DeviceError } from '../services/DeviceClient';
import { MOCK_DEVICE_ID, MockTransport } from '../transport/MockTransport';
import type { DeviceMessage } from '../protocol/messages';

async function setup(opts: ConstructorParameters<typeof MockTransport>[0] = { latencyMs: 0, chunkSize: 20 }) {
  const transport = new MockTransport(opts);
  const client = new DeviceClient(transport);
  await transport.connect(MOCK_DEVICE_ID);
  return { transport, client };
}

function nextEvent<K extends DeviceMessage["type"], T extends DeviceMessage = Extract<DeviceMessage, { type: K }>>(client: DeviceClient, type: K): Promise<T> {
  return new Promise((resolve) => {
    const off = client.onMessage((m) => {
      if (m.type === type) {
        off();
        resolve(m as T);
      }
    });
  });
}

describe('DeviceClient + simulator', () => {
  it('milestone 1: info -> learn -> receive -> transmit -> confirmation', async () => {
    const { transport, client } = await setup();

    const info = await client.getInfo();
    expect(info.type).toBe('device_info');
    expect(info.protocolVersion).toBe(1);
    expect(info.capabilities.rollingCode).toBe(false);

    const learnStarted = nextEvent(client, 'learn_state');
    const ack = await client.startLearning({ timeoutMs: 5000, single: true, includeTimings: true });
    expect(ack.type).toBe('ack');
    expect((await learnStarted).active).toBe(true);

    const received = nextEvent(client, 'signal_received');
    const ended = nextEvent(client, 'learn_state');
    transport.simulator!.simulateButtonPress({ protocol: 1, bitLength: 24, value: '5393', pulseLength: 320, repeat: 10 });
    const sig = await received;
    expect(sig.signal).toMatchObject({ protocol: 1, bitLength: 24, value: '5393' });
    expect(sig.decoded.hex).toBe('0x001511');
    expect(sig.timings!.length).toBe(1 + 2 * 24);
    expect(sig.frequencySource).toBe('nominal');
    expect((await ended).reason).toBe('captured');

    const { ack: txAck, done } = await client.transmit({ ...sig.signal, repeat: 2 });
    expect(txAck.estimatedAirtimeMs).toBeGreaterThan(0);
    expect(done.ok).toBe(true);
    expect(done.repeat).toBe(2);
  });

  it('rx_probe reports raw receiver activity with a verdict', async () => {
    const { client } = await setup();
    const r = await client.probeReceiver(500);
    expect(r.type).toBe('rx_probe_result');
    expect(r.durationMs).toBe(500);
    expect(r.edges).toBeGreaterThan(0);
    expect(['active', 'quiet', 'no_activity', 'stuck_high']).toContain(r.verdict);
  });

  it('loopback_test returns sent/got codes and a match flag', async () => {
    const { client } = await setup();
    const r = await client.loopbackTest();
    expect(r.type).toBe('loopback_result');
    expect(r.match).toBe(true);
    expect(r.got?.value).toBe(r.sent.value);
  });

  it('maps device errors to DeviceError with the firmware code', async () => {
    const { client } = await setup();
    await expect(client.transmit({ protocol: 99, bitLength: 24, value: '1' })).rejects.toMatchObject({
      code: 'invalid_signal',
    });
  });

  it('enforces the duty-cycle limiter', async () => {
    const { client } = await setup();
    // 20 repeats of a 24-bit protocol-1 code at 350 us ~= 896 ms; budget is 6000 ms.
    const sig = { protocol: 1, bitLength: 24, value: '1', pulseLength: 350, repeat: 20 };
    let rejected: DeviceError | null = null;
    for (let i = 0; i < 10 && !rejected; i++) {
      try {
        await client.transmit(sig);
        await new Promise((r) => setTimeout(r, 110));
      } catch (e) {
        rejected = e as DeviceError;
      }
    }
    expect(rejected?.code).toBe('rate_limited');
    expect(rejected?.retryAfterMs).toBeGreaterThan(0);
  }, 20000);

  it('retries after a lost response using the same id (no double execution)', async () => {
    const { client, transport } = await setup({ latencyMs: 0, chunkSize: 20, dropFirstResponseOf: 'ack' });
    const p = client.request({ type: 'store_signal', name: 'Lamp', signal: { protocol: 1, bitLength: 24, value: '7' } }, { timeoutMs: 200, retries: 1 });
    const ack = await p;
    expect(ack.slot).toBe(0);
    expect(client.stats.retries).toBe(1);
    const list = await client.listStored();
    expect(list.count).toBe(1); // stored once, not twice
    expect(transport.simulator).not.toBeNull();
  });

  it('does not treat a reused id with a different type as a duplicate (restarted client)', async () => {
    const { client, transport } = await setup();
    const dev = transport.simulator!;
    // Simulate a previous client session that used id "x-1" for learn_start.
    const lines: string[] = [];
    const off = client.onMessage((m) => lines.push(m.type));
    const send = (o: object) => dev.receive(new TextEncoder().encode(JSON.stringify(o) + '\n'));
    send({ v: 1, id: 'x-1', type: 'learn_start', timeoutMs: 5000 });
    await new Promise((r) => setTimeout(r, 20));
    send({ v: 1, id: 'x-1', type: 'get_diagnostics' });
    await new Promise((r) => setTimeout(r, 20));
    off();
    expect(lines).toContain('diagnostics');
    expect(lines.filter((t) => t === 'ack')).toHaveLength(1);
  });

  it('times out when the device never answers', async () => {
    const { client, transport } = await setup();
    // Make the simulator deaf.
    (transport.simulator as any).receive = () => undefined;
    await expect(client.ping()).rejects.toMatchObject({ code: 'timeout' });
  }, 10000);

  it('rejects pending requests on link loss', async () => {
    const { client, transport } = await setup({ latencyMs: 200, chunkSize: 20 });
    const p = client.getDiagnostics();
    transport.simulateLinkLoss();
    await expect(p).rejects.toMatchObject({ code: 'disconnected' });
  });

  it('validates set_config pins on the device side', async () => {
    const { client } = await setup();
    await expect(client.setConfig({ txPin: 34 })).rejects.toMatchObject({ code: 'invalid_config' });
    const cfg = await client.setConfig({ rxPin: 14 });
    expect(cfg.config.rebootRequired).toBe(true);
    expect(cfg.config.pending?.rxPin).toBe(14);
  });

  it('learn_stop ends the session with reason "stopped"', async () => {
    const { client } = await setup();
    await client.startLearning({ timeoutMs: 5000, single: false, includeTimings: false });
    const ended = nextEvent(client, 'learn_state');
    // skip the "active: true" event if it comes first
    const stopAck = await client.stopLearning();
    expect(stopAck.wasLearning).toBe(true);
    let ev = await ended;
    if (ev.type === 'learn_state' && ev.active) ev = await nextEvent(client, 'learn_state');
    expect(ev).toMatchObject({ active: false, reason: 'stopped' });
  });
});
