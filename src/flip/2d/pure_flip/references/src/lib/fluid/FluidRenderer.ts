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
			// Add soft edge falloff for more water-like appearance
			float alpha = 1.0 - smoothstep(0.15, 0.25, r2);
			gl_FragColor = vec4(fragColor, alpha * 0.8);
		} else {
			gl_FragColor = vec4(fragColor, 1.0);
		}
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
		vec4 screenTransform = vec4(2.0 / domainSize.x, 2.0 / domainSize.y, -1.0, -1.0);
		gl_Position = vec4(v * screenTransform.xy + screenTransform.zw, 0.0, 1.0);
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

export interface RenderConfig {
    showParticles: boolean;
    showGrid: boolean;
    simWidth: number;
    simHeight: number;
}

export class FluidRenderer {
    private gl: WebGLRenderingContext;
    private pointShader: WebGLProgram;
    private meshShader: WebGLProgram;
    private pointVertexBuffer: WebGLBuffer;
    private pointColorBuffer: WebGLBuffer;
    private gridVertBuffer: WebGLBuffer;
    private gridColorBuffer: WebGLBuffer;
    private gridVertBufferInitialized = false;

    constructor(canvas: HTMLCanvasElement) {
        const gl = canvas.getContext('webgl');
        if (!gl) {
            throw new Error('WebGL not supported');
        }
        this.gl = gl;

        // Enable blending for water-like transparency effects
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        this.pointShader = this.createShader(pointVertexShader, pointFragmentShader);
        this.meshShader = this.createShader(meshVertexShader, meshFragmentShader);

        this.pointVertexBuffer = this.createBuffer();
        this.pointColorBuffer = this.createBuffer();
        this.gridVertBuffer = this.createBuffer();
        this.gridColorBuffer = this.createBuffer();
    }

    private createShader(vsSource: string, fsSource: string): WebGLProgram {
        const gl = this.gl;

        const vsShader = gl.createShader(gl.VERTEX_SHADER);
        if (!vsShader) throw new Error('Failed to create vertex shader');
        gl.shaderSource(vsShader, vsSource);
        gl.compileShader(vsShader);
        if (!gl.getShaderParameter(vsShader, gl.COMPILE_STATUS)) {
            console.error('Vertex shader compile error:', gl.getShaderInfoLog(vsShader));
            throw new Error('Vertex shader compilation failed');
        }

        const fsShader = gl.createShader(gl.FRAGMENT_SHADER);
        if (!fsShader) throw new Error('Failed to create fragment shader');
        gl.shaderSource(fsShader, fsSource);
        gl.compileShader(fsShader);
        if (!gl.getShaderParameter(fsShader, gl.COMPILE_STATUS)) {
            console.error('Fragment shader compile error:', gl.getShaderInfoLog(fsShader));
            throw new Error('Fragment shader compilation failed');
        }

        const shader = gl.createProgram();
        if (!shader) throw new Error('Failed to create shader program');
        gl.attachShader(shader, vsShader);
        gl.attachShader(shader, fsShader);
        gl.linkProgram(shader);

        if (!gl.getProgramParameter(shader, gl.LINK_STATUS)) {
            console.error('Shader link error:', gl.getProgramInfoLog(shader));
            throw new Error('Shader program linking failed');
        }

        return shader;
    }

    private createBuffer(): WebGLBuffer {
        const buffer = this.gl.createBuffer();
        if (!buffer) throw new Error('Failed to create buffer');
        return buffer;
    }

    render(fluid: FlipFluid, config: RenderConfig): void {
        // const gl = this.gl;

        // Water-like background - deep ocean blue
        // gl.clearColor(0.02, 0.1, 0.2, 1.0);
        // gl.clear(gl.COLOR_BUFFER_BIT);
        // gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

        // Render particles and grid
        this.renderPoints(fluid, config);
    }

    private renderPoints(fluid: FlipFluid, config: RenderConfig): void {
        const gl = this.gl;
        gl.useProgram(this.pointShader);
        gl.uniform2f(gl.getUniformLocation(this.pointShader, 'domainSize'), config.simWidth, config.simHeight);

        const posLoc = gl.getAttribLocation(this.pointShader, 'attrPosition');
        gl.enableVertexAttribArray(posLoc);
        const colorLoc = gl.getAttribLocation(this.pointShader, 'attrColor');
        gl.enableVertexAttribArray(colorLoc);

        // Render grid cells
        if (config.showGrid) {
            const pointSize = 0.9 * fluid.h / config.simWidth * gl.canvas.width;
            gl.uniform1f(gl.getUniformLocation(this.pointShader, 'pointSize'), pointSize);
            gl.uniform1f(gl.getUniformLocation(this.pointShader, 'drawDisk'), 0.0);

            if (!this.gridVertBufferInitialized) {
                const cellCenters = new Float32Array(2 * fluid.fNumCells);
                let p = 0;
                for (let i = 0; i < fluid.fNumX; i++) {
                    for (let j = 0; j < fluid.fNumY; j++) {
                        cellCenters[p++] = (i + 0.5) * fluid.h;
                        cellCenters[p++] = (j + 0.5) * fluid.h;
                    }
                }
                gl.bindBuffer(gl.ARRAY_BUFFER, this.gridVertBuffer);
                gl.bufferData(gl.ARRAY_BUFFER, cellCenters, gl.STATIC_DRAW);
                this.gridVertBufferInitialized = true;
            }

            gl.bindBuffer(gl.ARRAY_BUFFER, this.gridVertBuffer);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.gridColorBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, fluid.cellColor, gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);

            gl.drawArrays(gl.POINTS, 0, fluid.fNumCells);
        }

        // Render particles
        if (config.showParticles) {
            const pointSize = 2.0 * fluid.particleRadius / config.simWidth * gl.canvas.width;
            gl.uniform1f(gl.getUniformLocation(this.pointShader, 'pointSize'), pointSize);
            gl.uniform1f(gl.getUniformLocation(this.pointShader, 'drawDisk'), 1.0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.pointVertexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, fluid.particlePos.subarray(0, 2 * fluid.numParticles), gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

            gl.bindBuffer(gl.ARRAY_BUFFER, this.pointColorBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, fluid.particleColor.subarray(0, 3 * fluid.numParticles), gl.DYNAMIC_DRAW);
            gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);

            gl.drawArrays(gl.POINTS, 0, fluid.numParticles);
        }

        gl.disableVertexAttribArray(posLoc);
        gl.disableVertexAttribArray(colorLoc);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    resize(width: number, height: number): void {
        const canvas = this.gl.canvas as HTMLCanvasElement;
        canvas.width = width;
        canvas.height = height;
        this.gl.viewport(0, 0, width, height);
    }
}
