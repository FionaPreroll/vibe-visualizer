let asked: Promise<boolean> | null = null;

/**
 * Asks the browser, once a session, to keep the app's data (NF-09). Without that, it may clear
 * it when the disk runs low: the images, the analysis, and an export not yet finished. Chromium
 * decides by itself (for sites used often, or installed); Firefox asks the user. So it is asked
 * when there is something worth keeping, after something the user did. True: it is kept.
 */
export function keepStorage(): Promise<boolean> {
  asked ??= ask();
  return asked;
}

async function ask(): Promise<boolean> {
  try {
    const storage = navigator.storage;
    if (typeof storage?.persist !== 'function') return false;
    return (await storage.persisted()) || (await storage.persist());
  } catch {
    return false;
  }
}
