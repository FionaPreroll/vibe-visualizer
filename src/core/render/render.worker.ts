import {
  FeatureSampler,
  FeatureTimelineReader,
  type HeardPosition,
} from '../analysis/feature-timeline';
import { F } from '../analysis/features';
import { DEFAULT_KALEIDO } from './kaleido-settings';
import { KaleidoscopeScene } from './kaleidoscope';
import { LogoSpectrumScene } from './logo-spectrum';
import { SAMPLE_POSITION, SAMPLE_TRACK, TrackOverlay } from './overlay';
import { DEFAULT_OVERLAY, type OverlaySettings, type OverlayTrack } from './overlay-settings';
import { PresetAutomation, SWITCHING_SEEDS } from './preset-automation';
import type { RenderEvent, RenderRequest, SceneKind } from './render-protocol';
import type { Scene, SceneInput } from './scene';
import { morphKaleido, morphLogoSpectrum } from './settings-morph';
import { DEFAULT_LOGO_SPECTRUM } from './visual-settings';

/**
 * Draws the visuals on an OffscreenCanvas, off the main thread (TECH-STACK: renderer). Each
 * frame it looks up the analysis frame for the moment you hear, from the shared feature
 * timeline and the audio clock sent by the main thread. The timeline also says which file that
 * music comes from and where in it: the track overlay and the cover art follow it exactly, also
 * across a gapless transition.
 */

/** After a change of the overlay's settings, it shows this long (ms), so the change is seen. */
const OVERLAY_PREVIEW_MS = 3000;

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
/** The file heard now (by its token; 0: none) and the position in it. */
const heard: HeardPosition = { seconds: 0, token: 0 };
let overlay: TrackOverlay | null = null;
let overlaySettings: OverlaySettings = DEFAULT_OVERLAY;
/** Until then (performance.now()), the overlay shows in full: its settings just changed. */
let overlayPreview = 0;
const overlayTracks = new Map<number, OverlayTrack>();
let overlayRate = 1;
/** Cover art by token (LS-15), and the token whose cover the Logo Spectrum has. */
const covers = new Map<number, ImageBitmap>();
let coverToken = -1;
let coverLogo = false;
/** Pictures asked for (EX-10): taken from the next frame drawn. */
const captures: { id: number; width: number; height: number }[] = [];
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
  const sampled = sampler ? sampler.sample(audibleFrame(now), features, heard) : false;
  if (!sampler) features.fill(0);
  // Live input comes from no file.
  const token = sampled && !clock?.live ? heard.token : 0;
  applySettings(dt);
  try {
    const input = { time: (now - startTime) / 1000, dt, features };
    if (active === 'logoSpectrum') {
      showCover(token);
      drawLayer(input);
    }
    scene.render(input);
    drawOverlay(now, token);
    if (captures.length > 0) takeCaptures();
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

/** The cover art of the file heard, for the Logo Spectrum's logo (LS-15). */
function showCover(token: number): void {
  if (token === coverToken || !logoSpectrum) return;
  coverToken = token;
  logoSpectrum.setCover(covers.get(token) ?? null);
}

/** The track overlay of the file heard; while its settings change, a sample if none plays. */
function drawOverlay(now: number, token: number): void {
  if (!overlay) return;
  const preview = Math.min(1, Math.max(0, (overlayPreview - now) / 500));
  const track = overlayTracks.get(token) ?? null;
  if (track) overlay.draw(track, heard.seconds, overlayRate, preview);
  else if (preview > 0) overlay.draw(SAMPLE_TRACK, SAMPLE_POSITION, 1, preview);
}

/**
 * Copies the frame just drawn for the pictures asked for, while it is still in the drawing
 * buffer; each is scaled and encoded as a PNG after that.
 */
function takeCaptures(): void {
  const source = canvas!;
  for (const { id, width, height } of captures.splice(0)) {
    createImageBitmap(source, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' })
      .then(async (bitmap) => {
        const picture = new OffscreenCanvas(width, height);
        picture.getContext('2d')!.drawImage(bitmap, 0, 0);
        bitmap.close();
        post({ type: 'capture', id, png: await picture.convertToBlob({ type: 'image/png' }) });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        post({ type: 'capture', id, png: null, message });
      });
  }
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
        logoSpectrum.setCoverLogo(coverLogo);
        overlay = new TrackOverlay(gl);
        overlay.setSettings(overlaySettings);
        overlay.resize(canvas.width, canvas.height);
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
          overlay?.resize(canvas.width, canvas.height);
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
      case 'overlay': {
        const changed = JSON.stringify(message.settings) !== JSON.stringify(overlaySettings);
        // The first settings are no change; a change shows the overlay for a moment.
        if (changed && overlay && message.settings.on) {
          overlayPreview = performance.now() + OVERLAY_PREVIEW_MS;
        }
        overlaySettings = message.settings;
        overlay?.setSettings(message.settings);
        break;
      }
      case 'tracks': {
        overlayTracks.clear();
        for (const { token, track } of message.tracks) if (track) overlayTracks.set(token, track);
        overlayRate = message.rate;
        // The covers of files that left the stream go.
        for (const [token, image] of covers) {
          if (message.tracks.some((entry) => entry.token === token)) continue;
          image.close();
          covers.delete(token);
        }
        break;
      }
      case 'cover':
        covers.get(message.token)?.close();
        if (message.image) covers.set(message.token, message.image);
        else covers.delete(message.token);
        // The file heard got its cover: it shows at once.
        if (message.token === coverToken) {
          coverToken = -1;
          showCover(message.token);
        }
        break;
      case 'coverLogo':
        coverLogo = message.on;
        logoSpectrum?.setCoverLogo(message.on);
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
      case 'capture':
        if (running && scene && !lost) captures.push(message);
        else
          post({ type: 'capture', id: message.id, png: null, message: 'The visuals are paused.' });
        break;
      case 'dispose':
        setRunning(false);
        logoSpectrum?.dispose();
        kaleidoscope?.dispose();
        overlay?.dispose();
        for (const image of covers.values()) image.close();
        covers.clear();
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
