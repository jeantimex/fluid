import { Utilities } from './utilities';
import { Camera } from './camera';
import { BoxEditor } from './box_editor';
import { generateSphereGeometry } from './renderer';
import { Simulator } from './simulator';
import { GBufferPass } from './render/passes/gbuffer_pass';
import { ShadowPass } from './render/passes/shadow_pass';
import { AOPass } from './render/passes/ao_pass';
import { CompositePass } from './render/passes/composite_pass';
import { FXAAPass } from './render/passes/fxaa_pass';
import { RenderResources } from './render/resources';
import type { SceneConfig } from './render/types';
import { MouseInteractionController } from './input/mouse_interaction';
import { createGui } from './ui/gui';

/**
 * Application entry point.
 *
 * Responsibilities in this file:
 * 1) Initialize WebGPU device/context and GPU resources.
 * 2) Configure simulation state + UI controls.
 * 3) Build render/compute pipelines and bind groups.
 * 4) Execute per-frame compute + multi-pass rendering.
 *
 * Frame order (when particles exist):
 * compute FLIP -> G-buffer -> shadow -> AO -> composite -> wireframe -> FXAA.
 */
async function init() {
  if (!navigator.gpu) {
    alert('WebGPU is not supported in this browser.');
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    alert('No appropriate GPU adapter found.');
    return;
  }

  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBuffersPerShaderStage: 10,
    },
  });
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const context = canvas.getContext('webgpu') as GPUCanvasContext;

  const devicePixelRatio = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentationFormat,
    alphaMode: 'premultiplied',
  });

  // --- Simulation config ---
  // World-space fluid/container tuning values surfaced to GUI.
  const BASE_PARTICLE_RADIUS = 0.22;
  const simConfig = {
    particleRadius: 0.12,
    spacingFactor: 3.0,
    boxWidth: 24,
    boxHeight: 10,
    boxDepth: 15,
    particleCount: 35000,
    fluidity: 0.99,
    showWireframe: true,
  };

  // Smooth configuration for gradual transitions
  // Keeps container changes visually/physically stable over several frames.
  const smoothConfig = {
    boxWidth: simConfig.boxWidth,
    boxHeight: simConfig.boxHeight,
    boxDepth: simConfig.boxDepth,
  };

  const getPositionScale = () =>
    simConfig.particleRadius / BASE_PARTICLE_RADIUS;

  // Simulation offset to center fluid on tiles (world origin)
  // Simulation uses positive [0,width] coordinates; render space is centered.
  const getSimOffsetX = () => -smoothConfig.boxWidth / 2;
  const getSimOffsetY = () => 0;
  const getSimOffsetZ = () => -smoothConfig.boxDepth / 2;

  const getInternalGridWidth = () => smoothConfig.boxWidth;
  const getInternalGridHeight = () => smoothConfig.boxHeight;
  const getInternalGridDepth = () => smoothConfig.boxDepth;

  const RESOLUTION_X = 32;
  const RESOLUTION_Y = 16;
  const RESOLUTION_Z = 16;

  const camera = new Camera(canvas, [0, 0, 0]); // Orbit around world origin
  const boxEditor = new BoxEditor(device, presentationFormat, [
    simConfig.boxWidth,
    simConfig.boxHeight,
    simConfig.boxDepth,
  ]);

  // --- Particle Setup ---
  // Buffers are allocated for max capacity once, then subranges are used.
  const MAX_PARTICLES = 200000;
  const particlePositionBuffer = device.createBuffer({
    size: MAX_PARTICLES * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const particleVelocityBuffer = device.createBuffer({
    size: MAX_PARTICLES * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  // Pre-computed random directions (uniform on sphere, matching WebGL)
  const particleRandomBuffer = device.createBuffer({
    size: MAX_PARTICLES * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const randomData = new Float32Array(MAX_PARTICLES * 4);
  for (let i = 0; i < MAX_PARTICLES; i++) {
    // Uniform distribution on sphere (same as WebGL)
    const theta = Math.random() * 2.0 * Math.PI;
    const u = Math.random() * 2.0 - 1.0;
    randomData[i * 4 + 0] = Math.sqrt(1.0 - u * u) * Math.cos(theta);
    randomData[i * 4 + 1] = Math.sqrt(1.0 - u * u) * Math.sin(theta);
    randomData[i * 4 + 2] = u;
    randomData[i * 4 + 3] = 0.0;
  }
  device.queue.writeBuffer(particleRandomBuffer, 0, randomData);

  const simulator = new Simulator(
    device,
    RESOLUTION_X,
    RESOLUTION_Y,
    RESOLUTION_Z,
    getInternalGridWidth(),
    getInternalGridHeight(),
    getInternalGridDepth(),
    particlePositionBuffer,
    particleVelocityBuffer,
    particleRandomBuffer
  );

  // Generate sphere geometry (2 iterations) for G-buffer - good balance of quality and performance
  const sphereGeom = generateSphereGeometry(2);
  const sphereVertexBuffer = device.createBuffer({
    size: sphereGeom.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });
  new Float32Array(sphereVertexBuffer.getMappedRange()).set(
    sphereGeom.vertices
  );
  sphereVertexBuffer.unmap();

  const sphereNormalBuffer = device.createBuffer({
    size: sphereGeom.normals.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });
  new Float32Array(sphereNormalBuffer.getMappedRange()).set(sphereGeom.normals);
  sphereNormalBuffer.unmap();

  const sphereIndexBuffer = device.createBuffer({
    size: sphereGeom.indices.byteLength,
    usage: GPUBufferUsage.INDEX,
    mappedAtCreation: true,
  });
  new Uint16Array(sphereIndexBuffer.getMappedRange()).set(sphereGeom.indices);
  sphereIndexBuffer.unmap();

  // Generate low-poly sphere geometry (1 iteration) for AO pass - soft effect doesn't need detail
  const aoSphereGeom = generateSphereGeometry(1);
  const aoSphereVertexBuffer = device.createBuffer({
    size: aoSphereGeom.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });
  new Float32Array(aoSphereVertexBuffer.getMappedRange()).set(
    aoSphereGeom.vertices
  );
  aoSphereVertexBuffer.unmap();

  const aoSphereIndexBuffer = device.createBuffer({
    size: aoSphereGeom.indices.byteLength,
    usage: GPUBufferUsage.INDEX,
    mappedAtCreation: true,
  });
  new Uint16Array(aoSphereIndexBuffer.getMappedRange()).set(
    aoSphereGeom.indices
  );
  aoSphereIndexBuffer.unmap();

  // Shadow map dimensions
  const SHADOW_MAP_SIZE = 1024;

  const resources = new RenderResources(
    device,
    presentationFormat,
    canvas.width,
    canvas.height,
    SHADOW_MAP_SIZE
  );

  // Scene configuration (Unity-style)
  const sceneConfig: SceneConfig = {
    dirToSun: [-0.83, 0.42, -0.36],
    floorY: 0.0, // Floor at bottom of simulation
    skyColorHorizon: [1.0, 1.0, 1.0],
    sunPower: 500.0,
    skyColorZenith: [0.08, 0.37, 0.73],
    sunBrightness: 1.0,
    skyColorGround: [0.55, 0.5, 0.55],
    floorSize: 100.0,
    tileCol1: [0.20392157, 0.5176471, 0.7764706], // Light Blue
    tileScale: 1.0,
    tileCol2: [0.6081319, 0.36850303, 0.8584906], // Purple
    tileDarkFactor: -0.35,
    tileCol3: [0.3019758, 0.735849, 0.45801795], // Green
    tileCol4: [0.8018868, 0.6434483, 0.36690104], // Yellow/Brown
  };

  const guiApi = createGui({
    simConfig,
    sceneConfig,
    maxParticles: MAX_PARTICLES,
    onParticleSpawnRequested: () => {
      spawnParticles();
    },
  });
  const guiState = guiApi.guiState;

  // Calculate light matrices (aligned with scene sun direction)
  const sunDir = sceneConfig.dirToSun;
  const lightDistance = 50.0;
  const lightPos = [
    sunDir[0] * lightDistance,
    sunDir[1] * lightDistance,
    sunDir[2] * lightDistance,
  ];

  const lightViewMatrix = Utilities.makeLookAtMatrix(
    new Float32Array(16),
    lightPos,
    [0, 0, 0], // Look at floor center
    [0.0, 1.0, 0.0] // Standard Y-up for slanted light
  );

  // Orthographic projection covering the simulation area from the light's POV
  const orthoSize = 40.0;
  const lightProjectionMatrix = Utilities.makeOrthographicMatrixWebGPU(
    new Float32Array(16),
    -orthoSize,
    orthoSize,
    -orthoSize,
    orthoSize,
    0.1,
    lightDistance * 2.0
  );
  const lightProjectionViewMatrix = new Float32Array(16);
  Utilities.premultiplyMatrix(
    lightProjectionViewMatrix,
    lightViewMatrix,
    lightProjectionMatrix
  );

  const gBufferPass = new GBufferPass(
    device,
    particlePositionBuffer,
    particleVelocityBuffer
  );
  const shadowPass = new ShadowPass(device, particlePositionBuffer);
  const aoPass = new AOPass(
    device,
    particlePositionBuffer,
    resources.linearSampler
  );
  const compositePass = new CompositePass(
    device,
    presentationFormat,
    resources.linearSampler,
    resources.shadowSampler
  );
  const fxaaPass = new FXAAPass(
    device,
    presentationFormat,
    resources.linearSampler
  );

  function updateSizeDependentBindings() {
    aoPass.updateSizeDependentBindings(resources.gBufferView);
    compositePass.updateSizeDependentBindings(
      resources.gBufferView,
      resources.occlusionView,
      resources.shadowDepthView
    );
    fxaaPass.updateSizeDependentBindings(resources.compositingView);
  }
  updateSizeDependentBindings();

  let particleCount = 0;
  function spawnParticles() {
    // Rebuild particle state from current box layout + target count.
    // Positions/velocities are rewritten from scratch.
    const positions = new Float32Array(MAX_PARTICLES * 4);
    const velocities = new Float32Array(MAX_PARTICLES * 4);
    const positionScale = getPositionScale();

    if (boxEditor.boxes.length > 0) {
      particleCount = Math.min(simConfig.particleCount, MAX_PARTICLES);

      // Calculate total volume of all boxes in world space
      let totalBoxVolumeWorld = 0;
      for (const box of boxEditor.boxes) {
        totalBoxVolumeWorld += box.computeVolume();
      }

      // Natural packing: we want particles to be ~spacingFactor*radius apart in world space
      const naturalSpacingWorld =
        simConfig.spacingFactor * simConfig.particleRadius;
      const naturalVolumeWorld =
        particleCount * Math.pow(naturalSpacingWorld, 3);

      // Fill ratio determines how much of the user's boxes we fill to maintain this density
      const fillRatio = Math.min(1.0, naturalVolumeWorld / totalBoxVolumeWorld);
      const linearFillRatio = Math.pow(fillRatio, 1 / 3);

      console.log(
        `Spawning ${particleCount} particles (S: ${positionScale.toFixed(3)}, Fill: ${(fillRatio * 100).toFixed(1)}%)`
      );

      let particlesCreated = 0;
      for (let boxIdx = 0; boxIdx < boxEditor.boxes.length; boxIdx++) {
        const box = boxEditor.boxes[boxIdx];
        const boxVolumeWorld = box.computeVolume();

        let particlesInBox: number;
        if (boxIdx < boxEditor.boxes.length - 1) {
          particlesInBox = Math.floor(
            (particleCount * boxVolumeWorld) / totalBoxVolumeWorld
          );
        } else {
          particlesInBox = particleCount - particlesCreated;
        }

        // Center the spawning volume within each box
        const boxW = box.max[0] - box.min[0];
        const boxH = box.max[1] - box.min[1];
        const boxD = box.max[2] - box.min[2];

        const spawnW = boxW * linearFillRatio;
        const spawnH = boxH * linearFillRatio;
        const spawnD = boxD * linearFillRatio;

        const offX = (boxW - spawnW) / 2;
        const offY = 0; // Always start from bottom
        const offZ = (boxD - spawnD) / 2;

        const cellsTarget = Math.pow(particlesInBox, 1 / 3);
        const nx = Math.max(
          1,
          Math.round(cellsTarget * Math.pow(spawnW / spawnH, 1 / 3))
        );
        const ny = Math.max(
          1,
          Math.round(cellsTarget * Math.pow(spawnH / spawnD, 1 / 3))
        );
        const nz = Math.max(1, Math.ceil(particlesInBox / (nx * ny)));

        for (let i = 0; i < particlesInBox; i++) {
          const idx = particlesCreated + i;
          const ix = i % nx;
          const iy = Math.floor(i / nx) % ny;
          const iz = Math.floor(i / (nx * ny));

          // Jittered grid position in world space
          const px =
            box.min[0] +
            offX +
            (ix + 0.5 + (Math.random() - 0.5) * 0.5) * (spawnW / nx);
          const py =
            box.min[1] +
            offY +
            (iy + 0.5 + (Math.random() - 0.5) * 0.5) * (spawnH / ny);
          const pz =
            box.min[2] +
            offZ +
            (iz + 0.5 + (Math.random() - 0.5) * 0.5) * (spawnD / nz);

          // Map to simulation space: WorldPos - ContainerOffset
          positions[idx * 4 + 0] = px - getSimOffsetX();
          positions[idx * 4 + 1] = py - getSimOffsetY();
          positions[idx * 4 + 2] = pz - getSimOffsetZ();
          positions[idx * 4 + 3] = 1.0;

          velocities[idx * 4 + 0] = 0.0;
          velocities[idx * 4 + 1] = 0.0;
          velocities[idx * 4 + 2] = 0.0;
          velocities[idx * 4 + 3] = 0.0;
        }
        particlesCreated += particlesInBox;
      }

      device.queue.writeBuffer(particlePositionBuffer, 0, positions);
      device.queue.writeBuffer(particleVelocityBuffer, 0, velocities);
    }

    guiApi.setParticleCountDisplay(particleCount);
  }

  spawnParticles();

  // Update reset callback now that spawnParticles is defined.
  guiApi.setResetHandler(() => {
    spawnParticles();
    console.log('Simulation reset');
  });

  // --- End Particle Setup ---

  const projectionMatrix = new Float32Array(16);
  const FOV = Math.PI / 3;

  function updateProjectionMatrix() {
    const aspect = canvas.width / canvas.height;
    Utilities.makePerspectiveMatrix(projectionMatrix, FOV, aspect, 0.1, 100.0);
  }
  updateProjectionMatrix();

  const mouseInteraction = new MouseInteractionController(canvas, camera);

  console.log('WebGPU Initialized with Particles');

  function frame() {
    guiApi.stats.begin();
    const commandEncoder = device.createCommandEncoder();

    // Interpolate GUI target dimensions -> simulation dimensions.
    // This avoids abrupt pressure shocks when container size changes.
    const lerpSpeed = 0.1;
    smoothConfig.boxWidth +=
      (simConfig.boxWidth - smoothConfig.boxWidth) * lerpSpeed;
    smoothConfig.boxHeight +=
      (simConfig.boxHeight - smoothConfig.boxHeight) * lerpSpeed;
    smoothConfig.boxDepth +=
      (simConfig.boxDepth - smoothConfig.boxDepth) * lerpSpeed;

    // Solver reads these values from uniforms each dispatch.
    simulator.gridWidth = getInternalGridWidth();
    simulator.gridHeight = getInternalGridHeight();
    simulator.gridDepth = getInternalGridDepth();

    const interaction = mouseInteraction.sample(FOV, [
      getSimOffsetX(),
      getSimOffsetY(),
      getSimOffsetZ(),
    ]);
    const viewMatrix = interaction.viewMatrix;
    const inverseViewMatrix = interaction.inverseViewMatrix;

    // Compute Pass (skip if paused)
    if (!guiState.paused) {
      const computePass = commandEncoder.beginComputePass();
      const gravity = 40.0; // Fixed gravity for 1:1 world scale

      // Derive rest-density estimate from current cell size and spacing.
      const cellSize = smoothConfig.boxWidth / 32.0;
      const targetSpacing = simConfig.spacingFactor * simConfig.particleRadius;
      // Clamp to keep pressure solve stable across extreme slider values.
      const targetDensity = Math.max(
        0.5,
        Math.min(500.0, Math.pow(cellSize / targetSpacing, 3.0))
      );

      simulator.step(
        computePass,
        particleCount,
        simConfig.fluidity,
        gravity,
        targetDensity,
        interaction.mouseVelocity,
        interaction.simMouseRayOrigin,
        interaction.worldSpaceMouseRay
      );
      computePass.end();
    }

    if (particleCount > 0) {
      // Update particle radius and offsets from current config
      const currentSimOffsetX = getSimOffsetX();
      const currentSimOffsetY = getSimOffsetY();
      const currentSimOffsetZ = getSimOffsetZ();
      const simOffset: [number, number, number] = [
        currentSimOffsetX,
        currentSimOffsetY,
        currentSimOffsetZ,
      ];

      gBufferPass.record({
        encoder: commandEncoder,
        projectionMatrix,
        viewMatrix,
        particleRadius: simConfig.particleRadius,
        simOffset,
        particleCount,
        colorView: resources.gBufferView,
        depthView: resources.depthView,
        sphereVertexBuffer,
        sphereNormalBuffer,
        sphereIndexBuffer,
        sphereIndexCount: sphereGeom.indices.length,
      });

      shadowPass.record({
        encoder: commandEncoder,
        lightProjectionViewMatrix,
        particleRadius: simConfig.particleRadius,
        simOffset,
        particleCount,
        depthView: resources.shadowDepthView,
        sphereVertexBuffer: aoSphereVertexBuffer,
        sphereIndexBuffer: aoSphereIndexBuffer,
        sphereIndexCount: aoSphereGeom.indices.length,
      });

      aoPass.record({
        encoder: commandEncoder,
        projectionMatrix,
        viewMatrix,
        width: canvas.width,
        height: canvas.height,
        fov: FOV,
        particleRadius: simConfig.particleRadius,
        simOffset,
        particleCount,
        colorView: resources.occlusionView,
        depthView: resources.depthView,
        sphereVertexBuffer: aoSphereVertexBuffer,
        sphereIndexBuffer: aoSphereIndexBuffer,
        sphereIndexCount: aoSphereGeom.indices.length,
      });

      compositePass.record({
        encoder: commandEncoder,
        inverseViewMatrix,
        lightProjectionViewMatrix,
        width: canvas.width,
        height: canvas.height,
        fov: FOV,
        shadowMapSize: SHADOW_MAP_SIZE,
        cameraPosition: camera.getPosition(),
        sceneConfig,
        targetView: resources.compositingView,
      });

      // ============ 4.1 WIREFRAME PASS ============
      // Optional debug/authoring overlay for container bounds.
      if (simConfig.showWireframe) {
        const wireframePass = commandEncoder.beginRenderPass({
          colorAttachments: [
            {
              view: resources.compositingView,
              loadOp: 'load',
              storeOp: 'store',
            },
          ],
          depthStencilAttachment: {
            view: resources.depthView,
            depthLoadOp: 'load',
            depthStoreOp: 'store',
          },
        });
        boxEditor.draw(
          wireframePass,
          projectionMatrix,
          camera,
          [currentSimOffsetX, currentSimOffsetY, currentSimOffsetZ],
          [smoothConfig.boxWidth, smoothConfig.boxHeight, smoothConfig.boxDepth]
        );
        wireframePass.end();
      }

      fxaaPass.record({
        encoder: commandEncoder,
        width: canvas.width,
        height: canvas.height,
        targetView: context.getCurrentTexture().createView(),
      });
    } else {
      // No particles - just clear
      const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.9, g: 0.9, b: 0.9, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      passEncoder.end();
    }

    device.queue.submit([commandEncoder.finish()]);
    guiApi.stats.end();
    guiApi.stats.update();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    resources.resize(canvas.width, canvas.height);
    updateSizeDependentBindings();
    updateProjectionMatrix();
  });
}

init();
