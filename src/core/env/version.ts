/** The name of the build running (vite-plugins/build-id.ts). */
export const BUILD_ID: string = __BUILD_ID__;

/**
 * Whether a newer build was deployed since this one loaded (NF-09): `version.json` on the
 * server names another build. Null when that cannot be told (offline, or the dev server).
 */
export async function newerBuild(get: typeof fetch = fetch): Promise<boolean | null> {
  try {
    const response = await get('/version.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const { build } = (await response.json()) as { build?: unknown };
    return typeof build === 'string' ? build !== BUILD_ID : null;
  } catch {
    return null;
  }
}
