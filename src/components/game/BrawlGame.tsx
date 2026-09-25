"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { BrawlEngine, EMPTY_INPUT, InputState, MatchConfig, MatchResult } from "@/lib/game/engine";
import { WORLD_H, WORLD_W } from "@/lib/game/content";
import { chipAudio } from "@/lib/game/audio";

const P1_KEYS: Record<string, keyof InputState> = {
  KeyA: "left", KeyD: "right", KeyW: "up", KeyS: "down",
  KeyJ: "attack", KeyK: "special", KeyL: "shield",
};

const P2_KEYS: Record<string, keyof InputState> = {
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
  Comma: "attack", Period: "special", Slash: "shield",
  Numpad1: "attack", Numpad2: "special", Numpad3: "shield",
};

interface Props {
  config: MatchConfig;
  onExit: () => void;
  onFinished: (result: MatchResult) => void;
}

export default function BrawlGame({ config, onExit, onFinished }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<BrawlEngine | null>(null);
  const rafRef = useRef<number>(0);
  const inputsRef = useRef<[InputState, InputState]>([{ ...EMPTY_INPUT }, { ...EMPTY_INPUT }]);
  const finishedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(chipAudio.muted);

  const togglePause = useCallback(() => {
    chipAudio.select();
    setPaused((p) => !p);
  }, []);

  useEffect(() => {
    if (engineRef.current) engineRef.current.paused = paused;
  }, [paused]);

  useEffect(() => {
    const engine = new BrawlEngine(config);
    engineRef.current = engine;
    finishedRef.current = false;

    if (wrapRef.current) {
      const family = getComputedStyle(wrapRef.current).getPropertyValue("--font-display").trim();
      if (family) engine.fontFamily = family;
    }

    chipAudio.playTheme(config.stage.slug);

    const onKeyDown = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Slash"].includes(e.code)) e.preventDefault();
      if (e.code === "Escape" || e.code === "KeyP") {
        togglePause();
        return;
      }
      if (e.repeat) return;
      const k1 = P1_KEYS[e.code];
      if (k1) inputsRef.current[0][k1] = true;
      const k2 = P2_KEYS[e.code];
      if (k2) inputsRef.current[1][k2] = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k1 = P1_KEYS[e.code];
      if (k1) inputsRef.current[0][k1] = false;
      const k2 = P2_KEYS[e.code];
      if (k2) inputsRef.current[1][k2] = false;
    };
    const onBlur = () => {
      inputsRef.current = [{ ...EMPTY_INPUT }, { ...EMPTY_INPUT }];
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) {
      console.error("[game] could not acquire 2D canvas context");
      return;
    }
    ctx.imageSmoothingEnabled = false;

    const STEP = 1000 / 60;
    let last = performance.now();
    let acc = 0;

    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);
      acc += Math.min(now - last, 200);
      last = now;
      let steps = 0;
      while (acc >= STEP && steps < 5) {
        engine.setInput(0, inputsRef.current[0]);
        if (!config.p2IsCpu) engine.setInput(1, inputsRef.current[1]);
        engine.update();
        acc -= STEP;
        steps++;
      }
      engine.render(ctx, now);

      if (engine.phase === "over" && engine.result && !finishedRef.current) {
        finishedRef.current = true;
        console.log("[game] reporting match result", engine.result);
        onFinished(engine.result);
      }
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [config, onFinished, togglePause]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    chipAudio.setMuted(next);
  };

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        width={WORLD_W}
        height={WORLD_H}
        className="w-full rounded-lg border-2 border-[#2b1a4d] bg-black shadow-[0_0_60px_rgba(255,46,151,0.25)]"
        style={{ imageRendering: "pixelated", aspectRatio: "16 / 9" }}
      />

      <div className="absolute right-3 top-3 flex gap-2">
        <button
          onClick={toggleMute}
          className="rounded border border-[#4b2f7a] bg-[#0d0620]/80 px-3 py-1.5 font-display text-[10px] text-[#c9b6ff] transition hover:border-[#ff2e97] hover:text-white"
        >
          {muted ? "SOUND OFF" : "SOUND ON"}
        </button>
        <button
          onClick={togglePause}
          className="rounded border border-[#4b2f7a] bg-[#0d0620]/80 px-3 py-1.5 font-display text-[10px] text-[#c9b6ff] transition hover:border-[#ff2e97] hover:text-white"
        >
          {paused ? "RESUME" : "PAUSE"}
        </button>
      </div>

      {paused && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 rounded-lg bg-[#07030f]/90 backdrop-blur-sm">
          <h2 className="font-display text-3xl text-[#ff2e97] drop-shadow-[0_0_18px_rgba(255,46,151,0.7)]">PAUSED</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <ControlCard
              title="PLAYER 1"
              color="#ff4d2d"
              rows={[["MOVE", "A / D"], ["JUMP", "W"], ["DROP / FALL", "S"], ["ATTACK", "J"], ["SPECIAL", "K"], ["SHIELD / DODGE", "L"]]}
            />
            <ControlCard
              title={config.p2IsCpu ? "CPU" : "PLAYER 2"}
              color="#7fd8ff"
              rows={
                config.p2IsCpu
                  ? [["DIFFICULTY", config.difficulty.label], ["LEVEL", config.difficulty.tag]]
                  : [["MOVE", "← / →"], ["JUMP", "↑"], ["DROP / FALL", "↓"], ["ATTACK", ","], ["SPECIAL", "."], ["SHIELD / DODGE", "/"]]
              }
            />
          </div>
          <div className="flex gap-4">
            <button
              onClick={togglePause}
              className="rounded border-2 border-[#ffd83d] bg-[#ffd83d] px-6 py-3 font-display text-xs text-[#1a1030] transition hover:scale-105"
            >
              RESUME
            </button>
            <button
              onClick={() => { chipAudio.back(); onExit(); }}
              className="rounded border-2 border-[#4b2f7a] px-6 py-3 font-display text-xs text-[#c9b6ff] transition hover:border-[#ff2e97] hover:text-white"
            >
              QUIT MATCH
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ControlCard({ title, color, rows }: { title: string; color: string; rows: string[][] }) {
  return (
    <div className="min-w-[230px] rounded border border-[#2b1a4d] bg-[#100827]/80 p-4">
      <p className="mb-3 font-display text-[11px]" style={{ color }}>{title}</p>
      <ul className="space-y-1.5">
        {rows.map(([label, key]) => (
          <li key={label} className="flex items-center justify-between gap-6 text-[11px] text-[#9b86c9]">
            <span className="tracking-wide">{label}</span>
            <span className="rounded bg-[#241243] px-2 py-0.5 font-display text-[10px] text-white">{key}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
