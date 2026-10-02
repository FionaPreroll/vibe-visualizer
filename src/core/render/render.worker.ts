import { FeatureSampler, FeatureTimelineReader } from '../analysis/feature-timeline';
import { F } from '../analysis/features';
import { DEFAULT_KALEIDO } from './kaleido-settings';
import { KaleidoscopeScene } from './kaleidoscope';
import { LogoSpectrumScene } from './logo-spectrum';
import { PresetAutomation, SWITCHING_SEEDS } from './preset-automation';
import type { RenderEvent, RenderRequest, SceneKind } from './render-protocol';
import type { Scene, SceneInput } from './scene';
import { morphKaleido, morphLogoSpectrum } from './settings-morph';
import { DEFAULT_LOGO_SPECTRUM } from './visual-settings';

/**
 * Draws the visuals on an OffscreenCanvas, off the main thread (TECH-STACK: renderer). Each
 * frame it looks up the analysis frame for the moment you hear, from the shared feature
 * timeline and the audio clock sent by the main thread.
 */

/** The parts of the dedicated worker scope used here (the project compiles with the DOM lib). */
const scope = self as unknown as {
  postMessage(message: RenderEvent): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<RenderRequest>) => void): void;
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  close(): void;
};

let canvas: OffscreenCanvas | null = null;
let gl: WebGL2RenderingContext | null = null;
let logoSpectrum: LogoSpectrumScene | null = null;
let kaleidoscope: KaleidoscopeScene | null = null;
let active: SceneKind = 'logoSpectrum';
let scene: Scene | null = null;
let reader: FeatureTimelineReader | null = null;
let sampler: FeatureSampler | null = null;
let sampleRate = 48000;
let clock: { contextTime: number; performanceTime: number; live: boolean } | null = null;
let running = false;
let request = 0;
let lastTime = -1;
let startTime = -1;
let frames = 0;
let statsStart = 0;
let statsFrames = 0;
let lost = false;
let reduceFlashing = false;
/** The Kaleidoscope look last given to it as the Logo Spectrum's layer (VE-08). */
let layerLook: unknown = null;
const features = new Float32Array(F.size);
/** Settings of each mode, with the automatic preset switching (PR-02). */
const logoSpectrumAuto = new PresetAutomation(
  morphLogoSpectrum,
  DEFAULT_LOGO_SPECTRUM,
  SWITCHING_SEEDS.logoSpectrum,
);
const kaleidoscopeAuto = new PresetAutomation(
  morphKaleido,
  DEFAULT_KALEIDO,
  SWITCHING_SEEDS.kaleidoscope,
);

function post(event: RenderEvent): void {
  scope.postMessage(event);
}

function audibleFrame(now: number): number | null {
  if (!clock) return null;
  if (clock.live) {
    // Live input is heard directly: show the newest analysis. Never looking past it keeps
    // every hit for the next frame.
    const latest = reader?.latestEngineFrame() ?? -1;
    return latest >= 0 ? latest : null;
  }
  const epoch = performance.timeOrigin + now;
  return (clock.contextTime + (epoch - clock.performanceTime) / 1000) * sampleRate;
}

function frame(now: number): void {
  request = 0;
  if (!running || !scene || lost) return;
  if (startTime < 0) startTime = now;
  const dt = lastTime < 0 ? 1 / 60 : (now - lastTime) / 1000;
  lastTime = now;

  // Hits between the last frame shown and this one are collected, so none is missed.
  if (sampler) sampler.sample(audibleFrame(now), features);
  else features.fill(0);
  applySettings(dt);
  try {
    const input = { time: (now - startTime) / 1000, dt, features };
    if (active === 'logoSpectrum') drawLayer(input);
    scene.render(input);
  } catch (error) {
    running = false;
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    return;
  }
  frames++;
  statsFrames++;
  if (now - statsStart >= 1000) {
    post({ type: 'stats', fps: (statsFrames * 1000) / (now - statsStart), frames });
    statsStart = now;
    statsFrames = 0;
  }
  request = scope.requestAnimationFrame(frame);
}

/** The settings of the scene shown, as the switching and its morph have them now. */
function applySettings(dt: number): void {
  if (active === 'logoSpectrum') {
    const { settings, switched } = logoSpectrumAuto.frame(dt, features);
    if (settings) logoSpectrum?.setSettings(settings);
    if (switched) post({ type: 'preset', scene: 'logoSpectrum', settings: switched });
  } else {
    const { settings, switched } = kaleidoscopeAuto.frame(dt, features);
    if (settings) kaleidoscope?.setSettings(settings);
    if (switched) post({ type: 'preset', scene: 'kaleidoscope', settings: switched });
  }
}

/**
 * The Kaleidoscope behind the Logo Spectrum (VE-08), when its settings ask for it: drawn first,
 * with its own settings, into a picture the Logo Spectrum's background shows.
 */
function drawLayer(input: SceneInput): void {
  if (!logoSpectrum || !kaleidoscope || !canvas) return;
  if (!logoSpectrum.wantsLayer) {
    logoSpectrum.setBackgroundLayer(null);
    return;
  }
  kaleidoscope.resize(canvas.width, canvas.height);
  const look = kaleidoscopeAuto.current;
  if (look !== layerLook) {
    kaleidoscope.setSettings(look);
    layerLook = look;
  }
  logoSpectrum.setBackgroundLayer(kaleidoscope.renderLayer(input));
}

function setRunning(value: boolean): void {
  running = value;
  if (running && !request && scene) {
    lastTime = -1;
    statsStart = performance.now();
    statsFrames = 0;
    request = scope.requestAnimationFrame(frame);
  }
  if (!running && request) {
    scope.cancelAnimationFrame(request);
    request = 0;
  }
}

/** Shows `kind` from the next frame on (the scene's buffers follow the canvas size). */
function activate(kind: SceneKind): void {
  active = kind;
  scene = kind === 'logoSpectrum' ? logoSpectrum : kaleidoscope;
  if (scene && canvas) scene.resize(canvas.width, canvas.height);
  // Its settings are brought up to date before its first frame; the switching counts anew.
  if (kind === 'logoSpectrum') {
    logoSpectrum?.setSettings(logoSpectrumAuto.target);
    logoSpectrumAuto.restart();
  } else {
    kaleidoscope?.setSettings(kaleidoscopeAuto.target);
    kaleidoscopeAuto.restart();
  }
  lastTime = -1;
}

scope.addEventListener('message', (event) => {
  const message = event.data;
  try {
    switch (message.type) {
      case 'init': {
        canvas = message.canvas;
        sampleRate = message.sampleRate;
        reader = new FeatureTimelineReader(message.timeline);
        sampler = new FeatureSampler(reader);
        canvas.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          lost = true;
          post({ type: 'error', message: 'The graphics context was lost.' });
        });
        gl = canvas.getContext('webgl2', {
          alpha: false,
          antialias: false,
          depth: false,
          stencil: false,
          premultipliedAlpha: false,
          preserveDrawingBuffer: false,
          powerPreference: 'high-performance',
        });
        if (!gl) throw new Error('WebGL2 is not available.');
        // Both scenes live as long as the worker: switching keeps their state and images.
        logoSpectrum = new LogoSpectrumScene(gl);
        kaleidoscope = new KaleidoscopeScene(gl);
        logoSpectrum.setReduceFlashing(reduceFlashing);
        kaleidoscope.setReduceFlashing(reduceFlashing);
        activate(active);
        post({ type: 'ready', floatTargets: logoSpectrum.floatTargets });
        setRunning(running);
        break;
      }
      case 'resize':
        if (canvas && scene) {
          canvas.width = Math.max(1, message.width);
          canvas.height = Math.max(1, message.height);
          scene.resize(canvas.width, canvas.height);
        }
        break;
      case 'scene':
        activate(message.scene);
        break;
      case 'logoSpectrum':
        logoSpectrumAuto.setSettings(message.settings);
        break;
      case 'kaleidoscope':
        kaleidoscopeAuto.setSettings(message.settings);
        break;
      case 'autoPresets':
        logoSpectrumAuto.setAuto(message.config, message.logoSpectrum);
        kaleidoscopeAuto.setAuto(message.config, message.kaleidoscope);
        break;
      case 'reduceFlashing':
        reduceFlashing = message.on;
        logoSpectrum?.setReduceFlashing(message.on);
        kaleidoscope?.setReduceFlashing(message.on);
        break;
      case 'image':
        logoSpectrum?.setImage(message.kind, message.image);
        message.image?.close();
        break;
      case 'clock':
        clock = {
          contextTime: message.contextTime,
          performanceTime: message.performanceTime,
          live: message.live,
        };
        break;
      case 'running':
        setRunning(message.running);
        break;
      case 'dispose':
        setRunning(false);
        logoSpectrum?.dispose();
        kaleidoscope?.dispose();
        logoSpectrum = null;
        kaleidoscope = null;
        scene = null;
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        scope.close();
        break;
    }
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
});
