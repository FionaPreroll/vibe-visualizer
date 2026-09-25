import { lab, SPIKES } from './report.svelte';

const yesNo = (value: boolean) => (value ? 'yes' : 'no');

export function buildMarkdownReport(): string {
  const lines: string[] = ['# Vibe Visualizer: Spike Lab report', ''];
  lines.push(`Date: ${new Date().toISOString()}`, '');
  const env = lab.env;
  if (env) {
    lines.push('## Environment', '');
    lines.push(`- Browser: ${env.userAgent}`);
    lines.push(
      `- Platform: ${env.platform}, ${env.cpuThreads} threads, ${env.deviceMemoryGb ?? '?'} GB RAM (reported)`,
    );
    lines.push(
      `- Cross-origin isolated: ${yesNo(env.crossOriginIsolated)}, SharedArrayBuffer: ${yesNo(env.sharedArrayBuffer)}`,
    );
    lines.push(
      `- WebGL2: ${yesNo(env.webgl2.supported)} (${env.webgl2.renderer}), float render targets: ${yesNo(env.webgl2.colorBufferFloat)}, max texture ${env.webgl2.maxTextureSize}`,
    );
    lines.push(
      `- WebGPU: ${yesNo(env.webgpu)}, OffscreenCanvas: ${yesNo(env.offscreenCanvas)}, AudioWorklet: ${yesNo(env.audioWorklet)}`,
    );
    lines.push(
      `- File System Access: ${yesNo(env.fileSystemAccess)}, OPFS: ${yesNo(env.opfs)}, wake lock: ${yesNo(env.wakeLock)}`,
    );
    lines.push('', '| Encoder | Supported | Hardware |', '|---|---|---|');
    for (const e of [...env.videoEncoders, ...env.audioEncoders]) {
      const hw = e.hardware === null ? '?' : yesNo(e.hardware);
      lines.push(`| ${e.label} | ${yesNo(e.supported)} | ${hw} |`);
    }
    lines.push('');
  }
  for (const { id, title } of SPIKES) {
    const result = lab.results[id];
    lines.push(`## ${id} ${title}: ${result.status}`, '');
    if (result.error) lines.push(`Error: ${result.error}`, '');
    if (result.checks.length > 0) {
      lines.push('| Check | Result | Detail |', '|---|---|---|');
      for (const c of result.checks) lines.push(`| ${c.label} | ${c.state} | ${c.detail} |`);
      lines.push('');
    }
    for (const [name, value] of Object.entries(result.metrics)) lines.push(`- ${name}: ${value}`);
    lines.push('');
  }
  return lines.join('\n');
}
