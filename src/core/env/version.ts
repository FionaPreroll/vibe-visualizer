/** The name of the build running (vite-plugins/build-info.ts). */
export const BUILD_ID: string = __BUILD_ID__;

/** The version of the build running: "0.9.20261003.1432", from when it was built (UTC). */
export const APP_VERSION: string = __APP_VERSION__;

/** When the build running was made. */
export const BUILT_AT = new Date(__BUILT_AT__);

/** A build on the server (`version.json`). */
export interface DeployedBuild {
  build: string;
  /** Null for a build from before versions. */
  version: string | null;
}

/**
 * The build deployed since this one loaded (NF-09), when `version.json` on the server names
 * another one. Null when it names this build, or when that cannot be told (offline, or the dev
 * server).
 */
export async function newerBuild(get: typeof fetch = fetch): Promise<DeployedBuild | null> {
  try {
    const response = await get('/version.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const { build, version } = (await response.json()) as { build?: unknown; version?: unknown };
    if (typeof build !== 'string' || build === BUILD_ID) return null;
    return { build, version: typeof version === 'string' ? version : null };
  } catch {
    return null;
  }
}

/** When a build was made, for people: "3 October 2026, 14:32 UTC". */
export function builtAtText(date: Date = BUILT_AT): string {
  const day = date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const time = date.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  return `${day}, ${time} UTC`;
}
