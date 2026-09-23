/**
 * Static asset registry.
 *
 * Pixel Brawl draws every fighter, stage and effect procedurally on <canvas>
 * and synthesises all music/SFX with the Web Audio API, so the game itself
 * ships with no binary assets. Any image/logo/icon added later must be
 * registered here and imported from this file — never hardcoded in a page.
 */

export const FILES: Record<string, string> = {
  // key: "https://..."
};

export type FileKey = keyof typeof FILES;
