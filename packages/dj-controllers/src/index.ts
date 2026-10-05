/**
 * DJ controllers in the browser: Web MIDI, a profile per controller, and semantic controls and
 * lights, so an app maps "deck 1, hot cue 3" once instead of the MIDI messages of each device.
 */

import { PIONEER_DDJ_FLX2 } from './profiles/pioneer-ddj-flx2';
import type { ControllerProfile } from './types';

export { Decoder, dataBytes } from './decoder';
export { ControllerHub } from './hub';
export type { ConnectedController, ControllerHubOptions, MidiMessage } from './hub';
export { guessLights, learnBinding, learnedProfile } from './learn';
export type { LearnTarget } from './learn';
export { BLINK_MS, Lights } from './lights';
export { sanitizeProfile } from './profile-file';
export { SoftTakeover } from './takeover';
export { PIONEER_DDJ_FLX2 };
export type * from './types';

/** The profiles that come with the library. */
export const PROFILES: readonly ControllerProfile[] = [PIONEER_DDJ_FLX2];
