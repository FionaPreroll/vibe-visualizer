import { exportFileName } from '../core/export/export-job';
import { frameSize } from '../core/export/video-format';
import type { Player } from '../core/player/player';
import { APP_NAME, shownArtist, shownTitle } from '../core/state/app-state';
import type { StageCapture } from './stage-capture';

/** The shorter side of a picture of the stage (EX-10): YouTube's thumbnails are 1280×720. */
export const PICTURE_SIZE = 720;

/**
 * Saves the picture on the stage as a PNG (EX-10), e.g. as a thumbnail: the next frame in the
 * aspect ratio of the stage, named after the track playing.
 */
export async function savePicture(player: Player, capture: StageCapture): Promise<void> {
  const { settings, tracks, currentId, live } = player.state;
  const [width, height] = frameSize(settings.aspect, PICTURE_SIZE);
  const png = await capture.picture(width, height);
  const track = live.status === 'off' ? tracks.find((entry) => entry.id === currentId) : undefined;
  const source = track
    ? { title: shownTitle(track), artist: shownArtist(track) }
    : { title: APP_NAME, artist: null };
  const url = URL.createObjectURL(png);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFileName(source, null, 'png');
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
