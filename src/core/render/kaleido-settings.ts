/**
 * Parameters of the Kaleidoscope mode (KA-*). Every scene declares its parameters as typed
 * specs (KA-01): the renderer passes them to the shaders as uniforms named `p_<key>`, and the UI
 * builds its controls from them. Common parameters (symmetry, feedback, colour, reactivity)
 * apply to every scene.
 */

export type ParamValue = number | boolean | string | string[];

export type ParamGroup = 'symmetry' | 'motion' | 'colour' | 'reaction' | 'scene' | 'post';

/** How the UI shows a number. */
export type NumberFormat =
  'percent' | 'seconds' | 'perMinute' | 'degrees' | 'times' | 'integer' | 'plain';

interface BaseSpec {
  key: string;
  label: string;
  group: ParamGroup;
  /** Shown only while another parameter has a given value. */
  visibleWhen?: { key: string; equals: ParamValue };
  hint?: string;
}

export type ParamSpec =
  | (BaseSpec & {
      kind: 'number';
      min: number;
      max: number;
      default: number;
      integer?: boolean;
      format: NumberFormat;
    })
  | (BaseSpec & { kind: 'boolean'; default: boolean })
  | (BaseSpec & {
      kind: 'select';
      options: readonly { value: string; label: string }[];
      default: string;
    })
  | (BaseSpec & { kind: 'color'; default: string })
  | (BaseSpec & { kind: 'gradient'; default: readonly string[] });

/** Colour gradients, dark to bright (KA-07). */
export const KALEIDO_PALETTES = {
  vortex: ['#26000a', '#6e0a16', '#0c3a1c', '#2fcf62', '#dcffd4'],
  ember: ['#140400', '#5c1600', '#d4480f', '#ffb347', '#fff2c8'],
  aurora: ['#05041a', '#1b2a78', '#18b0a4', '#98f2c8', '#f7ecff'],
  magenta: ['#10001c', '#56097a', '#e0249f', '#ff8ad8', '#eafcff'],
  ice: ['#020814', '#0b3a6b', '#2a9df4', '#9be7ff', '#ffffff'],
  neon: ['#0b0016', '#3d00a8', '#ff2fd6', '#1ff0ff', '#f2ffff'],
  mono: ['#000000', '#2e2e2e', '#7c7c7c', '#c6c6c6', '#ffffff'],
} as const;

export type KaleidoPaletteName = keyof typeof KALEIDO_PALETTES | 'custom';
export const GRADIENT_STOPS = 5;

const PALETTE_OPTIONS = [
  ...Object.keys(KALEIDO_PALETTES).map((name) => ({
    value: name,
    label: name[0]!.toUpperCase() + name.slice(1),
  })),
  { value: 'custom', label: 'Custom' },
];

/** Parameters every scene has (KA-05 symmetry, KA-06 feedback, KA-07 colour, KA-08 reaction). */
export const COMMON_PARAMS: readonly ParamSpec[] = [
  {
    kind: 'number',
    key: 'segments',
    label: 'Segments',
    group: 'symmetry',
    min: 1,
    max: 16,
    default: 6,
    integer: true,
    format: 'integer',
  },
  { kind: 'boolean', key: 'mirror', label: 'Mirror segments', group: 'symmetry', default: true },
  {
    kind: 'number',
    key: 'spin',
    label: 'Spin',
    group: 'symmetry',
    min: -10,
    max: 10,
    default: 0.5,
    format: 'perMinute',
  },
  {
    kind: 'number',
    key: 'zoom',
    label: 'Zoom',
    group: 'symmetry',
    min: 0.5,
    max: 3,
    default: 1,
    format: 'times',
  },
  {
    kind: 'number',
    key: 'centerX',
    label: 'Centre X',
    group: 'symmetry',
    min: -0.4,
    max: 0.4,
    default: 0,
    format: 'percent',
  },
  {
    kind: 'number',
    key: 'centerY',
    label: 'Centre Y',
    group: 'symmetry',
    min: -0.4,
    max: 0.4,
    default: 0,
    format: 'percent',
  },
  {
    kind: 'number',
    key: 'flow',
    label: 'Tunnel flow',
    group: 'motion',
    min: -1,
    max: 1,
    default: -0.4,
    format: 'plain',
    hint: 'Negative pulls the picture into the centre, positive pushes it out',
  },
  {
    kind: 'number',
    key: 'twist',
    label: 'Twist',
    group: 'motion',
    min: -1,
    max: 1,
    default: 0.25,
    format: 'plain',
  },
  {
    kind: 'number',
    key: 'trails',
    label: 'Trails',
    group: 'motion',
    min: 0,
    max: 1,
    default: 0.6,
    format: 'percent',
  },
  {
    kind: 'select',
    key: 'palette',
    label: 'Palette',
    group: 'colour',
    options: PALETTE_OPTIONS,
    default: 'vortex',
  },
  {
    kind: 'gradient',
    key: 'gradient',
    label: 'Your colours',
    group: 'colour',
    default: KALEIDO_PALETTES.vortex,
    visibleWhen: { key: 'palette', equals: 'custom' },
  },
  {
    kind: 'number',
    key: 'hueCycle',
    label: 'Hue cycle',
    group: 'colour',
    min: 0,
    max: 10,
    default: 0,
    format: 'perMinute',
  },
  {
    kind: 'number',
    key: 'barShift',
    label: 'Colour step per bar',
    group: 'colour',
    min: 0,
    max: 0.5,
    default: 0.15,
    format: 'percent',
    hint: 'Shifts the colours every four beats',
  },
  {
    kind: 'number',
    key: 'reactivity',
    label: 'Reactivity',
    group: 'reaction',
    min: 0,
    max: 2,
    default: 1,
    format: 'times',
  },
  {
    kind: 'number',
    key: 'intensity',
    label: 'Intensity',
    group: 'reaction',
    min: 0,
    max: 2,
    default: 1,
    format: 'times',
  },
  {
    kind: 'number',
    key: 'bloom',
    label: 'Bloom',
    group: 'post',
    min: 0,
    max: 1,
    default: 0.5,
    format: 'percent',
  },
];

export interface KaleidoScene {
  id: KaleidoSceneId;
  name: string;
  description: string;
  params: readonly ParamSpec[];
  /** Common parameters that suit this scene; applied when you switch to it. */
  look: Record<string, ParamValue>;
}

export type KaleidoSceneId = 'vortex' | 'crystal';

export const KALEIDO_SCENES: readonly KaleidoScene[] = [
  {
    id: 'vortex',
    name: 'Vortex',
    description: 'A swirling tunnel of fibrous strands, pulled into a glowing core',
    params: [
      {
        kind: 'number',
        key: 'arms',
        label: 'Arms',
        group: 'scene',
        min: 1,
        max: 8,
        default: 3,
        integer: true,
        format: 'integer',
      },
      {
        kind: 'number',
        key: 'swirl',
        label: 'Swirl',
        group: 'scene',
        min: 0,
        max: 1,
        default: 0.5,
        format: 'percent',
      },
      {
        kind: 'number',
        key: 'strands',
        label: 'Strands',
        group: 'scene',
        min: 0,
        max: 1,
        default: 0.6,
        format: 'percent',
      },
      {
        kind: 'number',
        key: 'fiber',
        label: 'Fibres',
        group: 'scene',
        min: 0,
        max: 1,
        default: 0.5,
        format: 'percent',
      },
      {
        kind: 'number',
        key: 'core',
        label: 'Core glow',
        group: 'scene',
        min: 0,
        max: 1,
        default: 0.6,
        format: 'percent',
      },
      { kind: 'color', key: 'coreColor', label: 'Core colour', group: 'scene', default: '#ff2438' },
    ],
    look: {
      segments: 1,
      mirror: true,
      flow: -0.4,
      twist: 0.25,
      trails: 0.6,
      palette: 'vortex',
      spin: 0.3,
    },
  },
  {
    id: 'crystal',
    name: 'Crystal Mandala',
    description: 'Crystal shards grow out of a star-shaped tunnel, sparks fly outward',
    params: [
      {
        kind: 'number',
        key: 'points',
        label: 'Star points',
        group: 'scene',
        min: 4,
        max: 12,
        default: 8,
        integer: true,
        format: 'integer',
      },
      {
        kind: 'number',
        key: 'starSize',
        label: 'Star size',
        group: 'scene',
        min: 0.05,
        max: 0.4,
        default: 0.16,
        format: 'percent',
      },
      {
        kind: 'number',
        key: 'shards',
        label: 'Shards',
        group: 'scene',
        min: 0,
        max: 1,
        default: 0.6,
        format: 'percent',
      },
      {
        kind: 'number',
        key: 'sparks',
        label: 'Sparks',
        group: 'scene',
        min: 0,
        max: 1,
        default: 0.5,
        format: 'percent',
      },
    ],
    look: {
      segments: 8,
      mirror: true,
      flow: 0.8,
      twist: 0.05,
      trails: 0.55,
      palette: 'magenta',
      spin: -0.4,
    },
  },
];

export interface KaleidoSettings {
  scene: KaleidoSceneId;
  common: Record<string, ParamValue>;
  /** Parameters of every scene, so that switching back keeps them. */
  scenes: Record<KaleidoSceneId, Record<string, ParamValue>>;
}

export function sceneById(id: KaleidoSceneId): KaleidoScene {
  return KALEIDO_SCENES.find((scene) => scene.id === id) ?? KALEIDO_SCENES[0]!;
}

function defaults(specs: readonly ParamSpec[]): Record<string, ParamValue> {
  return Object.fromEntries(
    specs.map((spec) => [spec.key, spec.kind === 'gradient' ? [...spec.default] : spec.default]),
  );
}

/** The settings of `scene` with its recommended look. */
export function sceneDefaults(scene: KaleidoSceneId): KaleidoSettings {
  return {
    scene,
    common: { ...defaults(COMMON_PARAMS), ...sceneById(scene).look },
    scenes: Object.fromEntries(
      KALEIDO_SCENES.map((entry) => [entry.id, defaults(entry.params)]),
    ) as KaleidoSettings['scenes'],
  };
}

const DEFAULT_SCENE: KaleidoSceneId = 'vortex';
export const DEFAULT_KALEIDO: KaleidoSettings = sceneDefaults(DEFAULT_SCENE);

const COLOR = /^#[0-9a-f]{6}$/i;

/** A valid value for `spec`, or its default. */
export function sanitizeParam(spec: ParamSpec, value: unknown): ParamValue {
  switch (spec.kind) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return spec.default;
      const clamped = Math.min(spec.max, Math.max(spec.min, value));
      return spec.integer ? Math.round(clamped) : clamped;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : spec.default;
    case 'select':
      return spec.options.some((option) => option.value === value)
        ? (value as string)
        : spec.default;
    case 'color':
      return typeof value === 'string' && COLOR.test(value) ? value.toLowerCase() : spec.default;
    case 'gradient':
      return Array.isArray(value) &&
        value.length === GRADIENT_STOPS &&
        value.every((color) => typeof color === 'string' && COLOR.test(color))
        ? value.map((color: string) => color.toLowerCase())
        : [...spec.default];
  }
}

function sanitizeGroup(
  specs: readonly ParamSpec[],
  value: unknown,
  fallback: Record<string, ParamValue>,
): Record<string, ParamValue> {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  return Object.fromEntries(
    specs.map((spec) => {
      const stored = input[spec.key];
      return [spec.key, sanitizeParam(spec, stored === undefined ? fallback[spec.key] : stored)];
    }),
  );
}

/**
 * Valid settings from whatever is stored; unknown keys dropped, values checked by their specs.
 * Missing or invalid values take the scene's defaults (with its look).
 */
export function sanitizeKaleido(value: unknown): KaleidoSettings {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const scene = KALEIDO_SCENES.some((entry) => entry.id === input['scene'])
    ? (input['scene'] as KaleidoSceneId)
    : DEFAULT_SCENE;
  const base = sceneDefaults(scene);
  const scenes = (
    typeof input['scenes'] === 'object' && input['scenes'] !== null ? input['scenes'] : {}
  ) as Record<string, unknown>;
  return {
    scene,
    common: sanitizeGroup(COMMON_PARAMS, input['common'], base.common),
    scenes: Object.fromEntries(
      KALEIDO_SCENES.map((entry) => [
        entry.id,
        sanitizeGroup(entry.params, scenes[entry.id], base.scenes[entry.id]),
      ]),
    ) as KaleidoSettings['scenes'],
  };
}

/** The gradient in use (a palette's or your own). */
export function gradientColors(settings: KaleidoSettings): readonly string[] {
  const palette = settings.common['palette'] as KaleidoPaletteName;
  return palette === 'custom'
    ? (settings.common['gradient'] as string[])
    : KALEIDO_PALETTES[palette];
}

export interface KaleidoPreset {
  name: string;
  settings: KaleidoSettings;
  builtIn: boolean;
}

function preset(
  name: string,
  scene: KaleidoSceneId,
  common: Record<string, ParamValue> = {},
  params: Record<string, ParamValue> = {},
): KaleidoPreset {
  const base = sceneDefaults(scene);
  return {
    name,
    builtIn: true,
    settings: sanitizeKaleido({
      scene,
      common: { ...base.common, ...common },
      scenes: { ...base.scenes, [scene]: { ...base.scenes[scene], ...params } },
    }),
  };
}

export const BUILT_IN_KALEIDO_PRESETS: readonly KaleidoPreset[] = [
  preset('Vortex', 'vortex'),
  preset(
    'Ember Vortex',
    'vortex',
    { palette: 'ember', segments: 1, twist: 0.4 },
    { coreColor: '#ffd28a' },
  ),
  preset(
    'Aurora Spiral',
    'vortex',
    { palette: 'aurora', segments: 6, mirror: true, hueCycle: 1 },
    { swirl: 0.7, coreColor: '#b388ff' },
  ),
  preset('Crystal Mandala', 'crystal'),
  preset(
    'Frozen Mandala',
    'crystal',
    { palette: 'ice', segments: 6, spin: 0.3 },
    { points: 6, shards: 0.8 },
  ),
  preset(
    'Neon Bloom',
    'crystal',
    { palette: 'neon', segments: 12, hueCycle: 2, bloom: 0.7 },
    { points: 12 },
  ),
];
