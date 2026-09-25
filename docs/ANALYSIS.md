# Vibe Visualizer — Audio Analysis

> **Status:** analysis v2 (2026-09-25): new drum detection and a live beat tracker, measured on a synthetic EDM mix and on real recordings. Features: AN-01–05 and the live part of AN-07 in [FEATURES.md](FEATURES.md).

The analyzer turns the audio that is playing into one **analysis frame** every 512 samples (about 94 frames per second at 48 kHz). The renderer reads the frame for the moment you hear. The same code runs live in the AudioWorklet and in the export, so both look the same (see [TECH-STACK.md](TECH-STACK.md), "one core, two clocks").

## 1. What the visuals get

Layout: `F` in `src/core/analysis/features.ts`. Values are 0…1 unless noted.

| Field | Meaning |
|---|---|
| `spectrum` (64) | Log-spaced spectrum, 30 Hz – 16 kHz, auto-gained |
| `bands` (6) | Energy of sub, bass, low-mid, mid, high-mid and treble, auto-gained |
| `energy`, `rms`, `peak` | Overall loudness (auto-gained); RMS and peak of the last hop (linear) |
| `kick`, `snare`, `hat` | Drum envelopes: 1 at the onset of a hit, then decaying (120, 100 and 60 ms) |
| `kickHit`, `snareHit`, `hatHit` | 1 in the frame that reports a hit |
| `beat`, `beatHit` | Beat envelope (1 on the beat, decaying over 100 ms) and the beat event |
| `beatPhase` | Position within the beat: 0 on the beat, rising to 1 just before the next |
| `bpm` | Tempo in beats per minute (not normalised) |
| `beatConfidence` | How clearly the music follows the tracked beat; 0 in silence. Beats are only reported above 0.1 |
| `waveform` (128) | Time-domain snapshot for oscilloscope-style elements |

## 2. Drum detection

Code: `src/core/analysis/drums.ts`. It works in steps of 128 samples (2.7 ms), four times finer than the analysis frame. The spectrum (2048-point FFT, 43 ms window) is too slow and too blurry in time for drum hits.

1. **Band envelopes.** Four 24 dB/octave Butterworth bands: kick 40–100 Hz (smoothed over 21 ms, because low frequencies need about one period to measure), drum body 150–300 Hz, snare 1–4 kHz, and hi-hat above 8 kHz.
2. **Rise.** For each band, the level in dB minus its minimum over the previous 21 ms. Onsets are the local maxima of this rise.
3. **Level gate.** A hit must reach close to the band's recent peak level (a peak follower that falls by 3 dB per second). This rejects quieter instruments in the same band. The kick must be within 3.5 dB, snare and hi-hat within 10 dB.
4. **Extra checks:**
   - **Snare:** the drum-body band must also rise by 5 dB, which tonal instruments above 1 kHz (vocals, guitars) do not do. The hi-hat band must not be more than 10 dB louder than the snare band, which rejects hi-hat spill; white-noise snares (like a 909) still pass.
   - **Hi-hat:** the sound must last. It may drop at most 6 dB within 5 ms after its peak, which rejects the short clicks of kick drums.
   - **Kick:** at most one hit per 90 ms, which suppresses double hits from bass notes beating against the kick's tail.
5. **Timing.** A hit is reported where its rise began, not where it peaked. This cancels most of the detection delay: the frame that reports a hit may come up to 30 ms later, but its envelope has already decayed by the right amount.

## 3. Beat tracking

Code: `src/core/analysis/beat-tracker.ts`, after the BTrack algorithm (Stark, Davies & Plumbley, DAFx 2009).

- **Onset strength:** the spectral flux (mean rise in dB over all FFT bins), once per frame.
- **Tempo:** autocorrelation of the onset strength over the last 5.5 s, summed over the first four multiples of each candidate period (75–180 BPM), with a preference for about 120 BPM. A Viterbi-style step favours small tempo changes. The first estimate comes after 1.4 s.
- **Phase:** a cumulative score adds each frame's onset strength to the best score about one beat earlier. Halfway between two beats, the score is extended into the future to predict the next beat. Because beats are predicted, they are reported 21 ms early, which cancels the delay of the flux itself.
- **Offbeat check:** with steady eighth notes (hi-hats), the score cannot tell beats from offbeats and may lock onto the "and". Every four beats, the kick and drum-body energy on the beats is compared with the energy halfway between. If the halfway points are clearly stronger (× 1.3), the tracker moves by half a beat.
- **Confidence:** onset strength on the beats compared with the average. In silence it falls within about half a second, so paused playback stops pulsing.

## 4. Evaluation

Two test sets, scored like MIREX: a detection is correct within ±50 ms of an unmatched annotation (±70 ms for beats, after a 5 s warm-up). F1 is the harmonic mean of precision (how many detections are right) and recall (how many hits are found).

- **Synthetic EDM mix** (`src/core/analysis/eval/drum-mix.ts`, 36 s at 124 BPM). Kick with pitch drop and click, an offbeat sub bass with sidechain pumping, claps with and without a snare body, closed and open hi-hats, a crash, a pad, a vocal-like synth in a drumless breakdown, and a build-up with snare and clap rolls and a noise riser. It runs as a unit test (`drums.test.ts`) with minimum scores.
- **Real recordings:** [MDB Drums](https://github.com/CarlSouthall/MDBDrums), 23 MedleyDB tracks (rock, pop, funk, jazz, latin, metal; acoustic drums; 22 minutes) with annotated kicks, snares, hi-hats, cymbals and beats. The dataset is CC BY-NC-SA 4.0 and not part of this repository. To run it:

  ```sh
  git clone https://github.com/CarlSouthall/MDBDrums
  MDB_DRUMS_DIR="$PWD/MDBDrums/MDB Drums" EVAL_CACHE_DIR=/tmp/vv-eval pnpm eval:drums
  ```

  `EVAL_CACHE_DIR` keeps the tracks converted to 48 kHz, which makes later runs take about 10 s.

### Results: v1 (M1) → v2

F1 scores:

| | Kick | Snare | Hi-hat | Beat | Tempo right |
|---|---|---|---|---|---|
| Real recordings, v1 | 57 % | 41 % | 65 % | — | — |
| Real recordings, v2 | **71 %** | 42 % | **73 %** | **79 %** | 21 of 23 tracks |
| Synthetic EDM mix, v1 | 85 % | 74 % | 77 % | — | — |
| Synthetic EDM mix, v2 | **88 %** | **98 %** | **82 %** | **100 %** | 124.2 BPM (truth 124) |

Mean timing error of the correct detections on real recordings: v1 reported hits 8–12 ms late (up to 21 ms on the synthetic mix). v2 is within −13…+2 ms, and beats within −2 ms.

Two tempo misses on real recordings are half-tempo readings of fast jazz (111 instead of 222 BPM), which is fine for visuals. Beat tracking is weakest in free jazz, latin and one track whose snare falls on the annotated offbeat.

**Scored for the visuals.** Ghost notes and brush strokes hardly matter for visuals, and hi-hat hits on a ride or crash cymbal are fine. Scored that way on the real recordings:

| | v1 | v2 |
|---|---|---|
| Snare (recall without ghost notes and brushes) | 48 % (precision 50 %, recall 46 %) | 46 % (precision 40 %, recall 54 %) |
| Hi-hat (cymbals count as correct) | 76 % | 78 % |

## 5. Limits and next steps

- **Bass notes as loud as the kick** in 40–100 Hz still count as kicks. So do toms. A sub bass on the offbeat is usually quieter than the kick and is rejected.
- **Snares in dense acoustic mixes** (guitars, piano): precision stays around 40 %. v2 favours electronic snares and claps.
- **Half and double tempo** are not resolved; the tracker prefers tempos near 120 BPM.

Planned:

- **Whole-track analysis for files and exports (AN-07).** For files, the whole track can be analysed ahead of time in a worker: with look-ahead, thresholds per track and a beat grid over the whole track. This is the next step for accuracy and fits the export (P2).
- **Stem separation (AN-10).** Detecting drums on a separated drum stem is the big jump in accuracy. It needs an on-device model, which is heavy but fine for offline rendering.
- **Controls.** Sensitivity per drum and a beat nudge in the visuals panel.
