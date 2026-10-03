import type { CapabilityReport } from './capabilities';

const yesNo = (value: boolean) => (value ? 'yes' : 'no');

/** The rows of the system check: what this browser offers the app, and how it is used. */
export function capabilityRows(report: CapabilityReport): { label: string; value: string }[] {
  const megabytes = (bytes: number | null) =>
    bytes === null ? '?' : `${Math.round(bytes / 2 ** 20).toLocaleString('en')} MB`;
  const encoders = [...report.videoEncoders, ...report.audioEncoders];
  return [
    { label: 'Browser', value: report.userAgent },
    {
      label: 'Computer',
      value: `${report.platform}, ${report.cpuThreads} threads, ${report.deviceMemoryGb ?? '?'} GB of memory (as the browser says)`,
    },
    {
      label: 'Graphics',
      value: report.webgl2.supported
        ? `WebGL 2 on ${report.webgl2.renderer}; float render targets: ${yesNo(report.webgl2.colorBufferFloat)}`
        : 'no WebGL 2',
    },
    {
      label: 'Engine',
      value: `SharedArrayBuffer: ${yesNo(report.crossOriginIsolated && report.sharedArrayBuffer)}, AudioWorklet: ${yesNo(report.audioWorklet)}, OffscreenCanvas: ${yesNo(report.offscreenCanvas)}`,
    },
    ...encoders.map((encoder) => ({
      label: encoder.label,
      value: encoder.supported
        ? encoder.hardware === null
          ? 'yes'
          : `yes, ${encoder.hardware ? 'hardware' : 'software'}`
        : 'no',
    })),
    {
      label: 'Storage',
      value: `${megabytes(report.storageUsageBytes)} used of ${megabytes(report.storageQuotaBytes)}; videos written straight to a file: ${yesNo(report.fileSystemAccess)}`,
    },
  ];
}

/** The system check as text, for a bug report. */
export function capabilityText(report: CapabilityReport, appName: string): string {
  const rows = capabilityRows(report).map((row) => `- ${row.label}: ${row.value}`);
  return [`${appName}: system check, ${new Date().toISOString()}`, '', ...rows].join('\n');
}
