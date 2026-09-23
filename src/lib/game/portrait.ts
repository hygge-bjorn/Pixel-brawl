/**
 * Static pixel portrait painter used by the character select screen.
 * Mirrors the in-match fighter art so what you pick is what you fight with.
 */
import { CharacterDef } from "./content";

export function drawPortrait(
  ctx: CanvasRenderingContext2D,
  char: CharacterDef,
  t: number,
  width: number,
  height: number
) {
  const c = char.colors;
  ctx.clearRect(0, 0, width, height);

  // backdrop
  const g = ctx.createRadialGradient(width / 2, height * 0.55, 10, width / 2, height * 0.55, width * 0.8);
  g.addColorStop(0, c.dark);
  g.addColorStop(1, "rgba(9,4,22,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  // aura particles
  for (let i = 0; i < 12; i++) {
    const a = (t * 0.0006 + i / 12) % 1;
    const x = width / 2 + Math.sin(a * Math.PI * 2 + i) * width * 0.34;
    const y = height * 0.92 - a * height * 0.8;
    ctx.globalAlpha = 0.5 * (1 - a);
    ctx.fillStyle = i % 2 ? c.accent : c.light;
    ctx.fillRect(Math.round(x), Math.round(y), 4, 4);
  }
  ctx.globalAlpha = 1;

  const scale = (height / 150) * char.sizeMul;
  const w = 44 * scale;
  const h = 80 * scale;
  const bob = Math.sin(t * 0.0025) * 3;

  ctx.save();
  ctx.translate(width / 2, height * 0.9 + bob);

  const px = (x: number, y: number, pw: number, ph: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(pw), Math.round(ph));
  };

  // shadow
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(0, 4, w * 0.6, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const bodyTop = -h;
  const legY = -h * 0.36;
  const swing = Math.sin(t * 0.003) * 3;

  px(-w * 0.34, legY, w * 0.3, h * 0.36, c.dark);
  px(w * 0.04, legY, w * 0.3, h * 0.36, c.dark);
  px(-w * 0.52, bodyTop + h * 0.34 + swing, w * 0.22, h * 0.2, c.main);
  px(w * 0.3, bodyTop + h * 0.34 - swing, w * 0.22, h * 0.2, c.main);
  px(-w * 0.42, bodyTop + h * 0.3, w * 0.84, h * 0.36, c.main);
  px(-w * 0.42, bodyTop + h * 0.3, w * 0.84, h * 0.1, c.light);
  px(-w * 0.1, bodyTop + h * 0.34, w * 0.22, h * 0.26, c.accent);

  const headH = h * 0.27;
  const headY = bodyTop + h * 0.03;
  px(-w * 0.33, headY, w * 0.66, headH, c.light);
  px(-w * 0.33, headY, w * 0.66, headH * 0.32, c.main);
  px(w * 0.06, headY + headH * 0.45, w * 0.18, headH * 0.22, c.eye);
  px(w * 0.14, headY + headH * 0.45, w * 0.08, headH * 0.22, "#1a1030");

  switch (char.slug) {
    case "blaze": {
      const flick = Math.sin(t * 0.01) * 3;
      px(-w * 0.12, headY - h * 0.12 + flick, w * 0.16, h * 0.13, "#ff9d3d");
      px(-w * 0.02, headY - h * 0.18 - flick, w * 0.12, h * 0.16, c.accent);
      break;
    }
    case "volt": {
      px(-w * 0.05, headY - h * 0.14, w * 0.09, h * 0.14, c.accent);
      px(w * 0.02, headY - h * 0.2, w * 0.12, h * 0.07, c.accent);
      px(-w * 0.33, headY + headH * 0.38, w * 0.66, headH * 0.16, "#1a1030");
      break;
    }
    case "tusk": {
      px(-w * 0.52, bodyTop + h * 0.28, w * 0.24, h * 0.14, c.dark);
      px(w * 0.28, bodyTop + h * 0.28, w * 0.24, h * 0.14, c.dark);
      px(w * 0.2, headY + headH * 0.66, w * 0.16, h * 0.05, "#fff6e0");
      px(-w * 0.3, headY + headH * 0.66, w * 0.14, h * 0.05, "#fff6e0");
      break;
    }
    default: {
      px(-w * 0.4, headY - h * 0.03, w * 0.8, headH * 0.5, c.dark);
      ctx.fillStyle = c.accent;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(-w * 0.62, -h * 0.8 + Math.sin(t * 0.004) * 6, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
  }

  ctx.restore();
}
