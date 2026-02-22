import{G as qe}from"./lil-gui.esm-DA0aiWCL.js";import{S as Ke}from"./main-DwTz-q1_.js";const z={clamp:function(i,e,n){return Math.max(e,Math.min(n,i))},getMousePosition:function(i,e){const n=e.getBoundingClientRect();return{x:i.clientX-n.left,y:i.clientY-n.top}},addVectors:function(i,e,n){return i[0]=e[0]+n[0],i[1]=e[1]+n[1],i[2]=e[2]+n[2],i},subtractVectors:function(i,e,n){return i[0]=e[0]-n[0],i[1]=e[1]-n[1],i[2]=e[2]-n[2],i},magnitudeOfVector:function(i){return Math.sqrt(i[0]*i[0]+i[1]*i[1]+i[2]*i[2])},dotVectors:function(i,e){return i[0]*e[0]+i[1]*e[1]+i[2]*e[2]},multiplyVectorByScalar:function(i,e,n){return i[0]=e[0]*n[0],i[1]=e[1]*n[0],i[2]=e[2]*n[0],i},multiplyVectorByNumber:function(i,e,n){return i[0]=e[0]*n,i[1]=e[1]*n,i[2]=e[2]*n,i},normalizeVector:function(i,e){const n=z.magnitudeOfVector(e);if(n===0)return i[0]=0,i[1]=0,i[2]=0,i;const t=1/n;return i[0]=e[0]*t,i[1]=e[1]*t,i[2]=e[2]*t,i},makePerspectiveMatrix:function(i,e,n,t,r){const a=1/Math.tan(e/2),p=1/(t-r);return i[0]=a/n,i[1]=0,i[2]=0,i[3]=0,i[4]=0,i[5]=a,i[6]=0,i[7]=0,i[8]=0,i[9]=0,i[10]=(r+t)*p,i[11]=-1,i[12]=0,i[13]=0,i[14]=2*r*t*p,i[15]=0,i},makeIdentityMatrix:function(i){return i.fill(0),i[0]=1,i[5]=1,i[10]=1,i[15]=1,i},premultiplyMatrix:function(i,e,n){const t=n[0],r=n[4],a=n[8],p=n[12],l=n[1],d=n[5],o=n[9],s=n[13],c=n[2],u=n[6],h=n[10],f=n[14],g=n[3],m=n[7],y=n[11],M=n[15],V=e[0],D=e[1],T=e[2],B=e[3];i[0]=t*V+r*D+a*T+p*B,i[1]=l*V+d*D+o*T+s*B,i[2]=c*V+u*D+h*T+f*B,i[3]=g*V+m*D+y*T+M*B;const S=e[4],C=e[5],I=e[6],E=e[7];i[4]=t*S+r*C+a*I+p*E,i[5]=l*S+d*C+o*I+s*E,i[6]=c*S+u*C+h*I+f*E,i[7]=g*S+m*C+y*I+M*E;const R=e[8],G=e[9],w=e[10],x=e[11];i[8]=t*R+r*G+a*w+p*x,i[9]=l*R+d*G+o*w+s*x,i[10]=c*R+u*G+h*w+f*x,i[11]=g*R+m*G+y*w+M*x;const O=e[12],U=e[13],_=e[14],A=e[15];return i[12]=t*O+r*U+a*_+p*A,i[13]=l*O+d*U+o*_+s*A,i[14]=c*O+u*U+h*_+f*A,i[15]=g*O+m*U+y*_+M*A,i},makeXRotationMatrix:function(i,e){return z.makeIdentityMatrix(i),i[5]=Math.cos(e),i[6]=Math.sin(e),i[9]=-Math.sin(e),i[10]=Math.cos(e),i},makeYRotationMatrix:function(i,e){return z.makeIdentityMatrix(i),i[0]=Math.cos(e),i[2]=-Math.sin(e),i[8]=Math.sin(e),i[10]=Math.cos(e),i},transformDirectionByMatrix:function(i,e,n){const t=e[0],r=e[1],a=e[2];return i[0]=n[0]*t+n[4]*r+n[8]*a,i[1]=n[1]*t+n[5]*r+n[9]*a,i[2]=n[2]*t+n[6]*r+n[10]*a,i},invertMatrix:function(i,e){const n=e[0],t=e[4],r=e[8],a=e[12],p=e[1],l=e[5],d=e[9],o=e[13],s=e[2],c=e[6],u=e[10],h=e[14],f=e[3],g=e[7],m=e[11],y=e[15],M=u*y,V=h*m,D=c*y,T=h*g,B=c*m,S=u*g,C=s*y,I=h*f,E=s*m,R=u*f,G=s*g,w=c*f,x=r*o,O=a*d,U=t*o,_=a*l,A=t*d,W=r*l,F=n*o,L=a*p,b=n*d,Y=r*p,j=n*l,v=t*p,X=M*l+T*d+B*o-(V*l+D*d+S*o),q=V*p+C*d+R*o-(M*p+I*d+E*o),J=D*p+I*l+G*o-(T*p+C*l+w*o),le=S*p+E*l+w*d-(B*p+R*l+G*d),oe=n*X+t*q+r*J+a*le;if(oe===0)return null;const k=1/oe;return i[0]=k*X,i[1]=k*q,i[2]=k*J,i[3]=k*le,i[4]=k*(V*t+D*r+S*a-(M*t+T*r+B*a)),i[5]=k*(M*n+I*r+E*a-(V*n+C*r+R*a)),i[6]=k*(T*n+C*t+w*a-(D*n+I*t+G*a)),i[7]=k*(B*n+R*t+G*r-(S*n+E*t+w*r)),i[8]=k*(x*g+_*m+A*y-(O*g+U*m+W*y)),i[9]=k*(O*f+F*m+Y*y-(x*f+L*m+b*y)),i[10]=k*(U*f+L*g+j*y-(_*f+F*g+v*y)),i[11]=k*(W*f+b*g+v*m-(A*f+Y*g+j*m)),i[12]=k*(U*u+W*h+O*c-(A*h+x*c+_*u)),i[13]=k*(b*h+x*s+L*u-(F*u+Y*h+O*s)),i[14]=k*(F*c+v*h+_*s-(j*h+U*s+L*c)),i[15]=k*(j*u+A*s+Y*c-(b*c+v*u+W*s)),i},makeLookAtMatrix:function(i,e,n,t){const r=e[0]-n[0],a=e[1]-n[1],p=e[2]-n[2],l=Math.sqrt(r*r+a*a+p*p),d=r/l,o=a/l,s=p/l,c=t[2]*o-t[1]*s,u=t[0]*s-t[2]*d,h=t[1]*d-t[0]*o,f=Math.sqrt(c*c+u*u+h*h),g=c/f,m=u/f,y=h/f,M=o*y-s*m,V=s*g-d*y,D=d*m-o*g,T=Math.sqrt(M*M+V*V+D*D),B=M/T,S=V/T,C=D/T;return i[0]=g,i[1]=B,i[2]=d,i[3]=0,i[4]=m,i[5]=S,i[6]=o,i[7]=0,i[8]=y,i[9]=C,i[10]=s,i[11]=0,i[12]=-(g*e[0]+m*e[1]+y*e[2]),i[13]=-(B*e[0]+S*e[1]+C*e[2]),i[14]=-(d*e[0]+o*e[1]+s*e[2]),i[15]=1,i},makeOrthographicMatrix:function(i,e,n,t,r,a,p){return i[0]=2/(n-e),i[1]=0,i[2]=0,i[3]=0,i[4]=0,i[5]=2/(r-t),i[6]=0,i[7]=0,i[8]=0,i[9]=0,i[10]=-2/(p-a),i[11]=0,i[12]=-(n+e)/(n-e),i[13]=-(r+t)/(r-t),i[14]=-(p+a)/(p-a),i[15]=1,i},makeOrthographicMatrixWebGPU:function(i,e,n,t,r,a,p){return i[0]=2/(n-e),i[1]=0,i[2]=0,i[3]=0,i[4]=0,i[5]=2/(r-t),i[6]=0,i[7]=0,i[8]=0,i[9]=0,i[10]=-1/(p-a),i[11]=0,i[12]=-(n+e)/(n-e),i[13]=-(r+t)/(r-t),i[14]=-a/(p-a),i[15]=1,i}},De=.005,Ve=25,ke=60;class Je{element;distance=30;orbitPoint;azimuth=-Math.PI/6;elevation=Math.PI/2-Math.PI/2.5;minElevation=-Math.PI/4;maxElevation=Math.PI/4;lastMouseX=0;lastMouseY=0;mouseDown=!1;viewMatrix=new Float32Array(16);constructor(e,n){this.element=e,this.orbitPoint=n,this.recomputeViewMatrix(),e.addEventListener("wheel",t=>{const r=t.deltaY;this.distance+=(r>0?1:-1)*2,this.distance<Ve&&(this.distance=Ve),this.distance>ke&&(this.distance=ke),this.recomputeViewMatrix()})}recomputeViewMatrix(){const e=new Float32Array(16),n=new Float32Array(16),t=z.makeIdentityMatrix(new Float32Array(16)),r=z.makeIdentityMatrix(new Float32Array(16));z.makeIdentityMatrix(this.viewMatrix),z.makeXRotationMatrix(e,this.elevation),z.makeYRotationMatrix(n,this.azimuth),t[14]=-this.distance,r[12]=-this.orbitPoint[0],r[13]=-this.orbitPoint[1],r[14]=-this.orbitPoint[2],z.premultiplyMatrix(this.viewMatrix,this.viewMatrix,r),z.premultiplyMatrix(this.viewMatrix,this.viewMatrix,n),z.premultiplyMatrix(this.viewMatrix,this.viewMatrix,e),z.premultiplyMatrix(this.viewMatrix,this.viewMatrix,t)}getPosition(){return[this.distance*Math.sin(Math.PI/2-this.elevation)*Math.sin(-this.azimuth)+this.orbitPoint[0],this.distance*Math.cos(Math.PI/2-this.elevation)+this.orbitPoint[1],this.distance*Math.sin(Math.PI/2-this.elevation)*Math.cos(-this.azimuth)+this.orbitPoint[2]]}getViewMatrix(){return this.viewMatrix}setBounds(e,n){this.minElevation=e,this.maxElevation=n,this.elevation>this.maxElevation&&(this.elevation=this.maxElevation),this.elevation<this.minElevation&&(this.elevation=this.minElevation),this.recomputeViewMatrix()}onMouseDown(e){const{x:n,y:t}=z.getMousePosition(e,this.element);this.mouseDown=!0,this.lastMouseX=n,this.lastMouseY=t}onMouseUp(){this.mouseDown=!1}isMouseDown(){return this.mouseDown}onMouseMove(e){const{x:n,y:t}=z.getMousePosition(e,this.element);if(this.mouseDown){const r=(n-this.lastMouseX)*De,a=(t-this.lastMouseY)*De;this.azimuth+=r,this.elevation+=a,this.elevation>this.maxElevation&&(this.elevation=this.maxElevation),this.elevation<this.minElevation&&(this.elevation=this.minElevation),this.recomputeViewMatrix(),this.lastMouseX=n,this.lastMouseY=t}}}class we{min;max;constructor(e,n){this.min=[e[0],e[1],e[2]],this.max=[n[0],n[1],n[2]]}computeVolume(){let e=1;for(let n=0;n<3;++n)e*=this.max[n]-this.min[n];return e}computeSurfaceArea(){const e=this.max[0]-this.min[0],n=this.max[1]-this.min[1],t=this.max[2]-this.min[2];return 2*(e*n+e*t+n*t)}clone(){return new we([this.min[0],this.min[1],this.min[2]],[this.max[0],this.max[1],this.max[2]])}randomPoint(){const e=[];for(let n=0;n<3;++n)e[n]=this.min[n]+Math.random()*(this.max[n]-this.min[n]);return e}}const $e=`// Box editor wireframe shader.
//
// Purpose:
// - Render the container boundary overlay in world space.
// - Keep transforms simple: unit geometry scaled + translated by uniforms.
//
// Coordinate flow:
// model(unit cube) -> world(simOffset + size) -> view -> clip.

struct Uniforms {
  // Standard camera matrices shared with scene rendering.
  projectionMatrix: mat4x4<f32>,
  viewMatrix: mat4x4<f32>,
  // Per-draw transform for a unit cube.
  translation: vec3<f32>,
  scale: vec3<f32>,
  // Output line color.
  color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vs_main(@location(0) position: vec3<f32>) -> VertexOutput {
  var out: VertexOutput;
  // Transform unit-geometry vertex into world space.
  let scaledPos = position * uniforms.scale + uniforms.translation;
  out.position = uniforms.projectionMatrix * uniforms.viewMatrix * vec4<f32>(scaledPos, 1.0);
  return out;
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return uniforms.color;
}
`;class Qe{device;gridDimensions;boxes=[];linePipeline;solidPipeline;gridVertexBuffer;cubeVertexBuffer;cubeIndexBuffer;uniformBuffer;bindGroup;constructor(e,n,t){this.device=e,this.gridDimensions=t,this.boxes.push(new we([0,0,0],[t[0]*.5,t[1]*.8,t[2]*.8]));const r=e.createShaderModule({code:$e}),a=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]}),l={layout:e.createPipelineLayout({bindGroupLayouts:[a]}),vertex:{module:r,entryPoint:"vs_main",buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]}]},fragment:{module:r,entryPoint:"fs_main",targets:[{format:n}]},primitive:{topology:"line-list"},depthStencil:{depthWriteEnabled:!0,depthCompare:"less",format:"depth24plus"}};this.linePipeline=e.createRenderPipeline(l);const d={...l};d.primitive={topology:"triangle-list",cullMode:"back"},this.solidPipeline=e.createRenderPipeline(d);const o=new Float32Array([0,0,0,1,0,0,1,0,0,1,0,1,1,0,1,0,0,1,0,0,1,0,0,0,0,1,0,1,1,0,1,1,0,1,1,1,1,1,1,0,1,1,0,1,1,0,1,0,0,0,0,0,1,0,1,0,0,1,1,0,1,0,1,1,1,1,0,0,1,0,1,1]);this.gridVertexBuffer=this.createBuffer(o,GPUBufferUsage.VERTEX);const s=new Float32Array([0,0,1,1,0,1,1,1,1,0,1,1,0,0,0,0,1,0,1,1,0,1,0,0,0,1,0,0,1,1,1,1,1,1,1,0,0,0,0,1,0,0,1,0,1,0,0,1,1,0,0,1,1,0,1,1,1,1,0,1,0,0,0,0,0,1,0,1,1,0,1,0]);this.cubeVertexBuffer=this.createBuffer(s,GPUBufferUsage.VERTEX);const c=new Uint16Array([0,1,2,0,2,3,4,5,6,4,6,7,8,9,10,8,10,11,12,13,14,12,14,15,16,17,18,16,18,19,20,21,22,20,22,23]);this.cubeIndexBuffer=this.createBuffer(c,GPUBufferUsage.INDEX),this.uniformBuffer=e.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.bindGroup=e.createBindGroup({layout:a,entries:[{binding:0,resource:{buffer:this.uniformBuffer}}]})}createBuffer(e,n){const t=this.device.createBuffer({size:e.byteLength,usage:n|GPUBufferUsage.COPY_DST,mappedAtCreation:!0});return e instanceof Float32Array?new Float32Array(t.getMappedRange()).set(e):new Uint16Array(t.getMappedRange()).set(e),t.unmap(),t}draw(e,n,t,r=[0,0,0],a=[1,1,1]){this.device.queue.writeBuffer(this.uniformBuffer,0,n),this.device.queue.writeBuffer(this.uniformBuffer,64,t.getViewMatrix()),e.setPipeline(this.linePipeline),e.setBindGroup(0,this.bindGroup),this.updateUniforms(r,a,[1,1,1,1]),e.setVertexBuffer(0,this.gridVertexBuffer),e.draw(24)}updateUniforms(e,n,t){this.device.queue.writeBuffer(this.uniformBuffer,128,new Float32Array(e)),this.device.queue.writeBuffer(this.uniformBuffer,144,new Float32Array(n)),this.device.queue.writeBuffer(this.uniformBuffer,160,new Float32Array(t))}}function Ee(i){let e=[];const n=o=>{const s=Math.sqrt(o[0]*o[0]+o[1]*o[1]+o[2]*o[2]),c=[o[0]/s,o[1]/s,o[2]/s];e.push(c)},t=(o,s)=>{const c=e[o],u=e[s],h=[(c[0]+u[0])/2,(c[1]+u[1])/2,(c[2]+u[2])/2];return n(h),e.length-1},r=(1+Math.sqrt(5))/2;n([-1,r,0]),n([1,r,0]),n([-1,-r,0]),n([1,-r,0]),n([0,-1,r]),n([0,1,r]),n([0,-1,-r]),n([0,1,-r]),n([r,0,-1]),n([r,0,1]),n([-r,0,-1]),n([-r,0,1]);let a=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];for(let o=0;o<i;o++){const s=[];for(const c of a){const u=t(c[0],c[1]),h=t(c[1],c[2]),f=t(c[2],c[0]);s.push([c[0],u,f]),s.push([c[1],h,u]),s.push([c[2],f,h]),s.push([u,h,f])}a=s}const p=new Float32Array(e.length*3),l=new Float32Array(e.length*3);for(let o=0;o<e.length;o++)p[o*3+0]=e[o][0],p[o*3+1]=e[o][1],p[o*3+2]=e[o][2],l[o*3+0]=e[o][0],l[o*3+1]=e[o][1],l[o*3+2]=e[o][2];const d=new Uint16Array(a.length*3);for(let o=0;o<a.length;o++)d[o*3+0]=a[o][0],d[o*3+1]=a[o][1],d[o*3+2]=a[o][2];return{vertices:p,normals:l,indices:d}}const en=`// =============================================================================
// FLIP (Fluid-Implicit-Particle) Simulation - WebGPU Compute Kernels
// =============================================================================
//
// This file implements a 3D incompressible fluid solver using the FLIP method,
// a hybrid Lagrangian-Eulerian approach introduced by Brackbill & Ruppel (1986)
// and refined for graphics by Zhu & Bridson (2005).
//
// =============================================================================
// ALGORITHM OVERVIEW
// =============================================================================
//
// FLIP combines two complementary representations:
//
//   1. PARTICLES (Lagrangian): Carry fluid mass and momentum through space.
//      - Advantages: No numerical diffusion, preserves vorticity, handles
//        free surfaces and splashes naturally.
//      - Stored in: \`positions[]\`, \`velocities[]\`
//
//   2. GRID (Eulerian): A fixed 3D MAC (Marker-And-Cell) grid used to enforce
//      the incompressibility constraint (divergence-free velocity field).
//      - Advantages: Easy to solve pressure Poisson equation, simple boundary
//        conditions, efficient neighbor queries.
//      - Stored in: \`gridVel[]\`, \`pressure[]\`, \`marker[]\`
//
// =============================================================================
// PER-FRAME SIMULATION LOOP (12 steps)
// =============================================================================
//
//   1. clearGrid        - Zero all grid arrays
//   2. transferToGrid   - Particle-to-Grid (P2G): splat particle velocity/mass
//   3. markCells        - Flag cells containing fluid particles
//   4. normalizeGrid    - Convert weighted sums to average velocities
//   5. addGravity       - Apply external forces (gravity, mouse interaction)
//   6. enforceBoundary  - Set wall velocities to zero (free-slip BC)
//   7. computeDivergence- Calculate velocity divergence per cell
//   8. jacobi (x50)     - Iteratively solve pressure Poisson equation
//   9. applyPressure    - Subtract pressure gradient to make field divergence-free
//  10. enforceBoundary  - Re-apply boundary conditions after projection
//  11. gridToParticle   - Grid-to-Particle (G2P): blend PIC and FLIP updates
//  12. advect           - Move particles through the velocity field (RK2)
//
// =============================================================================
// MAC GRID STAGGERING
// =============================================================================
//
// The MAC grid stores velocity components at face centers, not cell centers:
//
//        +-------+-------+
//       /|      /|      /|
//      / |  Vz / |  Vz / |     Vz: stored on xy-faces (z = integer)
//     +-------+-------+  |
//     |  |    |  |    |  |
//  Vx |  +----|-Vy----|-Vy     Vy: stored on xz-faces (y = integer)
//     | /     | /     | /
//     |/   Vz |/   Vz |/       Vx: stored on yz-faces (x = integer)
//     +-------+-------+
//        Vx      Vx
//
// This staggering:
//   - Prevents checkerboard pressure instabilities
//   - Makes divergence computation natural (finite differences align with faces)
//   - Requires offset interpolation for each velocity component
//
// =============================================================================
// PIC vs FLIP BLENDING
// =============================================================================
//
// The method blends two velocity update strategies:
//
//   PIC (Particle-In-Cell): vNew = gridVel
//     - Very stable but over-dissipates energy
//     - Results in "viscous" looking fluid
//
//   FLIP (Fluid-Implicit-Particle): vNew = vOld + (gridVelNew - gridVelOld)
//     - Preserves kinetic energy and vorticity
//     - Can become unstable/noisy with too many particles per cell
//
//   Final: vNew = mix(vPIC, vFLIP, fluidity)
//     - fluidity = 0.0: pure PIC (stable, viscous)
//     - fluidity = 0.99: nearly pure FLIP (energetic, may have noise)
//
// =============================================================================
// IMPLEMENTATION NOTES
// =============================================================================
//
// - Atomic integers are used for P2G accumulation to handle race conditions
//   when multiple particles contribute to the same grid node. Values are
//   scaled by SCALE=10000 for fixed-point precision.
//
// - \`gridVelOrig\` snapshots the velocity field after normalization but before
//   pressure projection. This is needed for the FLIP delta: (vNew - vOld).
//
// - The pressure solve uses Jacobi iteration (50 iterations per frame).
//   This is simple to parallelize but converges slowly. Production code
//   might use multigrid or conjugate gradient solvers.
//
// - A density-correction term in the divergence helps prevent particle
//   clustering in high-density regions.

// =============================================================================
// Uniform Block - Simulation Parameters (112 bytes, updated each frame)
// =============================================================================
struct Uniforms {
  // Grid resolution: number of cells along each axis.
  // Velocity grid is (nx+1) x (ny+1) x (nz+1) due to MAC staggering.
  nx: u32, ny: u32, nz: u32,

  // Total number of active particles this frame.
  particleCount: u32,

  // World-space dimensions of the simulation container.
  width: f32, height: f32, depth: f32,

  // Timestep (typically 1/60 second for real-time).
  dt: f32,

  // Frame counter, used to offset random sampling for turbulence.
  frameNumber: f32,

  // PIC/FLIP blend factor: 0.0 = pure PIC, 1.0 = pure FLIP.
  // Typical values: 0.95-0.99 for lively fluid with some stability.
  fluidity: f32,

  // Gravity magnitude (applied downward along -Y).
  gravity: f32,

  // Target particle density per cell. Used for density-correction pressure.
  particleDensity: f32,

  // Mouse interaction: world-space velocity imparted to nearby fluid.
  mouseVelocity: vec3<f32>, _pad4: f32,

  // Mouse ray for interaction (origin + direction in world space).
  mouseRayOrigin: vec3<f32>, _pad5: f32,
  mouseRayDirection: vec3<f32>, _pad6: f32,

  // Grid-dependent scaling factors for non-cubic cells.
  // invDx = nx / width, invDy = ny / height, invDz = nz / depth.
  invDx: f32, invDy: f32, invDz: f32,
  // precomputeJacobi = 1.0 / (2.0 * (invDx^2 + invDy^2 + invDz^2))
  precomputeJacobi: f32,
};

// =============================================================================
// Buffer Bindings
// =============================================================================

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// Particle state buffers (Lagrangian representation)
// positions.xyz = world position, w = unused
// velocities.xyz = velocity vector, w = unused
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;

// =============================================================================
// Atomic Accumulation Buffers (for race-free P2G transfer)
// =============================================================================
// During P2G, many particles may contribute to the same grid node simultaneously.
// We use atomic integers to accumulate weighted sums without data races.
// Values are scaled by SCALE to preserve precision in fixed-point representation.
struct AtomicCell { x: atomic<i32>, y: atomic<i32>, z: atomic<i32>, w: atomic<i32> };
@group(0) @binding(3) var<storage, read_write> gridVelAtomic: array<AtomicCell>;  // Weighted velocity sum
@group(0) @binding(4) var<storage, read_write> gridWeightAtomic: array<AtomicCell>; // Weight sum

// =============================================================================
// Grid State Buffers (Eulerian representation)
// =============================================================================
// gridVel: Current velocity field (after normalization and forces).
//   .xyz = staggered velocity components (Vx on yz-face, Vy on xz-face, Vz on xy-face)
//   .w = accumulated scalar weight (used for density estimation)
@group(0) @binding(5) var<storage, read_write> gridVel: array<vec4<f32>>;

// gridVelOrig: Snapshot of grid velocity BEFORE pressure projection.
// Required for FLIP update: delta = gridVelNew - gridVelOrig
@group(0) @binding(6) var<storage, read_write> gridVelOrig: array<vec4<f32>>;

// marker: Cell occupancy flags. 0 = air (empty), 1 = fluid (contains particles).
// Pressure is only solved in fluid cells.
@group(0) @binding(7) var<storage, read_write> marker: array<u32>;

// Pressure and divergence for incompressibility projection.
// divergence = ∇·v (velocity divergence, should become zero)
// pressure = scalar field whose gradient makes velocity divergence-free
@group(0) @binding(8) var<storage, read_write> pressure: array<f32>;
@group(0) @binding(9) var<storage, read_write> divergence: array<f32>;

// Pre-computed random unit vectors for turbulent noise during advection.
@group(0) @binding(10) var<storage, read> randomDirs: array<vec4<f32>>;

// =============================================================================
// Constants
// =============================================================================

// Fixed-point scale factor for atomic accumulation.
// Atomic operations only work on integers, so we multiply floats by SCALE,
// accumulate as integers, then divide by SCALE after normalization.
const SCALE: f32 = 10000.0;

// Magnitude of random turbulent perturbation added during advection.
// Keeps motion lively and prevents particle stacking.
const TURBULENCE: f32 = 0.05;

// Radius of mouse interaction force field (in grid units).
const MOUSE_RADIUS: f32 = 5.0;

// =============================================================================
// Configurable Workgroup Size (via override constants)
// =============================================================================
// These can be set at pipeline creation time for performance tuning.
// Typical values: 32, 64, 128, 256 depending on GPU architecture.
override PARTICLE_WORKGROUP_SIZE: u32 = 64;

// =============================================================================
// INDEX HELPER FUNCTIONS
// =============================================================================
// The simulation uses two grid indexing schemes:
//
// 1. Velocity grid: (nx+1) x (ny+1) x (nz+1) nodes
//    - One extra node per axis for MAC staggering
//    - Used for velocity components at face centers
//
// 2. Scalar grid: nx x ny x nz cells
//    - Used for pressure, divergence, and cell markers
//    - Values live at cell centers
// =============================================================================

/// Convert 3D velocity grid coordinates to linear buffer index.
/// The velocity grid has dimensions (nx+1) x (ny+1) x (nz+1).
/// Coordinates are clamped to valid range to handle boundary lookups safely.
fn velIdx(x: u32, y: u32, z: u32) -> u32 {
  let cx = clamp(x, 0u, uniforms.nx);
  let cy = clamp(y, 0u, uniforms.ny);
  let cz = clamp(z, 0u, uniforms.nz);
  // Row-major layout: x varies fastest, then y, then z
  return cx + cy * (uniforms.nx + 1u) + cz * (uniforms.nx + 1u) * (uniforms.ny + 1u);
}

/// Convert 3D scalar grid coordinates to linear buffer index.
/// The scalar grid has dimensions nx x ny x nz (cell-centered quantities).
/// Used for pressure, divergence, and marker arrays.
fn scalarIdx(x: u32, y: u32, z: u32) -> u32 {
  let cx = clamp(x, 0u, uniforms.nx - 1u);
  let cy = clamp(y, 0u, uniforms.ny - 1u);
  let cz = clamp(z, 0u, uniforms.nz - 1u);
  return cx + cy * uniforms.nx + cz * uniforms.nx * uniforms.ny;
}

/// Transform world-space position to grid-space coordinates.
/// Grid space: [0, nx] x [0, ny] x [0, nz]
/// This is the fractional cell position used for interpolation.
fn worldToGrid(p: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    p.x / uniforms.width * f32(uniforms.nx),
    p.y / uniforms.height * f32(uniforms.ny),
    p.z / uniforms.depth * f32(uniforms.nz)
  );
}

// =============================================================================
// INTERPOLATION KERNEL FUNCTIONS
// =============================================================================
// The interpolation kernel determines how particles spread their influence
// to nearby grid nodes (P2G) and how grid velocities are sampled at arbitrary
// positions (G2P and advection).
//
// We use a separable trilinear (tent) kernel, which is the standard choice
// for FLIP/PIC methods. Each component uses a 1D hat function:
//
//         1.0  ___
//             /   \\
//            /     \\
//     ______/       \\______
//         -1   0   +1
//
// The 3D kernel is the product: K(dx, dy, dz) = h(dx) * h(dy) * h(dz)
// This gives bilinear interpolation within each grid cell.
// =============================================================================

/// 1D tent (hat) kernel function.
/// Returns linear falloff from 1 at r=0 to 0 at |r|=1.
/// Zero outside [-1, 1].
fn h(r: f32) -> f32 {
  if (r >= 0.0 && r <= 1.0) { return 1.0 - r; }
  else if (r >= -1.0 && r < 0.0) { return 1.0 + r; }
  return 0.0;
}

/// 3D separable tent kernel for trilinear interpolation.
/// v = offset vector from grid node to particle (in grid units).
/// Returns weight in range [0, 1], used for both P2G and G2P.
fn kernel(v: vec3<f32>) -> f32 {
  return h(v.x) * h(v.y) * h(v.z);
}

/// Smooth falloff kernel for mouse interaction force.
/// Returns 1.0 near the mouse ray, falling to 0.0 at MOUSE_RADIUS distance.
/// Uses smoothstep for C1 continuity (no sudden force discontinuities).
fn mouseKernel(gridPosition: vec3<f32>) -> f32 {
  // Convert grid position back to world space
  let worldPosition = gridPosition / vec3<f32>(f32(uniforms.nx), f32(uniforms.ny), f32(uniforms.nz)) *
                     vec3<f32>(uniforms.width, uniforms.height, uniforms.depth);

  // Compute perpendicular distance from point to mouse ray
  // Using: d = |cross(rayDir, toPoint)| / |rayDir| (rayDir is unit length)
  let toOrigin = worldPosition - uniforms.mouseRayOrigin;
  let distanceToMouseRay = length(cross(uniforms.mouseRayDirection, toOrigin));
  let normalizedDistance = max(0.0, distanceToMouseRay / MOUSE_RADIUS);

  // Smoothstep gives C1 falloff from 1 (at center) to 0 (at radius)
  return smoothstep(1.0, 0.9, normalizedDistance);
}

// =============================================================================
// STEP 1: CLEAR GRID
// =============================================================================
// Reset all grid buffers to zero at the start of each frame.
// This prepares for fresh P2G accumulation.
//
// Workgroup size: (8, 4, 4) = 128 threads
// Dispatch: ceil((nx+1)/8) x ceil((ny+1)/4) x ceil((nz+1)/4) workgroups
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn clearGrid(@builtin(global_invocation_id) id: vec3<u32>) {
  // Clear velocity grid (includes boundary nodes due to <= comparison)
  if (id.x <= uniforms.nx && id.y <= uniforms.ny && id.z <= uniforms.nz) {
    let vi = velIdx(id.x, id.y, id.z);

    // Reset atomic accumulators (used in P2G for race-free summation)
    atomicStore(&gridVelAtomic[vi].x, 0);
    atomicStore(&gridVelAtomic[vi].y, 0);
    atomicStore(&gridVelAtomic[vi].z, 0);
    atomicStore(&gridVelAtomic[vi].w, 0);
    atomicStore(&gridWeightAtomic[vi].x, 0);
    atomicStore(&gridWeightAtomic[vi].y, 0);
    atomicStore(&gridWeightAtomic[vi].z, 0);
    atomicStore(&gridWeightAtomic[vi].w, 0);

    // Reset float velocity buffers
    gridVel[vi] = vec4<f32>(0.0);
    gridVelOrig[vi] = vec4<f32>(0.0);
  }

  // Clear scalar grid (cell-centered quantities)
  if (id.x < uniforms.nx && id.y < uniforms.ny && id.z < uniforms.nz) {
    let si = scalarIdx(id.x, id.y, id.z);
    marker[si] = 0u;       // 0 = air, will be set to 1 by markCells if particles present
    pressure[si] = 0.0;    // Initial pressure guess (warm starting could improve convergence)
    divergence[si] = 0.0;  // Will be computed in computeDivergence
  }
}

// =============================================================================
// STEP 2: PARTICLE TO GRID (P2G) - Transfer momentum from particles to grid
// =============================================================================
// This is the heart of the Lagrangian-to-Eulerian transfer in FLIP/PIC.
//
// Each particle "splats" its velocity to the 8 surrounding grid nodes using
// trilinear interpolation weights. The weighted sum is accumulated atomically
// since many particles may contribute to the same node.
//
// KEY CONCEPT - MAC Staggering:
// Unlike a collocated grid where all velocity components live at the same
// position, MAC grids store each component at face centers:
//
//   Vx: stored at yz-face center (x = integer, y+0.5, z+0.5)
//   Vy: stored at xz-face center (x+0.5, y = integer, z+0.5)
//   Vz: stored at xy-face center (x+0.5, y+0.5, z = integer)
//
// This means each velocity component uses DIFFERENT interpolation offsets!
// The kernel weight for Vx is computed from distance to (i, j+0.5, k+0.5),
// not from distance to (i, j, k).
//
// Workgroup size: 64 threads (1D dispatch)
// Dispatch: ceil(particleCount / 64) workgroups
// =============================================================================

@compute @workgroup_size(PARTICLE_WORKGROUP_SIZE)
fn transferToGrid(@builtin(global_invocation_id) id: vec3<u32>) {
  let pIdx = id.x;
  if (pIdx >= uniforms.particleCount) { return; }

  // Load particle state
  let pos = positions[pIdx].xyz;  // World-space position
  let vel = velocities[pIdx].xyz; // Velocity to transfer
  let g = worldToGrid(pos);       // Grid-space position (fractional)

  // Find base cell (lower-left-back corner of 2x2x2 neighborhood)
  let baseX = i32(floor(g.x));
  let baseY = i32(floor(g.y));
  let baseZ = i32(floor(g.z));

  // Loop over 2x2x2 neighborhood of grid nodes
  for (var di = 0; di <= 1; di++) {
    for (var dj = 0; dj <= 1; dj++) {
      for (var dk = 0; dk <= 1; dk++) {
        let cellX = u32(max(0, baseX + di));
        let cellY = u32(max(0, baseY + dj));
        let cellZ = u32(max(0, baseZ + dk));

        // Skip out-of-bounds nodes
        if (cellX > uniforms.nx || cellY > uniforms.ny || cellZ > uniforms.nz) {
          continue;
        }

        let cellIdx = velIdx(cellX, cellY, cellZ);

        // =================================================================
        // MAC Staggered Sample Positions:
        // Each velocity component lives at a different position within
        // the grid cell. We compute separate weights for each.
        // =================================================================
        // Vx: yz-face center (x=integer, y/z offset by 0.5)
        let xPos = vec3<f32>(f32(cellX), f32(cellY) + 0.5, f32(cellZ) + 0.5);
        // Vy: xz-face center (y=integer, x/z offset by 0.5)
        let yPos = vec3<f32>(f32(cellX) + 0.5, f32(cellY), f32(cellZ) + 0.5);
        // Vz: xy-face center (z=integer, x/y offset by 0.5)
        let zPos = vec3<f32>(f32(cellX) + 0.5, f32(cellY) + 0.5, f32(cellZ));
        // Scalar weight for density estimation (cell center)
        let scalarPos = vec3<f32>(f32(cellX) + 0.5, f32(cellY) + 0.5, f32(cellZ) + 0.5);

        // Compute interpolation weights (tent kernel, range [0,1])
        let xWeight = kernel(g - xPos);
        let yWeight = kernel(g - yPos);
        let zWeight = kernel(g - zPos);
        let scalarWeight = kernel(g - scalarPos);

        // =================================================================
        // Atomic Accumulation:
        // Multiple threads may write to the same grid node. We use atomic
        // adds on scaled integers to avoid race conditions.
        // After all particles are processed, normalizeGrid will divide
        // by the total weight to get average velocity.
        // =================================================================
        atomicAdd(&gridWeightAtomic[cellIdx].x, i32(xWeight * SCALE));
        atomicAdd(&gridWeightAtomic[cellIdx].y, i32(yWeight * SCALE));
        atomicAdd(&gridWeightAtomic[cellIdx].z, i32(zWeight * SCALE));
        atomicAdd(&gridWeightAtomic[cellIdx].w, i32(scalarWeight * SCALE));

        // Accumulate weighted velocity (momentum-like quantity)
        atomicAdd(&gridVelAtomic[cellIdx].x, i32(vel.x * xWeight * SCALE));
        atomicAdd(&gridVelAtomic[cellIdx].y, i32(vel.y * yWeight * SCALE));
        atomicAdd(&gridVelAtomic[cellIdx].z, i32(vel.z * zWeight * SCALE));
      }
    }
  }
}

// =============================================================================
// STEP 3: MARK CELLS - Flag cells containing fluid particles
// =============================================================================
// Cells are marked as either:
//   0 = AIR: no particles, pressure = 0 (Dirichlet boundary)
//   1 = FLUID: contains particles, solve pressure equation here
//
// This classification is essential for the pressure solve: we only need to
// compute pressure in fluid cells, and air cells provide boundary conditions.
//
// Note: This simple scheme doesn't distinguish SOLID cells. Wall boundaries
// are handled separately in enforceBoundary by zeroing wall-normal velocities.
// =============================================================================

@compute @workgroup_size(PARTICLE_WORKGROUP_SIZE)
fn markCells(@builtin(global_invocation_id) id: vec3<u32>) {
  let pIdx = id.x;
  if (pIdx >= uniforms.particleCount) { return; }

  // Find which cell this particle occupies
  let pos = positions[pIdx].xyz;
  let g = worldToGrid(pos);

  let cellX = u32(clamp(i32(floor(g.x)), 0, i32(uniforms.nx) - 1));
  let cellY = u32(clamp(i32(floor(g.y)), 0, i32(uniforms.ny) - 1));
  let cellZ = u32(clamp(i32(floor(g.z)), 0, i32(uniforms.nz) - 1));

  // Mark cell as containing fluid
  // Multiple particles may mark the same cell; that's fine (idempotent)
  let si = scalarIdx(cellX, cellY, cellZ);
  marker[si] = 1u;
}

// =============================================================================
// STEP 4: NORMALIZE GRID - Convert weighted sums to average velocities
// =============================================================================
// After P2G, each grid node contains:
//   gridVelAtomic = Σ(weight_i * velocity_i)  (weighted velocity sum)
//   gridWeightAtomic = Σ(weight_i)            (total weight)
//
// The actual velocity is: v = Σ(w_i * v_i) / Σ(w_i)
//
// This normalization step also:
//   - Converts from fixed-point (integers) back to floating-point
//   - Saves a copy to gridVelOrig for the FLIP update later
//   - Stores scalar weight in .w for density estimation
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn normalizeGrid(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
  let vi = velIdx(id.x, id.y, id.z);

  // Load and descale atomic accumulators
  let wx = f32(atomicLoad(&gridWeightAtomic[vi].x)) / SCALE;
  let wy = f32(atomicLoad(&gridWeightAtomic[vi].y)) / SCALE;
  let wz = f32(atomicLoad(&gridWeightAtomic[vi].z)) / SCALE;
  let ws = f32(atomicLoad(&gridWeightAtomic[vi].w)) / SCALE;

  // Compute normalized (average) velocities per component
  // Zero weight means no particles contributed; velocity stays zero
  var vx = 0.0;
  var vy = 0.0;
  var vz = 0.0;

  if (wx > 0.0) {
    vx = f32(atomicLoad(&gridVelAtomic[vi].x)) / SCALE / wx;
  }
  if (wy > 0.0) {
    vy = f32(atomicLoad(&gridVelAtomic[vi].y)) / SCALE / wy;
  }
  if (wz > 0.0) {
    vz = f32(atomicLoad(&gridVelAtomic[vi].z)) / SCALE / wz;
  }

  // Store normalized velocity (.xyz) and scalar weight (.w for density)
  gridVel[vi] = vec4<f32>(vx, vy, vz, ws);

  // CRITICAL: Save copy BEFORE forces and pressure projection.
  // The FLIP update uses: v_new = v_old + (gridVel_after - gridVelOrig)
  // gridVelOrig captures the "before" state for this delta.
  gridVelOrig[vi] = vec4<f32>(vx, vy, vz, ws);
}

// =============================================================================
// STEP 5: ADD EXTERNAL FORCES (Gravity + Mouse Interaction)
// =============================================================================
// External forces are applied to the grid velocity field using forward Euler:
//   v_new = v_old + acceleration * dt
//
// Two forces are applied:
//   1. Gravity: constant downward acceleration (-Y direction)
//   2. Mouse: radial force field around mouse ray, pushing fluid
//
// Note: Forces are applied AFTER normalization but BEFORE pressure projection.
// This ensures incompressibility is enforced on the final velocity field.
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn addGravity(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
  let vi = velIdx(id.x, id.y, id.z);

  // Apply gravity (acceleration integrated over timestep)
  // Only affects Y-component since gravity is along -Y
  gridVel[vi].y -= uniforms.gravity * uniforms.dt;

  // =================================================================
  // Mouse Interaction Force
  // =================================================================
  // Compute staggered positions for each velocity component
  // (same offsets as in P2G)
  let xPosition = vec3<f32>(f32(id.x), f32(id.y) + 0.5, f32(id.z) + 0.5);
  let yPosition = vec3<f32>(f32(id.x) + 0.5, f32(id.y), f32(id.z) + 0.5);
  let zPosition = vec3<f32>(f32(id.x) + 0.5, f32(id.y) + 0.5, f32(id.z));

  // Get smooth falloff weight from each position to mouse ray
  let kernelX = mouseKernel(xPosition);
  let kernelY = mouseKernel(yPosition);
  let kernelZ = mouseKernel(zPosition);

  // Scale force by timestep for framerate independence
  // smoothstep prevents excessive forces at very small dt
  let forceMultiplier = 3.0 * smoothstep(0.0, 1.0 / 200.0, uniforms.dt);

  // Add mouse velocity impulse (weighted by distance to mouse ray)
  gridVel[vi].x += uniforms.mouseVelocity.x * kernelX * forceMultiplier;
  gridVel[vi].y += uniforms.mouseVelocity.y * kernelY * forceMultiplier;
  gridVel[vi].z += uniforms.mouseVelocity.z * kernelZ * forceMultiplier;
}

// =============================================================================
// STEP 6 & 10: ENFORCE BOUNDARY CONDITIONS
// =============================================================================
// Apply wall boundary conditions to the velocity field.
// This kernel runs TWICE per frame:
//   1. After external forces, before pressure solve
//   2. After pressure projection, before G2P
//
// Boundary Type: FREE-SLIP (no friction, no penetration)
//   - Wall-normal velocity component is set to zero
//   - Wall-tangent components are left unchanged
//
// Special case: TOP WALL (y = ny)
//   - Allows downward flow (min with 0) but blocks upward
//   - This permits fluid to "pour out" the top if desired
//
// Note: No solid obstacles are handled here. Adding solids would require
// checking marker values and zeroing velocities into solid cells.
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn enforceBoundary(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
  let vi = velIdx(id.x, id.y, id.z);

  // Left wall (x = 0): no flow in -X direction
  if (id.x == 0u) { gridVel[vi].x = 0.0; }
  // Right wall (x = nx): no flow in +X direction
  if (id.x == uniforms.nx) { gridVel[vi].x = 0.0; }

  // Bottom wall (y = 0): no flow in -Y direction
  if (id.y == 0u) { gridVel[vi].y = 0.0; }
  // Top wall (y = ny): allow outflow (downward) but block inflow (upward)
  if (id.y == uniforms.ny) { gridVel[vi].y = min(gridVel[vi].y, 0.0); }

  // Back wall (z = 0): no flow in -Z direction
  if (id.z == 0u) { gridVel[vi].z = 0.0; }
  // Front wall (z = nz): no flow in +Z direction
  if (id.z == uniforms.nz) { gridVel[vi].z = 0.0; }
}

// =============================================================================
// STEP 7: COMPUTE DIVERGENCE - Measure how much fluid is "created" per cell
// =============================================================================
// Divergence measures the net outflow of velocity from a cell:
//   ∇·v = ∂vx/∂x + ∂vy/∂y + ∂vz/∂z
//
// For incompressible fluids, divergence must be zero everywhere:
//   ∇·v = 0  (continuity equation)
//
// A positive divergence means the cell is "expanding" (more outflow than inflow).
// A negative divergence means the cell is "compressing" (more inflow than outflow).
//
// The pressure solve will find a pressure field whose gradient, when subtracted
// from velocity, eliminates this divergence.
//
// DENSITY CORRECTION:
// An additional term is subtracted based on local particle density.
// If density > target, this adds "artificial divergence" that pushes
// particles apart, preventing excessive clustering.
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn computeDivergence(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }
  let si = scalarIdx(id.x, id.y, id.z);

  // Air cells have zero divergence (Dirichlet BC: pressure = 0)
  if (marker[si] == 0u) {
    divergence[si] = 0.0;
    return;
  }

  // =================================================================
  // Discrete Divergence Computation
  // =================================================================
  // Due to MAC staggering, velocity components align naturally with
  // cell faces. The divergence is simply the sum of differences:
  //
  //   ∇·v = (Vx_right - Vx_left) + (Vy_top - Vy_bottom) + (Vz_front - Vz_back)
  //
  // This is exact (no interpolation needed) because faces share nodes.
  //
  //      +---Vy_top---+
  //      |           |
  //   Vx_left   •   Vx_right   (• = cell center)
  //      |           |
  //      +--Vy_bottom-+
  // =================================================================

  let leftX = gridVel[velIdx(id.x, id.y, id.z)].x;       // Left face Vx
  let rightX = gridVel[velIdx(id.x + 1u, id.y, id.z)].x;  // Right face Vx
  let bottomY = gridVel[velIdx(id.x, id.y, id.z)].y;      // Bottom face Vy
  let topY = gridVel[velIdx(id.x, id.y + 1u, id.z)].y;    // Top face Vy
  let backZ = gridVel[velIdx(id.x, id.y, id.z)].z;        // Back face Vz
  let frontZ = gridVel[velIdx(id.x, id.y, id.z + 1u)].z;  // Front face Vz

  // Compute discrete divergence (units: 1/time, or velocity/distance)
  var div = uniforms.invDx * (rightX - leftX) +
            uniforms.invDy * (topY - bottomY) +
            uniforms.invDz * (frontZ - backZ);

  // =================================================================
  // Density Correction Term
  // =================================================================
  // If particle density exceeds target, add artificial divergence.
  // This creates outward pressure that separates clustered particles.
  // The max() ensures we only push apart, never pull together.
  let density = gridVel[velIdx(id.x, id.y, id.z)].w;
  div -= max((density - uniforms.particleDensity) * 1.0, 0.0);

  divergence[si] = div;
}

// =============================================================================
// STEP 8: JACOBI PRESSURE SOLVE - Make velocity divergence-free
// =============================================================================
// We need to find pressure P such that:
//   ∇²P = ∇·v   (Poisson equation)
//
// Then subtract the pressure gradient from velocity:
//   v_new = v - ∇P
//
// This makes ∇·v_new = 0 (divergence-free, incompressible).
//
// JACOBI ITERATION:
// The discrete Laplacian ∇²P at cell (i,j,k) is:
//   ∇²P ≈ (P_left + P_right + P_bottom + P_top + P_back + P_front - 6*P_center)
//
// Rearranging the Poisson equation:
//   P_center = (P_neighbors - divergence) / 6
//
// Each Jacobi iteration updates all cells simultaneously using values from
// the previous iteration. This is highly parallel but converges slowly.
// We run 50 iterations per frame (could use multigrid for faster convergence).
//
// BOUNDARY CONDITIONS:
// - Air cells (marker=0): pressure = 0 (Dirichlet BC, free surface)
// - Boundary neighbors: implicitly treated as having pressure = 0
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn jacobi(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }
  let si = scalarIdx(id.x, id.y, id.z);

  // Skip air cells - they maintain zero pressure
  if (marker[si] == 0u) { return; }

  let div = divergence[si];

  // Sample 6-connected neighbor pressures
  // Boundary cells use 0 pressure (implicit Dirichlet BC)
  var pL = 0.0;  // Left   (-X)
  var pR = 0.0;  // Right  (+X)
  var pB = 0.0;  // Bottom (-Y)
  var pT = 0.0;  // Top    (+Y)
  var pBk = 0.0; // Back   (-Z)
  var pFr = 0.0; // Front  (+Z)

  if (id.x > 0u) { pL = pressure[scalarIdx(id.x - 1u, id.y, id.z)]; }
  if (id.x < uniforms.nx - 1u) { pR = pressure[scalarIdx(id.x + 1u, id.y, id.z)]; }
  if (id.y > 0u) { pB = pressure[scalarIdx(id.x, id.y - 1u, id.z)]; }
  if (id.y < uniforms.ny - 1u) { pT = pressure[scalarIdx(id.x, id.y + 1u, id.z)]; }
  if (id.z > 0u) { pBk = pressure[scalarIdx(id.x, id.y, id.z - 1u)]; }
  if (id.z < uniforms.nz - 1u) { pFr = pressure[scalarIdx(id.x, id.y, id.z + 1u)]; }

  // Jacobi update: P_new = (sum_of_scaled_neighbors - divergence) * precomputeJacobi
  // This is one step toward solving: ∇²P = divergence
  let invDx2 = uniforms.invDx * uniforms.invDx;
  let invDy2 = uniforms.invDy * uniforms.invDy;
  let invDz2 = uniforms.invDz * uniforms.invDz;

  pressure[si] = (invDx2 * (pL + pR) + invDy2 * (pB + pT) + invDz2 * (pBk + pFr) - div) * uniforms.precomputeJacobi;
}

// =============================================================================
// STEP 8 (ALTERNATIVE): RED-BLACK GAUSS-SEIDEL PRESSURE SOLVE
// =============================================================================
// Red-Black Gauss-Seidel is a more efficient iterative solver than Jacobi.
// It divides cells into two groups based on parity:
//   - RED cells: (x + y + z) % 2 == 0
//   - BLACK cells: (x + y + z) % 2 == 1
//
// Key insight: In a 3D grid, all neighbors of a red cell are black, and
// all neighbors of a black cell are red. This means:
//   1. Update all red cells first (neighbors are black, unchanged)
//   2. Update all black cells (neighbors are red, already updated!)
//
// This gives ~2x faster convergence than Jacobi because updates propagate
// within a single iteration instead of requiring multiple iterations.
//
// Convergence comparison (for same accuracy):
//   - Jacobi: ~50 iterations
//   - Red-Black GS: ~25 iterations
// =============================================================================

/// Red phase: Update cells where (x + y + z) is even
@compute @workgroup_size(8, 4, 4)
fn jacobiRed(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }

  // Only process RED cells (parity == 0)
  let parity = (id.x + id.y + id.z) % 2u;
  if (parity != 0u) { return; }

  let si = scalarIdx(id.x, id.y, id.z);
  if (marker[si] == 0u) { return; }

  let div = divergence[si];

  var pL = 0.0; var pR = 0.0; var pB = 0.0; var pT = 0.0; var pBk = 0.0; var pFr = 0.0;

  if (id.x > 0u) { pL = pressure[scalarIdx(id.x - 1u, id.y, id.z)]; }
  if (id.x < uniforms.nx - 1u) { pR = pressure[scalarIdx(id.x + 1u, id.y, id.z)]; }
  if (id.y > 0u) { pB = pressure[scalarIdx(id.x, id.y - 1u, id.z)]; }
  if (id.y < uniforms.ny - 1u) { pT = pressure[scalarIdx(id.x, id.y + 1u, id.z)]; }
  if (id.z > 0u) { pBk = pressure[scalarIdx(id.x, id.y, id.z - 1u)]; }
  if (id.z < uniforms.nz - 1u) { pFr = pressure[scalarIdx(id.x, id.y, id.z + 1u)]; }

  let invDx2 = uniforms.invDx * uniforms.invDx;
  let invDy2 = uniforms.invDy * uniforms.invDy;
  let invDz2 = uniforms.invDz * uniforms.invDz;

  pressure[si] = (invDx2 * (pL + pR) + invDy2 * (pB + pT) + invDz2 * (pBk + pFr) - div) * uniforms.precomputeJacobi;
}

/// Black phase: Update cells where (x + y + z) is odd
@compute @workgroup_size(8, 4, 4)
fn jacobiBlack(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }

  // Only process BLACK cells (parity == 1)
  let parity = (id.x + id.y + id.z) % 2u;
  if (parity != 1u) { return; }

  let si = scalarIdx(id.x, id.y, id.z);
  if (marker[si] == 0u) { return; }

  let div = divergence[si];

  var pL = 0.0; var pR = 0.0; var pB = 0.0; var pT = 0.0; var pBk = 0.0; var pFr = 0.0;

  if (id.x > 0u) { pL = pressure[scalarIdx(id.x - 1u, id.y, id.z)]; }
  if (id.x < uniforms.nx - 1u) { pR = pressure[scalarIdx(id.x + 1u, id.y, id.z)]; }
  if (id.y > 0u) { pB = pressure[scalarIdx(id.x, id.y - 1u, id.z)]; }
  if (id.y < uniforms.ny - 1u) { pT = pressure[scalarIdx(id.x, id.y + 1u, id.z)]; }
  if (id.z > 0u) { pBk = pressure[scalarIdx(id.x, id.y, id.z - 1u)]; }
  if (id.z < uniforms.nz - 1u) { pFr = pressure[scalarIdx(id.x, id.y, id.z + 1u)]; }

  let invDx2 = uniforms.invDx * uniforms.invDx;
  let invDy2 = uniforms.invDy * uniforms.invDy;
  let invDz2 = uniforms.invDz * uniforms.invDz;

  pressure[si] = (invDx2 * (pL + pR) + invDy2 * (pB + pT) + invDz2 * (pBk + pFr) - div) * uniforms.precomputeJacobi;
}

// =============================================================================
// STEP 9: APPLY PRESSURE GRADIENT - Project velocity to divergence-free field
// =============================================================================
// This is the "projection" step that enforces incompressibility.
//
// Given the pressure field P from Jacobi iteration, we subtract its gradient:
//   v_new = v_old - ∇P
//
// Since ∇²P = ∇·v_old, and ∇·(∇P) = ∇²P, we get:
//   ∇·v_new = ∇·v_old - ∇²P = ∇·v_old - ∇·v_old = 0  ✓
//
// The velocity field is now divergence-free (incompressible).
//
// MAC GRID NOTE:
// Each velocity component is co-located with the pressure gradient in that
// direction. This makes the gradient computation exact (no interpolation):
//
//   Vx at face between cells (i-1,j,k) and (i,j,k):
//     ∂P/∂x ≈ P[i,j,k] - P[i-1,j,k]
//
// This perfect alignment is a key benefit of MAC staggering.
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn applyPressure(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
  let vi = velIdx(id.x, id.y, id.z);

  var v = gridVel[vi];

  // =================================================================
  // X-Velocity Update (lives on yz-face at x = id.x)
  // =================================================================
  // The face separates cells (id.x-1, y, z) and (id.x, y, z)
  // Gradient: ∂P/∂x = (P_right - P_left) / dx
  let pRight = pressure[scalarIdx(id.x, id.y, id.z)];
  let pLeft = pressure[scalarIdx(id.x - 1u, id.y, id.z)];
  v.x -= uniforms.invDx * (pRight - pLeft);

  // =================================================================
  // Y-Velocity Update (lives on xz-face at y = id.y)
  // =================================================================
  // The face separates cells (x, id.y-1, z) and (x, id.y, z)
  // Gradient: ∂P/∂y = (P_top - P_bottom) / dy
  let pTop = pressure[scalarIdx(id.x, id.y, id.z)];
  let pBottom = pressure[scalarIdx(id.x, id.y - 1u, id.z)];
  v.y -= uniforms.invDy * (pTop - pBottom);

  // =================================================================
  // Z-Velocity Update (lives on xy-face at z = id.z)
  // =================================================================
  // The face separates cells (x, y, id.z-1) and (x, y, id.z)
  // Gradient: ∂P/∂z = (P_front - P_back) / dz
  let pFront = pressure[scalarIdx(id.x, id.y, id.z)];
  let pBack = pressure[scalarIdx(id.x, id.y, id.z - 1u)];
  v.z -= uniforms.invDz * (pFront - pBack);

  gridVel[vi] = v;
}

// =============================================================================
// STAGGERED VELOCITY SAMPLING FUNCTIONS
// =============================================================================
// These functions sample the MAC grid velocity at arbitrary positions using
// trilinear interpolation. Due to MAC staggering, each component requires
// different offsets:
//
//   Vx is stored at (i, j+0.5, k+0.5) → sample at (g.x, g.y-0.5, g.z-0.5)
//   Vy is stored at (i+0.5, j, k+0.5) → sample at (g.x-0.5, g.y, g.z-0.5)
//   Vz is stored at (i+0.5, j+0.5, k) → sample at (g.x-0.5, g.y-0.5, g.z)
//
// The offset accounts for the fact that values are stored at face centers,
// not node corners. After applying the offset, standard trilinear
// interpolation can be used.
// =============================================================================

/// Sample X-velocity component at grid position g using trilinear interpolation.
/// Applies -0.5 offset to y and z due to MAC staggering of Vx on yz-faces.
fn sampleXVelocity(g: vec3<f32>) -> f32 {
  // Transform to Vx sample space (Vx stored at y+0.5, z+0.5 positions)
  let p = vec3<f32>(g.x, g.y - 0.5, g.z - 0.5);
  let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
  let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z)); // Fractional part

  // Trilinear interpolation over 2x2x2 neighborhood
  var v = 0.0;
  for (var di = 0; di <= 1; di++) {
    for (var dj = 0; dj <= 1; dj++) {
      for (var dk = 0; dk <= 1; dk++) {
        // Trilinear weight = product of 1D lerp weights
        let w = select(1.0 - f.x, f.x, di == 1) *
                select(1.0 - f.y, f.y, dj == 1) *
                select(1.0 - f.z, f.z, dk == 1);
        let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
        let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
        let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
        v += gridVel[velIdx(ix, iy, iz)].x * w;
      }
    }
  }
  return v;
}

/// Sample Y-velocity component at grid position g using trilinear interpolation.
/// Applies -0.5 offset to x and z due to MAC staggering of Vy on xz-faces.
fn sampleYVelocity(g: vec3<f32>) -> f32 {
  // Transform to Vy sample space (Vy stored at x+0.5, z+0.5 positions)
  let p = vec3<f32>(g.x - 0.5, g.y, g.z - 0.5);
  let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
  let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

  var v = 0.0;
  for (var di = 0; di <= 1; di++) {
    for (var dj = 0; dj <= 1; dj++) {
      for (var dk = 0; dk <= 1; dk++) {
        let w = select(1.0 - f.x, f.x, di == 1) *
                select(1.0 - f.y, f.y, dj == 1) *
                select(1.0 - f.z, f.z, dk == 1);
        let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
        let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
        let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
        v += gridVel[velIdx(ix, iy, iz)].y * w;
      }
    }
  }
  return v;
}

/// Sample Z-velocity component at grid position g using trilinear interpolation.
/// Applies -0.5 offset to x and y due to MAC staggering of Vz on xy-faces.
fn sampleZVelocity(g: vec3<f32>) -> f32 {
  // Transform to Vz sample space (Vz stored at x+0.5, y+0.5 positions)
  let p = vec3<f32>(g.x - 0.5, g.y - 0.5, g.z);
  let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
  let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

  var v = 0.0;
  for (var di = 0; di <= 1; di++) {
    for (var dj = 0; dj <= 1; dj++) {
      for (var dk = 0; dk <= 1; dk++) {
        let w = select(1.0 - f.x, f.x, di == 1) *
                select(1.0 - f.y, f.y, dj == 1) *
                select(1.0 - f.z, f.z, dk == 1);
        let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
        let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
        let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
        v += gridVel[velIdx(ix, iy, iz)].z * w;
      }
    }
  }
  return v;
}

/// Sample full velocity vector at world position p.
/// Combines the three staggered component samples into a single vec3.
fn sampleVelocity(p: vec3<f32>) -> vec3<f32> {
  let g = worldToGrid(p);
  return vec3<f32>(sampleXVelocity(g), sampleYVelocity(g), sampleZVelocity(g));
}

// =============================================================================
// ORIGINAL VELOCITY SAMPLING (for FLIP delta computation)
// =============================================================================
// These functions sample gridVelOrig (the pre-projection snapshot) instead of
// gridVel (post-projection). Used in G2P to compute the FLIP velocity delta:
//   delta = gridVel_new - gridVelOrig
// =============================================================================

/// Sample X-velocity from the ORIGINAL (pre-projection) grid state.
fn sampleXVelocityOrig(g: vec3<f32>) -> f32 {
  let p = vec3<f32>(g.x, g.y - 0.5, g.z - 0.5);
  let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
  let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

  var v = 0.0;
  for (var di = 0; di <= 1; di++) {
    for (var dj = 0; dj <= 1; dj++) {
      for (var dk = 0; dk <= 1; dk++) {
        let w = select(1.0 - f.x, f.x, di == 1) *
                select(1.0 - f.y, f.y, dj == 1) *
                select(1.0 - f.z, f.z, dk == 1);
        let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
        let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
        let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
        v += gridVelOrig[velIdx(ix, iy, iz)].x * w;  // Note: gridVelOrig, not gridVel
      }
    }
  }
  return v;
}

/// Sample Y-velocity from the ORIGINAL (pre-projection) grid state.
fn sampleYVelocityOrig(g: vec3<f32>) -> f32 {
  let p = vec3<f32>(g.x - 0.5, g.y, g.z - 0.5);
  let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
  let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

  var v = 0.0;
  for (var di = 0; di <= 1; di++) {
    for (var dj = 0; dj <= 1; dj++) {
      for (var dk = 0; dk <= 1; dk++) {
        let w = select(1.0 - f.x, f.x, di == 1) *
                select(1.0 - f.y, f.y, dj == 1) *
                select(1.0 - f.z, f.z, dk == 1);
        let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
        let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
        let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
        v += gridVelOrig[velIdx(ix, iy, iz)].y * w;
      }
    }
  }
  return v;
}

/// Sample Z-velocity from the ORIGINAL (pre-projection) grid state.
fn sampleZVelocityOrig(g: vec3<f32>) -> f32 {
  let p = vec3<f32>(g.x - 0.5, g.y - 0.5, g.z);
  let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
  let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

  var v = 0.0;
  for (var di = 0; di <= 1; di++) {
    for (var dj = 0; dj <= 1; dj++) {
      for (var dk = 0; dk <= 1; dk++) {
        let w = select(1.0 - f.x, f.x, di == 1) *
                select(1.0 - f.y, f.y, dj == 1) *
                select(1.0 - f.z, f.z, dk == 1);
        let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
        let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
        let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
        v += gridVelOrig[velIdx(ix, iy, iz)].z * w;
      }
    }
  }
  return v;
}

/// Sample full velocity vector from the ORIGINAL (pre-projection) grid state.
fn sampleVelocityOrig(p: vec3<f32>) -> vec3<f32> {
  let g = worldToGrid(p);
  return vec3<f32>(sampleXVelocityOrig(g), sampleYVelocityOrig(g), sampleZVelocityOrig(g));
}

// =============================================================================
// STEP 11: GRID TO PARTICLE (G2P) - Transfer velocity back to particles
// =============================================================================
// This step transfers the updated grid velocity back to particles.
// Two strategies are blended:
//
// PIC (Particle-In-Cell):
//   v_particle = sampleVelocity(position)
//   - Simply copy grid velocity to particle
//   - Very stable, but causes excessive numerical diffusion
//   - Results in "viscous" fluid that loses energy quickly
//
// FLIP (Fluid-Implicit-Particle):
//   v_particle = v_old + (gridVel_new - gridVel_old)
//   - Add only the CHANGE in grid velocity to particle
//   - Preserves kinetic energy and vorticity
//   - Can become noisy/unstable with too high fluidity
//
// Final velocity = mix(PIC, FLIP, fluidity)
//   - fluidity = 0.0: pure PIC (stable but diffusive)
//   - fluidity = 0.99: nearly pure FLIP (energetic but may be noisy)
//   - Typical values: 0.95 - 0.99
//
// WHY FLIP WORKS:
// The grid "absorbs" numerical errors during P2G averaging and pressure solve.
// By taking only the delta (what the grid DID to the velocity), particles
// keep their pre-existing momentum and only receive the incompressibility
// correction and external forces applied to the grid.
// =============================================================================

@compute @workgroup_size(PARTICLE_WORKGROUP_SIZE)
fn gridToParticle(@builtin(global_invocation_id) id: vec3<u32>) {
  let pIdx = id.x;
  if (pIdx >= uniforms.particleCount) { return; }

  let pos = positions[pIdx].xyz;
  let velOld = velocities[pIdx].xyz;  // Particle velocity from previous frame

  // Sample CURRENT grid velocity (after projection and forces)
  let vGridNew = sampleVelocity(pos);

  // Sample ORIGINAL grid velocity (before projection, saved in normalizeGrid)
  let vGridOld = sampleVelocityOrig(pos);

  // =================================================================
  // PIC/FLIP Velocity Computation
  // =================================================================

  // FLIP: Add grid delta to particle's existing velocity
  // This preserves particle momentum and only adds the grid's contribution
  let vFlip = velOld + (vGridNew - vGridOld);

  // PIC: Just use the grid velocity directly
  // This is more stable but loses the particle's individual momentum
  let vPic = vGridNew;

  // Blend between PIC (stable) and FLIP (energetic)
  // fluidity = 0: all PIC, fluidity = 1: all FLIP
  let vNew = mix(vPic, vFlip, uniforms.fluidity);

  velocities[pIdx] = vec4<f32>(vNew, 0.0);
}

// =============================================================================
// STEP 12: ADVECT PARTICLES - Move particles through velocity field
// =============================================================================
// Particles are moved according to the divergence-free velocity field using
// Runge-Kutta 2 (midpoint method) integration:
//
//   v1 = velocity(position)
//   midpoint = position + v1 * dt/2
//   v2 = velocity(midpoint)
//   position_new = position + v2 * dt
//
// This second-order method is more accurate than forward Euler and prevents
// particles from "overshooting" in regions of high velocity gradient.
//
// TURBULENT NOISE:
// A small random perturbation is added to each particle's motion:
//   - Scaled by velocity magnitude (faster particles get more noise)
//   - Prevents particles from forming perfectly ordered structures
//   - Adds visual liveliness to the simulation
//   - The random direction is pre-computed and indexed by particle + frame
//
// BOUNDARY CLAMPING:
// Particles are clamped inside the container with a small epsilon margin.
// This prevents particles from getting stuck exactly on walls.
// =============================================================================

@compute @workgroup_size(PARTICLE_WORKGROUP_SIZE)
fn advect(@builtin(global_invocation_id) id: vec3<u32>) {
  let pIdx = id.x;
  if (pIdx >= uniforms.particleCount) { return; }

  var pos = positions[pIdx].xyz;

  // =================================================================
  // RK2 (Midpoint) Integration
  // =================================================================
  // More accurate than forward Euler for curved trajectories.
  // Uses velocity at midpoint for the actual step.

  // Sample velocity at current position
  let v1 = sampleVelocity(pos);

  // Compute midpoint (half timestep forward)
  let midPos = pos + v1 * uniforms.dt * 0.5;

  // Sample velocity at midpoint
  let v2 = sampleVelocity(midPos);

  // Take full step using midpoint velocity
  var step = v2 * uniforms.dt;

  // =================================================================
  // Turbulent Noise
  // =================================================================
  // Add small random perturbation proportional to velocity.
  // Frame offset ensures different particles get different noise each frame.
  let offset = u32(uniforms.frameNumber) % uniforms.particleCount;
  let randomIdx = (pIdx + offset) % uniforms.particleCount;
  let randomDir = randomDirs[randomIdx].xyz;  // Pre-computed unit vector

  // Scale noise by velocity magnitude and timestep
  step += TURBULENCE * randomDir * length(v1) * uniforms.dt;

  // Apply displacement
  pos += step;

  // =================================================================
  // Boundary Clamping
  // =================================================================
  // Keep particles strictly inside container with small margin.
  // This prevents numerical issues at exact boundaries.
  let eps = 0.01;
  pos = clamp(pos,
    vec3<f32>(eps, eps, eps),
    vec3<f32>(uniforms.width - eps, uniforms.height - eps, uniforms.depth - eps)
  );

  positions[pIdx] = vec4<f32>(pos, 1.0);
}
`;class nn{device;nx;ny;nz;gridWidth;gridHeight;gridDepth;gridVelocityBuffer;gridWeightBuffer;gridVelocityFloatBuffer;gridVelocityOrigBuffer;gridMarkerBuffer;pressureBuffer;pressureTempBuffer;uniformBuffer;clearGridPipeline;transferToGridPipeline;normalizeGridPipeline;markCellsPipeline;addGravityPipeline;enforceBoundaryPipeline;divergencePipeline;jacobiPipeline;jacobiRedPipeline;jacobiBlackPipeline;applyPressurePipeline;gridToParticlePipeline;advectPipeline;simBindGroup;simBindGroupAlt;frameNumber=0;particleWorkgroupSize=64;shaderModule;pipelineLayout;constructor(e,n,t,r,a,p,l,d,o,s,c=64){this.device=e,this.nx=n,this.ny=t,this.nz=r,this.gridWidth=a,this.gridHeight=p,this.gridDepth=l,this.particleWorkgroupSize=c;const u=(n+1)*(t+1)*(r+1),h=n*t*r,f=(m,y=GPUBufferUsage.STORAGE)=>e.createBuffer({size:m,usage:y});this.gridVelocityBuffer=f(u*16),this.gridWeightBuffer=f(u*16),this.gridVelocityFloatBuffer=f(u*16),this.gridVelocityOrigBuffer=f(u*16),this.gridMarkerBuffer=f(h*4),this.pressureBuffer=f(h*4),this.pressureTempBuffer=f(h*4),this.uniformBuffer=f(112,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST),this.shaderModule=e.createShaderModule({code:en});const g=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:6,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:7,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:8,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:9,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:10,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}}]});this.pipelineLayout=e.createPipelineLayout({bindGroupLayouts:[g]}),this.createPipelines(),this.simBindGroup=e.createBindGroup({layout:g,entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:d}},{binding:2,resource:{buffer:o}},{binding:3,resource:{buffer:this.gridVelocityBuffer}},{binding:4,resource:{buffer:this.gridWeightBuffer}},{binding:5,resource:{buffer:this.gridVelocityFloatBuffer}},{binding:6,resource:{buffer:this.gridVelocityOrigBuffer}},{binding:7,resource:{buffer:this.gridMarkerBuffer}},{binding:8,resource:{buffer:this.pressureBuffer}},{binding:9,resource:{buffer:this.pressureTempBuffer}},{binding:10,resource:{buffer:s}}]}),this.simBindGroupAlt=this.simBindGroup,this.updateUniforms(0,.99,40,10,[0,0,0],[0,0,0],[0,0,1])}createPipelines(){const e=t=>this.device.createComputePipeline({layout:this.pipelineLayout,compute:{module:this.shaderModule,entryPoint:t}}),n=t=>this.device.createComputePipeline({layout:this.pipelineLayout,compute:{module:this.shaderModule,entryPoint:t,constants:{PARTICLE_WORKGROUP_SIZE:this.particleWorkgroupSize}}});this.clearGridPipeline=e("clearGrid"),this.normalizeGridPipeline=e("normalizeGrid"),this.addGravityPipeline=e("addGravity"),this.enforceBoundaryPipeline=e("enforceBoundary"),this.divergencePipeline=e("computeDivergence"),this.jacobiPipeline=e("jacobi"),this.jacobiRedPipeline=e("jacobiRed"),this.jacobiBlackPipeline=e("jacobiBlack"),this.applyPressurePipeline=e("applyPressure"),this.transferToGridPipeline=n("transferToGrid"),this.markCellsPipeline=n("markCells"),this.gridToParticlePipeline=n("gridToParticle"),this.advectPipeline=n("advect")}updateWorkgroupSize(e){e!==this.particleWorkgroupSize&&(this.particleWorkgroupSize=e,this.createPipelines(),console.log(`Workgroup size updated to ${e}`))}updateUniforms(e,n,t,r,a,p,l){const d=new ArrayBuffer(112),o=new Uint32Array(d),s=new Float32Array(d);o[0]=this.nx,o[1]=this.ny,o[2]=this.nz,o[3]=e,s[4]=this.gridWidth,s[5]=this.gridHeight,s[6]=this.gridDepth,s[7]=1/60,s[8]=this.frameNumber,s[9]=n,s[10]=t,s[11]=r,s[12]=a[0],s[13]=a[1],s[14]=a[2],s[15]=0,s[16]=p[0],s[17]=p[1],s[18]=p[2],s[19]=0,s[20]=l[0],s[21]=l[1],s[22]=l[2],s[23]=0;const c=this.nx/this.gridWidth,u=this.ny/this.gridHeight,h=this.nz/this.gridDepth,f=c*c,g=u*u,m=h*h,y=1/(2*(f+g+m));s[24]=c,s[25]=u,s[26]=h,s[27]=y,this.device.queue.writeBuffer(this.uniformBuffer,0,d),this.frameNumber++}step(e,n,t,r,a,p,l,d,o,s){this.updateUniforms(n,t,r,a,d,o,s);const c=[Math.ceil((this.nx+1)/8),Math.ceil((this.ny+1)/4),Math.ceil((this.nz+1)/4)],u=[Math.ceil(this.nx/8),Math.ceil(this.ny/4),Math.ceil(this.nz/4)],h=Math.ceil(n/this.particleWorkgroupSize);if(e.setBindGroup(0,this.simBindGroup),e.setPipeline(this.clearGridPipeline),e.dispatchWorkgroups(c[0],c[1],c[2]),e.setPipeline(this.transferToGridPipeline),e.dispatchWorkgroups(h),e.setPipeline(this.markCellsPipeline),e.dispatchWorkgroups(h),e.setPipeline(this.normalizeGridPipeline),e.dispatchWorkgroups(c[0],c[1],c[2]),e.setPipeline(this.addGravityPipeline),e.dispatchWorkgroups(c[0],c[1],c[2]),e.setPipeline(this.enforceBoundaryPipeline),e.dispatchWorkgroups(c[0],c[1],c[2]),e.setPipeline(this.divergencePipeline),e.dispatchWorkgroups(u[0],u[1],u[2]),l)for(let f=0;f<p;f++)e.setPipeline(this.jacobiRedPipeline),e.dispatchWorkgroups(u[0],u[1],u[2]),e.setPipeline(this.jacobiBlackPipeline),e.dispatchWorkgroups(u[0],u[1],u[2]);else for(let f=0;f<p;f++)e.setPipeline(this.jacobiPipeline),e.dispatchWorkgroups(u[0],u[1],u[2]);e.setPipeline(this.applyPressurePipeline),e.dispatchWorkgroups(c[0],c[1],c[2]),e.setPipeline(this.enforceBoundaryPipeline),e.dispatchWorkgroups(c[0],c[1],c[2]),e.setPipeline(this.gridToParticlePipeline),e.dispatchWorkgroups(h),e.setPipeline(this.advectPipeline),e.dispatchWorkgroups(h)}}const tn=`// =============================================================================
// G-BUFFER RENDERING PASS
// =============================================================================
//
// This pass renders fluid particles as instanced sphere meshes into a G-buffer
// texture. Each particle becomes a small sphere in 3D space.
//
// ## Deferred Rendering
//
// Rather than computing final lighting here, we output intermediate data:
// - **Normal (xy)**: View-space normal direction (z reconstructed from unit length)
// - **Speed**: Velocity magnitude for color variation
// - **Depth**: View-space Z coordinate for AO and compositing
//
// This data is consumed by later fullscreen passes (AO, composite) which
// perform the actual lighting calculations.
//
// ## Instanced Rendering
//
// All particles share the same sphere mesh (generated via icosphere subdivision).
// We use GPU instancing: one draw call renders all particles, with each instance
// sampling its position/velocity from storage buffers.
//
// ## G-Buffer Layout (rgba16float)
//
// | Channel | Content              | Range     |
// |---------|----------------------|-----------|
// | R       | Normal.x (view)      | [-1, 1]   |
// | G       | Normal.y (view)      | [-1, 1]   |
// | B       | Speed (|velocity|)   | [0, ∞)    |
// | A       | View-space Z (depth) | (-∞, 0]   |
//
// Normal.z is reconstructed: z = sqrt(1 - x² - y²)

struct Uniforms {
  projectionMatrix: mat4x4<f32>,
  viewMatrix: mat4x4<f32>,
  // Sphere radius in world units.
  sphereRadius: f32,
  // Optional scale for simulation-space positions.
  positionScale: f32,
  // Simulation-to-world translation.
  simOffsetX: f32,
  simOffsetY: f32,
  simOffsetZ: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) viewSpaceNormal: vec3<f32>,
  @location(1) viewSpaceZ: f32,
  @location(2) speed: f32,
};

@vertex
fn vs_main(
  @location(0) vertexPos: vec3<f32>,
  @location(1) vertexNormal: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  // Per-instance particle state.
  let spherePos = positions[instanceIndex].xyz * uniforms.positionScale;
  let velocity = velocities[instanceIndex].xyz;
  let simOffset = vec3<f32>(uniforms.simOffsetX, uniforms.simOffsetY, uniforms.simOffsetZ);

  // Expand unit sphere vertex into world and then view space.
  let worldPos = vertexPos * uniforms.sphereRadius + spherePos + simOffset;
  let viewPos = uniforms.viewMatrix * vec4<f32>(worldPos, 1.0);

  var out: VertexOutput;
  out.position = uniforms.projectionMatrix * viewPos;
  out.viewSpaceNormal = (uniforms.viewMatrix * vec4<f32>(vertexNormal, 0.0)).xyz;
  out.viewSpaceZ = viewPos.z;
  // Speed is scalar magnitude used later for color ramping.
  out.speed = length(velocity);
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  // Pack only x/y to save bandwidth; z reconstructed in composite/AO.
  let n = normalize(in.viewSpaceNormal);
  return vec4<f32>(n.x, n.y, in.speed, in.viewSpaceZ);
}
`;class rn{device;pipeline;uniformBuffer;bindGroup;uniformData=new Float32Array(8);constructor(e,n,t){this.device=e;const r=e.createShaderModule({code:tn});this.pipeline=e.createRenderPipeline({layout:"auto",vertex:{module:r,entryPoint:"vs_main",buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]},{arrayStride:12,attributes:[{shaderLocation:1,offset:0,format:"float32x3"}]}]},fragment:{module:r,entryPoint:"fs_main",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list",cullMode:"back"},depthStencil:{depthWriteEnabled:!0,depthCompare:"less",format:"depth24plus"}}),this.uniformBuffer=e.createBuffer({size:160,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.bindGroup=e.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:n}},{binding:2,resource:{buffer:t}}]})}record(e){this.uniformData[0]=e.particleRadius,this.uniformData[1]=1,this.uniformData[2]=e.simOffset[0],this.uniformData[3]=e.simOffset[1],this.uniformData[4]=e.simOffset[2],this.device.queue.writeBuffer(this.uniformBuffer,0,e.projectionMatrix),this.device.queue.writeBuffer(this.uniformBuffer,64,e.viewMatrix),this.device.queue.writeBuffer(this.uniformBuffer,128,this.uniformData);const n=e.encoder.beginRenderPass({colorAttachments:[{view:e.colorView,clearValue:{r:0,g:0,b:-1,a:0},loadOp:"clear",storeOp:"store"}],depthStencilAttachment:{view:e.depthView,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});n.setPipeline(this.pipeline),n.setBindGroup(0,this.bindGroup),n.setVertexBuffer(0,e.sphereVertexBuffer),n.setVertexBuffer(1,e.sphereNormalBuffer),n.setIndexBuffer(e.sphereIndexBuffer,"uint16"),n.drawIndexed(e.sphereIndexCount,e.particleCount),n.end()}}const on=`// =============================================================================
// SHADOW MAP DEPTH PASS
// =============================================================================
//
// This pass renders the scene from the light's point of view to create a
// depth buffer (shadow map). This map is later sampled during compositing
// to determine which pixels are in shadow.
//
// ## Shadow Mapping Overview
//
// 1. Render scene depth from light's perspective (this pass)
// 2. During compositing, for each pixel:
//    a. Transform world position to light's clip space
//    b. Compare pixel's depth to shadow map depth
//    c. If pixel is farther than shadow map → in shadow
//
// ## Implementation Details
//
// - **Light projection**: Orthographic for directional sun light
// - **Resolution**: 1024x1024 (configurable via SHADOW_MAP_SIZE)
// - **Filtering**: 3x3 PCF in composite pass
// - **Bias**: Small offset (0.002) prevents self-shadowing artifacts
//
// ## Empty Fragment Shader
//
// Since we only need depth values (stored automatically by the depth buffer),
// the fragment shader is empty. No color attachment is needed.
//
// ## Performance Optimization
//
// Uses lower-polygon sphere geometry (1 subdivision level) since shadow
// edges will be softened by PCF filtering anyway.

struct Uniforms {
  // Light camera transform.
  projectionViewMatrix: mat4x4<f32>,
  sphereRadius: f32,
  positionScale: f32,
  // Simulation-space to world-space offset.
  simOffsetX: f32,
  simOffsetY: f32,
  simOffsetZ: f32,
  _pad: vec3<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;

@vertex
fn vs_main(
  @location(0) vertexPos: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32
) -> @builtin(position) vec4<f32> {
  let spherePos = positions[instanceIndex].xyz * uniforms.positionScale;
  let simOffset = vec3<f32>(uniforms.simOffsetX, uniforms.simOffsetY, uniforms.simOffsetZ);
  let worldPos = vertexPos * uniforms.sphereRadius + spherePos + simOffset;
  // Clip-space output from the light's point of view.
  return uniforms.projectionViewMatrix * vec4<f32>(worldPos, 1.0);
}

@fragment
fn fs_main() {}
`;class sn{device;pipeline;uniformBuffer;bindGroup;uniformData=new Float32Array(8);constructor(e,n){this.device=e;const t=e.createShaderModule({code:on});this.pipeline=e.createRenderPipeline({layout:"auto",vertex:{module:t,entryPoint:"vs_main",buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]}]},fragment:{module:t,entryPoint:"fs_main",targets:[]},primitive:{topology:"triangle-list",cullMode:"back"},depthStencil:{depthWriteEnabled:!0,depthCompare:"less",format:"depth32float"}}),this.uniformBuffer=e.createBuffer({size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.bindGroup=e.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:n}}]})}record(e){this.uniformData[0]=e.particleRadius,this.uniformData[1]=1,this.uniformData[2]=e.simOffset[0],this.uniformData[3]=e.simOffset[1],this.uniformData[4]=e.simOffset[2],this.device.queue.writeBuffer(this.uniformBuffer,0,e.lightProjectionViewMatrix),this.device.queue.writeBuffer(this.uniformBuffer,64,this.uniformData);const n=e.encoder.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:e.depthView,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});n.setPipeline(this.pipeline),n.setBindGroup(0,this.bindGroup),n.setVertexBuffer(0,e.sphereVertexBuffer),n.setIndexBuffer(e.sphereIndexBuffer,"uint16"),n.drawIndexed(e.sphereIndexCount,e.particleCount),n.end()}}const an=`// =============================================================================
// SCREEN-SPACE AMBIENT OCCLUSION (SSAO) PASS
// =============================================================================
//
// This pass computes soft shadows from nearby particles using an analytic
// sphere occlusion formula. Unlike traditional SSAO (which samples random
// directions), this leverages our knowledge of particle positions.
//
// ## Algorithm Overview
//
// 1. For each particle, render an enlarged sphere (3x particle radius)
// 2. For each pixel covered by this sphere:
//    a. Sample G-buffer to get shaded point position and normal
//    b. Compute analytic occlusion from this particle to that point
//    c. Accumulate via additive blending
//
// The result is a soft, physically-plausible ambient occlusion that accounts
// for all nearby occluders without expensive ray marching.
//
// ## Analytic Sphere Occlusion
//
// The occlusion from a sphere at distance d with radius r to a surface
// with normal n is computed analytically. This formula accounts for:
// - Distance falloff (1/d²)
// - Sphere solid angle (depends on r/d ratio)
// - Surface orientation (n·L term)
//
// ## Additive Blending
//
// Each particle's contribution is added to a single-channel (r16float) buffer.
// The composite pass reads this accumulated occlusion value.
//
// ## Performance
//
// Using lower-polygon spheres (1 subdivision = 80 faces) keeps vertex costs
// down since we don't need surface detail for the soft occlusion effect.

struct Uniforms {
  projectionMatrix: mat4x4<f32>,
  viewMatrix: mat4x4<f32>,
  resolution: vec2<f32>,
  // Camera FOV is used for view-ray reconstruction from screen UV.
  fov: f32,
  sphereRadius: f32,
  positionScale: f32,
  simOffsetX: f32,
  simOffsetY: f32,
  simOffsetZ: f32,
  _pad: vec3<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var gBufferTex: texture_2d<f32>;
@group(0) @binding(3) var linearSamp: sampler;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) viewSpaceSpherePos: vec3<f32>,
  @location(1) sphereRadius: f32,
};

const PI: f32 = 3.14159265;

@vertex
fn vs_main(
  @location(0) vertexPos: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let spherePos = positions[instanceIndex].xyz * uniforms.positionScale;
  let simOffset = vec3<f32>(uniforms.simOffsetX, uniforms.simOffsetY, uniforms.simOffsetZ);
  let worldSpherePos = spherePos + simOffset;
  let viewSpherPos = (uniforms.viewMatrix * vec4<f32>(worldSpherePos, 1.0)).xyz;

  // Render a larger proxy sphere so fragments near the particle can receive AO.
  let extrudedRadius = uniforms.sphereRadius * 3.0;
  let worldPos = vertexPos * extrudedRadius + worldSpherePos;

  var out: VertexOutput;
  out.position = uniforms.projectionMatrix * uniforms.viewMatrix * vec4<f32>(worldPos, 1.0);
  out.viewSpaceSpherePos = viewSpherPos;
  out.sphereRadius = uniforms.sphereRadius;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) f32 {
  // Convert pixel coord to normalized UV for sampling G-buffer.
  let coords = in.position.xy / uniforms.resolution;
  let data = textureSample(gBufferTex, linearSamp, coords);

  // Background pixels don't receive particle occlusion.
  let viewSpaceZ = data.a;
  if (viewSpaceZ > -0.01) { return 0.0; }

  // Reconstruct unit normal from packed x/y.
  let nx = data.r;
  let ny = data.g;
  let nz = sqrt(max(0.0, 1.0 - nx * nx - ny * ny));
  let viewSpaceNormal = vec3<f32>(nx, ny, nz);

  // Reconstruct view-space position from depth and camera projection params.
  let tanHalfFov = tan(uniforms.fov / 2.0);
  let viewRay = vec3<f32>(
    (coords.x * 2.0 - 1.0) * tanHalfFov * uniforms.resolution.x / uniforms.resolution.y,
    (1.0 - 2.0 * coords.y) * tanHalfFov,
    -1.0
  );
  let viewSpacePos = viewRay * -viewSpaceZ;

  // Relative vector from shaded point to occluding sphere center.
  let di = in.viewSpaceSpherePos - viewSpacePos;
  let l = length(di);
  if (l < 0.001) { return 0.0; }

  let nl = dot(viewSpaceNormal, di / l);
  let h = l / in.sphereRadius;
  let h2 = h * h;
  let k2 = 1.0 - h2 * nl * nl;

  // Analytic sphere occlusion approximation used by the original reference.
  var result = max(0.0, nl) / h2;

  if (k2 > 0.0 && l > in.sphereRadius) {
    result = nl * acos(-nl * sqrt((h2 - 1.0) / (1.0 - nl * nl))) - sqrt(k2 * (h2 - 1.0));
    result = result / h2 + atan(sqrt(k2 / (h2 - 1.0)));
    result /= PI;
  }

  return result;
}
`;class ln{device;pipeline;uniformBuffer;particlePositionBuffer;linearSampler;bindGroup=null;uniformData=new Float32Array(12);constructor(e,n,t){this.device=e,this.particlePositionBuffer=n,this.linearSampler=t;const r=e.createShaderModule({code:an});this.pipeline=e.createRenderPipeline({layout:"auto",vertex:{module:r,entryPoint:"vs_main",buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]}]},fragment:{module:r,entryPoint:"fs_main",targets:[{format:"r16float",blend:{color:{srcFactor:"one",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}}}]},primitive:{topology:"triangle-list",cullMode:"back"},depthStencil:{depthWriteEnabled:!1,depthCompare:"less",format:"depth24plus"}}),this.uniformBuffer=e.createBuffer({size:192,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}updateSizeDependentBindings(e){this.bindGroup=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:this.particlePositionBuffer}},{binding:2,resource:e},{binding:3,resource:this.linearSampler}]})}record(e){if(!this.bindGroup)throw new Error("AOPass bind group is not initialized.");this.uniformData[0]=e.width,this.uniformData[1]=e.height,this.uniformData[2]=e.fov,this.uniformData[3]=e.particleRadius,this.uniformData[4]=1,this.uniformData[5]=e.simOffset[0],this.uniformData[6]=e.simOffset[1],this.uniformData[7]=e.simOffset[2],this.device.queue.writeBuffer(this.uniformBuffer,0,e.projectionMatrix),this.device.queue.writeBuffer(this.uniformBuffer,64,e.viewMatrix),this.device.queue.writeBuffer(this.uniformBuffer,128,this.uniformData);const n=e.encoder.beginRenderPass({colorAttachments:[{view:e.colorView,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}],depthStencilAttachment:{view:e.depthView,depthLoadOp:"load",depthStoreOp:"store"}});n.setPipeline(this.pipeline),n.setBindGroup(0,this.bindGroup),n.setVertexBuffer(0,e.sphereVertexBuffer),n.setIndexBuffer(e.sphereIndexBuffer,"uint16"),n.drawIndexed(e.sphereIndexCount,e.particleCount),n.end()}}const cn=`// =============================================================================
// COMPOSITE SHADING PASS
// =============================================================================
//
// This fullscreen pass produces the final rendered image by combining:
// - Fluid particles (from G-buffer data)
// - Shadow mapping (directional light shadows)
// - Ambient occlusion (from AO pass)
// - Procedural floor with checkerboard tiles
// - Procedural sky gradient with sun
//
// ## Input Textures
//
// - **gBufferTex**: Particle normals (xy), speed, depth (rgba16float)
// - **occlusionTex**: Accumulated ambient occlusion (r16float)
// - **shadowTex**: Shadow depth map from light POV (depth32float)
//
// ## Fluid Shading
//
// 1. Reconstruct view-space normal from G-buffer (z = sqrt(1 - x² - y²))
// 2. Reconstruct world position from depth + inverse view matrix
// 3. Sample shadow map with 3x3 PCF (Percentage Closer Filtering)
// 4. Apply HSV color based on particle speed (faster = bluer hue)
// 5. Modulate by ambient occlusion and shadow
//
// ## Floor Rendering
//
// For background pixels (no fluid), we ray-cast to a floor plane:
// 1. Compute ray-plane intersection
// 2. Apply checkerboard pattern with 4 colors
// 3. Add procedural HSV jitter per tile for visual interest
// 4. Sample floor shadows from the same shadow map
//
// ## Sky Rendering
//
// For pixels that miss both fluid and floor:
// 1. Blend between horizon and zenith colors based on ray direction
// 2. Add sun highlight (Phong-style specular lobe)

struct Uniforms {
  // Camera inverse view to reconstruct world rays/positions.
  inverseViewMatrix: mat4x4<f32>,
  // Light view-projection for shadow-map lookup.
  lightProjectionViewMatrix: mat4x4<f32>,
  resolution: vec2<f32>,
  fov: f32,
  shadowResolution: f32,
  // World-space camera origin for ray-plane intersection.
  cameraPos: vec3<f32>,
  _pad0: f32,
  dirToSun: vec3<f32>,
  floorY: f32,
  skyColorHorizon: vec3<f32>,
  sunPower: f32,
  skyColorZenith: vec3<f32>,
  sunBrightness: f32,
  skyColorGround: vec3<f32>,
  floorSize: f32,
  tileCol1: vec3<f32>,
  tileScale: f32,
  tileCol2: vec3<f32>,
  tileDarkFactor: f32,
  tileCol3: vec3<f32>,
  _pad1: f32,
  tileCol4: vec3<f32>,
  _pad2: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var gBufferTex: texture_2d<f32>;
@group(0) @binding(2) var occlusionTex: texture_2d<f32>;
@group(0) @binding(3) var shadowTex: texture_depth_2d;
@group(0) @binding(4) var linearSamp: sampler;
@group(0) @binding(5) var shadowSamp: sampler_comparison;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, 1.0)
  );
  var out: VertexOutput;
  out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  out.uv = vec2<f32>(pos[vertexIndex].x * 0.5 + 0.5, 0.5 - pos[vertexIndex].y * 0.5);
  return out;
}

fn hsvToRGB(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

fn rgbToHsv(rgb: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = select(vec4<f32>(rgb.gb, K.xy), vec4<f32>(rgb.bg, K.wz), rgb.g < rgb.b);
  let q = select(vec4<f32>(rgb.r, p.yzx), vec4<f32>(p.xyw, rgb.r), rgb.r < p.x);
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn tweakHsv(col: vec3<f32>, shift: vec3<f32>) -> vec3<f32> {
  return clamp(hsvToRGB(rgbToHsv(col) + shift), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn modulo(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }

fn linearToSrgb(c: vec3<f32>) -> vec3<f32> { return pow(c, vec3<f32>(1.0 / 2.2)); }

fn hashInt2(v: vec2<i32>) -> u32 { return u32(v.x) * 5023u + u32(v.y) * 96456u; }

fn randomValue(state: ptr<function, u32>) -> f32 {
  // Tiny hash-based PRNG for tile color variation.
  *state = *state * 747796405u + 2891336453u;
  let word = ((*state >> ((*state >> 28u) + 4u)) ^ *state) * 277803737u;
  return f32((word >> 22u) ^ word) / 4294967295.0;
}

fn randomSNorm3(state: ptr<function, u32>) -> vec3<f32> {
  return vec3<f32>(
    randomValue(state) * 2.0 - 1.0,
    randomValue(state) * 2.0 - 1.0,
    randomValue(state) * 2.0 - 1.0
  );
}

fn getSkyColor(dir: vec3<f32>) -> vec3<f32> {
  // Horizon/zenith gradient + sun lobe.
  let sun = pow(max(0.0, dot(dir, uniforms.dirToSun)), uniforms.sunPower);
  let skyGradientT = pow(smoothstep(0.0, 0.4, dir.y), 0.35);
  let groundToSkyT = smoothstep(-0.01, 0.0, dir.y);
  let skyGradient = mix(uniforms.skyColorHorizon, uniforms.skyColorZenith, skyGradientT);
  var res = mix(uniforms.skyColorGround, skyGradient, groundToSkyT);
  if (dir.y >= -0.01) { res += sun * uniforms.sunBrightness; }
  return res;
}

fn rayPlaneIntersect(ro: vec3<f32>, rd: vec3<f32>, planeY: f32) -> f32 {
  if (abs(rd.y) < 0.0001) { return -1.0; }
  let t = (planeY - ro.y) / rd.y;
  return select(-1.0, t, t > 0.0);
}

fn sampleFloorShadow(worldPos: vec3<f32>) -> f32 {
  // Standard 3x3 PCF shadow filter.
  var lightSpacePos = uniforms.lightProjectionViewMatrix * vec4<f32>(worldPos, 1.0);
  lightSpacePos = lightSpacePos / lightSpacePos.w;
  let lightCoords = vec2<f32>(lightSpacePos.x * 0.5 + 0.5, 0.5 - lightSpacePos.y * 0.5);
  let lightDepth = lightSpacePos.z;

  var shadow = 0.0;
  let texelSize = 1.0 / uniforms.shadowResolution;
  for (var x = -1; x <= 1; x++) {
    for (var y = -1; y <= 1; y++) {
      let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
      let sampleCoord = lightCoords + offset;
      shadow += textureSampleCompare(shadowTex, shadowSamp, sampleCoord, lightDepth - 0.002);
    }
  }
  shadow = shadow / 9.0;

  let inBounds = lightCoords.x >= 0.0 && lightCoords.x <= 1.0 &&
                 lightCoords.y >= 0.0 && lightCoords.y <= 1.0 &&
                 lightDepth >= 0.0 && lightDepth <= 1.0;
  return select(1.0, shadow, inBounds);
}

fn getSceneBackground(rayDir: vec3<f32>, floorShadow: f32) -> vec3<f32> {
  // Intersect camera ray with floor plane and shade tile if hit is in bounds.
  let t = rayPlaneIntersect(uniforms.cameraPos, rayDir, uniforms.floorY);

  if (t > 0.0) {
    let hitPos = uniforms.cameraPos + rayDir * t;
    let halfSize = uniforms.floorSize * 0.5;
    if (abs(hitPos.x) < halfSize && abs(hitPos.z) < halfSize) {
      let rotatedPos = vec2<f32>(-hitPos.z, hitPos.x);

      var tileCol: vec3<f32>;
      if (rotatedPos.x < 0.0) { tileCol = uniforms.tileCol1; }
      else { tileCol = uniforms.tileCol2; }
      if (rotatedPos.y < 0.0) {
        if (rotatedPos.x < 0.0) { tileCol = uniforms.tileCol3; }
        else { tileCol = uniforms.tileCol4; }
      }

      tileCol = linearToSrgb(tileCol);
      let tileCoord = floor(rotatedPos * uniforms.tileScale);

      var rngState = hashInt2(vec2<i32>(i32(tileCoord.x), i32(tileCoord.y)));
      let rv = randomSNorm3(&rngState) * vec3<f32>(0.2, 0.0, 0.73) * 0.1;
      tileCol = tweakHsv(tileCol, rv);

      let isDarkTile = modulo(tileCoord.x, 2.0) == modulo(tileCoord.y, 2.0);
      if (isDarkTile) {
        tileCol = tweakHsv(tileCol, vec3<f32>(0.0, 0.0, uniforms.tileDarkFactor));
      }

      let ambient = 0.4;
      let shadowFactor = ambient + (1.0 - ambient) * floorShadow;
      tileCol *= shadowFactor;

      return tileCol;
    }
  }

  return getSkyColor(rayDir);
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  // G-buffer sample layout: normal.xy, speed, viewSpaceZ.
  let data = textureSample(gBufferTex, linearSamp, in.uv);
  let occlusion = textureSample(occlusionTex, linearSamp, in.uv).r;

  let speed = data.b;
  let viewSpaceZ = data.a;

  // Reconstruct normal.z from unit-length constraint.
  let nx = data.r;
  let ny = data.g;
  let nz = sqrt(max(0.0, 1.0 - nx * nx - ny * ny));

  // Reconstruct view ray/position from UV + depth.
  let tanHalfFov = tan(uniforms.fov / 2.0);
  let viewRay = vec3<f32>(
    (in.uv.x * 2.0 - 1.0) * tanHalfFov * uniforms.resolution.x / uniforms.resolution.y,
    (1.0 - 2.0 * in.uv.y) * tanHalfFov,
    -1.0
  );
  let viewSpacePos = viewRay * max(-viewSpaceZ, 0.01);
  let worldSpacePos = (uniforms.inverseViewMatrix * vec4<f32>(viewSpacePos, 1.0)).xyz;

  var lightSpacePos = uniforms.lightProjectionViewMatrix * vec4<f32>(worldSpacePos, 1.0);
  lightSpacePos = lightSpacePos / lightSpacePos.w;
  let lightCoords = vec2<f32>(lightSpacePos.x * 0.5 + 0.5, 0.5 - lightSpacePos.y * 0.5);
  let lightDepth = lightSpacePos.z;

  // Particle shadows via PCF in light space.
  var shadow = 0.0;
  let texelSize = 1.0 / uniforms.shadowResolution;
  for (var x = -1; x <= 1; x++) {
    for (var y = -1; y <= 1; y++) {
      let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
      shadow += textureSampleCompare(shadowTex, shadowSamp, lightCoords + offset, lightDepth - 0.002);
    }
  }
  shadow /= 9.0;

  // Background if no fluid was written to this pixel.
  let isBackground = speed < 0.0 || viewSpaceZ > -0.01;

  let rayDirNorm = normalize((uniforms.inverseViewMatrix * vec4<f32>(viewRay, 0.0)).xyz);

  let floorT = rayPlaneIntersect(uniforms.cameraPos, rayDirNorm, uniforms.floorY);
  let floorHitPos = uniforms.cameraPos + rayDirNorm * max(floorT, 0.0);
  let floorShadow = sampleFloorShadow(floorHitPos);

  let bgColor = getSceneBackground(rayDirNorm, floorShadow);

  // Fluid base color shifts with speed for a lively stylized look.
  let hue = max(0.6 - speed * 0.0025, 0.52);
  var particleColor = hsvToRGB(vec3<f32>(hue, 0.75, 1.0));

  // AO darkens ambient term; shadow darkens direct term.
  let clampedOcclusion = min(occlusion * 0.5, 1.0);
  let ambient = 1.0 - clampedOcclusion * 0.7;
  let direct = 1.0 - (1.0 - shadow) * 0.8;
  particleColor *= ambient * direct;

  let finalColor = select(particleColor, bgColor, isBackground);
  return vec4<f32>(finalColor, 1.0);
}
`;class dn{device;pipeline;uniformBuffer;linearSampler;shadowSampler;bindGroup=null;uniformData=new Float32Array(40);constructor(e,n,t,r){this.device=e,this.linearSampler=t,this.shadowSampler=r;const a=e.createShaderModule({code:cn});this.pipeline=e.createRenderPipeline({layout:"auto",vertex:{module:a,entryPoint:"vs_main"},fragment:{module:a,entryPoint:"fs_main",targets:[{format:n}]},primitive:{topology:"triangle-strip"}}),this.uniformBuffer=e.createBuffer({size:320,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}updateSizeDependentBindings(e,n,t){this.bindGroup=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:e},{binding:2,resource:n},{binding:3,resource:t},{binding:4,resource:this.linearSampler},{binding:5,resource:this.shadowSampler}]})}record(e){if(!this.bindGroup)throw new Error("CompositePass bind group is not initialized.");this.device.queue.writeBuffer(this.uniformBuffer,0,e.inverseViewMatrix),this.device.queue.writeBuffer(this.uniformBuffer,64,e.lightProjectionViewMatrix);let n=0;this.uniformData[n++]=e.width,this.uniformData[n++]=e.height,this.uniformData[n++]=e.fov,this.uniformData[n++]=e.shadowMapSize,this.uniformData[n++]=e.cameraPosition[0],this.uniformData[n++]=e.cameraPosition[1],this.uniformData[n++]=e.cameraPosition[2],this.uniformData[n++]=0,this.uniformData[n++]=e.sceneConfig.dirToSun[0],this.uniformData[n++]=e.sceneConfig.dirToSun[1],this.uniformData[n++]=e.sceneConfig.dirToSun[2],this.uniformData[n++]=e.sceneConfig.floorY,this.uniformData[n++]=e.sceneConfig.skyColorHorizon[0],this.uniformData[n++]=e.sceneConfig.skyColorHorizon[1],this.uniformData[n++]=e.sceneConfig.skyColorHorizon[2],this.uniformData[n++]=e.sceneConfig.sunPower,this.uniformData[n++]=e.sceneConfig.skyColorZenith[0],this.uniformData[n++]=e.sceneConfig.skyColorZenith[1],this.uniformData[n++]=e.sceneConfig.skyColorZenith[2],this.uniformData[n++]=e.sceneConfig.sunBrightness,this.uniformData[n++]=e.sceneConfig.skyColorGround[0],this.uniformData[n++]=e.sceneConfig.skyColorGround[1],this.uniformData[n++]=e.sceneConfig.skyColorGround[2],this.uniformData[n++]=e.sceneConfig.floorSize,this.uniformData[n++]=e.sceneConfig.tileCol1[0],this.uniformData[n++]=e.sceneConfig.tileCol1[1],this.uniformData[n++]=e.sceneConfig.tileCol1[2],this.uniformData[n++]=e.sceneConfig.tileScale,this.uniformData[n++]=e.sceneConfig.tileCol2[0],this.uniformData[n++]=e.sceneConfig.tileCol2[1],this.uniformData[n++]=e.sceneConfig.tileCol2[2],this.uniformData[n++]=e.sceneConfig.tileDarkFactor,this.uniformData[n++]=e.sceneConfig.tileCol3[0],this.uniformData[n++]=e.sceneConfig.tileCol3[1],this.uniformData[n++]=e.sceneConfig.tileCol3[2],this.uniformData[n++]=0,this.uniformData[n++]=e.sceneConfig.tileCol4[0],this.uniformData[n++]=e.sceneConfig.tileCol4[1],this.uniformData[n++]=e.sceneConfig.tileCol4[2],this.uniformData[n++]=0,this.device.queue.writeBuffer(this.uniformBuffer,128,this.uniformData);const t=e.encoder.beginRenderPass({colorAttachments:[{view:e.targetView,clearValue:{r:.9,g:.9,b:.9,a:1},loadOp:"clear",storeOp:"store"}]});t.setPipeline(this.pipeline),t.setBindGroup(0,this.bindGroup),t.draw(4),t.end()}}const un=`// =============================================================================
// FXAA (Fast Approximate Anti-Aliasing) PASS
// =============================================================================
//
// This post-process pass reduces aliasing (jagged edges) using the FXAA
// algorithm developed by Timothy Lottes at NVIDIA.
//
// ## How FXAA Works
//
// Unlike hardware MSAA which samples geometry multiple times, FXAA works
// purely on the final image:
//
// 1. **Edge Detection**: Sample a 3x3 neighborhood of luminance values
// 2. **Edge Direction**: Compute gradient direction (horizontal or vertical)
// 3. **Blend Along Edge**: Sample colors along the detected edge direction
// 4. **Contrast Check**: Use aggressive blend if contrast is high, conservative if low
//
// ## Algorithm Details
//
// - **Luminance**: Computed from RGB using perceptual weights (0.299, 0.587, 0.114)
// - **Direction**: Gradient of luminance determines blur direction
// - **Two Candidates**:
//   - rgbA: Narrow sample (1/3 and 2/3 along edge)
//   - rgbB: Wider sample (includes ±0.5 along edge)
// - **Selection**: Use rgbB if it stays within local contrast range, else rgbA
//
// ## Tuning Constants
//
// - **FXAA_SPAN_MAX** (8.0): Maximum blur distance in pixels
// - **FXAA_REDUCE_MUL** (1/8): Reduces blur on low-contrast edges
// - **FXAA_REDUCE_MIN** (1/128): Minimum blur reduction factor
//
// ## Trade-offs
//
// - Very fast (single pass, few samples)
// - Works on any rendered image (doesn't need scene geometry)
// - May slightly blur fine details
// - Best for real-time rendering where MSAA is too expensive

struct Uniforms {
  resolution: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var linearSamp: sampler;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

const FXAA_SPAN_MAX: f32 = 8.0;
const FXAA_REDUCE_MUL: f32 = 1.0 / 8.0;
const FXAA_REDUCE_MIN: f32 = 1.0 / 128.0;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, 1.0)
  );
  var out: VertexOutput;
  out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  out.uv = vec2<f32>(pos[vertexIndex].x * 0.5 + 0.5, 0.5 - pos[vertexIndex].y * 0.5);
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  // 1 pixel offset in UV space.
  let delta = 1.0 / uniforms.resolution;

  let rgbNW = textureSample(inputTex, linearSamp, in.uv + vec2<f32>(-1.0, -1.0) * delta).rgb;
  let rgbNE = textureSample(inputTex, linearSamp, in.uv + vec2<f32>(1.0, -1.0) * delta).rgb;
  let rgbSW = textureSample(inputTex, linearSamp, in.uv + vec2<f32>(-1.0, 1.0) * delta).rgb;
  let rgbSE = textureSample(inputTex, linearSamp, in.uv + vec2<f32>(1.0, 1.0) * delta).rgb;
  let rgbM = textureSample(inputTex, linearSamp, in.uv).rgb;

  // Luminance neighborhood drives edge detection direction.
  let luma = vec3<f32>(0.299, 0.587, 0.114);
  let lumaNW = dot(rgbNW, luma);
  let lumaNE = dot(rgbNE, luma);
  let lumaSW = dot(rgbSW, luma);
  let lumaSE = dot(rgbSE, luma);
  let lumaM = dot(rgbM, luma);

  let lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
  let lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

  var dir = vec2<f32>(
    -((lumaNW + lumaNE) - (lumaSW + lumaSE)),
    ((lumaNW + lumaSW) - (lumaNE + lumaSE))
  );

  // Reduce over-blur on low-contrast regions.
  let dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);
  let rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = min(vec2<f32>(FXAA_SPAN_MAX), max(vec2<f32>(-FXAA_SPAN_MAX), dir * rcpDirMin)) * delta;

  // Two candidate blends sampled along detected edge direction.
  let rgbA = 0.5 * (
    textureSample(inputTex, linearSamp, in.uv + dir * (1.0 / 3.0 - 0.5)).rgb +
    textureSample(inputTex, linearSamp, in.uv + dir * (2.0 / 3.0 - 0.5)).rgb
  );
  let rgbB = rgbA * 0.5 + 0.25 * (
    textureSample(inputTex, linearSamp, in.uv + dir * -0.5).rgb +
    textureSample(inputTex, linearSamp, in.uv + dir * 0.5).rgb
  );
  let lumaB = dot(rgbB, luma);

  // Pick conservative sample if rgbB falls outside local contrast range.
  if (lumaB < lumaMin || lumaB > lumaMax) {
    return vec4<f32>(rgbA, 1.0);
  } else {
    return vec4<f32>(rgbB, 1.0);
  }
}
`;class fn{device;pipeline;uniformBuffer;linearSampler;bindGroup=null;uniformData=new Float32Array(2);constructor(e,n,t){this.device=e,this.linearSampler=t;const r=e.createShaderModule({code:un});this.pipeline=e.createRenderPipeline({layout:"auto",vertex:{module:r,entryPoint:"vs_main"},fragment:{module:r,entryPoint:"fs_main",targets:[{format:n}]},primitive:{topology:"triangle-strip"}}),this.uniformBuffer=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}updateSizeDependentBindings(e){this.bindGroup=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:e},{binding:2,resource:this.linearSampler}]})}record(e){if(!this.bindGroup)throw new Error("FXAAPass bind group is not initialized.");this.uniformData[0]=e.width,this.uniformData[1]=e.height,this.device.queue.writeBuffer(this.uniformBuffer,0,this.uniformData);const n=e.encoder.beginRenderPass({colorAttachments:[{view:e.targetView,clearValue:{r:.9,g:.9,b:.9,a:1},loadOp:"clear",storeOp:"store"}]});n.setPipeline(this.pipeline),n.setBindGroup(0,this.bindGroup),n.draw(4),n.end()}}class pn{device;presentationFormat;depthTexture;gBufferTexture;occlusionTexture;compositingTexture;shadowDepthTexture;depthView;gBufferView;occlusionView;compositingView;shadowDepthView;linearSampler;shadowSampler;constructor(e,n,t,r,a){this.device=e,this.presentationFormat=n,this.depthTexture=this.createDepthTexture(t,r),this.gBufferTexture=this.createGBufferTexture(t,r),this.occlusionTexture=this.createOcclusionTexture(t,r),this.compositingTexture=this.createCompositingTexture(t,r),this.shadowDepthTexture=this.createShadowDepthTexture(a),this.depthView=this.depthTexture.createView(),this.gBufferView=this.gBufferTexture.createView(),this.occlusionView=this.occlusionTexture.createView(),this.compositingView=this.compositingTexture.createView(),this.shadowDepthView=this.shadowDepthTexture.createView(),this.linearSampler=e.createSampler({magFilter:"linear",minFilter:"linear"}),this.shadowSampler=e.createSampler({magFilter:"linear",minFilter:"linear",compare:"less"})}resize(e,n){this.depthTexture.destroy(),this.gBufferTexture.destroy(),this.occlusionTexture.destroy(),this.compositingTexture.destroy(),this.depthTexture=this.createDepthTexture(e,n),this.gBufferTexture=this.createGBufferTexture(e,n),this.occlusionTexture=this.createOcclusionTexture(e,n),this.compositingTexture=this.createCompositingTexture(e,n),this.depthView=this.depthTexture.createView(),this.gBufferView=this.gBufferTexture.createView(),this.occlusionView=this.occlusionTexture.createView(),this.compositingView=this.compositingTexture.createView()}createDepthTexture(e,n){return this.device.createTexture({size:[e,n],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT})}createGBufferTexture(e,n){return this.device.createTexture({size:[e,n],format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING})}createOcclusionTexture(e,n){return this.device.createTexture({size:[e,n],format:"r16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING})}createCompositingTexture(e,n){return this.device.createTexture({size:[e,n],format:this.presentationFormat,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING})}createShadowDepthTexture(e){return this.device.createTexture({size:[e,e],format:"depth32float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING})}}class hn{canvas;camera;mouseX=0;mouseY=0;lastMousePlaneX=0;lastMousePlaneY=0;constructor(e,n){this.canvas=e,this.camera=n,e.addEventListener("pointerdown",t=>{t.preventDefault(),this.camera.onMouseDown(t)}),document.addEventListener("pointerup",t=>{t.preventDefault(),this.camera.onMouseUp()}),e.addEventListener("pointermove",t=>{t.preventDefault();const r=z.getMousePosition(t,e),a=e.getBoundingClientRect(),p=r.x/a.width,l=r.y/a.height;this.mouseX=p*2-1,this.mouseY=(1-l)*2-1,this.camera.onMouseMove(t)})}sample(e,n){const t=Math.tan(e/2),r=this.canvas.width/this.canvas.height,a=[this.mouseX*t*r,this.mouseY*t,-1],p=a[0]*this.camera.distance,l=a[1]*this.camera.distance;let d=p-this.lastMousePlaneX,o=l-this.lastMousePlaneY;this.camera.isMouseDown()&&(d=0,o=0),this.lastMousePlaneX=p,this.lastMousePlaneY=l;const s=this.camera.getViewMatrix(),c=z.invertMatrix(new Float32Array(16),s)||new Float32Array(16),u=[0,0,0];z.transformDirectionByMatrix(u,a,c),z.normalizeVector(u,u);const h=[s[0],s[4],s[8]],f=[s[1],s[5],s[9]],g=[d*h[0]+o*f[0],d*h[1]+o*f[1],d*h[2]+o*f[2]],m=this.camera.getPosition(),y=[m[0]-n[0],m[1]-n[1],m[2]-n[2]];return{viewMatrix:s,inverseViewMatrix:c,worldSpaceMouseRay:u,mouseVelocity:g,simMouseRayOrigin:y}}}function pe(i){const e=Math.round(Math.pow(i[0],.45454545454545453)*255),n=Math.round(Math.pow(i[1],1/2.2)*255),t=Math.round(Math.pow(i[2],1/2.2)*255);return"#"+[e,n,t].map(r=>r.toString(16).padStart(2,"0")).join("")}function mn(i){const e=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(i);return e?[Math.pow(parseInt(e[1],16)/255,2.2),Math.pow(parseInt(e[2],16)/255,2.2),Math.pow(parseInt(e[3],16)/255,2.2)]:[0,0,0]}function gn(i){const e={paused:!1,showStats:!1},n=new Ke({horizontal:!0});if(n.dom.style.position="fixed",n.dom.style.bottom="0px",n.dom.style.left="0px",n.dom.style.display="none",document.body.appendChild(n.dom),!document.querySelector('link[href*="Material+Icons"]')){const v=document.createElement("link");v.href="https://fonts.googleapis.com/icon?family=Material+Icons",v.rel="stylesheet",document.head.appendChild(v)}const t=document.createElement("style");t.textContent=`
        #gui-container {
            position: fixed;
            top: 10px;
            right: 10px;
            z-index: 10001;
            background: #1a1a1a;
            color: #fff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-sizing: border-box;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            width: 280px;
            max-width: calc(100vw - 20px);
            height: auto;
            max-height: calc(100vh - 20px);
            display: flex;
            flex-direction: column;
            user-select: none;
            overflow: hidden;
            border-radius: 8px;
        }
        #gui-container.collapsed {
            width: 44px;
            height: 44px;
            border-radius: 22px;
            cursor: pointer;
        }
        #gui-container.collapsed:hover {
            background: #2a2a2a;
        }
        #gui-container .gui-content-wrapper {
            transition: opacity 0.2s ease;
            opacity: 1;
            display: flex;
            flex-direction: column;
            overflow-y: auto;
            flex-grow: 1;
            scrollbar-width: thin;
            scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
        }
        #gui-container .gui-content-wrapper::-webkit-scrollbar {
            width: 6px;
        }
        #gui-container .gui-content-wrapper::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.2);
            border-radius: 3px;
        }
        #gui-container.collapsed .gui-content-wrapper {
            opacity: 0;
            pointer-events: none;
            display: none;
        }
        #gui-container .gui-toggle-btn {
            background: none;
            border: none;
            color: white;
            cursor: pointer;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0.7;
            transition: opacity 0.2s;
            width: 44px;
            height: 44px;
            flex-shrink: 0;
        }
        #gui-container .gui-toggle-btn:hover {
            opacity: 1;
        }
        #gui-container.collapsed .gui-toggle-btn {
            opacity: 1;
        }
        #gui-container .gui-header-main {
            display: flex;
            align-items: center;
            background: #1a1a1a;
            flex-shrink: 0;
        }
        #gui-container .gui-title-area {
            flex-grow: 1;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-right: 11px;
            overflow: hidden;
        }
        #gui-container.collapsed .gui-title-area {
            display: none;
        }
        #gui-container .lil-gui.root,
        #gui-container .lil-gui.lil-root {
            width: 100% !important;
            border: none;
            box-shadow: none;
            background: transparent;
        }
        #gui-container .lil-gui.root > .children,
        #gui-container .lil-gui.lil-root > .children {
            border: none;
        }
        @media (max-width: 480px) {
            #gui-container:not(.collapsed) {
                width: calc(100vw - 20px);
                top: 10px;
                right: 10px;
            }
        }
    `,document.head.appendChild(t);const r=document.createElement("div");r.id="gui-container",window.innerWidth<=480&&r.classList.add("collapsed"),document.body.appendChild(r);const a=document.createElement("div");a.className="gui-header-main",r.appendChild(a);const p=document.createElement("button");p.className="gui-toggle-btn",p.innerHTML='<span class="material-icons">menu</span>',a.appendChild(p);const l=document.createElement("div");l.className="gui-title-area",a.appendChild(l);const d=document.createElement("span");d.style.cssText=`
        font-size: 16px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    `,d.textContent="WebGPU 3D Fluid",l.appendChild(d);const o=document.createElement("a");o.href="https://github.com/jeantimex/fluid",o.target="_blank",o.rel="noopener noreferrer",o.title="View on GitHub",o.style.cssText=`
        display: flex;
        align-items: center;
        color: #fff;
        opacity: 0.7;
        transition: opacity 0.2s;
        margin-left: 10px;
    `,o.onpointerenter=()=>o.style.opacity="1",o.onpointerleave=()=>o.style.opacity="0.7",o.innerHTML=`
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
    `,l.appendChild(o);const s=document.createElement("div");s.className="gui-content-wrapper",r.appendChild(s);const c=v=>{v&&v.stopPropagation(),r.classList.toggle("collapsed")};p.onclick=c,r.onclick=()=>{r.classList.contains("collapsed")&&r.classList.remove("collapsed")};const u=document.createElement("div");u.className="custom-gui-folder",u.style.cssText=`
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.02);
    `;const h=document.createElement("div");h.className="custom-gui-folder-header",h.style.cssText=`
        display: flex;
        align-items: center;
        padding: 1px;
        cursor: pointer;
        user-select: none;
        font-size: 11px;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.9);
    `,h.innerHTML=`
        <span class="material-icons folder-arrow" style="
            font-family: 'Material Icons';
            font-size: 16px;
            transition: transform 0.2s;
            transform: rotate(90deg);
            text-transform: none;
        ">chevron_right</span>
        About
    `;const f=document.createElement("div");f.className="custom-gui-folder-content",f.style.cssText=`
        overflow: hidden;
        max-height: none;
        transition: max-height 0.3s ease-out;
    `;let g=!0;h.onclick=()=>{f.style.maxHeight==="none"&&(f.style.maxHeight=f.scrollHeight+"px",f.offsetHeight),g=!g;const v=h.querySelector(".folder-arrow");g?(v.style.transform="rotate(90deg)",f.style.maxHeight=f.scrollHeight+"px"):(v.style.transform="rotate(0deg)",f.style.maxHeight="0")};const m=document.createElement("div");m.style.cssText=`
        padding: 5px 11px 5px 11px;
        font-size: 11px;
        font-weight: 400;
        opacity: 0.6;
        line-height: 1.4;
        letter-spacing: 0.01em;
        white-space: normal;
        overflow-wrap: break-word;
        max-width: 220px;
    `,m.textContent="FLIP Fluid • Particle Simulation",f.appendChild(m);const y=document.createElement("div");y.style.cssText=`
        padding: 0 11px 10px 11px;
        font-size: 10px;
        font-weight: 400;
        opacity: 1.0;
        letter-spacing: 0.01em;
    `,y.innerHTML='Original Author: <a href="https://github.com/dli/fluid" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">David Li</a>',f.appendChild(y);const M=document.createElement("div");M.style.cssText=`
        padding: 0 11px 10px 11px;
        font-size: 10px;
        font-weight: 400;
        opacity: 1.0;
        letter-spacing: 0.01em;
    `,M.innerHTML='WebGPU Author: <a href="https://github.com/jeantimex" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">jeantimex</a>',f.appendChild(M);const V=document.createElement("div");V.style.cssText=`
        padding: 0 11px 10px 11px;
        font-size: 10px;
        font-weight: 400;
        opacity: 0.6;
        letter-spacing: 0.01em;
    `;const D=new Date("2026-02-22T18:47:30.261Z");V.textContent=`Build: ${D.toLocaleDateString()} ${D.toLocaleTimeString()}`,f.appendChild(V);const T=document.createElement("div");T.style.cssText=`
        padding: 5px 11px 10px 11px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    `;const B=document.createElement("div");B.style.cssText=`
        font-size: 10px;
        font-weight: 600;
        opacity: 0.8;
        text-transform: uppercase;
        margin-bottom: 4px;
    `,B.textContent="Features:",T.appendChild(B);const S=document.createElement("ul");S.style.cssText=`
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
    `,["FLIP Fluid Simulator (GPU)","Deferred Rendering Pipeline","Dynamic Shadow Mapping","Screen-Space Ambient Occlusion","FXAA Anti-Aliasing","Mouse Interaction"].forEach(v=>{const X=document.createElement("li");X.textContent=v,S.appendChild(X)}),T.appendChild(S),f.appendChild(T);const I=document.createElement("div");I.style.cssText=`
        padding: 5px 11px 10px 11px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    `;const E=document.createElement("div");E.style.cssText=`
        font-size: 10px;
        font-weight: 600;
        opacity: 0.8;
        text-transform: uppercase;
        margin-bottom: 4px;
    `,E.textContent="Interactions:",I.appendChild(E);const R=document.createElement("ul");R.style.cssText=`
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
    `,["Click & Drag: Orbit Camera","Mouse Move: Push Particles","Mouse Wheel: Zoom In/Out"].forEach(v=>{const X=document.createElement("li");X.textContent=v,R.appendChild(X)}),I.appendChild(R),f.appendChild(I),u.appendChild(h),u.appendChild(f),s.appendChild(u);const w=new qe({container:s,title:"Simulation Settings"}),x=w.addFolder("Fluid"),O={particleCount:0},U=x.add(O,"particleCount").name("Particle Count").disable();let _=()=>{},A=null;const W={togglePause:()=>{e.paused=!e.paused,A&&A.name(e.paused?"Resume":"Pause")},reset:()=>{_()}};x.add(i.simConfig,"particleRadius",.05,.5,.01).name("Particle Radius").onChange(()=>{i.onParticleSpawnRequested()}),x.add(i.simConfig,"spacingFactor",1,10,.1).name("Spacing Factor").onChange(i.onParticleSpawnRequested),x.add(i.simConfig,"fluidity",.5,.99,.01).name("Fluidity"),x.add(i.simConfig,"gravity",-50,50,1).name("Gravity"),x.add(i.simConfig,"jacobiIterations",1,100,1).name("Pressure Iterations"),x.add(i.simConfig,"useRedBlackGS").name("Red-Black GS"),x.add(i.simConfig,"particleWorkgroupSize",[32,64,128,256]).name("Workgroup Size").onChange(()=>{i.onWorkgroupSizeChanged?.()}),x.add(i.simConfig,"particleCount",1e3,i.maxParticles,1e3).name("Target Count").onFinishChange(()=>{W.reset()}),x.close();const F=w.addFolder("Container");F.add(i.simConfig,"boxWidth",10,100,1).name("Box Width"),F.add(i.simConfig,"boxHeight",5,50,1).name("Box Height"),F.add(i.simConfig,"boxDepth",5,50,1).name("Box Depth"),F.add(i.simConfig,"showWireframe").name("Show Wireframe"),F.close();const L=w.addFolder("Environment"),b={tileCol1:pe(i.sceneConfig.tileCol1),tileCol2:pe(i.sceneConfig.tileCol2),tileCol3:pe(i.sceneConfig.tileCol3),tileCol4:pe(i.sceneConfig.tileCol4)},Y=v=>X=>{const q=mn(X),J=i.sceneConfig[v];Array.isArray(J)&&J.length>=3&&(J[0]=q[0],J[1]=q[1],J[2]=q[2])};L.addColor(b,"tileCol1").name("Tile Color 1").onChange(Y("tileCol1")),L.addColor(b,"tileCol2").name("Tile Color 2").onChange(Y("tileCol2")),L.addColor(b,"tileCol3").name("Tile Color 3").onChange(Y("tileCol3")),L.addColor(b,"tileCol4").name("Tile Color 4").onChange(Y("tileCol4")),L.add(i.sceneConfig,"sunBrightness",0,3,.1).name("Sun Brightness"),L.add(i.sceneConfig,"tileDarkFactor",-1,0,.05).name("Tile Dark Factor"),L.close();const j=w.addFolder("Performance");return j.add(e,"showStats").name("Show FPS").onChange(v=>{n.dom.style.display=v?"block":"none"}),j.close(),A=w.add(W,"togglePause").name("Pause"),w.add(W,"reset").name("Reset Simulation"),window.addEventListener("keydown",v=>{v.target instanceof HTMLInputElement||v.target instanceof HTMLTextAreaElement||(v.key==="p"||v.key==="P")&&W.togglePause()}),{guiState:e,stats:n,setResetHandler(v){_=v},setParticleCountDisplay(v){O.particleCount=v,U.updateDisplay()}}}async function vn(){if(!navigator.gpu){alert("WebGPU is not supported in this browser.");return}const i=await navigator.gpu.requestAdapter();if(!i){alert("No appropriate GPU adapter found.");return}const e=await i.requestDevice({requiredLimits:{maxStorageBuffersPerShaderStage:10}}),n=document.getElementById("canvas"),t=n.getContext("webgpu"),r=window.devicePixelRatio||1;n.width=window.innerWidth*r,n.height=window.innerHeight*r;const a=navigator.gpu.getPreferredCanvasFormat();t.configure({device:e,format:a,alphaMode:"premultiplied"});const p=.22,l={particleRadius:.12,spacingFactor:3,boxWidth:24,boxHeight:10,boxDepth:15,particleCount:35e3,fluidity:.99,gravity:40,jacobiIterations:50,useRedBlackGS:!0,particleWorkgroupSize:64,showWireframe:!0},d={boxWidth:l.boxWidth,boxHeight:l.boxHeight,boxDepth:l.boxDepth},o=()=>l.particleRadius/p,s=()=>-d.boxWidth/2,c=()=>0,u=()=>-d.boxDepth/2,h=()=>d.boxWidth,f=()=>d.boxHeight,g=()=>d.boxDepth,m=32,y=l.boxHeight,M=16,D=Math.ceil(50/y*M),T=16,B=new Je(n,[0,0,0]),S=new Qe(e,a,[l.boxWidth,l.boxHeight,l.boxDepth]),C=2e5,I=e.createBuffer({size:C*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),E=e.createBuffer({size:C*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),R=e.createBuffer({size:C*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),G=new Float32Array(C*4);for(let P=0;P<C;P++){const H=Math.random()*2*Math.PI,$=Math.random()*2-1;G[P*4+0]=Math.sqrt(1-$*$)*Math.cos(H),G[P*4+1]=Math.sqrt(1-$*$)*Math.sin(H),G[P*4+2]=$,G[P*4+3]=0}e.queue.writeBuffer(R,0,G);const w=new nn(e,m,D,T,h(),f(),g(),I,E,R,l.particleWorkgroupSize),x=Ee(2),O=e.createBuffer({size:x.vertices.byteLength,usage:GPUBufferUsage.VERTEX,mappedAtCreation:!0});new Float32Array(O.getMappedRange()).set(x.vertices),O.unmap();const U=e.createBuffer({size:x.normals.byteLength,usage:GPUBufferUsage.VERTEX,mappedAtCreation:!0});new Float32Array(U.getMappedRange()).set(x.normals),U.unmap();const _=e.createBuffer({size:x.indices.byteLength,usage:GPUBufferUsage.INDEX,mappedAtCreation:!0});new Uint16Array(_.getMappedRange()).set(x.indices),_.unmap();const A=Ee(1),W=e.createBuffer({size:A.vertices.byteLength,usage:GPUBufferUsage.VERTEX,mappedAtCreation:!0});new Float32Array(W.getMappedRange()).set(A.vertices),W.unmap();const F=e.createBuffer({size:A.indices.byteLength,usage:GPUBufferUsage.INDEX,mappedAtCreation:!0});new Uint16Array(F.getMappedRange()).set(A.indices),F.unmap();const L=1024,b=new pn(e,a,n.width,n.height,L),Y={dirToSun:[-.83,.42,-.36],floorY:0,skyColorHorizon:[1,1,1],sunPower:500,skyColorZenith:[.08,.37,.73],sunBrightness:1,skyColorGround:[.55,.5,.55],floorSize:100,tileCol1:[.20392157,.5176471,.7764706],tileScale:1,tileCol2:[.6081319,.36850303,.8584906],tileDarkFactor:-.35,tileCol3:[.3019758,.735849,.45801795],tileCol4:[.8018868,.6434483,.36690104]},j=gn({simConfig:l,sceneConfig:Y,maxParticles:C,onParticleSpawnRequested:()=>{me()},onWorkgroupSizeChanged:()=>{w.updateWorkgroupSize(l.particleWorkgroupSize)}}),v=j.guiState,X=Y.dirToSun,q=50,J=[X[0]*q,X[1]*q,X[2]*q],le=z.makeLookAtMatrix(new Float32Array(16),J,[0,0,0],[0,1,0]),oe=40,k=z.makeOrthographicMatrixWebGPU(new Float32Array(16),-oe,oe,-oe,oe,.1,q*2),he=new Float32Array(16);z.premultiplyMatrix(he,le,k);const Re=new rn(e,I,E),Ge=new sn(e,I),Pe=new ln(e,I,b.linearSampler),Se=new dn(e,a,b.linearSampler,b.shadowSampler),Ce=new fn(e,a,b.linearSampler);function ze(){Pe.updateSizeDependentBindings(b.gBufferView),Se.updateSizeDependentBindings(b.gBufferView,b.occlusionView,b.shadowDepthView),Ce.updateSizeDependentBindings(b.compositingView)}ze();let K=0;function me(){const P=new Float32Array(C*4),H=new Float32Array(C*4),$=o();if(S.boxes.length>0){K=Math.min(l.particleCount,C);let Q=0;for(const Z of S.boxes)Q+=Z.computeVolume();const ue=l.spacingFactor*l.particleRadius,ge=K*Math.pow(ue,3),ee=Math.min(1,ge/Q),ne=Math.pow(ee,1/3);console.log(`Spawning ${K} particles (S: ${$.toFixed(3)}, Fill: ${(ee*100).toFixed(1)}%)`);let ie=0;for(let Z=0;Z<S.boxes.length;Z++){const N=S.boxes[Z],ve=N.computeVolume();let te;Z<S.boxes.length-1?te=Math.floor(K*ve/Q):te=K-ie;const Be=N.max[0]-N.min[0],_e=N.max[1]-N.min[1],Ie=N.max[2]-N.min[2],ye=Be*ne,xe=_e*ne,be=Ie*ne,Ue=(Be-ye)/2,Fe=0,Le=(Ie-be)/2,Ae=Math.pow(te,1/3),ae=Math.max(1,Math.round(Ae*Math.pow(ye/xe,1/3))),fe=Math.max(1,Math.round(Ae*Math.pow(xe/be,1/3))),Ne=Math.max(1,Math.ceil(te/(ae*fe)));for(let se=0;se<te;se++){const re=ie+se,We=se%ae,je=Math.floor(se/ae)%fe,Xe=Math.floor(se/(ae*fe)),Ye=N.min[0]+Ue+(We+.5+(Math.random()-.5)*.5)*(ye/ae),He=N.min[1]+Fe+(je+.5+(Math.random()-.5)*.5)*(xe/fe),Ze=N.min[2]+Le+(Xe+.5+(Math.random()-.5)*.5)*(be/Ne);P[re*4+0]=Ye-s(),P[re*4+1]=He-c(),P[re*4+2]=Ze-u(),P[re*4+3]=1,H[re*4+0]=0,H[re*4+1]=0,H[re*4+2]=0,H[re*4+3]=0}ie+=te}e.queue.writeBuffer(I,0,P),e.queue.writeBuffer(E,0,H)}j.setParticleCountDisplay(K)}me(),j.setResetHandler(()=>{me(),console.log("Simulation reset")});const ce=new Float32Array(16),de=Math.PI/3;function Te(){const P=n.width/n.height;z.makePerspectiveMatrix(ce,de,P,.1,100)}Te();const Oe=new hn(n,B);console.log("WebGPU Initialized with Particles");function Me(){j.stats.begin();const P=e.createCommandEncoder(),H=.1;d.boxWidth+=(l.boxWidth-d.boxWidth)*H,d.boxHeight+=(l.boxHeight-d.boxHeight)*H,d.boxDepth+=(l.boxDepth-d.boxDepth)*H,w.gridWidth=h(),w.gridHeight=f(),w.gridDepth=g();const $=Math.max(1,Math.min(D,Math.round(d.boxHeight/y*M)));w.ny=$;const Q=Oe.sample(de,[s(),c(),u()]),ue=Q.viewMatrix,ge=Q.inverseViewMatrix;if(!v.paused){const ee=P.beginComputePass(),ne=d.boxWidth/m,ie=d.boxHeight/w.ny,Z=d.boxDepth/T,N=ne*ie*Z,ve=l.spacingFactor*l.particleRadius,te=Math.max(.5,Math.min(500,N/Math.pow(ve,3)));w.step(ee,K,l.fluidity,l.gravity,te,l.jacobiIterations,l.useRedBlackGS,Q.mouseVelocity,Q.simMouseRayOrigin,Q.worldSpaceMouseRay),ee.end()}if(K>0){const ee=s(),ne=c(),ie=u(),Z=[ee,ne,ie];if(Re.record({encoder:P,projectionMatrix:ce,viewMatrix:ue,particleRadius:l.particleRadius,simOffset:Z,particleCount:K,colorView:b.gBufferView,depthView:b.depthView,sphereVertexBuffer:O,sphereNormalBuffer:U,sphereIndexBuffer:_,sphereIndexCount:x.indices.length}),Ge.record({encoder:P,lightProjectionViewMatrix:he,particleRadius:l.particleRadius,simOffset:Z,particleCount:K,depthView:b.shadowDepthView,sphereVertexBuffer:W,sphereIndexBuffer:F,sphereIndexCount:A.indices.length}),Pe.record({encoder:P,projectionMatrix:ce,viewMatrix:ue,width:n.width,height:n.height,fov:de,particleRadius:l.particleRadius,simOffset:Z,particleCount:K,colorView:b.occlusionView,depthView:b.depthView,sphereVertexBuffer:W,sphereIndexBuffer:F,sphereIndexCount:A.indices.length}),Se.record({encoder:P,inverseViewMatrix:ge,lightProjectionViewMatrix:he,width:n.width,height:n.height,fov:de,shadowMapSize:L,cameraPosition:B.getPosition(),sceneConfig:Y,targetView:b.compositingView}),l.showWireframe){const N=P.beginRenderPass({colorAttachments:[{view:b.compositingView,loadOp:"load",storeOp:"store"}],depthStencilAttachment:{view:b.depthView,depthLoadOp:"load",depthStoreOp:"store"}});S.draw(N,ce,B,[ee,ne,ie],[d.boxWidth,d.boxHeight,d.boxDepth]),N.end()}Ce.record({encoder:P,width:n.width,height:n.height,targetView:t.getCurrentTexture().createView()})}else P.beginRenderPass({colorAttachments:[{view:t.getCurrentTexture().createView(),clearValue:{r:.9,g:.9,b:.9,a:1},loadOp:"clear",storeOp:"store"}]}).end();e.queue.submit([P.finish()]),j.stats.end(),j.stats.update(),requestAnimationFrame(Me)}requestAnimationFrame(Me),window.addEventListener("resize",()=>{n.width=window.innerWidth*r,n.height=window.innerHeight*r,b.resize(n.width,n.height),ze(),Te()})}vn();
