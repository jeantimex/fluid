import { Scene } from './types';

const pointVertexShader = `
		attribute vec2 attrPosition;
		attribute vec3 attrColor;
		uniform vec2 domainSize;
		uniform float pointSize;
		uniform float drawDisk;

		varying vec3 fragColor;
		varying float fragDrawDisk;

		void main() {
		vec4 screenTransform = 
			vec4(2.0 / domainSize.x, 2.0 / domainSize.y, -1.0, -1.0);
		gl_Position =
			vec4(attrPosition * screenTransform.xy + screenTransform.zw, 0.0, 1.0);

		gl_PointSize = pointSize;
		fragColor = attrColor;
		fragDrawDisk = drawDisk;
		}
	`;

const pointFragmentShader = `
		precision mediump float;
		varying vec3 fragColor;
		varying float fragDrawDisk;

		void main() {
			if (fragDrawDisk == 1.0) {
				float rx = 0.5 - gl_PointCoord.x;
				float ry = 0.5 - gl_PointCoord.y;
				float r2 = rx * rx + ry * ry;
				if (r2 > 0.25)
					discard;
			}
			gl_FragColor = vec4(fragColor, 1.0);
		}
	`;

const meshVertexShader = `
		attribute vec2 attrPosition;
		uniform vec2 domainSize;
		uniform vec3 color;
		uniform vec2 translation;
		uniform float scale;

		varying vec3 fragColor;

		void main() {
			vec2 v = translation + attrPosition * scale;
		vec4 screenTransform = 
			vec4(2.0 / domainSize.x, 2.0 / domainSize.y, -1.0, -1.0);
		gl_Position =
			vec4(v * screenTransform.xy + screenTransform.zw, 0.0, 1.0);

		fragColor = color;
		}
	`;

const meshFragmentShader = `
		precision mediump float;
		varying vec3 fragColor;

		void main() {
			gl_FragColor = vec4(fragColor, 1.0);
		}
	`;

export class Renderer {
  gl: WebGLRenderingContext;
  pointShader: WebGLProgram;
  meshShader: WebGLProgram;

  pointVertexBuffer: WebGLBuffer | null = null;
  pointColorBuffer: WebGLBuffer | null = null;
  gridVertBuffer: WebGLBuffer | null = null;
  gridColorBuffer: WebGLBuffer | null = null;
  diskVertBuffer: WebGLBuffer | null = null;
  diskIdBuffer: WebGLBuffer | null = null;

  constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    this.pointShader = this.createShader(pointVertexShader, pointFragmentShader);
    this.meshShader = this.createShader(meshVertexShader, meshFragmentShader);
  }

  createShader(vsSource: string, fsSource: string) {
    const gl = this.gl;
    const vsShader = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vsShader, vsSource);
    gl.compileShader(vsShader);
    if (!gl.getShaderParameter(vsShader, gl.COMPILE_STATUS))
      console.log("vertex shader compile error: " + gl.getShaderInfoLog(vsShader));

    const fsShader = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fsShader, fsSource);
    gl.compileShader(fsShader);
    if (!gl.getShaderParameter(fsShader, gl.COMPILE_STATUS))
      console.log("fragment shader compile error: " + gl.getShaderInfoLog(fsShader));

    const shader_prog = gl.createProgram()!;
    gl.attachShader(shader_prog, vsShader);
    gl.attachShader(shader_prog, fsShader);
    gl.linkProgram(shader_prog);
    return shader_prog;
  }

  resetGridBuffer() {
    this.gridVertBuffer = null;
  }

  draw(scene: Scene, simWidth: number, simHeight: number, canvas: HTMLCanvasElement) {
    const gl = this.gl;
    const fluid = scene.fluid!;

    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // --- Grid ---
    if (this.gridVertBuffer == null) {
      this.gridVertBuffer = gl.createBuffer();
      const cellCenters = new Float32Array(2 * fluid.fNumCells);
      let p_idx = 0;
      for (let i = 0; i < fluid.fNumX; i++) {
        for (let j = 0; j < fluid.fNumY; j++) {
          cellCenters[p_idx++] = (i + 0.5) * fluid.h;
          cellCenters[p_idx++] = (j + 0.5) * fluid.h;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gridVertBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, cellCenters, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    if (this.gridColorBuffer == null) this.gridColorBuffer = gl.createBuffer();

    if (scene.showGrid) {
      const pointSize = (0.9 * fluid.h) / simWidth * canvas.width;
      gl.useProgram(this.pointShader);
      gl.uniform2f(gl.getUniformLocation(this.pointShader, "domainSize"), simWidth, simHeight);
      gl.uniform1f(gl.getUniformLocation(this.pointShader, "pointSize"), pointSize);
      gl.uniform1f(gl.getUniformLocation(this.pointShader, "drawDisk"), 0.0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.gridVertBuffer);
      const posLoc = gl.getAttribLocation(this.pointShader, "attrPosition");
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.gridColorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, fluid.cellColor, gl.DYNAMIC_DRAW);
      const colorLoc = gl.getAttribLocation(this.pointShader, "attrColor");
      gl.enableVertexAttribArray(colorLoc);
      gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.POINTS, 0, fluid.fNumCells);
      gl.disableVertexAttribArray(posLoc);
      gl.disableVertexAttribArray(colorLoc);
    }

    // --- Particles ---
    if (scene.showParticles) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const pointSize = (2.0 * fluid.particleRadius) / simWidth * canvas.width;
      gl.useProgram(this.pointShader);
      gl.uniform2f(gl.getUniformLocation(this.pointShader, "domainSize"), simWidth, simHeight);
      gl.uniform1f(gl.getUniformLocation(this.pointShader, "pointSize"), pointSize);
      gl.uniform1f(gl.getUniformLocation(this.pointShader, "drawDisk"), 1.0);

      if (this.pointVertexBuffer == null) this.pointVertexBuffer = gl.createBuffer();
      if (this.pointColorBuffer == null) this.pointColorBuffer = gl.createBuffer();

      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointVertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, fluid.particlePos, gl.DYNAMIC_DRAW);
      const posLoc = gl.getAttribLocation(this.pointShader, "attrPosition");
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointColorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, fluid.particleColor, gl.DYNAMIC_DRAW);
      const colorLoc = gl.getAttribLocation(this.pointShader, "attrColor");
      gl.enableVertexAttribArray(colorLoc);
      gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.POINTS, 0, fluid.numParticles);
      gl.disableVertexAttribArray(posLoc);
      gl.disableVertexAttribArray(colorLoc);
    }

    // --- Obstacle (Disk) ---
    const numSegs = 50;
    if (this.diskVertBuffer == null) {
      this.diskVertBuffer = gl.createBuffer();
      const dphi = (2.0 * Math.PI) / numSegs;
      const diskVerts = new Float32Array(2 * numSegs + 2);
      let p_idx = 0;
      diskVerts[p_idx++] = 0.0; diskVerts[p_idx++] = 0.0;
      for (let i = 0; i < numSegs; i++) {
        diskVerts[p_idx++] = Math.cos(i * dphi);
        diskVerts[p_idx++] = Math.sin(i * dphi);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.diskVertBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, diskVerts, gl.STATIC_DRAW);

      this.diskIdBuffer = gl.createBuffer();
      const diskIds = new Uint16Array(3 * numSegs);
      p_idx = 0;
      for (let i = 0; i < numSegs; i++) {
        diskIds[p_idx++] = 0; diskIds[p_idx++] = 1 + i; diskIds[p_idx++] = 1 + ((i + 1) % numSegs);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.diskIdBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, diskIds, gl.STATIC_DRAW);
    }

    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.meshShader);
    gl.uniform2f(gl.getUniformLocation(this.meshShader, "domainSize"), simWidth, simHeight);
    gl.uniform3f(gl.getUniformLocation(this.meshShader, "color"), 1.0, 0.0, 0.0);
    gl.uniform2f(gl.getUniformLocation(this.meshShader, "translation"), scene.obstacleX, scene.obstacleY);
    gl.uniform1f(gl.getUniformLocation(this.meshShader, "scale"), scene.obstacleRadius);

    const meshPosLoc = gl.getAttribLocation(this.meshShader, "attrPosition");
    gl.enableVertexAttribArray(meshPosLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.diskVertBuffer);
    gl.vertexAttribPointer(meshPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.diskIdBuffer);
    gl.drawElements(gl.TRIANGLES, 3 * numSegs, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(meshPosLoc);
  }
}
