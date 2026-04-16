import type { FlipFluid } from './FlipFluid';

const pointVertexShader = `
  attribute vec2 attrPosition;
  attribute vec3 attrColor;
  uniform vec2 domainSize;
  uniform float pointSize;
  uniform float drawDisk;
  varying vec3 fragColor;
  varying float fragDrawDisk;

  void main() {
    vec4 screenTransform = vec4(2.0 / domainSize.x, 2.0 / domainSize.y, -1.0, -1.0);
    gl_Position = vec4(attrPosition * screenTransform.xy + screenTransform.zw, 0.0, 1.0);
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
      float r2 = dot(gl_PointCoord - 0.5, gl_PointCoord - 0.5);
      if (r2 > 0.25) discard;
      float alpha = 1.0 - smoothstep(0.15, 0.25, r2);
      gl_FragColor = vec4(fragColor, alpha * 0.82);
    } else {
      gl_FragColor = vec4(fragColor, 1.0);
    }
  }
`;

export interface RenderConfig {
  showParticles: boolean;
  showSpray: boolean;
  showFoam: boolean;
  showBubble: boolean;
  showGrid: boolean;
  simWidth: number;
  simHeight: number;
}

export class FluidRenderer {
  private gl: WebGLRenderingContext;
  private pointShader: WebGLProgram;
  private pointVertexBuffer: WebGLBuffer;
  private pointColorBuffer: WebGLBuffer;
  private gridVertBuffer: WebGLBuffer;
  private gridColorBuffer: WebGLBuffer;
  private gridVertBufferInitialized = false;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
    if (!gl) {
      throw new Error('WebGL not supported');
    }

    this.gl = gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this.pointShader = this.createProgram(pointVertexShader, pointFragmentShader);
    this.pointVertexBuffer = this.createBuffer();
    this.pointColorBuffer = this.createBuffer();
    this.gridVertBuffer = this.createBuffer();
    this.gridColorBuffer = this.createBuffer();
  }

  private createProgram(
    vertexSource: string,
    fragmentSource: string
  ): WebGLProgram {
    const gl = this.gl;
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) {
      throw new Error('Failed to create shader program');
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'Shader program linking failed');
    }

    return program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error('Failed to create shader');
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'Shader compilation failed');
    }

    return shader;
  }

  private createBuffer(): WebGLBuffer {
    const buffer = this.gl.createBuffer();
    if (!buffer) {
      throw new Error('Failed to create buffer');
    }
    return buffer;
  }

  render(fluid: FlipFluid, config: RenderConfig): void {
    const gl = this.gl;
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.pointShader);
    gl.uniform2f(
      gl.getUniformLocation(this.pointShader, 'domainSize'),
      config.simWidth,
      config.simHeight
    );

    const positionLocation = gl.getAttribLocation(this.pointShader, 'attrPosition');
    const colorLocation = gl.getAttribLocation(this.pointShader, 'attrColor');

    gl.enableVertexAttribArray(positionLocation);
    gl.enableVertexAttribArray(colorLocation);

    if (config.showGrid) {
      this.renderGrid(fluid, config, positionLocation, colorLocation);
    }

    if (config.showParticles) {
      this.renderParticles(fluid, config, positionLocation, colorLocation);
    }

    if (config.showSpray || config.showFoam || config.showBubble) {
      this.renderDiffuseParticles(fluid, config, positionLocation, colorLocation);
    }

    gl.disableVertexAttribArray(positionLocation);
    gl.disableVertexAttribArray(colorLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  private renderGrid(
    fluid: FlipFluid,
    config: RenderConfig,
    positionLocation: number,
    colorLocation: number
  ): void {
    const gl = this.gl;
    const pointSize = (0.9 * fluid.h * gl.canvas.width) / config.simWidth;
    gl.uniform1f(gl.getUniformLocation(this.pointShader, 'pointSize'), pointSize);
    gl.uniform1f(gl.getUniformLocation(this.pointShader, 'drawDisk'), 0.0);

    if (!this.gridVertBufferInitialized) {
      const cellCenters = new Float32Array(2 * fluid.fNumCells);
      let index = 0;
      for (let i = 0; i < fluid.fNumX; i++) {
        for (let j = 0; j < fluid.fNumY; j++) {
          cellCenters[index++] = (i + 0.5) * fluid.h;
          cellCenters[index++] = (j + 0.5) * fluid.h;
        }
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gridVertBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, cellCenters, gl.STATIC_DRAW);
      this.gridVertBufferInitialized = true;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridVertBuffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, fluid.cellColor, gl.DYNAMIC_DRAW);
    gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, fluid.fNumCells);
  }

  private renderParticles(
    fluid: FlipFluid,
    config: RenderConfig,
    positionLocation: number,
    colorLocation: number
  ): void {
    const gl = this.gl;
    const pointSize = (2.0 * fluid.particleRadius * gl.canvas.width) / config.simWidth;
    gl.uniform1f(gl.getUniformLocation(this.pointShader, 'pointSize'), pointSize);
    gl.uniform1f(gl.getUniformLocation(this.pointShader, 'drawDisk'), 1.0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointVertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      fluid.particlePos.subarray(0, 2 * fluid.numParticles),
      gl.DYNAMIC_DRAW
    );
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointColorBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      fluid.particleColor.subarray(0, 3 * fluid.numParticles),
      gl.DYNAMIC_DRAW
    );
    gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, fluid.numParticles);
  }

  private renderDiffuseParticles(
    fluid: FlipFluid,
    config: RenderConfig,
    positionLocation: number,
    colorLocation: number
  ): void {
    if (fluid.numDiffuseParticles === 0) return;

    const gl = this.gl;
    const pointSize = (1.35 * fluid.particleRadius * gl.canvas.width) / config.simWidth;
    gl.uniform1f(gl.getUniformLocation(this.pointShader, 'pointSize'), pointSize);
    gl.uniform1f(gl.getUniformLocation(this.pointShader, 'drawDisk'), 1.0);

    // Create a temporary set of filtered arrays to upload in one pass if all are enabled,
    // or just render the whole buffer if all are visible.
    const allEnabled = config.showSpray && config.showFoam && config.showBubble;
    if (allEnabled) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointVertexBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        fluid.diffusePos.subarray(0, 2 * fluid.numDiffuseParticles),
        gl.DYNAMIC_DRAW
      );
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointColorBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        fluid.diffuseColor.subarray(0, 3 * fluid.numDiffuseParticles),
        gl.DYNAMIC_DRAW
      );
      gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.POINTS, 0, fluid.numDiffuseParticles);
    } else {
      // Filter the particles that match the visibility config.
      const filteredPos = new Float32Array(2 * fluid.numDiffuseParticles);
      const filteredColor = new Float32Array(3 * fluid.numDiffuseParticles);
      let count = 0;

      for (let i = 0; i < fluid.numDiffuseParticles; i++) {
        const type = fluid.diffuseType[i];
        let visible = false;
        // Check alignment with DIFFUSE_BUBBLE=0, FOAM=1, SPRAY=2
        if (type === 0 && config.showBubble) visible = true;
        else if (type === 1 && config.showFoam) visible = true;
        else if (type === 2 && config.showSpray) visible = true;

        if (visible) {
          filteredPos[2 * count] = fluid.diffusePos[2 * i];
          filteredPos[2 * count + 1] = fluid.diffusePos[2 * i + 1];
          filteredColor[3 * count] = fluid.diffuseColor[3 * i];
          filteredColor[3 * count + 1] = fluid.diffuseColor[3 * i + 1];
          filteredColor[3 * count + 2] = fluid.diffuseColor[3 * i + 2];
          count++;
        }
      }

      if (count > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.pointVertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, filteredPos.subarray(0, 2 * count), gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.pointColorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, filteredColor.subarray(0, 3 * count), gl.DYNAMIC_DRAW);
        gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.POINTS, 0, count);
      }
    }
  }

  invalidateGridBuffer(): void {
    this.gridVertBufferInitialized = false;
  }

  resize(width: number, height: number): void {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    canvas.width = width;
    canvas.height = height;
    this.gl.viewport(0, 0, width, height);
  }
}
