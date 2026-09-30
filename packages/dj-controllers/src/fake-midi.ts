/** A Web MIDI stand-in for tests: ports that can be plugged in, receive and record messages. */

class FakePort {
  onstatechange: ((event: Event) => void) | null = null;
  state: MIDIPortDeviceState = 'connected';

  constructor(
    readonly id: string,
    readonly name: string,
    readonly type: MIDIPortType,
  ) {}
}

export class FakeInput extends FakePort {
  onmidimessage: ((event: MIDIMessageEvent) => void) | null = null;

  constructor(id: string, name: string) {
    super(id, name, 'input');
  }

  /** A message from the device. */
  receive(data: readonly number[], timeStamp = 0): void {
    this.onmidimessage?.({ data: new Uint8Array(data), timeStamp } as unknown as MIDIMessageEvent);
  }
}

export class FakeOutput extends FakePort {
  readonly sent: number[][] = [];

  constructor(id: string, name: string) {
    super(id, name, 'output');
  }

  send(data: readonly number[]): void {
    this.sent.push([...data]);
  }
}

export class FakeAccess {
  readonly inputs = new Map<string, FakeInput>();
  readonly outputs = new Map<string, FakeOutput>();
  onstatechange: ((event: MIDIConnectionEvent) => void) | null = null;
  readonly sysexEnabled = false;

  /** A device with an input and an output port of the same name. */
  device(name: string): { input: FakeInput; output: FakeOutput } {
    const input = new FakeInput(`${name}-in`, name);
    const output = new FakeOutput(`${name}-out`, name);
    this.inputs.set(input.id, input);
    this.outputs.set(output.id, output);
    return { input, output };
  }

  plug(port: FakeInput | FakeOutput): void {
    port.state = 'connected';
    (port.type === 'input' ? this.inputs : this.outputs).set(port.id, port as never);
    this.onstatechange?.({ port } as unknown as MIDIConnectionEvent);
  }

  unplug(port: FakeInput | FakeOutput): void {
    port.state = 'disconnected';
    (port.type === 'input' ? this.inputs : this.outputs).delete(port.id);
    this.onstatechange?.({ port } as unknown as MIDIConnectionEvent);
  }

  /** As navigator.requestMIDIAccess would give it. */
  request = (): Promise<MIDIAccess> => Promise.resolve(this as unknown as MIDIAccess);
}
