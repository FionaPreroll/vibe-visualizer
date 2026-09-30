import { Decoder } from './decoder';
import { lightKey, Lights } from './lights';
import type { ControlEvent, ControllerProfile, LightState, LightTarget } from './types';

export interface ConnectedController {
  /** The id of its MIDI input port. */
  id: string;
  /** The port's name, as the browser reports it. */
  name: string;
  /** Its profile, or null for a device the library does not know. */
  profile: ControllerProfile | null;
  /** Whether its lights can be set (the browser also reports its output port). */
  lights: boolean;
}

/** A MIDI message as it arrived, for a MIDI monitor. */
export interface MidiMessage {
  device: ConnectedController;
  data: Uint8Array;
  time: number;
}

export interface ControllerHubOptions {
  profiles: readonly ControllerProfile[];
  /** How to get MIDI access: navigator.requestMIDIAccess unless given (tests, other sources). */
  requestAccess?: (options: MIDIOptions) => Promise<MIDIAccess>;
}

interface Connection {
  device: ConnectedController;
  input: MIDIInput;
  output: MIDIOutput | null;
  decoder: Decoder | null;
  lights: Lights | null;
}

/**
 * DJ controllers through Web MIDI: finds them among the MIDI devices (also when they are
 * plugged in later), turns what they send into control events, and sets their lights.
 * Web MIDI exists on the main thread only, so the hub lives there.
 */
export class ControllerHub {
  private access: MIDIAccess | null = null;
  private readonly connections = new Map<string, Connection>();
  private readonly controlListeners = new Set<(event: ControlEvent) => void>();
  private readonly messageListeners = new Set<(message: MidiMessage) => void>();
  private readonly deviceListeners = new Set<(devices: readonly ConnectedController[]) => void>();
  /** The lights as the app wants them, for controllers that connect later. */
  private readonly lightStates = new Map<string, { target: LightTarget; state: LightState }>();

  constructor(private readonly options: ControllerHubOptions) {}

  /** Whether this browser has Web MIDI (Safari has not). */
  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  get started(): boolean {
    return this.access !== null;
  }

  get devices(): readonly ConnectedController[] {
    return [...this.connections.values()].map((connection) => connection.device);
  }

  /** Asks for MIDI access (the browser asks the user the first time) and listens to it. */
  async start(): Promise<void> {
    if (this.access) return;
    const request =
      this.options.requestAccess ?? ((options) => navigator.requestMIDIAccess(options));
    const access = await request({ sysex: false });
    if (this.access) return;
    this.access = access;
    access.onstatechange = (event) => this.onStateChange(event);
    for (const input of access.inputs.values()) this.connect(input);
    this.emitDevices();
  }

  /** Turns the controllers' lights off and stops listening. */
  stop(): void {
    if (!this.access) return;
    this.access.onstatechange = null;
    for (const id of [...this.connections.keys()]) this.disconnect(id, true);
    this.access = null;
    this.emitDevices();
  }

  onControl(listener: (event: ControlEvent) => void): () => void {
    this.controlListeners.add(listener);
    return () => this.controlListeners.delete(listener);
  }

  onMessage(listener: (message: MidiMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  /** Called at once with the devices, and again whenever they change. */
  onDevices(listener: (devices: readonly ConnectedController[]) => void): () => void {
    this.deviceListeners.add(listener);
    listener(this.devices);
    return () => this.deviceListeners.delete(listener);
  }

  /** Sets a light on every connected controller that has it, and on those that connect later. */
  setLight(target: LightTarget, state: LightState): void {
    this.lightStates.set(lightKey(target), { target, state });
    for (const connection of this.connections.values()) connection.lights?.set(target, state);
  }

  private onStateChange(event: MIDIConnectionEvent): void {
    const port = event.port;
    if (!port) return;
    if (port.type === 'output') {
      // An output can show up after its input.
      if (port.state === 'connected') {
        for (const connection of this.connections.values()) this.attachOutput(connection);
        this.emitDevices();
      }
      return;
    }
    if (port.state === 'connected' && !this.connections.has(port.id)) {
      this.connect(port as MIDIInput);
      this.emitDevices();
    } else if (port.state === 'disconnected' && this.connections.has(port.id)) {
      this.disconnect(port.id, false);
      this.emitDevices();
    }
  }

  private connect(input: MIDIInput): void {
    if (this.connections.has(input.id) || input.state === 'disconnected') return;
    const name = input.name ?? 'MIDI device';
    const profile =
      this.options.profiles.find((candidate) => matches(name, candidate.ports.input)) ?? null;
    const connection: Connection = {
      device: { id: input.id, name, profile, lights: false },
      input,
      output: null,
      decoder: profile ? new Decoder(profile) : null,
      lights: null,
    };
    this.connections.set(input.id, connection);
    this.attachOutput(connection);
    input.onmidimessage = (event) => this.onMidiMessage(connection, event);
  }

  private attachOutput(connection: Connection): void {
    const profile = connection.device.profile;
    if (!profile || connection.output || !this.access) return;
    // The output of the same name as the input, else one that fits the profile, but never one
    // that another controller of the same model has already.
    const taken = new Set([...this.connections.values()].map((other) => other.output));
    const free = [...this.access.outputs.values()].filter(
      (port) => port.state !== 'disconnected' && !taken.has(port),
    );
    const wanted = profile.ports.output ?? profile.ports.input;
    const output =
      free.find((port) => port.name === connection.device.name) ??
      free.find((port) => matches(port.name ?? '', wanted));
    if (!output) return;
    const send = (message: readonly number[]) => {
      try {
        output.send([...message]);
      } catch {
        // Unplugged in the meantime: its state change follows.
      }
    };
    connection.output = output;
    connection.lights = new Lights(profile, send);
    connection.device = { ...connection.device, lights: true };
    for (const message of profile.onConnect ?? []) send(message);
    connection.lights.clear();
    for (const { target, state } of this.lightStates.values()) {
      connection.lights.set(target, state);
    }
  }

  private disconnect(id: string, letGo: boolean): void {
    const connection = this.connections.get(id);
    if (!connection) return;
    connection.input.onmidimessage = null;
    if (letGo && connection.output && connection.lights) {
      connection.lights.clear();
      for (const message of connection.device.profile?.onDisconnect ?? []) {
        try {
          connection.output.send([...message]);
        } catch {
          // Gone already.
        }
      }
    }
    connection.lights?.dispose();
    this.connections.delete(id);
  }

  private onMidiMessage(connection: Connection, event: MIDIMessageEvent): void {
    const data = event.data;
    if (!data) return;
    const time = event.timeStamp;
    for (const listener of this.messageListeners) {
      listener({ device: connection.device, data, time });
    }
    const control = connection.decoder?.decode(data, time);
    if (!control) return;
    for (const listener of this.controlListeners) listener(control);
  }

  private emitDevices(): void {
    const devices = this.devices;
    for (const listener of this.deviceListeners) listener(devices);
  }
}

function matches(name: string, wanted: string): boolean {
  return name.toLowerCase().includes(wanted.toLowerCase());
}
