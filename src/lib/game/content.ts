/**
 * PIXEL BRAWL — static game content.
 * Roster, move tables, stage layouts and CPU difficulty tuning.
 * Everything here is pure data so the engine stays deterministic and fast.
 */

export type Facing = 1 | -1;

export interface ProjectileDef {
  speed: number;
  gravity: number;
  life: number;
  w: number;
  h: number;
  color: string;
  glow: string;
  shape: "orb" | "bolt" | "rock" | "flame";
  spin?: boolean;
}

export interface MoveDef {
  id: string;
  name: string;
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  baseKb: number;
  kbScale: number;
  /** Launch angle in degrees, measured from the attacker's forward direction. */
  angle: number;
  hitOX: number;
  hitOY: number;
  hitW: number;
  hitH: number;
  backwards?: boolean;
  spike?: boolean;
  selfVX?: number;
  selfVY?: number;
  /** Momentum is applied when the hitbox becomes active instead of on startup. */
  airOnly?: boolean;
  groundOnly?: boolean;
  projectile?: ProjectileDef;
  armor?: number;
  intangible?: boolean;
  pull?: number;
  resetsAir?: boolean;
  slam?: boolean;
  sfx?: "light" | "heavy" | "proj";
  fx?: string;
}

export interface CharacterDef {
  slug: string;
  name: string;
  title: string;
  description: string;
  quote: string;
  colors: {
    main: string;
    dark: string;
    light: string;
    accent: string;
    eye: string;
  };
  weight: number;
  runSpeed: number;
  jumpV: number;
  airJumps: number;
  gravityMul: number;
  powerMul: number;
  sizeMul: number;
  frameMul: number;
  stats: { power: number; speed: number; weight: number; range: number };
  moves: Record<string, MoveDef>;
}

/* ------------------------------------------------------------------ */
/* Shared normal attacks — every fighter gets these, scaled by power.   */
/* ------------------------------------------------------------------ */

const BASE_MOVES: Record<string, MoveDef> = {
  jab: {
    id: "jab", name: "Jab", startup: 4, active: 3, recovery: 9,
    damage: 3.5, baseKb: 3.4, kbScale: 0.06, angle: 42,
    hitOX: 34, hitOY: -6, hitW: 42, hitH: 32, sfx: "light",
  },
  ftilt: {
    id: "ftilt", name: "Side Tilt", startup: 7, active: 4, recovery: 14,
    damage: 9, baseKb: 5, kbScale: 0.16, angle: 30,
    hitOX: 46, hitOY: -8, hitW: 54, hitH: 36, sfx: "light",
  },
  fsmash: {
    id: "fsmash", name: "Side Smash", startup: 13, active: 4, recovery: 26,
    damage: 16, baseKb: 7.5, kbScale: 0.29, angle: 35,
    hitOX: 56, hitOY: -6, hitW: 68, hitH: 46, sfx: "heavy", fx: "smash",
  },
  utilt: {
    id: "utilt", name: "Up Tilt", startup: 6, active: 5, recovery: 13,
    damage: 8, baseKb: 5, kbScale: 0.18, angle: 82,
    hitOX: 8, hitOY: -54, hitW: 60, hitH: 48, sfx: "light",
  },
  dtilt: {
    id: "dtilt", name: "Down Tilt", startup: 6, active: 4, recovery: 12,
    damage: 7, baseKb: 4.6, kbScale: 0.13, angle: 18,
    hitOX: 40, hitOY: 22, hitW: 52, hitH: 28, sfx: "light",
  },
  dash: {
    id: "dash", name: "Dash Attack", startup: 8, active: 6, recovery: 19,
    damage: 11, baseKb: 6, kbScale: 0.17, angle: 48,
    hitOX: 42, hitOY: 0, hitW: 58, hitH: 48, selfVX: 7, sfx: "heavy",
  },
  nair: {
    id: "nair", name: "Neutral Air", startup: 5, active: 7, recovery: 12,
    damage: 8, baseKb: 4.6, kbScale: 0.14, angle: 45,
    hitOX: 0, hitOY: -4, hitW: 84, hitH: 70, airOnly: true, sfx: "light",
  },
  fair: {
    id: "fair", name: "Forward Air", startup: 9, active: 4, recovery: 16,
    damage: 12, baseKb: 5.6, kbScale: 0.21, angle: 32,
    hitOX: 48, hitOY: -10, hitW: 58, hitH: 48, airOnly: true, sfx: "heavy",
  },
  bair: {
    id: "bair", name: "Back Air", startup: 7, active: 4, recovery: 15,
    damage: 11.5, baseKb: 6, kbScale: 0.22, angle: 18,
    hitOX: -48, hitOY: -6, hitW: 56, hitH: 44, backwards: true, airOnly: true, sfx: "heavy",
  },
  uair: {
    id: "uair", name: "Up Air", startup: 6, active: 5, recovery: 13,
    damage: 9, baseKb: 5, kbScale: 0.19, angle: 88,
    hitOX: 4, hitOY: -56, hitW: 62, hitH: 50, airOnly: true, sfx: "light",
  },
  dair: {
    id: "dair", name: "Down Air (Spike)", startup: 11, active: 5, recovery: 20,
    damage: 13, baseKb: 4.2, kbScale: 0.14, angle: -80, spike: true,
    hitOX: 6, hitOY: 46, hitW: 52, hitH: 46, airOnly: true, sfx: "heavy", fx: "spike",
  },
};

function tune(
  overrides: Record<string, Partial<MoveDef>>,
  powerMul: number,
  frameMul: number,
  specials: Record<string, MoveDef>
): Record<string, MoveDef> {
  const out: Record<string, MoveDef> = {};
  for (const [key, base] of Object.entries(BASE_MOVES)) {
    const merged: MoveDef = { ...base, ...(overrides[key] || {}) };
    merged.damage = Math.round(merged.damage * powerMul * 10) / 10;
    merged.startup = Math.max(3, Math.round(merged.startup * frameMul));
    merged.recovery = Math.max(4, Math.round(merged.recovery * frameMul));
    out[key] = merged;
  }
  for (const [key, def] of Object.entries(specials)) out[key] = def;
  return out;
}

/* ------------------------------------------------------------------ */
/* Roster                                                              */
/* ------------------------------------------------------------------ */

export const CHARACTERS: CharacterDef[] = [
  {
    slug: "blaze",
    name: "BLAZE",
    title: "Ember Vanguard",
    description:
      "All-round brawler with scorching fists. Reliable combos, a solid recovery and a fireball that punishes campers.",
    quote: "Burn bright, hit harder.",
    colors: { main: "#ff4d2d", dark: "#a81f12", light: "#ffb06b", accent: "#ffd23d", eye: "#fff3d6" },
    weight: 100, runSpeed: 6.4, jumpV: 15.4, airJumps: 1, gravityMul: 1,
    powerMul: 1, sizeMul: 1, frameMul: 1,
    stats: { power: 7, speed: 6, weight: 6, range: 6 },
    moves: tune({}, 1, 1, {
      neutralb: {
        id: "neutralb", name: "Ember Shot", startup: 11, active: 2, recovery: 18,
        damage: 7, baseKb: 4, kbScale: 0.1, angle: 38,
        hitOX: 40, hitOY: -10, hitW: 10, hitH: 10, sfx: "proj",
        projectile: { speed: 12, gravity: 0.08, life: 95, w: 26, h: 26, color: "#ff7a2d", glow: "#ffd23d", shape: "flame" },
      },
      sideb: {
        id: "sideb", name: "Flame Dash", startup: 10, active: 12, recovery: 22,
        damage: 12, baseKb: 6.2, kbScale: 0.19, angle: 42,
        hitOX: 34, hitOY: -4, hitW: 62, hitH: 58, selfVX: 14, sfx: "heavy", fx: "fire",
      },
      upb: {
        id: "upb", name: "Rising Blaze", startup: 6, active: 12, recovery: 20,
        damage: 10, baseKb: 6.4, kbScale: 0.17, angle: 80,
        hitOX: 6, hitOY: -34, hitW: 58, hitH: 84, selfVX: 3.4, selfVY: -17.5,
        sfx: "heavy", fx: "fire",
      },
      downb: {
        id: "downb", name: "Cinder Quake", startup: 14, active: 6, recovery: 26,
        damage: 11, baseKb: 5.4, kbScale: 0.19, angle: 62,
        hitOX: 0, hitOY: 24, hitW: 150, hitH: 44, groundOnly: true, sfx: "heavy", fx: "quake",
      },
    }),
  },
  {
    slug: "volt",
    name: "VOLT",
    title: "Static Runner",
    description:
      "Lightning-fast featherweight. Blistering dash attacks, a double jump to spare and a blink recovery — but flies off screen early.",
    quote: "Too slow. Always.",
    colors: { main: "#ffd83d", dark: "#a97900", light: "#fff3a8", accent: "#5ce1ff", eye: "#1a1030" },
    weight: 78, runSpeed: 8.6, jumpV: 16.2, airJumps: 2, gravityMul: 1.02,
    powerMul: 0.85, sizeMul: 0.92, frameMul: 0.85,
    stats: { power: 5, speed: 10, weight: 3, range: 5 },
    moves: tune({ jab: { recovery: 7 }, nair: { active: 8 } }, 0.85, 0.85, {
      neutralb: {
        id: "neutralb", name: "Volt Bolt", startup: 8, active: 2, recovery: 13,
        damage: 5, baseKb: 3.2, kbScale: 0.08, angle: 30,
        hitOX: 38, hitOY: -12, hitW: 10, hitH: 10, sfx: "proj",
        projectile: { speed: 18, gravity: 0, life: 55, w: 30, h: 12, color: "#ffe45e", glow: "#5ce1ff", shape: "bolt" },
      },
      sideb: {
        id: "sideb", name: "Thunder Rush", startup: 8, active: 10, recovery: 20,
        damage: 9, baseKb: 5.2, kbScale: 0.17, angle: 26,
        hitOX: 30, hitOY: -6, hitW: 58, hitH: 54, selfVX: 19, sfx: "heavy", fx: "spark",
      },
      upb: {
        id: "upb", name: "Blink Strike", startup: 5, active: 10, recovery: 18,
        damage: 8, baseKb: 6, kbScale: 0.2, angle: 76,
        hitOX: 8, hitOY: -30, hitW: 54, hitH: 80, selfVX: 6, selfVY: -21,
        intangible: true, sfx: "heavy", fx: "spark",
      },
      downb: {
        id: "downb", name: "Static Field", startup: 10, active: 8, recovery: 22,
        damage: 7, baseKb: 4.4, kbScale: 0.13, angle: 88,
        hitOX: 0, hitOY: -8, hitW: 128, hitH: 112, sfx: "light", fx: "spark",
      },
    }),
  },
  {
    slug: "tusk",
    name: "TUSK",
    title: "Iron Colossus",
    description:
      "Super-heavyweight wall of muscle. Slow and clumsy, plows through weak hits with armour, and ends stocks with one charged smash.",
    quote: "The ground remembers me.",
    colors: { main: "#7be08a", dark: "#2f7a45", light: "#c8ffd4", accent: "#ffb648", eye: "#12281c" },
    weight: 138, runSpeed: 4.9, jumpV: 13.8, airJumps: 1, gravityMul: 1.18,
    powerMul: 1.3, sizeMul: 1.18, frameMul: 1.26,
    stats: { power: 10, speed: 3, weight: 10, range: 7 },
    moves: tune(
      { fsmash: { baseKb: 8.4, kbScale: 0.33 }, dair: { kbScale: 0.16 } },
      1.3, 1.26,
      {
        neutralb: {
          id: "neutralb", name: "Boulder Toss", startup: 16, active: 2, recovery: 24,
          damage: 14, baseKb: 6, kbScale: 0.2, angle: 45,
          hitOX: 40, hitOY: -16, hitW: 10, hitH: 10, sfx: "proj",
          projectile: { speed: 9.5, gravity: 0.34, life: 130, w: 38, h: 38, color: "#9a7b55", glow: "#ffb648", shape: "rock", spin: true },
        },
        sideb: {
          id: "sideb", name: "Iron Charge", startup: 13, active: 16, recovery: 28,
          damage: 16, baseKb: 7, kbScale: 0.22, angle: 38,
          hitOX: 40, hitOY: -4, hitW: 70, hitH: 70, selfVX: 12.5, armor: 12,
          sfx: "heavy", fx: "quake",
        },
        upb: {
          id: "upb", name: "Titan Leap", startup: 8, active: 12, recovery: 24,
          damage: 12, baseKb: 6.2, kbScale: 0.18, angle: 84,
          hitOX: 4, hitOY: -34, hitW: 66, hitH: 86, selfVX: 2.5, selfVY: -16.5,
          sfx: "heavy", fx: "quake",
        },
        downb: {
          id: "downb", name: "Ground Pound", startup: 12, active: 8, recovery: 30,
          damage: 18, baseKb: 7.4, kbScale: 0.25, angle: 58,
          hitOX: 0, hitOY: 26, hitW: 166, hitH: 50, slam: true, armor: 16,
          sfx: "heavy", fx: "quake",
        },
      }
    ),
  },
  {
    slug: "nyx",
    name: "NYX",
    title: "Void Dancer",
    description:
      "Floaty zoner who rules the air. Void orbs control space, a gravity well drags fighters in and a triple jump makes her a nightmare to edgeguard.",
    quote: "The dark is only a door.",
    colors: { main: "#b794ff", dark: "#5b2f9e", light: "#e7d9ff", accent: "#57f2d0", eye: "#f2f0ff" },
    weight: 84, runSpeed: 6.1, jumpV: 14.9, airJumps: 2, gravityMul: 0.8,
    powerMul: 0.95, sizeMul: 0.98, frameMul: 0.96,
    stats: { power: 6, speed: 7, weight: 4, range: 9 },
    moves: tune({ fair: { hitOX: 54, hitW: 64 }, uair: { hitH: 56 } }, 0.95, 0.96, {
      neutralb: {
        id: "neutralb", name: "Void Orb", startup: 12, active: 2, recovery: 20,
        damage: 9, baseKb: 4.8, kbScale: 0.15, angle: 44,
        hitOX: 40, hitOY: -12, hitW: 10, hitH: 10, sfx: "proj",
        projectile: { speed: 7.5, gravity: 0, life: 135, w: 32, h: 32, color: "#b794ff", glow: "#57f2d0", shape: "orb", spin: true },
      },
      sideb: {
        id: "sideb", name: "Shadow Slip", startup: 9, active: 10, recovery: 22,
        damage: 11, baseKb: 5.6, kbScale: 0.18, angle: 34,
        hitOX: 34, hitOY: -6, hitW: 60, hitH: 56, selfVX: 15, intangible: true,
        sfx: "heavy", fx: "void",
      },
      upb: {
        id: "upb", name: "Wraith Ascend", startup: 6, active: 12, recovery: 20,
        damage: 7.5, baseKb: 5.4, kbScale: 0.17, angle: 86,
        hitOX: 4, hitOY: -32, hitW: 56, hitH: 88, selfVX: 1.5, selfVY: -19,
        sfx: "heavy", fx: "void",
      },
      downb: {
        id: "downb", name: "Gravity Well", startup: 16, active: 10, recovery: 26,
        damage: 12, baseKb: 6, kbScale: 0.2, angle: 70,
        hitOX: 0, hitOY: -10, hitW: 176, hitH: 150, pull: 1.6, sfx: "heavy", fx: "void",
      },
    }),
  },
];

/* ------------------------------------------------------------------ */
/* Stages                                                              */
/* ------------------------------------------------------------------ */

export interface Platform {
  x: number;
  y: number;
  w: number;
  /** Main floor is drawn thicker and is never dropped through by the CPU. */
  main?: boolean;
}

export interface StageDef {
  slug: string;
  name: string;
  subtitle: string;
  description: string;
  theme: string;
  hazardLevel: number;
  friction: number;
  platforms: Platform[];
  spawns: { x: number; y: number }[];
  palette: {
    sky: [string, string, string];
    far: string;
    mid: string;
    near: string;
    floor: string;
    floorEdge: string;
    accent: string;
    glow: string;
  };
}

export const WORLD_W = 1280;
export const WORLD_H = 720;
export const BLAST = { left: -250, right: WORLD_W + 250, top: -330, bottom: WORLD_H + 310 };

export const STAGES: StageDef[] = [
  {
    slug: "neon_rooftop",
    name: "NEON ROOFTOP",
    subtitle: "Sector 9 — 03:14 AM",
    description: "A rain-slicked rooftop above a sleepless neon city. Two floating billboards make perfect juggling platforms.",
    theme: "Neon Overdrive",
    hazardLevel: 1,
    friction: 0.8,
    platforms: [
      { x: 250, y: 528, w: 780, main: true },
      { x: 330, y: 386, w: 190 },
      { x: 760, y: 386, w: 190 },
    ],
    spawns: [{ x: 470, y: 360 }, { x: 810, y: 360 }],
    palette: {
      sky: ["#11052b", "#2b0a4a", "#57106b"],
      far: "#1d0940", mid: "#2a0f55", near: "#12062e",
      floor: "#241243", floorEdge: "#ff2e97", accent: "#00e5ff", glow: "#ff2e97",
    },
  },
  {
    slug: "jungle_ruins",
    name: "JUNGLE RUINS",
    subtitle: "Temple of the Jade Ape",
    description: "Overgrown temple stones under a jade canopy. Three soft platforms in classic battlefield formation.",
    theme: "Jade Canopy",
    hazardLevel: 2,
    friction: 0.82,
    platforms: [
      { x: 230, y: 546, w: 820, main: true },
      { x: 330, y: 416, w: 180 },
      { x: 770, y: 416, w: 180 },
      { x: 552, y: 300, w: 176 },
    ],
    spawns: [{ x: 440, y: 380 }, { x: 840, y: 380 }],
    palette: {
      sky: ["#04231b", "#0b4534", "#1c7a4f"],
      far: "#0a3427", mid: "#12523a", near: "#06201a",
      floor: "#3f5d34", floorEdge: "#a8e06a", accent: "#ffd76a", glow: "#7dff9e",
    },
  },
  {
    slug: "lava_forge",
    name: "LAVA FORGE",
    subtitle: "Anvil of the Deep",
    description: "A narrow anvil suspended over molten rock. Tiny ledges, huge blast zones — one mistake and you are ash.",
    theme: "Molten Anvil",
    hazardLevel: 3,
    friction: 0.78,
    platforms: [
      { x: 400, y: 512, w: 480, main: true },
      { x: 236, y: 418, w: 148 },
      { x: 896, y: 418, w: 148 },
      { x: 556, y: 316, w: 168 },
    ],
    spawns: [{ x: 500, y: 360 }, { x: 780, y: 360 }],
    palette: {
      sky: ["#1b0403", "#4a0d06", "#8f1c05" ],
      far: "#2a0705", mid: "#5c1206", near: "#180302",
      floor: "#33201c", floorEdge: "#ff7a18", accent: "#ffd23d", glow: "#ff4d12",
    },
  },
  {
    slug: "frost_spire",
    name: "FROST SPIRE",
    subtitle: "Aurora Peaks",
    description: "Frozen towers beneath an aurora sky. Slippery ice floor and a high central platform for aerial duels.",
    theme: "Aurora Frost",
    hazardLevel: 2,
    friction: 0.93,
    platforms: [
      { x: 258, y: 536, w: 764, main: true },
      { x: 322, y: 428, w: 156 },
      { x: 802, y: 428, w: 156 },
      { x: 544, y: 320, w: 192 },
    ],
    spawns: [{ x: 460, y: 360 }, { x: 820, y: 360 }],
    palette: {
      sky: ["#030a24", "#0b2350", "#1b4f8f"],
      far: "#0a1c45", mid: "#123c6e", near: "#050f2a",
      floor: "#2a4d78", floorEdge: "#9be8ff", accent: "#57f2d0", glow: "#7fd8ff",
    },
  },
];

/* ------------------------------------------------------------------ */
/* CPU difficulty                                                      */
/* ------------------------------------------------------------------ */

export interface DifficultyDef {
  id: "easy" | "normal" | "hard" | "insane";
  label: string;
  tag: string;
  description: string;
  color: string;
  /** frames between AI decisions */
  think: number;
  reaction: number;
  aggression: number;
  attackChance: number;
  specialChance: number;
  shieldChance: number;
  dodgeChance: number;
  spacing: number;
  recovery: number;
  edgeguard: number;
  diSkill: number;
}

export const DIFFICULTIES: DifficultyDef[] = [
  {
    id: "easy", label: "ROOKIE", tag: "LV 1", color: "#7dff9e",
    description: "Wanders in, swings late and forgets to come back from the ledge.",
    think: 26, reaction: 24, aggression: 0.45, attackChance: 0.35, specialChance: 0.1,
    shieldChance: 0.05, dodgeChance: 0.03, spacing: 0.4, recovery: 0.55, edgeguard: 0, diSkill: 0.1,
  },
  {
    id: "normal", label: "BRAWLER", tag: "LV 4", color: "#ffd83d",
    description: "Trades hits fairly, shields sometimes and recovers most of the time.",
    think: 18, reaction: 16, aggression: 0.65, attackChance: 0.55, specialChance: 0.22,
    shieldChance: 0.18, dodgeChance: 0.12, spacing: 0.62, recovery: 0.8, edgeguard: 0.2, diSkill: 0.35,
  },
  {
    id: "hard", label: "VETERAN", tag: "LV 7", color: "#ff9d3d",
    description: "Spaces aerials, punishes whiffs, and will follow you off the stage.",
    think: 11, reaction: 9, aggression: 0.82, attackChance: 0.72, specialChance: 0.33,
    shieldChance: 0.34, dodgeChance: 0.26, spacing: 0.82, recovery: 0.94, edgeguard: 0.55, diSkill: 0.65,
  },
  {
    id: "insane", label: "NIGHTMARE", tag: "LV 9", color: "#ff2e97",
    description: "Frame-tight punishes, relentless edgeguards, perfect recoveries. Good luck.",
    think: 6, reaction: 4, aggression: 0.95, attackChance: 0.86, specialChance: 0.42,
    shieldChance: 0.5, dodgeChance: 0.42, spacing: 0.96, recovery: 1, edgeguard: 0.9, diSkill: 0.95,
  },
];

export const STOCK_OPTIONS = [2, 3, 5];
