import { describe, expect, it } from 'vitest';
import { buildToolNotices, emscriptenNotice, ffmpegNotice } from './third-party-extras';
import {
  noticesText,
  packageNotice,
  packageOf,
  sourceNote,
  sourceUrl,
  type Notice,
} from './third-party-notices';

describe('third-party notices', () => {
  it('finds the package of a module, also of a scoped one in pnpm', () => {
    expect(packageOf('/app/node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs')).toEqual(
      { name: 'clsx', dir: '/app/node_modules/.pnpm/clsx@2.1.1/node_modules/clsx' },
    );
    expect(packageOf('/app/node_modules/@fontsource/pacifico/400.css?inline')).toEqual({
      name: '@fontsource/pacifico',
      dir: '/app/node_modules/@fontsource/pacifico',
    });
    // Our own code, and the build's virtual modules, are no packages of others.
    expect(packageOf('/app/src/ui/App.svelte')).toBeNull();
    expect(packageOf('\0vite/modulepreload-polyfill.js')).toBeNull();
  });

  it('links the source of a package', () => {
    expect(sourceUrl('git+https://github.com/lukeed/clsx.git')).toBe(
      'https://github.com/lukeed/clsx',
    );
    expect(sourceUrl('git+ssh://git@github.com/indutny/fft.js.git')).toBe(
      'https://github.com/indutny/fft.js',
    );
    expect(sourceUrl('sveltejs/svelte')).toBe('https://github.com/sveltejs/svelte');
    expect(sourceUrl(undefined)).toBeNull();
  });

  it('reads a package: name, version, licence and its licence file', () => {
    const notice = packageNotice('node_modules/svelte');
    expect(notice).toMatchObject({ name: 'svelte', license: 'MIT' });
    expect(notice.url).toBe('https://github.com/sveltejs/svelte');
    expect(notice.texts.map(({ file }) => file)).toEqual(['LICENSE.md']);
    expect(notice.texts[0]!.text).toContain('Permission is hereby granted');
  });

  it('says where the source of an MPL package is', () => {
    const notice: Notice = {
      name: 'mediabunny',
      version: '1.60.0',
      license: 'MPL-2.0',
      url: null,
      texts: [],
    };
    expect(sourceNote(notice)).toContain('https://www.npmjs.com/package/mediabunny/v/1.60.0');
    expect(sourceNote({ ...notice, license: 'MIT' })).toBeUndefined();
  });

  it('writes the notices as text', () => {
    const text = noticesText('FibeStation', [
      {
        name: 'a',
        version: '1.0.0',
        license: 'MIT',
        url: 'https://a',
        texts: [{ file: 'LICENSE', text: 'A' }],
      },
    ]);
    expect(text).toContain('FibeStation contains these parts of others');
    expect(text).toContain('a 1.0.0 (MIT)\nSource: https://a\n\n--- LICENSE ---\n\nA');
  });

  it('adds FFmpeg with the LGPL, where its source is, and an offer of it', () => {
    const notice = ffmpegNotice('bugs@example.com');
    expect(notice.version).toMatch(/^libavcodec \d+\.\d+\.\d+$/);
    expect(notice.license).toBe('LGPL-2.1-or-later');
    expect(notice.note).toContain('https://github.com/FFmpeg/FFmpeg');
    expect(notice.note).toContain('write to bugs@example.com');
    expect(notice.texts[0]!.text).toContain('GNU LESSER GENERAL PUBLIC LICENSE');
  });

  it('adds the runtime of the WebAssembly and the build tools, with their own licences only', () => {
    expect(emscriptenNotice().texts.map(({ file }) => file)).toEqual(['LICENSE', 'COPYRIGHT']);
    const [vite, rolldown] = buildToolNotices();
    expect(vite!.texts[0]!.text).toContain('MIT License');
    expect(vite!.texts[0]!.text).not.toContain('Licenses of bundled dependencies');
    expect(rolldown!.texts[0]!.text).toContain('MIT License');
  });
});
