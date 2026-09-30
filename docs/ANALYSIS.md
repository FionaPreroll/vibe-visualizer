# Vibe Visualizer — Audio Analysis

> **Status:** analysis v2 (2026-09-25): new drum detection and a live beat tracker, measured on a synthetic EDM mix and on real recordings. Beat grid for files (2026-09-29, P3 M2): each file's beats are computed from the whole track in the background. Features: AN-01–05 and AN-07 in [FEATURES.md](FEATURES.md).

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

## 4. Beat grid for files

Code: `src/core/analysis/beat-grid.ts` and `bars.ts`. The live tracker only knows the past, so it needs a few seconds to lock on and can drift to a related tempo. For a file, the whole track is known: a worker (`src/core/library/track-analysis.worker.ts`) decodes it in the background, runs the same analyzer over it and keeps, per frame, the onset strength (the spectral flux, as above), the accent (kick and drum-body energy), whether there is sound, and the rises of the kick and snare bands; every four frames it also keeps the 64-band spectrum (in dB, before the auto-gain, half-dB steps). That is about 33 bytes per frame, 20 MB for a two-hour mix. From these:

1. **Tempo path.** Every half second, the autocorrelation of the last 10 s of onsets (a running sum) is scored with a comb over four multiples of each period (75–180 BPM), times a preference for tempos around 120 BPM. A Viterbi pass over the whole track finds the most likely path of tempos: small changes are cheap, and a jump to any tempo (the next track of a mix) is possible but rare.
2. **Beats.** Dynamic programming (after Ellis, "Beat Tracking by Dynamic Programming", 2007) chooses the sequence of beats that best matches strong onsets while each interval stays close to the local period. The accent counts extra, so the beats land on the kicks rather than on offbeat hi-hats. Each beat is refined to a fraction of a frame and moved back by the delay of the flux.
3. **Confidence per beat.** The median score on the 8 beats on either side compared with the median score between them: noise gives a ratio of about 2, a sustained pad 1.5, real recordings 5–9. It maps to 0 below 2.5 and to 1 above 4.5; silence has none. Beats with a confidence under 0.1 are not reported.
4. **Fast genres.** The preference for 120 BPM tempts the path to half or 2/3 of fast tempos: drum & bass at 87 or 116 instead of 174, hardcore at 89 instead of 178. So the tempo is checked against the snares, in windows of 12 s: for the beats at the tempo found and at double and 3/2 of it, the snare rise on each beat is averaged per position in a bar of four. Where a faster tempo puts the snares clearly on the second and fourth beat (by at least 0.3 on a scale of −1 to 1, and 0.15 more than the tempo found) and its neighbouring windows agree, it wins. Slower tempos are not tried: a half-time feel (dubstep, trap) and swing jazz show such a backbeat at half or 2/3 of their tempo too, and in the first version (which tried them) swing jazz fell from 100 to 80 %.
5. **Bars.** Each beat gets its position in a bar of four (AN-11). Three clues mark a downbeat, each compared with the 16 beats on either side (as a z-score): the harmony changes there (the mean spectrum from 55 Hz to 3.7 kHz of the two beats after it against the two before, each without its overall level), the kick plays there (and often on the third beat) and the snare on the second and fourth. The change of harmony counts most; the drums settle what it leaves open (the snares alone cannot tell the first beat from the third). A hidden Markov model over the beats (each beat takes the position after the one before; another bar length costs a log-probability of −8) finds the most likely positions (Viterbi). The weights were chosen on MDB Drums and the genre patterns below.

**The tempo by hand (TMP-06).** Where the grid still reads a related tempo, the BPM in the queue opens a menu: × 2, ÷ 2, × 1.5, ÷ 1.5 of it (40–250 BPM), or back to the tempo found. The grid is then computed anew within a factor of 1.2 of the tempo given, with a narrow preference for it (0.1 octaves) and without the check against the snares. The worker keeps the features of recent tracks in memory (up to 64 MB, about six hours), so that takes a moment instead of a decode; the tempo is kept per file, and the cache stores it with the grid.

While a file with a grid plays, the worklet takes the beat fields (`beat`, `beatHit`, `beatPhase`, `bpm`, `beatConfidence`) from the grid instead of the live tracker, at the file position that is being analysed and scaled by the playback speed. The export uses the same grid (the bars are not in the export's frames yet: they come with the bar-synced visuals of P4). For a normal track the grid is ready a few seconds after the track was added (the grid itself takes about 20 ms; decoding and analysing the track take the rest), and it is cached in the Origin Private File System by a fingerprint of the file (SHA-256 of its size and three samples of 256 KB), together with the waveform of the timeline, so it is there at once the next time. The queue shows each track's tempo from its grid: the median over the track of the mean beat interval across 16 beats (single intervals alternate by a frame between the onsets at fast tempos, and 240 BPM read as 246).

## 5. Evaluation

Two test sets, scored like MIREX: a detection is correct within ±50 ms of an unmatched annotation (±70 ms for beats, after a 5 s warm-up). F1 is the harmonic mean of precision (how many detections are right) and recall (how many hits are found).

- **Synthetic EDM mix** (`src/core/analysis/eval/drum-mix.ts`, 36 s at 124 BPM). Kick with pitch drop and click, an offbeat sub bass with sidechain pumping, claps with and without a snare body, closed and open hi-hats, a crash, a pad, a vocal-like synth in a drumless breakdown, and a build-up with snare and clap rolls and a noise riser. It runs as a unit test (`drums.test.ts`) with minimum scores.
- **Genre patterns** (`src/core/analysis/eval/patterns.ts`): 16 bars each of techno (128 BPM), house (122), rock (118), hip-hop (92), drum & bass (174, also with dotted stabs that suggest 116), jungle (166), hardcore (178) and dubstep (140, snare on the third beat), with a bass line whose note changes on every downbeat. Known beats and downbeats; `beat-grid.test.ts` checks the tempo and the bars of three of them.
- **Real recordings:** [MDB Drums](https://github.com/CarlSouthall/MDBDrums), 23 MedleyDB tracks (rock, pop, funk, jazz, latin, metal; acoustic drums; 22 minutes) with annotated kicks, snares, hi-hats, cymbals, beats and downbeats. The dataset is CC BY-NC-SA 4.0 and not part of this repository. To run it:

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
| Real recordings, beat grid (P3 M2) | | | | **87 %** | 21 of 23 tracks |
| Synthetic EDM mix, v1 | 85 % | 74 % | 77 % | — | — |
| Synthetic EDM mix, v2 | **88 %** | **98 %** | **82 %** | **100 %** | 124.2 BPM (truth 124) |

Mean timing error of the correct detections on real recordings: v1 reported hits 8–12 ms late (up to 21 ms on the synthetic mix). v2 is within −13…+2 ms, and beats within −2 ms.

Two tempo misses on real recordings are half-tempo readings of fast jazz (111 instead of 222 BPM), which is fine for visuals. Beat tracking is weakest in free jazz, latin and one track whose snare falls on the annotated offbeat.

The beat grid is right more often (precision 92 %, recall 83 %) and needs no time to lock on: it scores from the first beat, where the live tracker is scored after a 5 s warm-up. It fixes the tracks where the live tracker locked onto the offbeat or a related tempo for a while (Latin jazz 27 → 97 %, Beatles 37 → 99 %, Punk 72 → 100 %). Free jazz stays hard (45 %). Computing the grids of all 23 tracks (22 minutes of music) takes about 0.5 s.

**Fast genres and bars (UX B).** On the genre patterns the grid now finds every tempo: hardcore was read at half (89 BPM), drum & bass and jungle were right already (the live tracker reads all three at half). On MDB Drums the check against the snares changes nothing (beat F1 87.2 %, tempo right in 21 of 23 tracks). The bars are right on all downbeats of the genre patterns. On MDB Drums the grid counts 342 of the 493 downbeats it has a beat on as the first beat of a bar (downbeat F1 59 %). 16 of the 23 tracks are right throughout. Britpop and speed metal are off by half a bar all along (their harmony changes more on the third beat than on the first), fusion and funk jazz in part; free jazz has no steady bars, and in the two fast jazz tracks the grid has half the tempo, so its bars are two bars long.

**Scored for the visuals.** Ghost notes and brush strokes hardly matter for visuals, and hi-hat hits on a ride or crash cymbal are fine. Scored that way on the real recordings:

| | v1 | v2 |
|---|---|---|
| Snare (recall without ghost notes and brushes) | 48 % (precision 50 %, recall 46 %) | 46 % (precision 40 %, recall 54 %) |
| Hi-hat (cymbals count as correct) | 76 % | 78 % |

## 6. Limits and next steps

- **Bass notes as loud as the kick** in 40–100 Hz still count as kicks. So do toms. A sub bass on the offbeat is usually quieter than the kick and is rejected.
- **Snares in dense acoustic mixes** (guitars, piano): precision stays around 40 %. v2 favours electronic snares and claps.
- **Half and double tempo:** the tracker and the grid prefer tempos near 120 BPM. The grid checks fast tempos against the snares (drum & bass, hardcore); a track read at double its tempo, or swing read at 3/2, is left to the correction by hand in the queue.
- **Bars** are bars of four beats; waltzes and other meters get bars of four too. Without drums and without changes of harmony (ambient), the positions are a guess.
- **Live input** has no grid: it is heard as it comes, so the live tracker stays in charge there.

Planned:

- **Drums from the whole track.** The beat grid uses the whole file; drum detection does not yet. With look-ahead and thresholds per track, it could get more precise too, for files and exports.
- **Stem separation (AN-10).** Detecting drums on a separated drum stem is the big jump in accuracy. It needs an on-device model, which is heavy but fine for offline rendering.
- **Controls.** Sensitivity per drum and a beat nudge in the visuals panel.
