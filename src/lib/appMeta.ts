/**
 * Official product identity — separate from the user-editable client display name.
 * Bump APP_VERSION when you cut a release (keep in sync with package.json).
 */
export const APP_BRAND = "MattChat";
export const APP_VERSION = "0.1.0";
/** Model / agent that built this UI stack */
export const APP_BUILT_BY = "Grok 4.5";
export const APP_TAGLINE = "Omnimodal chat · clinical timing · A/B";

export function appVersionLabel() {
  return `v${APP_VERSION}`;
}

export function appBuiltByLabel() {
  return `Built by ${APP_BUILT_BY}`;
}
