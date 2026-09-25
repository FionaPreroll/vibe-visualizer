/** Loads a media URL into a <video> element and reports what the browser sees. */
export function probePlayback(
  url: string,
  timeoutMs = 15_000,
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    const timer = setTimeout(() => reject(new Error('timed out loading the video')), timeoutMs);
    video.addEventListener('loadedmetadata', () => {
      clearTimeout(timer);
      resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
      video.removeAttribute('src');
      video.load();
    });
    video.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(video.error?.message || 'the browser cannot play this file'));
    });
    video.src = url;
  });
}
