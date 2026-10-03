import { describe, expect, it } from 'vitest';
import type { CapabilityReport } from './capabilities';
import { capabilityRows, capabilityText } from './capability-report';

const REPORT: CapabilityReport = {
  userAgent: 'Mozilla/5.0 Test',
  platform: 'macOS',
  cpuThreads: 8,
  deviceMemoryGb: 16,
  crossOriginIsolated: true,
  sharedArrayBuffer: true,
  audioWorklet: true,
  offscreenCanvas: true,
  webgpu: true,
  webgl2: {
    supported: true,
    renderer: 'Apple M3',
    maxTextureSize: 16384,
    colorBufferFloat: true,
    floatLinearFiltering: true,
  },
  webCodecs: true,
  videoEncoders: [
    { label: 'H.264 1080p60 (YouTube)', codec: 'avc1.64002A', supported: true, hardware: true },
    { label: 'AV1 1080p60', codec: 'av01.0.09M.08', supported: false, hardware: null },
  ],
  audioEncoders: [
    { label: 'AAC-LC 48 kHz stereo', codec: 'mp4a.40.2', supported: true, hardware: null },
  ],
  fileSystemAccess: true,
  opfs: true,
  storageQuotaBytes: 2 ** 34,
  storageUsageBytes: 300 * 2 ** 20,
  wakeLock: true,
  measureMemory: true,
};

describe('system check', () => {
  it('says what the browser offers the app', () => {
    const rows = Object.fromEntries(capabilityRows(REPORT).map((row) => [row.label, row.value]));
    expect(rows['Graphics']).toBe('WebGL 2 on Apple M3; float render targets: yes');
    expect(rows['Engine']).toBe('SharedArrayBuffer: yes, AudioWorklet: yes, OffscreenCanvas: yes');
    expect(rows['H.264 1080p60 (YouTube)']).toBe('yes, hardware');
    expect(rows['AV1 1080p60']).toBe('no');
    expect(rows['AAC-LC 48 kHz stereo']).toBe('yes');
    expect(rows['Storage']).toBe(
      '300 MB used of 16,384 MB; videos written straight to a file: yes',
    );
  });

  it('needs cross-origin isolation for SharedArrayBuffer', () => {
    const rows = capabilityRows({ ...REPORT, crossOriginIsolated: false });
    expect(rows.find((row) => row.label === 'Engine')!.value).toMatch(/^SharedArrayBuffer: no/);
  });

  it('is text for a bug report', () => {
    const text = capabilityText(REPORT, 'FibeStation');
    expect(text).toMatch(/^FibeStation: system check, \d{4}-\d\d-\d\dT/);
    expect(text).toContain('\n- Browser: Mozilla/5.0 Test\n');
  });
});
