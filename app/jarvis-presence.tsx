"use client";

import { useEffect, useMemo, useRef } from "react";
import type { JarvisVoiceState } from "./jarvis-voice";

type Variant = "hero" | "core" | "compact" | "mini";

type Point = {
  x: number;
  y: number;
  z: number;
  seed: number;
};

const RED = [183, 31, 38] as const;

function particleCount(variant: Variant) {
  if (variant === "hero") return 900;
  if (variant === "core") return 720;
  if (variant === "compact") return 260;
  return 90;
}

function buildPoints(count: number): Point[] {
  const points: Point[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    points.push({ x, y, z, seed: (i * 0.61803398875) % 1 });
  }
  return points;
}

function stateParams(state: JarvisVoiceState) {
  if (state === "LISTENING") return { speed: 0.72, noise: 0.12, pulse: 0.045, twist: 0.14, squash: 0.98 };
  if (state === "THINKING") return { speed: 1.25, noise: 0.18, pulse: 0.025, twist: 0.34, squash: 0.92 };
  if (state === "SPEAKING") return { speed: 0.94, noise: 0.16, pulse: 0.09, twist: 0.2, squash: 1.02 };
  if (state === "ERROR") return { speed: 1.5, noise: 0.24, pulse: 0.02, twist: 0.42, squash: 0.9 };
  return { speed: 0.34, noise: 0.07, pulse: 0.018, twist: 0.1, squash: 0.96 };
}

export default function JarvisPresence({
  state = "STANDBY",
  variant = "core",
  label = "JARVIS",
  className = "",
}: {
  state?: JarvisVoiceState;
  variant?: Variant;
  label?: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const points = useMemo(() => buildPoints(particleCount(variant)), [variant]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    let frame = 0;
    let running = true;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 1.6);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const start = performance.now();
    const params = stateParams(state);

    const draw = (now: number) => {
      if (!running) return;
      frame = window.requestAnimationFrame(draw);

      const t = (now - start) / 1000;
      context.clearRect(0, 0, width, height);

      const size = Math.min(width, height);
      const cx = width / 2;
      const cy = height / 2;
      const baseRadius = size * (variant === "mini" ? 0.36 : variant === "compact" ? 0.39 : 0.405);
      const breathe = 1 + Math.sin(t * (1.2 + params.speed * 0.5)) * params.pulse;
      const rotationY = t * params.speed * 0.52;
      const rotationX = Math.sin(t * params.speed * 0.31) * 0.17;
      const cosY = Math.cos(rotationY);
      const sinY = Math.sin(rotationY);
      const cosX = Math.cos(rotationX);
      const sinX = Math.sin(rotationX);

      const halo = context.createRadialGradient(cx, cy, size * 0.03, cx, cy, size * 0.5);
      halo.addColorStop(0, `rgba(${RED[0]},${RED[1]},${RED[2]},0.10)`);
      halo.addColorStop(0.48, `rgba(${RED[0]},${RED[1]},${RED[2]},0.035)`);
      halo.addColorStop(1, `rgba(${RED[0]},${RED[1]},${RED[2]},0)`);
      context.fillStyle = halo;
      context.beginPath();
      context.arc(cx, cy, size * 0.5, 0, Math.PI * 2);
      context.fill();

      const projected: Array<{ x: number; y: number; z: number; alpha: number; radius: number }> = [];

      for (let i = 0; i < points.length; i += 1) {
        const point = points[i];
        const wave =
          Math.sin(point.y * 7.5 + t * 1.8 * params.speed + point.seed * 5.2) * params.noise +
          Math.cos(point.x * 5.2 - t * 1.25 * params.speed) * params.noise * 0.42;

        const speakingWave = state === "SPEAKING"
          ? Math.sin((point.y + 1) * 8 - t * 8.5) * 0.075
          : 0;
        const listeningLift = state === "LISTENING"
          ? Math.cos((point.x + point.z) * 5 + t * 2.5) * 0.035
          : 0;
        const errorJitter = state === "ERROR"
          ? Math.sin(i * 12.77 + t * 21) * 0.055
          : 0;

        const radial = 1 + wave + speakingWave + listeningLift + errorJitter;
        let x = point.x * radial;
        let y = point.y * radial * (1.08 + Math.sin(t * 0.42) * 0.035) * params.squash;
        let z = point.z * radial;

        const twist = params.twist * point.y;
        const twistCos = Math.cos(twist);
        const twistSin = Math.sin(twist);
        const tx = x * twistCos - z * twistSin;
        const tz = x * twistSin + z * twistCos;
        x = tx;
        z = tz;

        const rx = x * cosY - z * sinY;
        const rz = x * sinY + z * cosY;
        const ry = y * cosX - rz * sinX;
        const rz2 = y * sinX + rz * cosX;

        const perspective = 1 / (1.9 - rz2 * 0.46);
        const px = cx + rx * baseRadius * breathe * perspective * 1.34;
        const py = cy + ry * baseRadius * breathe * perspective * 1.34;
        const depth = Math.max(0, Math.min(1, (rz2 + 1.25) / 2.5));
        const alpha = 0.18 + depth * 0.78;
        const radius = (variant === "mini" ? 0.8 : variant === "compact" ? 0.95 : 1.12) * (0.66 + depth * 0.72);

        projected.push({ x: px, y: py, z: rz2, alpha, radius });
      }

      projected.sort((a, b) => a.z - b.z);

      context.shadowColor = `rgba(${RED[0]},${RED[1]},${RED[2]},0.42)`;
      context.shadowBlur = variant === "mini" ? 2 : 4;
      for (const point of projected) {
        context.fillStyle = `rgba(${RED[0]},${RED[1]},${RED[2]},${point.alpha})`;
        context.beginPath();
        context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
        context.fill();
      }
      context.shadowBlur = 0;

      if (variant !== "mini") {
        const coreAlpha = state === "SPEAKING" ? 0.34 : state === "THINKING" ? 0.27 : 0.2;
        const inner = context.createRadialGradient(cx, cy, 0, cx, cy, size * 0.18);
        inner.addColorStop(0, `rgba(${RED[0]},${RED[1]},${RED[2]},${coreAlpha})`);
        inner.addColorStop(1, `rgba(${RED[0]},${RED[1]},${RED[2]},0)`);
        context.fillStyle = inner;
        context.beginPath();
        context.arc(cx, cy, size * 0.2, 0, Math.PI * 2);
        context.fill();
      }
    };

    frame = window.requestAnimationFrame(draw);
    return () => {
      running = false;
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [points, state, variant]);

  return (
    <div className={`jarvis-presence-form jarvis-presence-${variant} jarvis-presence-state-${state.toLowerCase()} ${className}`.trim()} aria-label={label}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="jarvis-presence-halo" aria-hidden="true" />
      {variant === "hero" ? <span className="jarvis-presence-label">{label}</span> : null}
    </div>
  );
}
