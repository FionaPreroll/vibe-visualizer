/** `?quick` in the URL shortens all spike runs (used by the automated end-to-end tests). */
export const quickMode = new URLSearchParams(location.search).has('quick');
