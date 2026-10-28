// O Atrament 5 não publica tipos; só o que o editor de marcação usa.
declare module "atrament" {
  export const MODE_DRAW: "draw";
  export const MODE_ERASE: "erase";
  export const MODE_FILL: "fill";
  export const MODE_DISABLED: "disabled";
  export type AtramentMode = "draw" | "erase" | "fill" | "disabled";

  export type AtramentSegment = { point: { x: number; y: number }; time: number; pressure: number };
  export type AtramentStroke = { segments: AtramentSegment[]; mode: AtramentMode; weight: number; smoothing: number; color: string; adaptiveStroke: boolean };

  export default class Atrament {
    constructor(canvas: HTMLCanvasElement | string, options?: { width?: number; height?: number; color?: string });
    mode: AtramentMode;
    color: string;
    weight: number;
    smoothing: number;
    adaptiveStroke: boolean;
    recordStrokes: boolean;
    pressureLow: number;
    pressureHigh: number;
    beginStroke(x: number, y: number): void;
    draw(x: number, y: number, prevX: number, prevY: number, pressure?: number): { x: number; y: number };
    endStroke(x: number, y: number): void;
    clear(): void;
    destroy(): void;
    addEventListener(type: "strokerecorded", listener: (event: { stroke: AtramentStroke }) => void): void;
    addEventListener(type: "strokestart" | "strokeend", listener: (event: { x: number; y: number }) => void): void;
    removeEventListener(type: string, listener: (event: never) => void): void;
  }
}
