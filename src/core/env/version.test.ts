import { describe, expect, it } from 'vitest';
import { APP_VERSION, BUILD_ID, BUILT_AT, builtAtText, newerBuild } from './version';

const serving = (body: unknown, status = 200) =>
  (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    })) as typeof fetch;

describe('the build', () => {
  it('has a name, a version from when it was built, and that time', () => {
    expect(BUILD_ID).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    expect(APP_VERSION).toMatch(/^0\.9\.\d{8}\.\d{4}$/);
    expect(Number.isNaN(BUILT_AT.getTime())).toBe(false);
  });

  it('says when it was built, in UTC', () => {
    expect(builtAtText(new Date('2026-10-03T14:32:59Z'))).toBe('3 October 2026, 14:32 UTC');
  });
});

describe('newer build', () => {
  it('is out when the server names another build, with its version', async () => {
    expect(await newerBuild(serving({ build: BUILD_ID, version: APP_VERSION }))).toBeNull();
    expect(await newerBuild(serving({ build: 'later', version: '0.9.20261004.0915' }))).toEqual({
      build: 'later',
      version: '0.9.20261004.0915',
    });
    // A build from before versions.
    expect(await newerBuild(serving({ build: 'later' }))).toEqual({
      build: 'later',
      version: null,
    });
  });

  it('is not known without a version from the server', async () => {
    expect(await newerBuild(serving('<!doctype html>'))).toBeNull();
    expect(await newerBuild(serving({ build: 'later' }, 404))).toBeNull();
    const offline = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    expect(await newerBuild(offline)).toBeNull();
  });
});
