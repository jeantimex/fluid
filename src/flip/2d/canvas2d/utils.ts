/**
 * Clamps a number between a minimum and maximum value.
 */
export function clamp(x: number, min: number, max: number) {
  if (x < min) return min;
  else if (x > max) return max;
  else return x;
}

/**
 * Compiles and links a WebGL shader program.
 */
export function createShader(gl: WebGLRenderingContext, vsSource: string, fsSource: string): WebGLProgram {
  const vsShader = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vsShader, vsSource);
  gl.compileShader(vsShader);
  if (!gl.getShaderParameter(vsShader, gl.COMPILE_STATUS)) {
    console.error("Vertex shader compile error: " + gl.getShaderInfoLog(vsShader));
  }

  const fsShader = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fsShader, fsSource);
  gl.compileShader(fsShader);
  if (!gl.getShaderParameter(fsShader, gl.COMPILE_STATUS)) {
    console.error("Fragment shader compile error: " + gl.getShaderInfoLog(fsShader));
  }

  const shaderProg = gl.createProgram()!;
  gl.attachShader(shaderProg, vsShader);
  gl.attachShader(shaderProg, fsShader);
  gl.linkProgram(shaderProg);
  
  if (!gl.getProgramParameter(shaderProg, gl.LINK_STATUS)) {
    console.error("Shader program link error: " + gl.getProgramInfoLog(shaderProg));
  }

  return shaderProg;
}

/**
 * Maps a value to a scientific color scale (blue to red).
 * Returns an array [r, g, b].
 */
export function getSciColor(val: number, minVal: number, maxVal: number): [number, number, number] {
  val = Math.min(Math.max(val, minVal), maxVal - 0.0001);
  const range = maxVal - minVal;
  val = range === 0.0 ? 0.5 : (val - minVal) / range;
  const m = 0.25;
  const num = Math.floor(val / m);
  const s = (val - num * m) / m;
  let r, g, b;
  switch (num) {
    case 0: r = 0.0; g = s; b = 1.0; break;
    case 1: r = 0.0; g = 1.0; b = 1.0 - s; break;
    case 2: r = s; g = 1.0; b = 0.0; break;
    case 3: r = 1.0; g = 1.0 - s; b = 0.0; break;
    default: r = 0.0; g = 0.0; b = 0.0;
  }
  return [r, g, b];
}
