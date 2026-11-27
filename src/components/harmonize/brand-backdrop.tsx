"use client";

import { useEffect, useRef } from "react";

// Curvas brancas do painel, em coordenadas do layout (1003 x 986).
const WIDTH = 1003;
const HEIGHT = 986;
const CURVES = "M245 0C243 70 246 120 238 175C215 320 120 420 0 492M710 0C690 50 697 100 692 150C675 310 560 420 420 442C360 450 300 436 250 437C150 442 70 470 0 527M1003 345C940 430 860 480 770 515C720 535 660 540 600 530C540 522 430 525 370 550C260 595 225 690 221 780C217 860 215 920 213 986M1003 453C880 478 825 505 770 558C710 618 688 710 686 800C684 870 681 930 680 986";

const VERTEX = "attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }";

// Fundo (faixa roxa com rastros verticais) + curvas, vistos através de "bolhas" que deslizam e separam as cores.
const FRAGMENT = `
precision highp float;
uniform vec2 res;
uniform float scale;
uniform float time;
uniform sampler2D curves;

vec3 backdrop(vec2 pos) {
  vec2 q = (pos - 0.5 * res) / scale / vec2(${WIDTH}.0, ${HEIGHT}.0) + 0.5;
  float y = clamp(q.y, 0.0, 1.0);
  vec3 color = mix(vec3(0.106, 0.051, 0.271), vec3(0.150, 0.080, 0.360), smoothstep(0.0, 0.22, y));
  color = mix(color, vec3(0.098, 0.047, 0.227), smoothstep(0.22, 0.58, y));
  color = mix(color, vec3(0.063, 0.035, 0.122), smoothstep(0.58, 1.0, y));
  float band = 0.215 + 0.13 * q.x + 0.018 * sin(q.x * 15.0);
  float d = y - band;
  color += vec3(0.30, 0.22, 0.56) * exp(-d * d / 0.0042) * (1.0 - 0.35 * q.x);
  float wave = 0.5 + 0.5 * cos(6.2832 * (q.x * 9.5 - 0.30 * sin(q.x * 6.0) - y * 0.9));
  float tail = smoothstep(-0.09, 0.04, d) * exp(-max(d, 0.0) / (0.09 + 0.22 * q.x));
  color += vec3(0.26, 0.19, 0.52) * pow(wave, 4.0) * tail * smoothstep(0.02, 0.55, q.x);
  vec2 corner = (q - vec2(1.0, 0.0)) * vec2(3.0, 3.4);
  color += vec3(0.26, 0.09, 0.62) * exp(-dot(corner, corner));
  return color + texture2D(curves, pos / res).rgb * 0.55;
}

void main() {
  vec2 pos = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);
  vec2 design = (pos - 0.5 * res) / scale + 0.5 * vec2(${WIDTH}.0, ${HEIGHT}.0);
  vec2 bend = vec2(0.0);
  float shine = 0.0;
  for (int i = 0; i < 6; i++) {
    float n = float(i);
    // Perto das curvas (onde a distorção aparece), alternando subida e descida.
    float lane = i == 0 ? 225.0 : i == 1 ? 690.0 : i == 2 ? 860.0 : i == 3 ? 130.0 : i == 4 ? 560.0 : 330.0;
    float radius = 62.0 + 17.0 * mod(n * 1.7, 3.0);
    float way = mod(n, 2.0) < 0.5 ? 1.0 : -1.0;
    vec2 center = vec2(
      lane + 75.0 * sin(time * (0.35 + 0.06 * n) + n * 2.1),
      mod(n * 233.0 + way * time * (48.0 + 9.0 * n), ${HEIGHT}.0 + 260.0) - 130.0
    );
    vec2 away = design - center;
    float k = max(0.0, 1.0 - length(away) / radius);
    bend -= away * k * k * 1.25;
    vec2 spot = (away - radius * vec2(-0.16, 0.22)) / (radius * vec2(0.42, 0.10));
    spot = mat2(0.9, -0.43, 0.43, 0.9) * spot;
    shine += exp(-dot(spot, spot)) * 0.11;
  }
  vec2 offset = bend * scale;
  vec3 color = vec3(
    backdrop(pos + offset * 0.80).r,
    backdrop(pos + offset).g,
    backdrop(pos + offset * 1.22).b
  );
  gl_FragColor = vec4(color + shine * vec3(0.82, 0.80, 1.0), 1.0);
}`;

// Desenha o efeito no canvas; sem WebGL (ou se algo falhar) o fundo em CSS/SVG continua visível.
function startBubbles(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", { antialias: false, powerPreference: "low-power" });
  if (!gl) return;
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]] as const) {
    const shader = gl.createShader(type);
    if (!shader) return;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const attribute = gl.getAttribLocation(program, "a");
  gl.enableVertexAttribArray(attribute);
  gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const [name, value] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) gl.texParameteri(gl.TEXTURE_2D, name, value);

  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const [resolution, scaleAt, timeAt] = [uniform("res"), uniform("scale"), uniform("time")];
  const sheet = document.createElement("canvas");
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame = 0;
  const draw = (milliseconds: number) => {
    gl.uniform1f(timeAt, still ? 4 : milliseconds / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.style.opacity = "1";
    if (!still) frame = window.requestAnimationFrame(draw);
  };

  // Mesmo enquadramento do SVG ("xMidYMid slice"): cobre o painel inteiro e centraliza.
  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    const pen = sheet.getContext("2d");
    if (!width || !height || !pen) return;
    canvas.width = sheet.width = width;
    canvas.height = sheet.height = height;
    const scale = Math.max(width / WIDTH, height / HEIGHT);
    pen.fillStyle = "#000";
    pen.fillRect(0, 0, width, height);
    pen.setTransform(scale, 0, 0, scale, (width - WIDTH * scale) / 2, (height - HEIGHT * scale) / 2);
    pen.strokeStyle = "#fff";
    pen.lineWidth = 1.3;
    pen.stroke(new Path2D(CURVES));
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, sheet);
    gl.viewport(0, 0, width, height);
    gl.uniform2f(resolution, width, height);
    gl.uniform1f(scaleAt, scale);
    window.cancelAnimationFrame(frame);
    draw(performance.now());
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  const lost = () => { window.cancelAnimationFrame(frame); canvas.style.opacity = "0"; };
  canvas.addEventListener("webglcontextlost", lost);

  return () => {
    window.cancelAnimationFrame(frame);
    observer.disconnect();
    canvas.removeEventListener("webglcontextlost", lost);
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
    gl.deleteTexture(texture);
  };
}

// Fundo do painel de marca das telas de acesso.
export function BrandBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => (canvasRef.current ? startBubbles(canvasRef.current) : undefined), []);
  return (
    <div aria-hidden="true" className="absolute inset-0">
      <div className="absolute inset-0 bg-[radial-gradient(120%_38%_at_20%_24%,rgba(112,82,208,0.75),transparent_70%),radial-gradient(70%_45%_at_95%_0%,rgba(104,45,230,0.85),transparent_70%),linear-gradient(180deg,#1b0d45_0%,#2a1766_26%,#190c3b_56%,#10091f_100%)]" />
      <svg className="absolute inset-0 h-full w-full text-white/50" fill="none" preserveAspectRatio="xMidYMid slice" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
        <path d={CURVES} stroke="currentColor" strokeWidth="1.2" />
      </svg>
      <canvas className="absolute inset-0 h-full w-full opacity-0 transition-opacity duration-700" ref={canvasRef} />
    </div>
  );
}
