import type { CSSProperties } from "react";
import type { MascotPose } from "@/lib/mascot-rules";

const W = 160;
const H = 180;

type Arm = { rest: number; swing: number; ms: number };
type Motion = { name: string; ms: number; times: number; vars?: CSSProperties };
type Pose = {
  right: Arm;
  left: Arm;
  /** Movimento do corpo inteiro. */
  body: Motion;
  /** Balanço da antena (opcional). */
  antenna?: Motion;
  /** Olhos: piscar nos dois, piscar só o direito, ou olhar de um lado para o outro. */
  eyes?: "blink" | "wink" | "look";
};

const down: Arm = { rest: 72, swing: 0, ms: 1000 };
const float = (ms = 3600, times = 1, px = "2px"): Motion => ({ name: "hp-mascot-float", ms, times, vars: { "--hp-float": px } as CSSProperties });

/**
 * Cada pose combina braços, corpo, antena e olhos — por isso não ficam todas parecidas.
 * Ângulo do braço em graus: 0 = horizontal, + = para baixo.
 */
const POSES: Record<MascotPose, Pose> = {
  wave: { right: { rest: -70, swing: 9, ms: 700 }, left: down, body: float() },
  point: { right: { rest: 52, swing: 3, ms: 900 }, left: down, body: float() },
  think: { right: { rest: -38, swing: 2, ms: 1200 }, left: down, body: { name: "hp-mascot-sway", ms: 2600, times: 2 }, eyes: "look" },
  cheer: { right: { rest: -105, swing: 6, ms: 600 }, left: { rest: -105, swing: 6, ms: 600 }, body: { name: "hp-mascot-bounce", ms: 900, times: 4 }, antenna: { name: "hp-mascot-antenna", ms: 900, times: 4 } },
  nod: { right: down, left: down, body: { name: "hp-mascot-nod", ms: 1400, times: 2 } },
  peek: { right: { rest: 40, swing: 0, ms: 1000 }, left: down, body: { name: "hp-mascot-tilt", ms: 2200, times: 2 }, antenna: { name: "hp-mascot-antenna", ms: 1600, times: 2 }, eyes: "look" },
  wink: { right: { rest: -62, swing: 7, ms: 800 }, left: down, body: { name: "hp-mascot-hop", ms: 1300, times: 2 }, eyes: "wink" },
  shrug: { right: { rest: -16, swing: 4, ms: 1500 }, left: { rest: -16, swing: 4, ms: 1500 }, body: { name: "hp-mascot-sway", ms: 2000, times: 2 }, antenna: { name: "hp-mascot-antenna", ms: 2000, times: 2 } },
};

/** Os movimentos em loop duram só um instante e depois o mascote fica parado (menos distração). */
const ACTIVE_MS = 4000;

function anim({ name, ms, times }: Motion) {
  return `${name} ${ms}ms ease-in-out ${times}`;
}

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

/** Um olho: o grupo de fora fecha a pálpebra (piscar/piscadela), o de dentro move a pupila (olhar). */
function MascotEye({ x, lid, look }: { x: number; lid?: string; look?: string }) {
  return (
    <g className={lid} style={{ transformOrigin: `${x}px 88px` }}>
      <circle cx={x} cy={88} r={14} fill="#ffffff" />
      <g className={look} style={{ transformOrigin: `${x}px 88px` }}>
        <circle cx={x + 3} cy={90} r={7} fill="#2a2745" />
        <circle cx={x + 5.5} cy={87} r={2.4} fill="#ffffff" />
      </g>
    </g>
  );
}

/** "Harmo", o guia: corpo na cor do tema, antena, olhos e braços. A pose define o conjunto do movimento. */
export function GuideMascot({ size = 150, pose = "wave", animated = true }: { size?: number; pose?: MascotPose; animated?: boolean }) {
  const config = POSES[pose] ?? POSES.wave;
  const bodyStyle = animated ? ({ animation: anim(config.body), ...config.body.vars } as CSSProperties) : undefined;
  const antennaStyle = animated && config.antenna ? ({ animation: anim(config.antenna) } as CSSProperties) : undefined;
  const eyes = animated ? config.eyes ?? "blink" : undefined;
  const lid = eyes === "wink" ? undefined : eyes === "blink" ? "hp-mascot-blink" : undefined;
  const look = eyes === "look" ? "hp-mascot-look" : undefined;
  return (
    <svg aria-hidden="true" focusable="false" width={size} height={size * (H / W)} viewBox={`0 0 ${W} ${H}`} className="hp-mascot pointer-events-none shrink-0 overflow-visible">
      <ellipse cx={80} cy={174} rx={42} ry={5} fill="#191a2e" opacity={0.12} />
      <g className="hp-mascot-body" style={bodyStyle}>
        <ellipse cx={60} cy={166} rx={15} ry={8} fill="var(--primary-foreground)" />
        <ellipse cx={100} cy={166} rx={15} ry={8} fill="var(--primary-foreground)" />
        <g className="hp-mascot-antenna" style={antennaStyle}>
          <path d="M80 24 V8" stroke="var(--primary)" strokeWidth={5} strokeLinecap="round" fill="none" />
          <circle cx={80} cy={6} r={6.5} fill="#ffc94d" />
        </g>
        <path d="M30 100 C30 50 58 24 80 24 C102 24 130 50 130 100 C130 142 112 166 80 166 C48 166 30 142 30 100 Z" fill="var(--primary)" />
        <ellipse cx={80} cy={128} rx={30} ry={26} fill="#ffffff" opacity={0.2} />
        <path d="M62 134 Q80 150 98 134" stroke="#ffffff" strokeWidth={4.5} strokeLinecap="round" fill="none" />
        <circle cx={47} cy={110} r={7} fill="#ff9aa8" opacity={0.55} />
        <circle cx={113} cy={110} r={7} fill="#ff9aa8" opacity={0.55} />
        <MascotEye x={62} lid={lid} look={look} />
        {/* Na piscadela só o olho direito fecha. */}
        <MascotEye x={98} lid={eyes === "wink" ? "hp-mascot-wink" : lid} look={look} />
        <MascotArm side="left" arm={config.left} animated={animated} />
        <MascotArm side="right" arm={config.right} animated={animated} />
      </g>
    </svg>
  );
}
