import { describe, expect, it } from 'vitest';
import { BUILD_ID, newerBuild } from './version';

const serving = (body: unknown, status = 200) =>
  (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    })) as typeof fetch;

describe('newer build', () => {
  it('has a name', () => {
    expect(BUILD_ID).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
  });

  it('is out when the server names another build', async () => {
    expect(await newerBuild(serving({ build: BUILD_ID }))).toBe(false);
    expect(await newerBuild(serving({ build: 'later' }))).toBe(true);
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
