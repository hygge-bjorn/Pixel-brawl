/**
 * PIXEL BRAWL — physics / combat / AI / rendering engine.
 *
 * Runs on a fixed 60Hz timestep. Platform-fighter rules: percent based
 * knockback, stocks, blast zones, shields, dodges, projectiles and a
 * tunable CPU opponent.
 */

import {
  BLAST, CHARACTERS, DifficultyDef, MoveDef, Platform, StageDef, WORLD_H, WORLD_W,
  CharacterDef,
} from "./content";
import { chipAudio } from "./audio";

export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  attack: boolean;
  special: boolean;
  shield: boolean;
}

export const EMPTY_INPUT: InputState = {
  left: false, right: false, up: false, down: false,
  attack: false, special: false, shield: false,
};

export interface MatchConfig {
  stage: StageDef;
  chars: [CharacterDef, CharacterDef];
  p2IsCpu: boolean;
  difficulty: DifficultyDef;
  stocks: number;
}

export interface MatchResult {
  winnerIndex: number;
  loserIndex: number;
  winnerChar: string;
  loserChar: string;
  stage: string;
  mode: "cpu" | "versus";
  difficulty: string;
  stocksLeft: number;
  damageDealt: number;
  durationSeconds: number;
}

const GRAVITY = 0.62;
const MAX_FALL = 15.5;
const FAST_FALL = 1.6;
const GROUND_ACCEL = 0.95;
const AIR_ACCEL = 0.52;
const AIR_DRAG = 0.985;
const HITSTUN_DRAG = 0.965;
const SHIELD_MAX = 100;
const RESPAWN_FRAMES = 70;
const SPAWN_INVULN = 100;

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; color: string;
  kind: "spark" | "dust" | "ring" | "star" | "text" | "trail";
  text?: string;
  gravity?: number;
}

interface Projectile {
  x: number; y: number; vx: number; vy: number;
  life: number; owner: number; move: MoveDef; facing: number;
  rot: number;
}

interface AiBrain {
  hold: InputState;
  holdFrames: number;
  memoryTimer: number;
  seenX: number;
  seenY: number;
  seenAttacking: boolean;
  cooldown: number;
  platformTimer: number;
}

export interface Fighter {
  index: number;
  char: CharacterDef;
  isCpu: boolean;
  x: number; y: number; vx: number; vy: number;
  w: number; h: number;
  facing: number;
  damage: number;
  stocks: number;
  onGround: boolean;
  jumpsLeft: number;
  usedUpB: boolean;
  fastFalling: boolean;
  action: "none" | "attack" | "charge" | "shield" | "dodge" | "roll" | "hitstun" | "dead" | "respawn" | "shieldbreak";
  move: MoveDef | null;
  aFrame: number;
  chargeFrames: number;
  hitlag: number;
  hitstun: number;
  invuln: number;
  shieldHp: number;
  shieldCooldown: number;
  actionTimer: number;
  hitSet: Set<number>;
  respawnTimer: number;
  landTimer: number;
  animTimer: number;
  damageDealt: number;
  kos: number;
  combo: number;
  comboTimer: number;
  lastHurtBy: number;
  prev: InputState;
  input: InputState;
  ai: AiBrain;
  flash: number;
  squash: number;
}

function rect(x: number, y: number, w: number, h: number) {
  return { x, y, w, h };
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export class BrawlEngine {
  config: MatchConfig;
  fighters: Fighter[] = [];
  projectiles: Projectile[] = [];
  particles: Particle[] = [];
  phase: "intro" | "fight" | "finish" | "over" = "intro";
  frame = 0;
  matchFrames = 0;
  introFrames = 200;
  finishTimer = 0;
  result: MatchResult | null = null;
  paused = false;
  shake = 0;
  hitStop = 0;
  camX = WORLD_W / 2;
  camY = WORLD_H / 2;
  camScale = 1;
  fontFamily = "monospace";
  announcement = "";
  announceTimer = 0;
  private lastCountdown = -1;

  constructor(config: MatchConfig) {
    this.config = config;
    this.fighters = [0, 1].map((i) => this.makeFighter(i));
    console.log(
      "[engine] match started:",
      config.chars[0].name, "vs", config.chars[1].name,
      "| stage:", config.stage.name,
      "| mode:", config.p2IsCpu ? `CPU ${config.difficulty.label}` : "VERSUS",
      "| stocks:", config.stocks
    );
  }

  private makeFighter(index: number): Fighter {
    const char = this.config.chars[index];
    const spawn = this.config.stage.spawns[index];
    return {
      index,
      char,
      isCpu: index === 1 && this.config.p2IsCpu,
      x: spawn.x, y: spawn.y, vx: 0, vy: 0,
      w: 44 * char.sizeMul, h: 80 * char.sizeMul,
      facing: index === 0 ? 1 : -1,
      damage: 0,
      stocks: this.config.stocks,
      onGround: false,
      jumpsLeft: char.airJumps,
      usedUpB: false,
      fastFalling: false,
      action: "none",
      move: null,
      aFrame: 0,
      chargeFrames: 0,
      hitlag: 0,
      hitstun: 0,
      invuln: SPAWN_INVULN,
      shieldHp: SHIELD_MAX,
      shieldCooldown: 0,
      actionTimer: 0,
      hitSet: new Set(),
      respawnTimer: 0,
      landTimer: 0,
      animTimer: 0,
      damageDealt: 0,
      kos: 0,
      combo: 0,
      comboTimer: 0,
      lastHurtBy: -1,
      prev: { ...EMPTY_INPUT },
      input: { ...EMPTY_INPUT },
      ai: {
        hold: { ...EMPTY_INPUT }, holdFrames: 0, memoryTimer: 0,
        seenX: spawn.x, seenY: spawn.y, seenAttacking: false, cooldown: 0, platformTimer: 0,
      },
      flash: 0,
      squash: 0,
    };
  }

  setInput(index: number, input: InputState) {
    this.fighters[index].input = input;
  }

  /* --------------------------------------------------------------- */
  /* Main update                                                      */
  /* --------------------------------------------------------------- */

  update() {
    if (this.paused || this.phase === "over") return;
    this.frame++;

    if (this.phase === "intro") {
      this.introFrames--;
      const secs = Math.ceil(this.introFrames / 60);
      if (secs !== this.lastCountdown && secs >= 0 && this.introFrames > 0) {
        this.lastCountdown = secs;
        chipAudio.countdown(secs > 3 ? 4 : secs);
      }
      if (this.introFrames <= 0) {
        this.phase = "fight";
        this.announce("BRAWL!", 70);
        chipAudio.countdown(0);
      }
    } else if (this.phase === "fight") {
      this.matchFrames++;
    } else if (this.phase === "finish") {
      this.finishTimer--;
      if (this.finishTimer <= 0) {
        this.phase = "over";
        console.log("[engine] match over:", this.result);
      }
    }

    if (this.announceTimer > 0) this.announceTimer--;
    if (this.shake > 0) this.shake *= 0.88;
    if (this.hitStop > 0) {
      this.hitStop--;
      this.updateParticles();
      this.updateCamera();
      return;
    }

    for (const f of this.fighters) {
      if (f.isCpu && this.phase === "fight") this.cpuThink(f, this.fighters[1 - f.index]);
      else if (f.isCpu) f.input = { ...EMPTY_INPUT };
      if (this.phase !== "fight" && !f.isCpu) {
        // during countdown/finish players can't act, but gravity still applies
        f.input = { ...EMPTY_INPUT };
      }
    }

    for (const f of this.fighters) this.updateFighter(f);
    this.updateProjectiles();
    this.resolveHits();
    this.updateParticles();
    this.updateCamera();

    for (const f of this.fighters) {
      for (const k of Object.keys(f.prev) as (keyof InputState)[]) f.prev[k] = f.input[k];
    }
  }

  private announce(text: string, frames: number) {
    this.announcement = text;
    this.announceTimer = frames;
  }

  /* --------------------------------------------------------------- */
  /* Fighter simulation                                               */
  /* --------------------------------------------------------------- */

  private updateFighter(f: Fighter) {
    f.animTimer++;
    if (f.flash > 0) f.flash--;
    if (f.squash > 0) f.squash *= 0.85;
    if (f.comboTimer > 0) { f.comboTimer--; if (f.comboTimer === 0) f.combo = 0; }

    if (f.hitlag > 0) { f.hitlag--; return; }
    if (f.invuln > 0) f.invuln--;

    if (f.action === "dead") {
      f.respawnTimer--;
      if (f.respawnTimer <= 0) this.respawn(f);
      return;
    }

    const inp = f.input;
    const pressed = (k: keyof InputState) => inp[k] && !f.prev[k];
    const stage = this.config.stage;

    /* --- hitstun & tumble --- */
    if (f.hitstun > 0) {
      f.hitstun--;
      f.action = f.hitstun > 0 ? "hitstun" : "none";
      // Directional influence
      const di = 0.11;
      if (inp.left) f.vx -= di;
      if (inp.right) f.vx += di;
      if (inp.up) f.vy -= di * 0.7;
      if (inp.down) f.vy += di * 0.7;
    }

    /* --- shield break stun --- */
    if (f.action === "shieldbreak") {
      f.actionTimer--;
      if (f.actionTimer <= 0) { f.action = "none"; f.shieldHp = SHIELD_MAX * 0.5; }
    }

    /* --- dodges / rolls --- */
    if (f.action === "dodge" || f.action === "roll") {
      f.actionTimer--;
      if (f.actionTimer <= 0) f.action = "none";
    }

    const busy =
      f.action === "attack" || f.action === "charge" || f.action === "dodge" ||
      f.action === "roll" || f.action === "hitstun" || f.action === "shieldbreak";

    /* --- shield --- */
    if (!busy && f.onGround && inp.shield && f.shieldCooldown <= 0 && this.phase === "fight") {
      if (f.action !== "shield") chipAudio.shieldUp();
      f.action = "shield";
      f.shieldHp -= 0.42;
      f.vx *= 0.7;
      if (f.shieldHp <= 0) {
        f.action = "shieldbreak";
        f.actionTimer = 110;
        f.shieldCooldown = 60;
        f.vy = -9;
        this.spawnRing(f.x, f.y - f.h / 2, "#7fd8ff", 44);
        chipAudio.hitHeavy();
        this.shake = 14;
      }
      // roll / spot dodge out of shield
      if (pressed("left") || pressed("right")) {
        f.action = "roll";
        f.actionTimer = 26;
        f.invuln = Math.max(f.invuln, 17);
        f.facing = pressed("left") ? -1 : 1;
        f.vx = (pressed("left") ? -1 : 1) * 11.5;
        chipAudio.dodge();
      } else if (pressed("down")) {
        f.action = "dodge";
        f.actionTimer = 24;
        f.invuln = Math.max(f.invuln, 16);
        f.vx = 0;
        chipAudio.dodge();
      }
    } else if (f.action === "shield") {
      f.action = "none";
    }

    if (f.action !== "shield") {
      f.shieldHp = Math.min(SHIELD_MAX, f.shieldHp + 0.22);
      if (f.shieldCooldown > 0) f.shieldCooldown--;
    }

    /* --- air dodge --- */
    if (!busy && !f.onGround && pressed("shield") && f.action !== "shield" && this.phase === "fight") {
      f.action = "dodge";
      f.actionTimer = 30;
      f.invuln = Math.max(f.invuln, 22);
      const dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      const dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      const len = Math.hypot(dx, dy) || 1;
      f.vx = (dx / len) * 12;
      f.vy = (dy / len) * 10 - 1;
      chipAudio.dodge();
      this.spawnPuff(f.x, f.y - f.h / 2, f.char.colors.light, 8);
    }

    /* --- attacks --- */
    if (!busy && f.action !== "shield" && this.phase === "fight") {
      if (pressed("special")) {
        let id = "neutralb";
        if (inp.up) id = "upb";
        else if (inp.down) id = "downb";
        else if (inp.left || inp.right) id = "sideb";
        const m = f.char.moves[id];
        if (m && !(m.groundOnly && !f.onGround) && !(id === "upb" && !f.onGround && f.usedUpB)) {
          if (inp.left) f.facing = -1;
          if (inp.right) f.facing = 1;
          if (id === "upb" && !f.onGround) f.usedUpB = true;
          this.startMove(f, m);
        }
      } else if (pressed("attack")) {
        if (f.onGround) {
          const dashing = Math.abs(f.vx) > f.char.runSpeed * 0.72 && (inp.left || inp.right);
          if (dashing) this.startMove(f, f.char.moves.dash);
          else if (inp.up) this.startMove(f, f.char.moves.utilt);
          else if (inp.down) this.startMove(f, f.char.moves.dtilt);
          else if (inp.left || inp.right) {
            f.facing = inp.left ? -1 : 1;
            f.action = "charge";
            f.chargeFrames = 0;
            f.move = f.char.moves.fsmash;
          } else this.startMove(f, f.char.moves.jab);
        } else {
          if (inp.down) this.startMove(f, f.char.moves.dair);
          else if (inp.up) this.startMove(f, f.char.moves.uair);
          else if ((inp.right && f.facing > 0) || (inp.left && f.facing < 0)) this.startMove(f, f.char.moves.fair);
          else if ((inp.right && f.facing < 0) || (inp.left && f.facing > 0)) this.startMove(f, f.char.moves.bair);
          else this.startMove(f, f.char.moves.nair);
        }
      }
    }

    /* --- charging a smash --- */
    if (f.action === "charge") {
      f.chargeFrames++;
      f.vx *= 0.7;
      if (!inp.attack || f.chargeFrames >= 48) {
        const charge = clamp(f.chargeFrames / 48, 0, 1);
        if (f.chargeFrames < 6) {
          this.startMove(f, f.char.moves.ftilt);
        } else {
          this.startMove(f, f.char.moves.fsmash, 1 + charge * 0.75);
        }
      }
    }

    /* --- active attack --- */
    if (f.action === "attack" && f.move) {
      const m = f.move;
      if (f.aFrame === m.startup) {
        if (m.selfVX) f.vx = m.selfVX * f.facing;
        if (m.selfVY) { f.vy = m.selfVY; f.fastFalling = false; }
        if (m.slam && !f.onGround) f.vy = 22;
        if (m.projectile) this.spawnProjectile(f, m);
        if (m.sfx === "heavy") chipAudio.swing();
        else if (m.sfx === "proj") chipAudio.projectile();
        else chipAudio.swing();
        if (m.fx) this.spawnMoveFx(f, m);
      }
      if (m.intangible && f.aFrame >= m.startup && f.aFrame < m.startup + m.active) {
        f.invuln = Math.max(f.invuln, 2);
      }
      if (m.pull && f.aFrame >= m.startup && f.aFrame < m.startup + m.active) {
        const opp = this.fighters[1 - f.index];
        if (opp.action !== "dead" && Math.hypot(opp.x - f.x, opp.y - f.y) < 260) {
          opp.vx += Math.sign(f.x - opp.x) * m.pull * 0.5;
          opp.vy -= 0.2;
        }
      }
      f.aFrame++;
      if (f.aFrame >= m.startup + m.active + m.recovery) {
        f.action = "none";
        f.move = null;
        f.hitSet.clear();
      }
    }

    /* --- horizontal movement --- */
    const canMove = f.action === "none" || f.action === "hitstun";
    const moveLocked = f.action === "attack" || f.action === "charge" || f.action === "dodge" ||
      f.action === "roll" || f.action === "shield" || f.action === "shieldbreak";

    if (canMove && f.hitstun <= 0) {
      const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      const maxSpeed = f.char.runSpeed;
      if (dir !== 0) {
        const accel = f.onGround ? GROUND_ACCEL : AIR_ACCEL;
        f.vx += dir * accel;
        f.vx = clamp(f.vx, -maxSpeed * 1.25, maxSpeed * 1.25);
        if (Math.abs(f.vx) > maxSpeed) f.vx *= 0.94;
        f.facing = dir as 1 | -1;
        if (f.onGround && f.animTimer % 9 === 0) this.spawnDust(f.x - dir * 12, f.y, 1);
      } else if (f.onGround) {
        f.vx *= stage.friction;
        if (Math.abs(f.vx) < 0.08) f.vx = 0;
      }
    } else if (moveLocked && f.onGround) {
      f.vx *= 0.9;
    }

    /* --- jumping --- */
    if ((f.action === "none") && this.phase === "fight") {
      if (pressed("up")) {
        if (f.onGround) {
          f.vy = -f.char.jumpV;
          f.onGround = false;
          f.fastFalling = false;
          chipAudio.jump();
          this.spawnDust(f.x, f.y, 6);
        } else if (f.jumpsLeft > 0) {
          f.jumpsLeft--;
          f.vy = -f.char.jumpV * 0.94;
          const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
          if (dir !== 0) { f.vx = dir * f.char.runSpeed * 0.9; f.facing = dir as 1 | -1; }
          f.fastFalling = false;
          chipAudio.doubleJump();
          this.spawnRing(f.x, f.y - f.h / 2, f.char.colors.light, 26);
        }
      }
      // short hop
      if (f.vy < -5 && !inp.up && !f.onGround) f.vy *= 0.86;
      if (!f.onGround && inp.down && f.vy > 1) f.fastFalling = true;
    }

    /* --- gravity --- */
    const grav = GRAVITY * f.char.gravityMul * (f.action === "dodge" && !f.onGround ? 0.4 : 1);
    f.vy += grav;
    const maxFall = MAX_FALL * (f.fastFalling ? FAST_FALL : 1) * (f.char.gravityMul > 1 ? 1.1 : 1);
    if (f.vy > maxFall) f.vy = maxFall;
    if (!f.onGround) f.vx *= f.hitstun > 0 ? HITSTUN_DRAG : AIR_DRAG;

    /* --- integrate + platform collision --- */
    const prevFeet = f.y;
    f.x += f.vx;
    f.y += f.vy;

    let landed = false;
    if (f.vy >= 0 && !(inp.down && f.action === "none" && f.vy > 0 && this.dropThroughAllowed(f))) {
      for (const p of stage.platforms) {
        if (f.x + f.w * 0.3 < p.x || f.x - f.w * 0.3 > p.x + p.w) continue;
        if (prevFeet <= p.y + 6 && f.y >= p.y) {
          f.y = p.y;
          f.vy = 0;
          landed = true;
          break;
        }
      }
    }

    if (landed) {
      if (!f.onGround) {
        f.squash = 1;
        this.spawnDust(f.x, f.y, 6);
        f.landTimer = 8;
        if (f.action === "attack" && f.move && f.move.slam) {
          this.slamShockwave(f, f.move);
        }
      }
      f.onGround = true;
      f.jumpsLeft = f.char.airJumps;
      f.usedUpB = false;
      f.fastFalling = false;
      if (f.hitstun > 0 && Math.abs(f.vy) > 6) f.vy = -Math.abs(f.vy) * 0.35;
    } else {
      f.onGround = false;
    }
    if (f.landTimer > 0) f.landTimer--;

    /* --- blast zones --- */
    if (f.x < BLAST.left || f.x > BLAST.right || f.y > BLAST.bottom || f.y - f.h < BLAST.top) {
      this.koFighter(f);
    }
  }

  private dropThroughAllowed(f: Fighter) {
    // can drop through the thin platforms, never through the main floor
    for (const p of this.config.stage.platforms) {
      if (!p.main && f.x >= p.x && f.x <= p.x + p.w && Math.abs(f.y - p.y) < 10) return true;
    }
    return false;
  }

  private startMove(f: Fighter, m: MoveDef, powerScale = 1) {
    f.action = "attack";
    f.move = powerScale === 1 ? m : { ...m, damage: m.damage * powerScale, baseKb: m.baseKb * (1 + (powerScale - 1) * 0.6), kbScale: m.kbScale * (1 + (powerScale - 1) * 0.8) };
    f.aFrame = 0;
    f.chargeFrames = 0;
    f.hitSet.clear();
  }

  private spawnProjectile(f: Fighter, m: MoveDef) {
    const def = m.projectile!;
    this.projectiles.push({
      x: f.x + m.hitOX * f.facing,
      y: f.y - f.h * 0.55 + m.hitOY,
      vx: def.speed * f.facing,
      vy: 0,
      life: def.life,
      owner: f.index,
      move: m,
      facing: f.facing,
      rot: 0,
    });
  }

  private spawnMoveFx(f: Fighter, m: MoveDef) {
    const c = f.char.colors;
    if (m.fx === "quake") {
      this.shake = Math.max(this.shake, 9);
      for (let i = 0; i < 14; i++) {
        this.particles.push({
          x: f.x + rand(-70, 70), y: f.y, vx: rand(-4, 4), vy: rand(-7, -2),
          life: 26, maxLife: 26, size: rand(4, 10), color: i % 2 ? c.accent : c.main, kind: "dust", gravity: 0.35,
        });
      }
    } else if (m.fx === "fire" || m.fx === "spark" || m.fx === "void") {
      for (let i = 0; i < 12; i++) {
        this.particles.push({
          x: f.x + rand(-20, 20), y: f.y - f.h * 0.5 + rand(-20, 20),
          vx: rand(-3, 3) - f.vx * 0.2, vy: rand(-3, 2),
          life: 22, maxLife: 22, size: rand(3, 8), color: i % 3 === 0 ? c.accent : c.main, kind: "spark",
        });
      }
    } else if (m.fx === "smash") {
      this.spawnRing(f.x + 40 * f.facing, f.y - f.h * 0.55, c.accent, 30);
    }
  }

  private slamShockwave(f: Fighter, m: MoveDef) {
    this.shake = 16;
    this.spawnRing(f.x, f.y, f.char.colors.accent, 60);
    for (let i = 0; i < 20; i++) {
      this.particles.push({
        x: f.x + rand(-90, 90), y: f.y, vx: rand(-7, 7), vy: rand(-9, -3),
        life: 30, maxLife: 30, size: rand(4, 11), color: i % 2 ? f.char.colors.main : f.char.colors.dark,
        kind: "dust", gravity: 0.4,
      });
    }
  }

  /* --------------------------------------------------------------- */
  /* Hit resolution                                                   */
  /* --------------------------------------------------------------- */

  private hitboxOf(f: Fighter, m: MoveDef) {
    const dir = m.backwards ? -f.facing : f.facing;
    const s = f.char.sizeMul;
    const cx = f.x + m.hitOX * dir * s;
    const cy = f.y - f.h * 0.5 + m.hitOY * s;
    return rect(cx - (m.hitW * s) / 2, cy - (m.hitH * s) / 2, m.hitW * s, m.hitH * s);
  }

  private bodyOf(f: Fighter) {
    return rect(f.x - f.w / 2, f.y - f.h, f.w, f.h);
  }

  private resolveHits() {
    for (const f of this.fighters) {
      if (f.action !== "attack" || !f.move || f.hitlag > 0) continue;
      const m = f.move;
      if (f.aFrame < m.startup || f.aFrame >= m.startup + m.active) continue;
      if (m.projectile) continue;
      const hb = this.hitboxOf(f, m);
      const opp = this.fighters[1 - f.index];
      if (opp.action === "dead" || f.hitSet.has(opp.index)) continue;
      if (overlaps(hb, this.bodyOf(opp))) {
        this.applyHit(f, opp, m, hb.x + hb.w / 2, hb.y + hb.h / 2);
        f.hitSet.add(opp.index);
      }
    }

    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const opp = this.fighters[1 - p.owner];
      if (opp.action === "dead") continue;
      const def = p.move.projectile!;
      const pr = rect(p.x - def.w / 2, p.y - def.h / 2, def.w, def.h);
      if (overlaps(pr, this.bodyOf(opp))) {
        const attacker = this.fighters[p.owner];
        const savedFacing = attacker.facing;
        attacker.facing = p.facing;
        this.applyHit(attacker, opp, p.move, p.x, p.y);
        attacker.facing = savedFacing;
        this.projectiles.splice(i, 1);
      }
    }
  }

  private applyHit(attacker: Fighter, target: Fighter, m: MoveDef, hx: number, hy: number) {
    if (target.invuln > 0 || target.action === "dodge") {
      this.spawnPuff(hx, hy, "#ffffff", 5);
      return;
    }

    // shielding
    if (target.action === "shield") {
      const facingHit = Math.sign(hx - target.x) !== target.facing || Math.abs(hx - target.x) < 12;
      if (facingHit || true) {
        target.shieldHp -= m.damage * 1.5 + 4;
        target.vx += Math.sign(target.x - attacker.x || 1) * (1.5 + m.damage * 0.12);
        this.spawnRing(target.x, target.y - target.h * 0.55, "#7fd8ff", 30);
        chipAudio.shieldHit();
        this.hitStop = 3;
        if (target.shieldHp <= 0) {
          target.action = "shieldbreak";
          target.actionTimer = 110;
          target.shieldCooldown = 70;
          target.vy = -10;
          this.shake = 14;
          chipAudio.hitHeavy();
          this.announce("SHIELD BREAK!", 70);
        }
        return;
      }
    }

    const armorMove = target.action === "attack" && target.move && target.move.armor ? target.move.armor : 0;
    const dmg = m.damage;
    target.damage = Math.min(999, target.damage + dmg);
    attacker.damageDealt += dmg;

    const hitlag = Math.round(3 + dmg * 0.45);
    attacker.hitlag = hitlag;
    target.hitlag = hitlag;
    this.hitStop = Math.min(10, Math.round(hitlag * 0.6));

    if (armorMove >= dmg) {
      this.spawnPuff(hx, hy, "#ffd23d", 8);
      chipAudio.hitLight();
      return;
    }

    const weightFactor = 100 / (target.char.weight + 40);
    const kb = (m.baseKb + (target.damage * 0.66 + dmg * 1.2) * m.kbScale) * weightFactor * 1.14;
    const angleRad = (m.angle * Math.PI) / 180;
    const dir = m.spike ? attacker.facing : attacker.facing;
    target.vx = Math.cos(angleRad) * kb * dir;
    target.vy = -Math.sin(angleRad) * kb;
    if (m.spike) target.vy = Math.abs(kb) * 0.85;

    target.hitstun = Math.min(78, Math.round(kb * 3.1));
    target.action = "hitstun";
    target.move = null;
    target.hitSet.clear();
    target.fastFalling = false;
    target.onGround = false;
    target.lastHurtBy = attacker.index;
    target.flash = 10;
    target.squash = 1;
    if (kb > 9) target.jumpsLeft = target.char.airJumps;

    attacker.combo++;
    attacker.comboTimer = 110;

    this.shake = Math.max(this.shake, Math.min(20, kb * 0.9));
    if (dmg >= 10) chipAudio.hitHeavy(); else chipAudio.hitLight();

    // fx
    const colors = attacker.char.colors;
    this.spawnRing(hx, hy, colors.accent, 22 + dmg);
    for (let i = 0; i < 10 + Math.round(dmg); i++) {
      this.particles.push({
        x: hx, y: hy, vx: rand(-9, 9), vy: rand(-9, 9),
        life: 24, maxLife: 24, size: rand(3, 9),
        color: i % 3 === 0 ? "#ffffff" : i % 3 === 1 ? colors.main : colors.accent,
        kind: "spark",
      });
    }
    this.particles.push({
      x: hx, y: hy - 20, vx: rand(-1, 1), vy: -1.6,
      life: 46, maxLife: 46, size: 20, color: dmg >= 12 ? "#ff5b5b" : "#ffffff",
      kind: "text", text: `${Math.round(dmg)}`,
    });
  }

  private koFighter(f: Fighter) {
    f.stocks--;
    f.action = "dead";
    f.respawnTimer = RESPAWN_FRAMES;
    f.damage = 0;
    f.vx = 0; f.vy = 0;
    f.hitstun = 0;
    f.hitlag = 0;
    f.combo = 0;
    const killer = this.fighters[1 - f.index];
    if (f.lastHurtBy === killer.index) killer.kos++;
    this.shake = 22;
    this.hitStop = 8;
    chipAudio.ko();
    chipAudio.blastoff();

    const cx = clamp(f.x, 40, WORLD_W - 40);
    const cy = clamp(f.y - f.h / 2, 40, WORLD_H - 40);
    for (let i = 0; i < 26; i++) {
      this.particles.push({
        x: cx, y: cy, vx: rand(-13, 13), vy: rand(-13, 13),
        life: 44, maxLife: 44, size: rand(4, 13),
        color: i % 2 ? f.char.colors.main : "#ffffff", kind: "star",
      });
    }
    this.spawnRing(cx, cy, "#ffffff", 90);
    console.log(`[engine] KO! ${f.char.name} lost a stock (${f.stocks} left)`);

    if (f.stocks <= 0) {
      const winner = this.fighters[1 - f.index];
      this.result = {
        winnerIndex: winner.index,
        loserIndex: f.index,
        winnerChar: winner.char.slug,
        loserChar: f.char.slug,
        stage: this.config.stage.slug,
        mode: this.config.p2IsCpu ? "cpu" : "versus",
        difficulty: this.config.p2IsCpu ? this.config.difficulty.id : "none",
        stocksLeft: winner.stocks,
        damageDealt: Math.round(winner.damageDealt),
        durationSeconds: Math.round(this.matchFrames / 60),
      };
      this.phase = "finish";
      this.finishTimer = 150;
      this.announce("GAME!", 150);
      f.action = "dead";
      f.respawnTimer = 99999;
      chipAudio.victory();
    } else {
      this.announce("KO!", 50);
    }
  }

  private respawn(f: Fighter) {
    const spawn = this.config.stage.spawns[f.index];
    f.x = spawn.x;
    f.y = spawn.y - 120;
    f.vx = 0; f.vy = 0;
    f.action = "none";
    f.invuln = SPAWN_INVULN;
    f.jumpsLeft = f.char.airJumps;
    f.usedUpB = false;
    f.shieldHp = SHIELD_MAX;
    f.onGround = false;
    this.spawnRing(f.x, f.y, f.char.colors.light, 50);
  }

  /* --------------------------------------------------------------- */
  /* Projectiles & particles                                          */
  /* --------------------------------------------------------------- */

  private updateProjectiles() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const def = p.move.projectile!;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += def.gravity;
      p.rot += 0.25;
      p.life--;
      if (this.frame % 2 === 0) {
        this.particles.push({
          x: p.x, y: p.y, vx: rand(-0.6, 0.6), vy: rand(-0.6, 0.6),
          life: 16, maxLife: 16, size: def.w * 0.4, color: def.glow, kind: "trail",
        });
      }
      let dead = p.life <= 0 || p.x < -260 || p.x > WORLD_W + 260 || p.y > WORLD_H + 260;
      if (!dead && def.gravity > 0) {
        for (const pl of this.config.stage.platforms) {
          if (p.x >= pl.x && p.x <= pl.x + pl.w && p.y >= pl.y - 4 && p.y <= pl.y + 22 && p.vy > 0) {
            dead = true;
            this.spawnPuff(p.x, p.y, def.glow, 8);
            break;
          }
        }
      }
      if (dead) this.projectiles.splice(i, 1);
    }
  }

  private updateParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.gravity) p.vy += p.gravity;
      if (p.kind === "spark" || p.kind === "star") { p.vx *= 0.92; p.vy *= 0.92; }
      p.life--;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    if (this.particles.length > 420) this.particles.splice(0, this.particles.length - 420);
  }

  private spawnRing(x: number, y: number, color: string, size: number) {
    this.particles.push({ x, y, vx: 0, vy: 0, life: 20, maxLife: 20, size, color, kind: "ring" });
  }

  private spawnDust(x: number, y: number, count: number) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + rand(-10, 10), y, vx: rand(-2.5, 2.5), vy: rand(-3, -0.5),
        life: 18, maxLife: 18, size: rand(3, 7), color: "rgba(255,255,255,0.7)", kind: "dust", gravity: 0.15,
      });
    }
  }

  private spawnPuff(x: number, y: number, color: string, count: number) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x, y, vx: rand(-4, 4), vy: rand(-4, 4),
        life: 16, maxLife: 16, size: rand(3, 7), color, kind: "spark",
      });
    }
  }

  /* --------------------------------------------------------------- */
  /* Camera                                                           */
  /* --------------------------------------------------------------- */

  private updateCamera() {
    const alive = this.fighters.filter((f) => f.action !== "dead");
    const list = alive.length ? alive : this.fighters;
    const minX = Math.min(...list.map((f) => f.x));
    const maxX = Math.max(...list.map((f) => f.x));
    const minY = Math.min(...list.map((f) => f.y - f.h));
    const maxY = Math.max(...list.map((f) => f.y));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2 - 30;
    const spanX = maxX - minX + 620;
    const spanY = maxY - minY + 420;
    const scale = clamp(Math.min(WORLD_W / spanX, WORLD_H / spanY), 0.82, 1.22);
    this.camScale += (scale - this.camScale) * 0.06;
    this.camX += (clamp(cx, 260, WORLD_W - 260) - this.camX) * 0.09;
    this.camY += (clamp(cy, 200, WORLD_H - 180) - this.camY) * 0.09;
  }

  /* --------------------------------------------------------------- */
  /* CPU                                                              */
  /* --------------------------------------------------------------- */

  private cpuThink(f: Fighter, opp: Fighter) {
    const d = this.config.difficulty;
    const ai = f.ai;

    if (ai.memoryTimer <= 0) {
      ai.seenX = opp.x;
      ai.seenY = opp.y;
      ai.seenAttacking = opp.action === "attack" || opp.action === "charge";
      ai.memoryTimer = d.reaction;
    } else ai.memoryTimer--;

    if (ai.cooldown > 0) ai.cooldown--;

    if (ai.holdFrames > 0) {
      ai.holdFrames--;
      f.input = ai.hold;
      return;
    }

    const inp: InputState = { ...EMPTY_INPUT };
    const main = this.config.stage.platforms.find((p) => p.main)!;
    const stageCenter = main.x + main.w / 2;
    const offstage = f.x < main.x - 10 || f.x > main.x + main.w + 10 || f.y > main.y + 60;
    const dxRaw = ai.seenX - f.x;
    const adx = Math.abs(dxRaw);
    const dy = ai.seenY - f.y;

    if (f.action === "dead" || f.action === "shieldbreak" || f.action === "hitstun") {
      // survival DI toward the stage
      if (f.hitstun > 0 && Math.random() < d.diSkill) {
        if (f.x < stageCenter) inp.right = true; else inp.left = true;
        if (f.vy > 6) inp.up = true;
      }
      f.input = inp;
      return;
    }

    /* ---- recovery ---- */
    // Jump / special need a fresh key press every time, so the AI pulses them.
    const pulse = this.frame % 12 < 5;
    if (offstage) {
      const toCenter = Math.sign(stageCenter - f.x) || 1;
      if (toCenter > 0) inp.right = true; else inp.left = true;
      const belowStage = f.y > main.y - 20;
      const skilled = Math.random() < d.recovery;
      if (skilled && (belowStage || f.vy > 1.2)) {
        if (f.jumpsLeft > 0) inp.up = pulse;
        else if (!f.usedUpB) { inp.up = pulse; inp.special = pulse; }
      }
      ai.hold = inp;
      ai.holdFrames = 2;
      f.input = inp;
      return;
    }

    /* ---- edgeguard ---- */
    const oppOffstage = ai.seenX < main.x - 20 || ai.seenX > main.x + main.w + 20;
    if (oppOffstage && Math.random() < d.edgeguard && !offstage) {
      // walk to the edge, but only leave the stage for a confident spike
      const edgeX = dxRaw > 0 ? main.x + main.w - 30 : main.x + 30;
      const commit = d.edgeguard > 0.6 && Math.random() < 0.35;
      const targetX = commit ? ai.seenX : edgeX;
      if (Math.abs(targetX - f.x) > 18) {
        if (targetX > f.x) inp.right = true; else inp.left = true;
      }
      if (commit && !f.onGround && f.jumpsLeft > 0 && dy < -30) inp.up = pulse;
      if (adx < 180 && Math.random() < 0.45) {
        inp.attack = true;
        if (dy > 30) inp.down = true;
      }
      ai.hold = inp;
      ai.holdFrames = Math.max(3, Math.round(d.think * 0.5));
      f.input = inp;
      return;
    }

    /* ---- defense ---- */
    if (ai.seenAttacking && adx < 150 && Math.random() < d.shieldChance) {
      inp.shield = true;
      if (Math.random() < d.dodgeChance) {
        if (dxRaw > 0) inp.left = true; else inp.right = true;
      }
      ai.hold = inp;
      ai.holdFrames = 16;
      f.input = inp;
      return;
    }

    /* ---- approach / attack ---- */
    const desired = 62 + d.spacing * 26;
    const wantsFight = Math.random() < d.aggression;

    if (adx > desired && wantsFight) {
      if (dxRaw > 0) inp.right = true; else inp.left = true;
    } else if (adx < 40) {
      if (dxRaw > 0) inp.left = true; else inp.right = true;
    }

    // vertical navigation
    if (dy < -70 && f.onGround && Math.random() < 0.55) inp.up = pulse;
    if (dy < -50 && !f.onGround && f.jumpsLeft > 0 && Math.random() < 0.25 * d.aggression) inp.up = pulse;

    let acted = false;
    if (ai.cooldown <= 0 && adx < desired + 44 && Math.abs(dy) < 130) {
      if (Math.random() < d.attackChance) {
        acted = true;
        if (dxRaw > 0) f.facing = 1; else f.facing = -1;
        const useSpecial = Math.random() < d.specialChance;
        if (useSpecial) {
          inp.special = true;
          const roll = Math.random();
          if (dy < -60) inp.up = true;
          else if (roll < 0.45) { if (dxRaw > 0) inp.right = true; else inp.left = true; }
          else if (roll < 0.62) inp.down = true;
        } else {
          inp.attack = true;
          if (dy < -55) inp.up = true;
          else if (!f.onGround && dy > 45) inp.down = true;
          else if (Math.random() < 0.55) { if (dxRaw > 0) inp.right = true; else inp.left = true; }
        }
        ai.cooldown = Math.round(d.think * 1.6);
      }
    }

    // ranged poke with a projectile when far away
    if (!acted && ai.cooldown <= 0 && adx > 260 && Math.abs(dy) < 90 && Math.random() < d.specialChance * 0.8) {
      inp.special = true;
      if (dxRaw > 0) f.facing = 1; else f.facing = -1;
      ai.cooldown = Math.round(d.think * 2.4);
      acted = true;
    }

    // charged smash from the veterans when the opponent is at high percent
    if (!acted && ai.cooldown <= 0 && adx < 90 && opp.damage > 70 && Math.random() < d.spacing * 0.35) {
      inp.attack = true;
      if (dxRaw > 0) inp.right = true; else inp.left = true;
      ai.hold = { ...inp };
      ai.holdFrames = 26 + Math.round(Math.random() * 16);
      f.input = inp;
      ai.cooldown = Math.round(d.think * 2);
      return;
    }

    this.keepOnStage(f, inp, main);
    ai.hold = inp;
    ai.holdFrames = acted ? 2 : Math.max(2, Math.round(d.think * 0.6));
    f.input = inp;
  }

  /** Stops the CPU from casually strolling off its own stage. */
  private keepOnStage(f: Fighter, inp: InputState, main: Platform) {
    const margin = 46;
    if (inp.right && f.x > main.x + main.w - margin) inp.right = false;
    if (inp.left && f.x < main.x + margin) inp.left = false;
    if (f.onGround && inp.down && Math.abs(f.vx) < 0.4) inp.down = false;
  }

  /* --------------------------------------------------------------- */
  /* Rendering                                                        */
  /* --------------------------------------------------------------- */

  render(ctx: CanvasRenderingContext2D, time: number) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, WORLD_W, WORLD_H);

    const shakeX = this.shake > 0.4 ? rand(-this.shake, this.shake) : 0;
    const shakeY = this.shake > 0.4 ? rand(-this.shake, this.shake) : 0;

    // background is drawn with a light parallax, not the full camera transform
    this.drawBackground(ctx, time, shakeX, shakeY);

    ctx.save();
    ctx.translate(WORLD_W / 2 + shakeX, WORLD_H / 2 + shakeY);
    ctx.scale(this.camScale, this.camScale);
    ctx.translate(-this.camX, -this.camY);

    this.drawPlatforms(ctx, time);
    this.drawParticles(ctx, "back");
    this.drawProjectiles(ctx, time);
    for (const f of this.fighters) this.drawFighter(ctx, f, time);
    this.drawParticles(ctx, "front");

    ctx.restore();

    this.drawOffscreenArrows(ctx);
    this.drawHud(ctx, time);
    ctx.restore();
  }

  private px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  private drawBackground(ctx: CanvasRenderingContext2D, t: number, sx: number, sy: number) {
    const s = this.config.stage;
    const p = s.palette;
    const g = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    g.addColorStop(0, p.sky[0]);
    g.addColorStop(0.55, p.sky[1]);
    g.addColorStop(1, p.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    const px = (this.camX - WORLD_W / 2) * 0.06 + sx * 0.4;
    const py = (this.camY - WORLD_H / 2) * 0.05 + sy * 0.4;
    ctx.save();
    ctx.translate(-px, -py);

    switch (s.slug) {
      case "neon_rooftop": this.bgNeon(ctx, t, p); break;
      case "jungle_ruins": this.bgJungle(ctx, t, p); break;
      case "lava_forge": this.bgLava(ctx, t, p); break;
      default: this.bgFrost(ctx, t, p); break;
    }
    ctx.restore();

    // vignette
    const vg = ctx.createRadialGradient(WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.35, WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.95);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  }

  private bgNeon(ctx: CanvasRenderingContext2D, t: number, p: StageDef["palette"]) {
    // moon
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    ctx.arc(1050, 150, 78, 0, Math.PI * 2);
    ctx.fill();
    // skyline
    for (let layer = 0; layer < 2; layer++) {
      const base = layer === 0 ? 560 : 620;
      const color = layer === 0 ? p.far : p.near;
      for (let i = -1; i < 16; i++) {
        const seed = (i * 97 + layer * 31) % 100;
        const w = 70 + (seed % 5) * 16;
        const h = 150 + (seed % 9) * 42 + layer * 30;
        const x = i * 92 + layer * 46;
        this.px(ctx, x, base - h, w, h, color);
        for (let wy = 0; wy < h - 30; wy += 26) {
          for (let wx = 0; wx < w - 16; wx += 20) {
            const lit = ((i * 13 + wy * 7 + wx * 3 + layer * 5) % 11) < 4;
            if (lit) {
              const flick = Math.sin(t * 0.002 + i + wy) > -0.9;
              this.px(ctx, x + 8 + wx, base - h + 16 + wy, 8, 10,
                flick ? (i % 3 === 0 ? p.accent : "#ffd76a") : "rgba(0,0,0,0.2)");
            }
          }
        }
      }
    }
    // neon signs
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = p.glow;
    ctx.fillRect(150, 320, 14, 120);
    ctx.fillStyle = p.accent;
    ctx.fillRect(1120, 260, 14, 150);
    ctx.globalAlpha = 1;
    // rain
    ctx.strokeStyle = "rgba(160,220,255,0.28)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 70; i++) {
      const x = (i * 211 + t * 0.55) % (WORLD_W + 200) - 100;
      const y = (i * 137 + t * 1.5) % WORLD_H;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 7, y + 22);
      ctx.stroke();
    }
  }

  private bgJungle(ctx: CanvasRenderingContext2D, t: number, p: StageDef["palette"]) {
    // sun shafts
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "#fff6c9";
    for (let i = 0; i < 7; i++) {
      ctx.save();
      ctx.translate(300 + i * 120, -60);
      ctx.rotate(0.28);
      ctx.fillRect(0, 0, 40, 900);
      ctx.restore();
    }
    ctx.restore();
    // canopy layers
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = [p.far, p.mid, p.near][layer];
      const yBase = 120 + layer * 60;
      ctx.beginPath();
      ctx.moveTo(-50, 0);
      for (let x = -50; x <= WORLD_W + 50; x += 40) {
        const y = yBase + Math.sin(x * 0.012 + layer * 2 + t * 0.0004) * 40;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(WORLD_W + 50, 0);
      ctx.closePath();
      ctx.fill();
    }
    // trunks + ruins
    for (let i = 0; i < 6; i++) {
      const x = 60 + i * 220;
      this.px(ctx, x, 180, 44, 520, i % 2 ? p.mid : p.far);
      this.px(ctx, x - 10, 250 + (i % 3) * 60, 64, 16, p.floor);
    }
    // fireflies
    for (let i = 0; i < 26; i++) {
      const x = (i * 173 + Math.sin(t * 0.0012 + i) * 70 + 120) % WORLD_W;
      const y = 220 + ((i * 97) % 340) + Math.cos(t * 0.0016 + i) * 26;
      ctx.globalAlpha = 0.55 + Math.sin(t * 0.005 + i) * 0.4;
      this.px(ctx, x, y, 6, 6, p.glow);
    }
    ctx.globalAlpha = 1;
  }

  private bgLava(ctx: CanvasRenderingContext2D, t: number, p: StageDef["palette"]) {
    // rock silhouettes
    for (let layer = 0; layer < 2; layer++) {
      ctx.fillStyle = layer === 0 ? p.far : p.near;
      ctx.beginPath();
      ctx.moveTo(-50, WORLD_H);
      for (let x = -50; x <= WORLD_W + 50; x += 80) {
        const y = 300 + layer * 120 + Math.sin(x * 0.01 + layer) * 90;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(WORLD_W + 50, WORLD_H);
      ctx.closePath();
      ctx.fill();
    }
    // lava lake
    const lavaY = 640;
    const lg = ctx.createLinearGradient(0, lavaY - 40, 0, WORLD_H);
    lg.addColorStop(0, "#ff9d3d");
    lg.addColorStop(0.4, "#ff4d12");
    lg.addColorStop(1, "#7a1102");
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(0, WORLD_H);
    for (let x = 0; x <= WORLD_W; x += 20) {
      ctx.lineTo(x, lavaY + Math.sin(x * 0.02 + t * 0.003) * 10 + Math.sin(x * 0.005 + t * 0.001) * 6);
    }
    ctx.lineTo(WORLD_W, WORLD_H);
    ctx.closePath();
    ctx.fill();
    // embers
    for (let i = 0; i < 40; i++) {
      const x = (i * 163 + Math.sin(t * 0.001 + i) * 40) % WORLD_W;
      const y = WORLD_H - ((t * 0.9 + i * 90) % (WORLD_H + 120));
      ctx.globalAlpha = clamp(y / WORLD_H, 0, 1) * 0.9;
      this.px(ctx, x, y, 5, 5, i % 3 ? "#ffb648" : "#ff4d12");
    }
    ctx.globalAlpha = 1;
  }

  private bgFrost(ctx: CanvasRenderingContext2D, t: number, p: StageDef["palette"]) {
    // stars
    for (let i = 0; i < 90; i++) {
      const x = (i * 227) % WORLD_W;
      const y = (i * 89) % 420;
      ctx.globalAlpha = 0.3 + Math.abs(Math.sin(t * 0.001 + i)) * 0.7;
      this.px(ctx, x, y, 3, 3, "#dff4ff");
    }
    ctx.globalAlpha = 1;
    // aurora
    for (let band = 0; band < 4; band++) {
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = band % 2 ? "#57f2d0" : "#7fd8ff";
      ctx.beginPath();
      ctx.moveTo(-40, 120 + band * 40);
      for (let x = -40; x <= WORLD_W + 40; x += 30) {
        ctx.lineTo(x, 120 + band * 44 + Math.sin(x * 0.006 + t * 0.0009 + band) * 52);
      }
      for (let x = WORLD_W + 40; x >= -40; x -= 30) {
        ctx.lineTo(x, 190 + band * 44 + Math.sin(x * 0.006 + t * 0.0009 + band) * 52);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // mountains
    for (let layer = 0; layer < 2; layer++) {
      ctx.fillStyle = layer === 0 ? p.far : p.mid;
      ctx.beginPath();
      ctx.moveTo(-50, WORLD_H);
      for (let x = -50; x <= WORLD_W + 50; x += 110) {
        ctx.lineTo(x, 430 + layer * 90 - Math.abs(Math.sin(x * 0.008 + layer)) * 230);
      }
      ctx.lineTo(WORLD_W + 50, WORLD_H);
      ctx.closePath();
      ctx.fill();
    }
    // snow
    for (let i = 0; i < 70; i++) {
      const x = (i * 191 + Math.sin(t * 0.0013 + i) * 40) % WORLD_W;
      const y = (i * 127 + t * 0.9) % WORLD_H;
      ctx.globalAlpha = 0.65;
      this.px(ctx, x, y, 4, 4, "#ffffff");
    }
    ctx.globalAlpha = 1;
  }

  private drawPlatforms(ctx: CanvasRenderingContext2D, t: number) {
    const s = this.config.stage;
    const p = s.palette;
    for (const pl of s.platforms) {
      const h = pl.main ? 170 : 22;
      // body
      this.px(ctx, pl.x, pl.y, pl.w, h, p.floor);
      // shading
      this.px(ctx, pl.x, pl.y + (pl.main ? 30 : 10), pl.w, pl.main ? 140 : 12, "rgba(0,0,0,0.28)");
      // top edge glow
      this.px(ctx, pl.x, pl.y - 4, pl.w, 6, p.floorEdge);
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(t * 0.003) * 0.12;
      this.px(ctx, pl.x, pl.y - 8, pl.w, 4, p.glow);
      ctx.restore();
      // pixel detailing
      for (let x = pl.x + 6; x < pl.x + pl.w - 10; x += 34) {
        this.px(ctx, x, pl.y + (pl.main ? 42 : 12), 14, 6, "rgba(255,255,255,0.08)");
      }
      if (pl.main) {
        for (let x = pl.x; x < pl.x + pl.w; x += 56) {
          this.px(ctx, x, pl.y + 96, 26, 8, "rgba(0,0,0,0.25)");
        }
      }
    }
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D, t: number) {
    for (const pr of this.projectiles) {
      const def = pr.move.projectile!;
      ctx.save();
      ctx.translate(pr.x, pr.y);
      if (def.spin) ctx.rotate(pr.rot);
      ctx.shadowBlur = 24;
      ctx.shadowColor = def.glow;
      if (def.shape === "bolt") {
        this.px(ctx, -def.w / 2, -def.h / 2, def.w, def.h, def.color);
        this.px(ctx, -def.w / 2 - 8, -2, 10, 4, def.glow);
      } else if (def.shape === "rock") {
        this.px(ctx, -def.w / 2, -def.h / 2, def.w, def.h, def.color);
        this.px(ctx, -def.w / 2 + 6, -def.h / 2 + 6, def.w * 0.4, def.h * 0.3, "rgba(255,255,255,0.25)");
      } else {
        ctx.fillStyle = def.color;
        ctx.beginPath();
        ctx.arc(0, 0, def.w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = def.glow;
        ctx.globalAlpha = 0.65;
        ctx.beginPath();
        ctx.arc(0, 0, def.w / 3.4 + Math.sin(t * 0.02) * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, layer: "back" | "front") {
    for (const p of this.particles) {
      const a = p.life / p.maxLife;
      const isFront = p.kind === "spark" || p.kind === "ring" || p.kind === "text" || p.kind === "star";
      if ((layer === "front") !== isFront) continue;
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      if (p.kind === "ring") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 5 * a + 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.35 - a), 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.kind === "text") {
        ctx.fillStyle = p.color;
        ctx.font = `bold 26px ${this.fontFamily}`;
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 6;
        ctx.fillText(p.text || "", p.x, p.y);
      } else if (p.kind === "star") {
        ctx.fillStyle = p.color;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.life * 0.2);
        ctx.fillRect(-p.size / 2, -p.size / 6, p.size, p.size / 3);
        ctx.fillRect(-p.size / 6, -p.size / 2, p.size / 3, p.size);
      } else if (p.kind === "trail") {
        ctx.globalAlpha = a * 0.5;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
        ctx.fill();
      } else {
        this.px(ctx, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size, p.color);
      }
      ctx.restore();
    }
  }

  /* ---------------------------- fighters --------------------------- */

  private drawFighter(ctx: CanvasRenderingContext2D, f: Fighter, t: number) {
    if (f.action === "dead") return;
    const c = f.char.colors;
    const s = f.char.sizeMul;
    const w = f.w;
    const h = f.h;
    const bob = f.onGround && f.action === "none" ? Math.sin(f.animTimer * 0.09) * 2 : 0;
    const squash = 1 - f.squash * 0.25;
    const stretch = 1 + f.squash * 0.2;

    ctx.save();
    // shadow
    const ground = this.groundUnder(f);
    if (ground !== null) {
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(f.x, ground + 2, w * 0.55, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (f.invuln > 0 && Math.floor(t / 60) % 2 === 0 && f.action !== "dodge") ctx.globalAlpha = 0.45;
    if (f.hitlag > 0) ctx.translate(rand(-2, 2), rand(-2, 2));

    ctx.translate(f.x, f.y + bob);
    ctx.scale(f.facing * squash, stretch);

    const bodyTop = -h;
    const legY = -h * 0.36;
    const run = Math.abs(f.vx) > 0.6 && f.onGround;
    const legSwing = run ? Math.sin(f.animTimer * 0.34) * 9 : 0;
    const airborne = !f.onGround;

    // --- legs ---
    if (airborne) {
      this.px(ctx, -w * 0.34, legY, w * 0.3, h * 0.3, c.dark);
      this.px(ctx, w * 0.04, legY + 4, w * 0.3, h * 0.26, c.dark);
    } else {
      this.px(ctx, -w * 0.34 + legSwing, legY, w * 0.3, h * 0.36, c.dark);
      this.px(ctx, w * 0.04 - legSwing, legY, w * 0.3, h * 0.36, c.dark);
    }

    // --- torso ---
    this.px(ctx, -w * 0.42, bodyTop + h * 0.3, w * 0.84, h * 0.36, c.main);
    this.px(ctx, -w * 0.42, bodyTop + h * 0.3, w * 0.84, h * 0.1, c.light);
    this.px(ctx, -w * 0.1, bodyTop + h * 0.34, w * 0.22, h * 0.26, c.accent);

    // --- head ---
    const headH = h * 0.27;
    const headY = bodyTop + h * 0.03;
    this.px(ctx, -w * 0.33, headY, w * 0.66, headH, c.light);
    this.px(ctx, -w * 0.33, headY, w * 0.66, headH * 0.32, c.main);
    // eye
    this.px(ctx, w * 0.06, headY + headH * 0.45, w * 0.18, headH * 0.22, c.eye);
    this.px(ctx, w * 0.14, headY + headH * 0.45, w * 0.08, headH * 0.22, "#1a1030");

    // --- character signature ---
    this.drawSignature(ctx, f, w, h, headY, headH, t);

    // --- arms / attack pose ---
    const attacking = f.action === "attack" && f.move;
    const charging = f.action === "charge";
    if (attacking) {
      const m = f.move!;
      const phase = f.aFrame < m.startup ? "wind" : f.aFrame < m.startup + m.active ? "hit" : "rec";
      const ext = phase === "hit" ? 1 : phase === "wind" ? 0.25 : 0.6;
      const dirBack = m.backwards ? -1 : 1;
      const ax = dirBack * (w * 0.3 + w * 0.7 * ext);
      const ay = bodyTop + h * 0.36 + (m.hitOY > 20 ? h * 0.3 : m.hitOY < -30 ? -h * 0.34 : 0);
      this.px(ctx, ax - w * 0.16, ay, w * 0.42, h * 0.16, c.main);
      this.px(ctx, ax + w * 0.16, ay - 3, w * 0.2, h * 0.2, c.accent);
      if (phase === "hit") this.drawSlash(ctx, f, m, w, h);
    } else if (charging) {
      const pulse = Math.sin(f.chargeFrames * 0.5) * 3;
      this.px(ctx, -w * 0.62 - pulse, bodyTop + h * 0.34, w * 0.34, h * 0.18, c.main);
      ctx.globalAlpha = 0.5 + Math.sin(f.chargeFrames * 0.4) * 0.4;
      this.px(ctx, w * 0.2, bodyTop + h * 0.3, w * 0.36, h * 0.24, c.accent);
      ctx.globalAlpha = 1;
    } else if (f.action === "shield") {
      this.px(ctx, -w * 0.5, bodyTop + h * 0.34, w * 0.28, h * 0.18, c.dark);
      this.px(ctx, w * 0.24, bodyTop + h * 0.34, w * 0.28, h * 0.18, c.dark);
    } else {
      const swing = run ? Math.sin(f.animTimer * 0.34 + Math.PI) * 7 : Math.sin(f.animTimer * 0.06) * 2;
      this.px(ctx, -w * 0.52, bodyTop + h * 0.34 + swing, w * 0.22, h * 0.2, c.main);
      this.px(ctx, w * 0.3, bodyTop + h * 0.34 - swing, w * 0.22, h * 0.2, c.main);
    }

    ctx.restore();

    // shield bubble
    if (f.action === "shield") {
      const r = (f.shieldHp / SHIELD_MAX) * (h * 0.78) + 14;
      ctx.save();
      ctx.globalAlpha = 0.34;
      ctx.fillStyle = f.shieldHp > 40 ? "#7fd8ff" : "#ff5b5b";
      ctx.beginPath();
      ctx.arc(f.x, f.y - h * 0.5, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    if (f.action === "shieldbreak") {
      ctx.save();
      ctx.fillStyle = "#ffd83d";
      ctx.font = `bold 18px ${this.fontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText("@@@", f.x, f.y - h - 16 + Math.sin(t * 0.01) * 3);
      ctx.restore();
    }

    // combo counter
    if (f.combo > 1 && f.comboTimer > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(f.comboTimer / 40, 0, 1);
      ctx.fillStyle = c.accent;
      ctx.font = `bold 20px ${this.fontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText(`${f.combo} HIT`, f.x, f.y - f.h - 34);
      ctx.restore();
    }
  }

  private drawSignature(
    ctx: CanvasRenderingContext2D, f: Fighter, w: number, h: number,
    headY: number, headH: number, t: number
  ) {
    const c = f.char.colors;
    switch (f.char.slug) {
      case "blaze": {
        const flick = Math.sin(t * 0.01) * 3;
        this.px(ctx, -w * 0.12, headY - h * 0.12 + flick, w * 0.16, h * 0.13, "#ff9d3d");
        this.px(ctx, -w * 0.02, headY - h * 0.18 - flick, w * 0.12, h * 0.16, c.accent);
        break;
      }
      case "volt": {
        this.px(ctx, -w * 0.05, headY - h * 0.14, w * 0.09, h * 0.14, c.accent);
        this.px(ctx, w * 0.02, headY - h * 0.2, w * 0.12, h * 0.07, c.accent);
        this.px(ctx, -w * 0.33, headY + headH * 0.38, w * 0.66, headH * 0.16, "#1a1030");
        break;
      }
      case "tusk": {
        this.px(ctx, -w * 0.52, -h + h * 0.28, w * 0.24, h * 0.14, c.dark);
        this.px(ctx, w * 0.28, -h + h * 0.28, w * 0.24, h * 0.14, c.dark);
        this.px(ctx, w * 0.2, headY + headH * 0.66, w * 0.16, h * 0.05, "#fff6e0");
        this.px(ctx, -w * 0.3, headY + headH * 0.66, w * 0.14, h * 0.05, "#fff6e0");
        break;
      }
      default: {
        // Nyx — hood + floating orb
        this.px(ctx, -w * 0.4, headY - h * 0.03, w * 0.8, headH * 0.5, c.dark);
        const orbY = -h * 0.8 + Math.sin(t * 0.004) * 6;
        ctx.save();
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = c.accent;
        ctx.beginPath();
        ctx.arc(-w * 0.62, orbY, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;
      }
    }
  }

  private drawSlash(ctx: CanvasRenderingContext2D, f: Fighter, m: MoveDef, w: number, h: number) {
    const c = f.char.colors;
    const dir = m.backwards ? -1 : 1;
    const cx = dir * m.hitOX;
    const cy = -h * 0.5 + m.hitOY;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(cx * 0.55, cy, Math.max(m.hitW, m.hitH) * 0.5, -0.9, 0.9);
    ctx.stroke();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  private groundUnder(f: Fighter): number | null {
    let best: number | null = null;
    for (const p of this.config.stage.platforms) {
      if (f.x >= p.x && f.x <= p.x + p.w && p.y >= f.y - 4) {
        if (best === null || p.y < best) best = p.y;
      }
    }
    return best;
  }

  /* ------------------------------- HUD ----------------------------- */

  private drawOffscreenArrows(ctx: CanvasRenderingContext2D) {
    for (const f of this.fighters) {
      if (f.action === "dead") continue;
      const sx = (f.x - this.camX) * this.camScale + WORLD_W / 2;
      const sy = (f.y - f.h / 2 - this.camY) * this.camScale + WORLD_H / 2;
      if (sx > 20 && sx < WORLD_W - 20 && sy > 20 && sy < WORLD_H - 20) continue;
      const cx = clamp(sx, 40, WORLD_W - 40);
      const cy = clamp(sy, 90, WORLD_H - 130);
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = f.char.colors.main;
      ctx.beginPath();
      ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0a0614";
      ctx.font = `bold 16px ${this.fontFamily}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`P${f.index + 1}`, cx, cy + 1);
      ctx.restore();
    }
  }

  private drawHud(ctx: CanvasRenderingContext2D, t: number) {
    const pad = 28;
    const cardW = 300;
    const cardH = 108;
    const y = WORLD_H - cardH - 20;

    this.fighters.forEach((f, i) => {
      const x = i === 0 ? pad : WORLD_W - pad - cardW;
      const c = f.char.colors;
      ctx.save();
      ctx.globalAlpha = 0.86;
      ctx.fillStyle = "rgba(8,4,20,0.82)";
      ctx.fillRect(x, y, cardW, cardH);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.main;
      ctx.fillRect(x, y, cardW, 5);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(x, y + cardH - 3, cardW, 3);

      // name + tag
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold 15px ${this.fontFamily}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(f.char.name, x + 14, y + 30);
      ctx.fillStyle = f.isCpu ? this.config.difficulty.color : "#7fd8ff";
      ctx.font = `bold 11px ${this.fontFamily}`;
      ctx.fillText(f.isCpu ? `CPU ${this.config.difficulty.tag}` : `P${i + 1}`, x + 14, y + 50);

      // percent
      const pct = Math.round(f.damage);
      const heat = clamp(pct / 160, 0, 1);
      const r = Math.round(255);
      const g = Math.round(255 - heat * 215);
      const b = Math.round(255 - heat * 240);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.font = `bold 40px ${this.fontFamily}`;
      ctx.textAlign = "right";
      const shakeAmt = pct > 100 ? Math.sin(t * 0.02) * 1.5 : 0;
      ctx.fillText(`${pct}%`, x + cardW - 16 + shakeAmt, y + 58);

      // stocks
      for (let s = 0; s < this.config.stocks; s++) {
        const sx = x + 16 + s * 22;
        const sy = y + cardH - 26;
        ctx.fillStyle = s < f.stocks ? c.main : "rgba(255,255,255,0.14)";
        ctx.fillRect(sx, sy, 15, 15);
        if (s < f.stocks) {
          ctx.fillStyle = c.light;
          ctx.fillRect(sx + 3, sy + 3, 5, 5);
        }
      }

      // shield bar
      const bw = 120;
      const bx = x + cardW - bw - 16;
      const by = y + cardH - 22;
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(bx, by, bw, 8);
      ctx.fillStyle = f.shieldHp > 40 ? "#7fd8ff" : "#ff5b5b";
      ctx.fillRect(bx, by, (f.shieldHp / SHIELD_MAX) * bw, 8);
      ctx.restore();
    });

    // timer
    ctx.save();
    ctx.fillStyle = "rgba(8,4,20,0.7)";
    ctx.fillRect(WORLD_W / 2 - 74, 18, 148, 44);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 22px ${this.fontFamily}`;
    ctx.textAlign = "center";
    const secs = Math.floor(this.matchFrames / 60);
    ctx.fillText(`${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`, WORLD_W / 2, 48);
    ctx.restore();

    // countdown / announcements
    if (this.phase === "intro") {
      const secs = Math.ceil(this.introFrames / 60);
      const label = secs > 3 ? "READY" : secs > 0 ? String(secs) : "GO!";
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = `bold ${secs > 3 ? 64 : 120}px ${this.fontFamily}`;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillText(label, WORLD_W / 2 + 5, WORLD_H / 2 + 5);
      ctx.fillStyle = secs > 3 ? "#7fd8ff" : "#ffd83d";
      ctx.fillText(label, WORLD_W / 2, WORLD_H / 2);
      ctx.restore();
    } else if (this.announceTimer > 0 && this.announcement) {
      ctx.save();
      ctx.textAlign = "center";
      const scale = clamp(this.announceTimer / 20, 0, 1);
      ctx.globalAlpha = clamp(this.announceTimer / 30, 0, 1);
      ctx.font = `bold ${70 + scale * 16}px ${this.fontFamily}`;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillText(this.announcement, WORLD_W / 2 + 5, WORLD_H / 2 - 55);
      ctx.fillStyle = "#ff2e97";
      ctx.fillText(this.announcement, WORLD_W / 2, WORLD_H / 2 - 60);
      ctx.restore();
    }
  }
}
