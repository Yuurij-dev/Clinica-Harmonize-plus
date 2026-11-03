import type { CSSProperties } from "react";
import type { TourPose } from "@/lib/tour-rules";

const W = 160;
const H = 180;

type Arm = { rest: number; swing: number; ms: number };
/** Posição de repouso, amplitude e velocidade de cada braço em cada pose (graus; 0 = braço na horizontal, + = para baixo). */
const ARMS: Record<TourPose, { right: Arm; left: Arm }> = {
  wave: { right: { rest: -70, swing: 9, ms: 700 }, left: { rest: 72, swing: 0, ms: 1000 } },
  point: { right: { rest: 52, swing: 3, ms: 900 }, left: { rest: 72, swing: 0, ms: 1000 } },
  think: { right: { rest: -38, swing: 2, ms: 1200 }, left: { rest: 72, swing: 0, ms: 1000 } },
  cheer: { right: { rest: -105, swing: 6, ms: 600 }, left: { rest: -105, swing: 6, ms: 600 } },
};

/** Os movimentos em loop duram só um instante e depois o mascote fica parado (menos distração). */
const ACTIVE_MS = 4000;

function MascotArm({ side, arm, animated }: { side: "left" | "right"; arm: Arm; animated: boolean }) {
  const right = side === "right";
  const deg = right ? arm.rest : -arm.rest;
  const swing = animated && arm.swing > 0;
  const cycles = Math.max(1, Math.round(ACTIVE_MS / (arm.ms * 2)));
  const style = swing ? ({ "--hp-swing": `${arm.swing}deg`, animation: `hp-mascot-arm ${arm.ms * 2}ms ease-in-out ${cycles}` } as CSSProperties) : undefined;
  return (
    // Ombro em (122,106) no braço direito e (38,106) no esquerdo; o grupo interno gira em torno dele (origem 0,0).
    <g transform={`translate(${right ? 122 : 38} 106) rotate(${deg})`}>
      <g style={style} className="hp-mascot-arm">
        <path d={right ? "M0 0 H37" : "M0 0 H-37"} stroke="var(--primary)" strokeWidth={17} strokeLinecap="round" fill="none" />
        <circle cx={right ? 39 : -39} cy={0} r={8.5} fill="#ffffff" />
      </g>
    </g>
  );
}

/** "Harmo", o guia do tour: corpo na cor do tema com antena, olhos que piscam e braços que acenam, apontam ou comemoram. */
export function GuideMascot({ size = 150, pose = "wave", animated = true }: { size?: number; pose?: TourPose; animated?: boolean }) {
  const arms = ARMS[pose];
  const floatStyle = animated ? ({ animation: `hp-mascot-float ${pose === "cheer" ? 900 : 3600}ms ease-in-out 500ms ${pose === "cheer" ? 4 : 1}`, "--hp-float": pose === "cheer" ? "3px" : "2px" } as CSSProperties) : undefined;
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size * (H / W)} viewBox={`0 0 ${W} ${H}`} className="hp-mascot pointer-events-none shrink-0 overflow-visible">
      <ellipse cx={80} cy={174} rx={42} ry={5} fill="#191a2e" opacity={0.12} />
      <g style={floatStyle}>
        <ellipse cx={60} cy={166} rx={15} ry={8} fill="var(--primary-foreground)" />
        <ellipse cx={100} cy={166} rx={15} ry={8} fill="var(--primary-foreground)" />
        <path d="M80 24 V8" stroke="var(--primary)" strokeWidth={5} strokeLinecap="round" fill="none" />
        <circle cx={80} cy={6} r={6.5} fill="#ffc94d" />
        <path d="M30 100 C30 50 58 24 80 24 C102 24 130 50 130 100 C130 142 112 166 80 166 C48 166 30 142 30 100 Z" fill="var(--primary)" />
        <ellipse cx={80} cy={128} rx={30} ry={26} fill="#ffffff" opacity={0.2} />
        <path d="M62 134 Q80 150 98 134" stroke="#ffffff" strokeWidth={4.5} strokeLinecap="round" fill="none" />
        <circle cx={47} cy={110} r={7} fill="#ff9aa8" opacity={0.55} />
        <circle cx={113} cy={110} r={7} fill="#ff9aa8" opacity={0.55} />
        <g className={animated ? "hp-mascot-eyes" : undefined}>
          <circle cx={62} cy={88} r={14} fill="#ffffff" />
          <circle cx={98} cy={88} r={14} fill="#ffffff" />
          <circle cx={65} cy={90} r={7} fill="#2a2745" />
          <circle cx={101} cy={90} r={7} fill="#2a2745" />
          <circle cx={67.5} cy={87} r={2.4} fill="#ffffff" />
          <circle cx={103.5} cy={87} r={2.4} fill="#ffffff" />
        </g>
        <MascotArm side="left" arm={arms.left} animated={animated} />
        <MascotArm side="right" arm={arms.right} animated={animated} />
      </g>
    </svg>
  );
}
