import { describe, expect, it } from 'vitest';
import { comparePaths, entriesFromFiles, isAudioFile } from './folder-reader';

/** A file as a folder input gives it, with its path in the folder. */
function inFolder(path: string, type = ''): File {
  const file = new File(['x'], path.split('/').pop()!, { type });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

describe('folder reader', () => {
  it('takes audio files and skips covers and playlists in folders', () => {
    expect(isAudioFile('01 Intro.MP3')).toBe(true);
    expect(isAudioFile('track.flac')).toBe(true);
    expect(isAudioFile('odd-name', 'audio/ogg')).toBe(true);
    expect(isAudioFile('cover.jpg')).toBe(false);
    expect(isAudioFile('album.m3u')).toBe(false);
    expect(isAudioFile('.mp3')).toBe(false);
  });

  it('sorts naturally, with a folder’s own files before its subfolders', () => {
    const paths = [
      'Album/Bonus/1 Demo.mp3',
      'Album/10 Outro.mp3',
      'Album/2 Song.mp3',
      'Album/CD 10/1 a.mp3',
      'Album/CD 2/1 a.mp3',
      'Album/1 Intro.mp3',
    ].map((path) => path.split('/'));
    expect(paths.sort(comparePaths).map((path) => path.join('/'))).toEqual([
      'Album/1 Intro.mp3',
      'Album/2 Song.mp3',
      'Album/10 Outro.mp3',
      'Album/Bonus/1 Demo.mp3',
      'Album/CD 2/1 a.mp3',
      'Album/CD 10/1 a.mp3',
    ]);
  });

  it('keeps loose files as given, and reads a picked folder in order', () => {
    const loose = [new File(['x'], 'b.mp3'), new File(['x'], 'a.txt')];
    expect(entriesFromFiles(loose).map((entry) => [entry.file.name, entry.folder])).toEqual([
      ['b.mp3', null],
      ['a.txt', null],
    ]);
    const folder = [
      inFolder('Mix/CD2/01 x.mp3'),
      inFolder('Mix/cover.jpg', 'image/jpeg'),
      inFolder('Mix/CD1/10 y.flac'),
      inFolder('Mix/CD1/9 z.wav'),
    ];
    expect(entriesFromFiles(folder).map((entry) => [entry.file.name, entry.folder])).toEqual([
      ['9 z.wav', 'Mix/CD1'],
      ['10 y.flac', 'Mix/CD1'],
      ['01 x.mp3', 'Mix/CD2'],
    ]);
  });
});
