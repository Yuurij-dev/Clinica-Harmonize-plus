/** Poses do Harmo. Cada uma tem braços, movimento de corpo, antena e olhos próprios (ver guide-mascot.tsx). */
export const MASCOT_POSES = ["wave", "point", "think", "cheer", "nod", "peek", "wink", "shrug"] as const;

export type MascotPose = (typeof MASCOT_POSES)[number];

export function isMascotPose(value: unknown): value is MascotPose {
  return typeof value === "string" && (MASCOT_POSES as readonly string[]).includes(value);
}

/**
 * Pose estável a partir de um texto (o título do modal, por exemplo): o mesmo modal mostra sempre a
 * mesma pose, mas modais diferentes variam entre si — sem repetir o mesmo aceno em toda tela.
 */
export function poseForKey(key: string, poses: readonly MascotPose[] = MASCOT_POSES): MascotPose {
  if (!poses.length) return "wave";
  // FNV-1a mais avalanche (fmix32). O embaralhamento final importa: como o número de poses é
  // potência de dois, o resto usa só os bits baixos, e um hash simples agruparia títulos parecidos.
  let hash = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193) >>> 0;
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return poses[hash % poses.length];
}
