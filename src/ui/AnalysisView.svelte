<script lang="ts">
  import { onMount } from 'svelte';
  import { BAND_NAMES, F, SPECTRUM_BANDS, WAVEFORM_POINTS } from '../core/analysis/features';
  import { usePlayer } from './player-context';

  /**
   * Debug view of the audio analysis (AN-01…05), drawn at the audible moment. It shows what the
   * visuals will react to and lets you check A/V sync by eye: the kick lamp should flash with
   * the kick you hear.
   */

  const player = usePlayer();
  let canvas: HTMLCanvasElement;
  let active = $state(false);

  const LABELS: Record<(typeof BAND_NAMES)[number], string> = {
    sub: 'SUB',
    bass: 'BASS',
    lowMid: 'LOW MID',
    mid: 'MID',
    highMid: 'HIGH MID',
    treble: 'TREBLE',
  };

  onMount(() => {
    const context = canvas.getContext('2d')!;
    const frame = new Float32Array(F.size);
    let request = 0;

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.round(canvas.clientWidth * ratio);
      const height = Math.round(canvas.clientHeight * ratio);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const engine = player.engine;
      const hasFrame =
        engine.started && engine.timeline.sample(engine.audibleFrame(), frame) !== null;
      if (!hasFrame) frame.fill(0);
      active = frame[F.energy]! > 0.01;

      context.clearRect(0, 0, width, height);
      const pad = 24 * ratio;
      const font = `${11 * ratio}px ui-monospace, Menlo, monospace`;
      context.font = font;
      context.textBaseline = 'top';

      // Spectrum: 64 log-spaced bands across the lower half.
      const spectrumTop = height * 0.45;
      const spectrumHeight = height - spectrumTop - pad;
      const barWidth = (width - pad * 2) / SPECTRUM_BANDS;
      for (let b = 0; b < SPECTRUM_BANDS; b++) {
        const value = frame[F.spectrum + b]!;
        const barHeight = value * spectrumHeight;
        context.fillStyle = `hsl(${270 - (b / SPECTRUM_BANDS) * 90} 90% ${45 + value * 25}%)`;
        context.fillRect(
          pad + b * barWidth + 1,
          spectrumTop + spectrumHeight - barHeight,
          Math.max(1, barWidth - 2),
          barHeight,
        );
      }

      // Band meters.
      const meterWidth = 56 * ratio;
      const meterHeight = height * 0.3;
      for (let n = 0; n < BAND_NAMES.length; n++) {
        const x = pad + n * (meterWidth + 8 * ratio);
        const value = frame[F.bands + n]!;
        context.fillStyle = 'rgba(255,255,255,0.06)';
        context.fillRect(x, pad, meterWidth, meterHeight);
        context.fillStyle = `hsl(${190 + n * 16} 90% 60%)`;
        context.fillRect(x, pad + meterHeight * (1 - value), meterWidth, meterHeight * value);
        context.fillStyle = 'rgba(233,233,243,0.7)';
        context.fillText(LABELS[BAND_NAMES[n]!], x, pad + meterHeight + 6 * ratio);
      }

      // Onset lamps.
      const lamps: [string, number][] = [
        ['KICK', frame[F.kick]!],
        ['SNARE', frame[F.snare]!],
        ['HAT', frame[F.hat]!],
      ];
      const lampRadius = 18 * ratio;
      lamps.forEach(([label, value], i) => {
        const x = width - pad - lampRadius - (lamps.length - 1 - i) * (lampRadius * 2 + 22 * ratio);
        const y = pad + lampRadius;
        context.beginPath();
        context.arc(x, y, lampRadius, 0, Math.PI * 2);
        context.fillStyle = `rgba(179,112,255,${0.12 + value * 0.88})`;
        context.fill();
        context.fillStyle = 'rgba(233,233,243,0.7)';
        context.fillText(
          label,
          x - context.measureText(label).width / 2,
          y + lampRadius + 6 * ratio,
        );
      });

      // Oscilloscope.
      const scopeY = height * 0.32;
      const scopeLeft = pad + BAND_NAMES.length * (meterWidth + 8 * ratio) + 16 * ratio;
      const scopeRight = width - pad - 3 * (lampRadius * 2 + 22 * ratio);
      if (scopeRight > scopeLeft) {
        context.beginPath();
        for (let i = 0; i < WAVEFORM_POINTS; i++) {
          const x = scopeLeft + (i / (WAVEFORM_POINTS - 1)) * (scopeRight - scopeLeft);
          const y = scopeY - frame[F.waveform + i]! * height * 0.12;
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.strokeStyle = 'rgba(63,217,255,0.85)';
        context.lineWidth = 2 * ratio;
        context.stroke();
      }

      request = requestAnimationFrame(draw);
    };
    request = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(request);
  });
</script>

<canvas bind:this={canvas} data-testid="analysis-view" data-active={active}></canvas>

<style>
  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
</style>
