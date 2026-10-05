import {
  FeatureSampler,
  FeatureTimelineReader,
  type HeardPosition,
} from '../analysis/feature-timeline';
import { F } from '../analysis/features';
import {
  COVER_BLEND_SECONDS,
  coverTonesOf,
  sameTrackColors,
  trackPalette,
  type CoverColors,
  type CoverPalette,
  type Tone,
  type TrackColors,
} from './cover-palette';
import { HeardHold } from './heard-hold';
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
/**
 * Backup frames (DS-06): while on, a timer draws when no animation frame has come for a while,
 * as behind other tabs while the canvas shows in the mini player's window.
 */
let backupTimer: ReturnType<typeof setInterval> | undefined;
/** When the last animation frame came (performance.now()). */
let lastAnimationFrame = 0;
/** No animation frame for this long (ms): the timer draws. */
const BACKUP_AFTER_MS = 250;
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
/** The file the frame shows (its cover, overlay and colours), held over gaps in the analysis. */
const heardHold = new HeardHold();
let overlay: TrackOverlay | null = null;
let overlaySettings: OverlaySettings = DEFAULT_OVERLAY;
/** Whether the overlay's settings came yet: the first ones are no change. */
let overlayKnown = false;
/** Until then (performance.now()), the overlay shows in full: its settings just changed. */
let overlayPreview = 0;
const overlayTracks = new Map<number, OverlayTrack>();
/** Files of the stream whose loudness is still being found out: the picture stays calm. */
const calmTokens = new Set<number>();
/** How far the picture moves with the music (0…1): shake, zoom and pulse. */
let motion = 1;
/** Time constant of its easing back in (s). */
const MOTION_SECONDS = 0.4;
let overlayRate = 1;
/** Cover art by token (LS-15), and the token whose cover the Logo Spectrum has. */
const covers = new Map<number, ImageBitmap>();
let coverToken = -1;
let coverLogo = false;
/**
 * The colours of the tracks (VE-12) by token: the tones of each cover, the colours the user gave
 * each track, and the palettes they make; and whether the visuals take them.
 */
const coverTones = new Map<number, Tone[] | null>();
const trackColors = new Map<number, TrackColors | null>();
const palettes = new Map<number, CoverPalette | null>();
let coverColorsOn = false;
/** The cover colours shown: blending from the last file's to the one heard (null: the look's). */
const shownColors: CoverColors = { from: null, to: null, blend: 1 };
/** Pictures asked for (EX-10): taken from the next frame drawn. */
const captures: { id: number; width: number; height: number }[] = [];
/** The file and position heard at the last frame, and how long it has stood still (s). */
const lastHeard = { token: -1, seconds: 0, still: 0 };
/** A step of the position heard this long or longer is a jump (a seek), not the music. */
const JUMP_SECONDS = 0.25;
/**
 * How long the position may stand still while playing (s): at high frame rates a frame can
 * fall between two analysis frames (~10 ms apart). Longer, it is paused, however few frames
 * that took.
 */
const STILL_SECONDS = 0.05;
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

/**
 * Seconds of the music played since the last frame, for what turns with it (LS-16): the tempo
 * while it plays on, nothing while paused, the steps of the jog wheel, the tempo again across a
 * seek or into the next file. Live input plays on.
 */
function playedSince(dt: number, sampled: boolean, live: boolean): number {
  if (live) return sampled ? dt : 0;
  if (!sampled) return 0;
  const step = heard.seconds - lastHeard.seconds;
  const sameFile = heard.token === lastHeard.token;
  lastHeard.token = heard.token;
  lastHeard.seconds = heard.seconds;
  if (!sameFile || Math.abs(step) >= JUMP_SECONDS) return dt * overlayRate;
  if (step === 0) return (lastHeard.still += dt) > STILL_SECONDS ? 0 : dt * overlayRate;
  lastHeard.still = 0;
  // Playing on: at the tempo, without the steps of the analysis frames.
  return step > 0 && step < 3 * dt * overlayRate + 0.03 ? dt * overlayRate : step;
}

/** Draws a frame at `now`, and asks for the next; from the backup timer, `backup`. */
function frame(now: number, backup = false): void {
  request = 0;
  if (!backup) lastAnimationFrame = performance.now();
  if (!running || !scene || lost) return;
  if (startTime < 0) startTime = now;
  const dt = lastTime < 0 ? 1 / 60 : (now - lastTime) / 1000;
  lastTime = now;

  // Hits between the last frame shown and this one are collected, so none is missed.
  const sampled = sampler ? sampler.sample(audibleFrame(now), features, heard) : false;
  if (!sampler) features.fill(0);
  // Live input comes from no file; a file is held over a few frames without analysis.
  const live = clock?.live === true;
  const token = heardHold.next(sampled || live, live ? 0 : heard.token, dt);
  applySettings(dt);
  const played = playedSince(dt, sampled, live);
  // Calm at once for a file whose loudness is not known yet; moving again eases in.
  const calm = token !== 0 && calmTokens.has(token);
  motion = calm ? 0 : motion + (1 - motion) * (1 - Math.exp(-dt / MOTION_SECONDS));
  try {
    const input = { time: (now - startTime) / 1000, dt, features, played, motion };
    const colors = coverColors(dt, token);
    logoSpectrum?.setCoverColors(colors);
    kaleidoscope?.setCoverColors(colors);
    if (active === 'logoSpectrum') {
      showCover(token);
      drawLayer(input);
    }
    scene.render(input);
    drawOverlay(now, token);
    if (captures.length > 0) takeCaptures();
  } catch (error) {
    running = false;
    post({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      fatal: true,
    });
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
  // The look behind is the Logo Spectrum's own (through its morph), else the Kaleidoscope's.
  const look = logoSpectrumAuto.current.layerLook ?? kaleidoscopeAuto.current;
  if (look !== layerLook) {
    kaleidoscope.setSettings(look);
    layerLook = look;
  }
  logoSpectrum.setBackgroundLayer(kaleidoscope.renderLayer(input));
}

/**
 * The colours of the cover of the file heard (VE-12), blended in over a moment when another
 * file is heard or the setting changes; null once they are the look's own.
 */
function coverColors(dt: number, token: number): CoverColors | null {
  const target = coverColorsOn ? (palettes.get(token) ?? null) : null;
  if (target !== shownColors.to) {
    // A blend under way goes on from the nearer of its ends.
    shownColors.from = shownColors.blend < 0.5 ? shownColors.from : shownColors.to;
    shownColors.to = target;
    shownColors.blend = 0;
  }
  shownColors.blend = Math.min(1, shownColors.blend + dt / COVER_BLEND_SECONDS);
  return shownColors.blend >= 1 && !shownColors.to ? null : shownColors;
}

/** The palette of the file with `token`, made anew when its cover or its colours changed. */
function updatePalette(token: number): void {
  palettes.set(token, trackPalette(trackColors.get(token) ?? null, coverTones.get(token) ?? null));
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
    lastAnimationFrame = statsStart;
    request = scope.requestAnimationFrame(frame);
  }
  if (!running && request) {
    scope.cancelAnimationFrame(request);
    request = 0;
  }
}

function setBackupFrames(on: boolean): void {
  clearInterval(backupTimer);
  backupTimer = on ? setInterval(backupFrame, 1000 / 60) : undefined;
}

/** The animation frame asked for has not come for a while: this one draws, and asks anew. */
function backupFrame(): void {
  if (!running || !scene || lost) return;
  const now = performance.now();
  if (now - lastAnimationFrame < BACKUP_AFTER_MS) return;
  if (request) scope.cancelAnimationFrame(request);
  frame(now, true);
}

/** Shows `kind` from the next frame on (the scene's buffers follow the canvas size). */
function activate(kind: SceneKind): void {
  active = kind;
  // The Kaleidoscope gets its look anew: as the layer behind, or in its own mode.
  layerLook = null;
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
          // Given up on purpose (dispose).
          if (lost) return;
          lost = true;
          post({ type: 'lost' });
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
        // The first settings are no change, though they differ from the defaults (they come
        // after the start); a change shows the overlay for a moment.
        const changed =
          overlayKnown && JSON.stringify(message.settings) !== JSON.stringify(overlaySettings);
        overlayKnown = true;
        if (changed && overlay && message.settings.on) {
          overlayPreview = performance.now() + OVERLAY_PREVIEW_MS;
        }
        overlaySettings = message.settings;
        overlay?.setSettings(message.settings);
        break;
      }
      case 'tracks': {
        overlayTracks.clear();
        calmTokens.clear();
        for (const { token, track, calm, colors } of message.tracks) {
          if (track) overlayTracks.set(token, track);
          if (calm) calmTokens.add(token);
          // A palette made anew only when the colours changed: it blends in as a new one.
          if (!trackColors.has(token) || !sameTrackColors(trackColors.get(token)!, colors)) {
            trackColors.set(token, colors);
            updatePalette(token);
          }
        }
        overlayRate = message.rate;
        // The covers and colours of files that left the stream go.
        const inStream = (token: number) => message.tracks.some((entry) => entry.token === token);
        for (const [token, image] of covers) {
          if (inStream(token)) continue;
          image.close();
          covers.delete(token);
        }
        for (const token of [...palettes.keys()]) {
          if (inStream(token)) continue;
          coverTones.delete(token);
          trackColors.delete(token);
          palettes.delete(token);
        }
        break;
      }
      case 'cover':
        covers.get(message.token)?.close();
        if (message.image) covers.set(message.token, message.image);
        else covers.delete(message.token);
        coverTones.set(message.token, message.image ? coverTonesOf(message.image) : null);
        updatePalette(message.token);
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
      case 'coverColors':
        coverColorsOn = message.on;
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
      case 'backupFrames':
        setBackupFrames(message.on);
        break;
      case 'capture':
        if (running && scene && !lost) captures.push(message);
        else
          post({ type: 'capture', id: message.id, png: null, message: 'The visuals are paused.' });
        break;
      case 'loseContext':
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        break;
      case 'dispose':
        setRunning(false);
        setBackupFrames(false);
        logoSpectrum?.dispose();
        kaleidoscope?.dispose();
        overlay?.dispose();
        for (const image of covers.values()) image.close();
        covers.clear();
        coverTones.clear();
        trackColors.clear();
        palettes.clear();
        logoSpectrum = null;
        kaleidoscope = null;
        scene = null;
        lost = true;
        gl?.getExtension('WEBGL_lose_context')?.loseContext();
        scope.close();
        break;
    }
  } catch (error) {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      // Without a scene, nothing draws.
      fatal: message.type === 'init',
    });
  }
});
