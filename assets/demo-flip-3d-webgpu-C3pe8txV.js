import{G as ni}from"./lil-gui.esm-DA0aiWCL.js";import{S as ai}from"./main-DwTz-q1_.js";const z={clamp:function(t,e,i){return Math.max(e,Math.min(i,t))},getMousePosition:function(t,e){const i=e.getBoundingClientRect();return{x:t.clientX-i.left,y:t.clientY-i.top}},addVectors:function(t,e,i){return t[0]=e[0]+i[0],t[1]=e[1]+i[1],t[2]=e[2]+i[2],t},subtractVectors:function(t,e,i){return t[0]=e[0]-i[0],t[1]=e[1]-i[1],t[2]=e[2]-i[2],t},magnitudeOfVector:function(t){return Math.sqrt(t[0]*t[0]+t[1]*t[1]+t[2]*t[2])},dotVectors:function(t,e){return t[0]*e[0]+t[1]*e[1]+t[2]*e[2]},multiplyVectorByScalar:function(t,e,i){return t[0]=e[0]*i[0],t[1]=e[1]*i[0],t[2]=e[2]*i[0],t},multiplyVectorByNumber:function(t,e,i){return t[0]=e[0]*i,t[1]=e[1]*i,t[2]=e[2]*i,t},normalizeVector:function(t,e){const i=z.magnitudeOfVector(e);if(i===0)return t[0]=0,t[1]=0,t[2]=0,t;const o=1/i;return t[0]=e[0]*o,t[1]=e[1]*o,t[2]=e[2]*o,t},makePerspectiveMatrix:function(t,e,i,o,n){const l=1/Math.tan(e/2),f=1/(o-n);return t[0]=l/i,t[1]=0,t[2]=0,t[3]=0,t[4]=0,t[5]=l,t[6]=0,t[7]=0,t[8]=0,t[9]=0,t[10]=(n+o)*f,t[11]=-1,t[12]=0,t[13]=0,t[14]=2*n*o*f,t[15]=0,t},makeIdentityMatrix:function(t){return t.fill(0),t[0]=1,t[5]=1,t[10]=1,t[15]=1,t},premultiplyMatrix:function(t,e,i){const o=i[0],n=i[4],l=i[8],f=i[12],x=i[1],a=i[5],r=i[9],s=i[13],u=i[2],m=i[6],h=i[10],y=i[14],P=i[3],w=i[7],S=i[11],v=i[15],B=e[0],b=e[1],T=e[2],C=e[3];t[0]=o*B+n*b+l*T+f*C,t[1]=x*B+a*b+r*T+s*C,t[2]=u*B+m*b+h*T+y*C,t[3]=P*B+w*b+S*T+v*C;const U=e[4],G=e[5],j=e[6],V=e[7];t[4]=o*U+n*G+l*j+f*V,t[5]=x*U+a*G+r*j+s*V,t[6]=u*U+m*G+h*j+y*V,t[7]=P*U+w*G+S*j+v*V;const O=e[8],k=e[9],L=e[10],N=e[11];t[8]=o*O+n*k+l*L+f*N,t[9]=x*O+a*k+r*L+s*N,t[10]=u*O+m*k+h*L+y*N,t[11]=P*O+w*k+S*L+v*N;const W=e[12],A=e[13],_=e[14],D=e[15];return t[12]=o*W+n*A+l*_+f*D,t[13]=x*W+a*A+r*_+s*D,t[14]=u*W+m*A+h*_+y*D,t[15]=P*W+w*A+S*_+v*D,t},makeXRotationMatrix:function(t,e){return z.makeIdentityMatrix(t),t[5]=Math.cos(e),t[6]=Math.sin(e),t[9]=-Math.sin(e),t[10]=Math.cos(e),t},makeYRotationMatrix:function(t,e){return z.makeIdentityMatrix(t),t[0]=Math.cos(e),t[2]=-Math.sin(e),t[8]=Math.sin(e),t[10]=Math.cos(e),t},transformDirectionByMatrix:function(t,e,i){const o=e[0],n=e[1],l=e[2];return t[0]=i[0]*o+i[4]*n+i[8]*l,t[1]=i[1]*o+i[5]*n+i[9]*l,t[2]=i[2]*o+i[6]*n+i[10]*l,t},invertMatrix:function(t,e){const i=e[0],o=e[4],n=e[8],l=e[12],f=e[1],x=e[5],a=e[9],r=e[13],s=e[2],u=e[6],m=e[10],h=e[14],y=e[3],P=e[7],w=e[11],S=e[15],v=m*S,B=h*w,b=u*S,T=h*P,C=u*w,U=m*P,G=s*S,j=h*y,V=s*w,O=m*y,k=s*P,L=u*y,N=n*r,W=l*a,A=o*r,_=l*x,D=o*a,de=n*x,H=i*r,te=l*f,ie=i*a,ge=n*f,ae=i*x,he=o*f,Ue=v*x+T*a+C*r-(B*x+b*a+U*r),be=B*f+G*a+O*r-(v*f+j*a+V*r),Re=b*f+j*x+k*r-(T*f+G*x+L*r),we=U*f+V*x+L*a-(C*f+O*x+k*a),Oe=i*Ue+o*be+n*Re+l*we;if(Oe===0)return null;const d=1/Oe;return t[0]=d*Ue,t[1]=d*be,t[2]=d*Re,t[3]=d*we,t[4]=d*(B*o+b*n+U*l-(v*o+T*n+C*l)),t[5]=d*(v*i+j*n+V*l-(B*i+G*n+O*l)),t[6]=d*(T*i+G*o+L*l-(b*i+j*o+k*l)),t[7]=d*(C*i+O*o+k*n-(U*i+V*o+L*n)),t[8]=d*(N*P+_*w+D*S-(W*P+A*w+de*S)),t[9]=d*(W*y+H*w+ge*S-(N*y+te*w+ie*S)),t[10]=d*(A*y+te*P+ae*S-(_*y+H*P+he*S)),t[11]=d*(de*y+ie*P+he*w-(D*y+ge*P+ae*w)),t[12]=d*(A*m+de*h+W*u-(D*h+N*u+_*m)),t[13]=d*(ie*h+N*s+te*m-(H*m+ge*h+W*s)),t[14]=d*(H*u+he*h+_*s-(ae*h+A*s+te*u)),t[15]=d*(ae*m+D*s+ge*u-(ie*u+he*m+de*s)),t},makeLookAtMatrix:function(t,e,i,o){const n=e[0]-i[0],l=e[1]-i[1],f=e[2]-i[2],x=Math.sqrt(n*n+l*l+f*f),a=n/x,r=l/x,s=f/x,u=o[2]*r-o[1]*s,m=o[0]*s-o[2]*a,h=o[1]*a-o[0]*r,y=Math.sqrt(u*u+m*m+h*h),P=u/y,w=m/y,S=h/y,v=r*S-s*w,B=s*P-a*S,b=a*w-r*P,T=Math.sqrt(v*v+B*B+b*b),C=v/T,U=B/T,G=b/T;return t[0]=P,t[1]=C,t[2]=a,t[3]=0,t[4]=w,t[5]=U,t[6]=r,t[7]=0,t[8]=S,t[9]=G,t[10]=s,t[11]=0,t[12]=-(P*e[0]+w*e[1]+S*e[2]),t[13]=-(C*e[0]+U*e[1]+G*e[2]),t[14]=-(a*e[0]+r*e[1]+s*e[2]),t[15]=1,t},makeOrthographicMatrix:function(t,e,i,o,n,l,f){return t[0]=2/(i-e),t[1]=0,t[2]=0,t[3]=0,t[4]=0,t[5]=2/(n-o),t[6]=0,t[7]=0,t[8]=0,t[9]=0,t[10]=-2/(f-l),t[11]=0,t[12]=-(i+e)/(i-e),t[13]=-(n+o)/(n-o),t[14]=-(f+l)/(f-l),t[15]=1,t},makeOrthographicMatrixWebGPU:function(t,e,i,o,n,l,f){return t[0]=2/(i-e),t[1]=0,t[2]=0,t[3]=0,t[4]=0,t[5]=2/(n-o),t[6]=0,t[7]=0,t[8]=0,t[9]=0,t[10]=-1/(f-l),t[11]=0,t[12]=-(i+e)/(i-e),t[13]=-(n+o)/(n-o),t[14]=-l/(f-l),t[15]=1,t}},Nt=.005,Wt=25,Xt=60;class si{element;distance=30;orbitPoint;azimuth=-Math.PI/6;elevation=Math.PI/2-Math.PI/2.5;minElevation=-Math.PI/4;maxElevation=Math.PI/4;lastMouseX=0;lastMouseY=0;mouseDown=!1;viewMatrix=new Float32Array(16);constructor(e,i){this.element=e,this.orbitPoint=i,this.recomputeViewMatrix(),e.addEventListener("wheel",o=>{const n=o.deltaY;this.distance+=(n>0?1:-1)*2,this.distance<Wt&&(this.distance=Wt),this.distance>Xt&&(this.distance=Xt),this.recomputeViewMatrix()})}recomputeViewMatrix(){const e=new Float32Array(16),i=new Float32Array(16),o=z.makeIdentityMatrix(new Float32Array(16)),n=z.makeIdentityMatrix(new Float32Array(16));z.makeIdentityMatrix(this.viewMatrix),z.makeXRotationMatrix(e,this.elevation),z.makeYRotationMatrix(i,this.azimuth),o[14]=-this.distance,n[12]=-this.orbitPoint[0],n[13]=-this.orbitPoint[1],n[14]=-this.orbitPoint[2],z.premultiplyMatrix(this.viewMatrix,this.viewMatrix,n),z.premultiplyMatrix(this.viewMatrix,this.viewMatrix,i),z.premultiplyMatrix(this.viewMatrix,this.viewMatrix,e),z.premultiplyMatrix(this.viewMatrix,this.viewMatrix,o)}getPosition(){return[this.distance*Math.sin(Math.PI/2-this.elevation)*Math.sin(-this.azimuth)+this.orbitPoint[0],this.distance*Math.cos(Math.PI/2-this.elevation)+this.orbitPoint[1],this.distance*Math.sin(Math.PI/2-this.elevation)*Math.cos(-this.azimuth)+this.orbitPoint[2]]}getViewMatrix(){return this.viewMatrix}setBounds(e,i){this.minElevation=e,this.maxElevation=i,this.elevation>this.maxElevation&&(this.elevation=this.maxElevation),this.elevation<this.minElevation&&(this.elevation=this.minElevation),this.recomputeViewMatrix()}onMouseDown(e){const{x:i,y:o}=z.getMousePosition(e,this.element);this.mouseDown=!0,this.lastMouseX=i,this.lastMouseY=o}onMouseUp(){this.mouseDown=!1}isMouseDown(){return this.mouseDown}onMouseMove(e){const{x:i,y:o}=z.getMousePosition(e,this.element);if(this.mouseDown){const n=(i-this.lastMouseX)*Nt,l=(o-this.lastMouseY)*Nt;this.azimuth+=n,this.elevation+=l,this.elevation>this.maxElevation&&(this.elevation=this.maxElevation),this.elevation<this.minElevation&&(this.elevation=this.minElevation),this.recomputeViewMatrix(),this.lastMouseX=i,this.lastMouseY=o}}}class xt{min;max;constructor(e,i){this.min=[e[0],e[1],e[2]],this.max=[i[0],i[1],i[2]]}computeVolume(){let e=1;for(let i=0;i<3;++i)e*=this.max[i]-this.min[i];return e}computeSurfaceArea(){const e=this.max[0]-this.min[0],i=this.max[1]-this.min[1],o=this.max[2]-this.min[2];return 2*(e*i+e*o+i*o)}clone(){return new xt([this.min[0],this.min[1],this.min[2]],[this.max[0],this.max[1],this.max[2]])}randomPoint(){const e=[];for(let i=0;i<3;++i)e[i]=this.min[i]+Math.random()*(this.max[i]-this.min[i]);return e}}class li{device;gridDimensions;boxes=[];linePipeline;solidPipeline;gridVertexBuffer;cubeVertexBuffer;cubeIndexBuffer;uniformBuffer;bindGroup;constructor(e,i,o){this.device=e,this.gridDimensions=o,this.boxes.push(new xt([0,0,0],[o[0]*.5,o[1]*.8,o[2]*.8]));const l=e.createShaderModule({code:`
            struct Uniforms {
                projectionMatrix: mat4x4<f32>,
                viewMatrix: mat4x4<f32>,
                translation: vec3<f32>,
                scale: vec3<f32>,
                color: vec4<f32>,
            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
            };

            @vertex
            fn vs_main(@location(0) position: vec3<f32>) -> VertexOutput {
                var out: VertexOutput;
                let scaledPos = position * uniforms.scale + uniforms.translation;
                out.position = uniforms.projectionMatrix * uniforms.viewMatrix * vec4<f32>(scaledPos, 1.0);
                return out;
            }

            @fragment
            fn fs_main() -> @location(0) vec4<f32> {
                return uniforms.color;
            }
        `}),f=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]}),a={layout:e.createPipelineLayout({bindGroupLayouts:[f]}),vertex:{module:l,entryPoint:"vs_main",buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]}]},fragment:{module:l,entryPoint:"fs_main",targets:[{format:i}]},primitive:{topology:"line-list"},depthStencil:{depthWriteEnabled:!0,depthCompare:"less",format:"depth24plus"}};this.linePipeline=e.createRenderPipeline(a);const r={...a};r.primitive={topology:"triangle-list",cullMode:"back"},this.solidPipeline=e.createRenderPipeline(r);const s=new Float32Array([0,0,0,1,0,0,1,0,0,1,0,1,1,0,1,0,0,1,0,0,1,0,0,0,0,1,0,1,1,0,1,1,0,1,1,1,1,1,1,0,1,1,0,1,1,0,1,0,0,0,0,0,1,0,1,0,0,1,1,0,1,0,1,1,1,1,0,0,1,0,1,1]);this.gridVertexBuffer=this.createBuffer(s,GPUBufferUsage.VERTEX);const u=new Float32Array([0,0,1,1,0,1,1,1,1,0,1,1,0,0,0,0,1,0,1,1,0,1,0,0,0,1,0,0,1,1,1,1,1,1,1,0,0,0,0,1,0,0,1,0,1,0,0,1,1,0,0,1,1,0,1,1,1,1,0,1,0,0,0,0,0,1,0,1,1,0,1,0]);this.cubeVertexBuffer=this.createBuffer(u,GPUBufferUsage.VERTEX);const m=new Uint16Array([0,1,2,0,2,3,4,5,6,4,6,7,8,9,10,8,10,11,12,13,14,12,14,15,16,17,18,16,18,19,20,21,22,20,22,23]);this.cubeIndexBuffer=this.createBuffer(m,GPUBufferUsage.INDEX),this.uniformBuffer=e.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.bindGroup=e.createBindGroup({layout:f,entries:[{binding:0,resource:{buffer:this.uniformBuffer}}]})}createBuffer(e,i){const o=this.device.createBuffer({size:e.byteLength,usage:i|GPUBufferUsage.COPY_DST,mappedAtCreation:!0});return e instanceof Float32Array?new Float32Array(o.getMappedRange()).set(e):new Uint16Array(o.getMappedRange()).set(e),o.unmap(),o}draw(e,i,o,n=[0,0,0],l=[1,1,1]){this.device.queue.writeBuffer(this.uniformBuffer,0,i),this.device.queue.writeBuffer(this.uniformBuffer,64,o.getViewMatrix()),e.setPipeline(this.linePipeline),e.setBindGroup(0,this.bindGroup),this.updateUniforms(n,l,[1,1,1,1]),e.setVertexBuffer(0,this.gridVertexBuffer),e.draw(24)}updateUniforms(e,i,o){this.device.queue.writeBuffer(this.uniformBuffer,128,new Float32Array(e)),this.device.queue.writeBuffer(this.uniformBuffer,144,new Float32Array(i)),this.device.queue.writeBuffer(this.uniformBuffer,160,new Float32Array(o))}}function jt(t){let e=[];const i=r=>{const s=Math.sqrt(r[0]*r[0]+r[1]*r[1]+r[2]*r[2]),u=[r[0]/s,r[1]/s,r[2]/s];e.push(u)},o=(r,s)=>{const u=e[r],m=e[s],h=[(u[0]+m[0])/2,(u[1]+m[1])/2,(u[2]+m[2])/2];return i(h),e.length-1},n=(1+Math.sqrt(5))/2;i([-1,n,0]),i([1,n,0]),i([-1,-n,0]),i([1,-n,0]),i([0,-1,n]),i([0,1,n]),i([0,-1,-n]),i([0,1,-n]),i([n,0,-1]),i([n,0,1]),i([-n,0,-1]),i([-n,0,1]);let l=[[0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],[1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],[3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],[4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1]];for(let r=0;r<t;r++){const s=[];for(const u of l){const m=o(u[0],u[1]),h=o(u[1],u[2]),y=o(u[2],u[0]);s.push([u[0],m,y]),s.push([u[1],h,m]),s.push([u[2],y,h]),s.push([m,h,y])}l=s}const f=new Float32Array(e.length*3),x=new Float32Array(e.length*3);for(let r=0;r<e.length;r++)f[r*3+0]=e[r][0],f[r*3+1]=e[r][1],f[r*3+2]=e[r][2],x[r*3+0]=e[r][0],x[r*3+1]=e[r][1],x[r*3+2]=e[r][2];const a=new Uint16Array(l.length*3);for(let r=0;r<l.length;r++)a[r*3+0]=l[r][0],a[r*3+1]=l[r][1],a[r*3+2]=l[r][2];return{vertices:f,normals:x,indices:a}}class ci{device;nx;ny;nz;gridWidth;gridHeight;gridDepth;gridVelocityBuffer;gridWeightBuffer;gridVelocityFloatBuffer;gridVelocityOrigBuffer;gridMarkerBuffer;pressureBuffer;pressureTempBuffer;uniformBuffer;clearGridPipeline;transferToGridPipeline;normalizeGridPipeline;markCellsPipeline;addGravityPipeline;enforceBoundaryPipeline;divergencePipeline;jacobiPipeline;applyPressurePipeline;gridToParticlePipeline;advectPipeline;simBindGroup;simBindGroupAlt;frameNumber=0;constructor(e,i,o,n,l,f,x,a,r,s){this.device=e,this.nx=i,this.ny=o,this.nz=n,this.gridWidth=l,this.gridHeight=f,this.gridDepth=x;const u=(i+1)*(o+1)*(n+1),m=i*o*n,h=(B,b=GPUBufferUsage.STORAGE)=>e.createBuffer({size:B,usage:b});this.gridVelocityBuffer=h(u*16),this.gridWeightBuffer=h(u*16),this.gridVelocityFloatBuffer=h(u*16),this.gridVelocityOrigBuffer=h(u*16),this.gridMarkerBuffer=h(m*4),this.pressureBuffer=h(m*4),this.pressureTempBuffer=h(m*4),this.uniformBuffer=h(112,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);const P=e.createShaderModule({code:`
            struct Uniforms {
                nx: u32, ny: u32, nz: u32, particleCount: u32,
                width: f32, height: f32, depth: f32, dt: f32,
                frameNumber: f32, fluidity: f32, gravity: f32, particleDensity: f32,
                mouseVelocity: vec3<f32>, _pad4: f32,
                mouseRayOrigin: vec3<f32>, _pad5: f32,
                mouseRayDirection: vec3<f32>, _pad6: f32,
            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
            @group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;

            // Atomic buffers for P2G accumulation
            struct AtomicCell { x: atomic<i32>, y: atomic<i32>, z: atomic<i32>, w: atomic<i32> };
            @group(0) @binding(3) var<storage, read_write> gridVelAtomic: array<AtomicCell>;  // weighted velocity
            @group(0) @binding(4) var<storage, read_write> gridWeightAtomic: array<AtomicCell>; // weights

            // Float buffers for simulation
            @group(0) @binding(5) var<storage, read_write> gridVel: array<vec4<f32>>;      // current velocity
            @group(0) @binding(6) var<storage, read_write> gridVelOrig: array<vec4<f32>>; // original velocity
            @group(0) @binding(7) var<storage, read_write> marker: array<u32>;            // scalar grid
            @group(0) @binding(8) var<storage, read_write> pressure: array<f32>;          // scalar grid
            @group(0) @binding(9) var<storage, read_write> divergence: array<f32>;        // scalar grid
            @group(0) @binding(10) var<storage, read> randomDirs: array<vec4<f32>>;       // pre-computed random directions

            const SCALE: f32 = 10000.0;
            const TURBULENCE: f32 = 0.05;  // Match WebGL

            // Velocity grid index (nx+1) x (ny+1) x (nz+1)
            fn velIdx(x: u32, y: u32, z: u32) -> u32 {
                let cx = clamp(x, 0u, uniforms.nx);
                let cy = clamp(y, 0u, uniforms.ny);
                let cz = clamp(z, 0u, uniforms.nz);
                return cx + cy * (uniforms.nx + 1u) + cz * (uniforms.nx + 1u) * (uniforms.ny + 1u);
            }

            // Scalar grid index nx x ny x nz
            fn scalarIdx(x: u32, y: u32, z: u32) -> u32 {
                let cx = clamp(x, 0u, uniforms.nx - 1u);
                let cy = clamp(y, 0u, uniforms.ny - 1u);
                let cz = clamp(z, 0u, uniforms.nz - 1u);
                return cx + cy * uniforms.nx + cz * uniforms.nx * uniforms.ny;
            }

            fn worldToGrid(p: vec3<f32>) -> vec3<f32> {
                return vec3<f32>(
                    p.x / uniforms.width * f32(uniforms.nx),
                    p.y / uniforms.height * f32(uniforms.ny),
                    p.z / uniforms.depth * f32(uniforms.nz)
                );
            }

            // Trilinear kernel weight function (matches WebGL h() and k())
            fn h(r: f32) -> f32 {
                if (r >= 0.0 && r <= 1.0) { return 1.0 - r; }
                else if (r >= -1.0 && r < 0.0) { return 1.0 + r; }
                return 0.0;
            }

            fn kernel(v: vec3<f32>) -> f32 {
                return h(v.x) * h(v.y) * h(v.z);
            }

            // Mouse kernel function (matches WebGL addforce.frag)
            const MOUSE_RADIUS: f32 = 5.0;

            fn mouseKernel(gridPosition: vec3<f32>) -> f32 {
                // Convert grid position to world position
                let worldPosition = gridPosition / vec3<f32>(f32(uniforms.nx), f32(uniforms.ny), f32(uniforms.nz)) *
                                   vec3<f32>(uniforms.width, uniforms.height, uniforms.depth);

                // Distance to mouse ray using cross product
                let toOrigin = worldPosition - uniforms.mouseRayOrigin;
                let distanceToMouseRay = length(cross(uniforms.mouseRayDirection, toOrigin));

                let normalizedDistance = max(0.0, distanceToMouseRay / MOUSE_RADIUS);
                return smoothstep(1.0, 0.9, normalizedDistance);
            }

            // ============ CLEAR GRID ============
            @compute @workgroup_size(8, 4, 4)
            fn clearGrid(@builtin(global_invocation_id) id: vec3<u32>) {
                // Clear velocity grid
                if (id.x <= uniforms.nx && id.y <= uniforms.ny && id.z <= uniforms.nz) {
                    let vi = velIdx(id.x, id.y, id.z);
                    atomicStore(&gridVelAtomic[vi].x, 0);
                    atomicStore(&gridVelAtomic[vi].y, 0);
                    atomicStore(&gridVelAtomic[vi].z, 0);
                    atomicStore(&gridVelAtomic[vi].w, 0);
                    atomicStore(&gridWeightAtomic[vi].x, 0);
                    atomicStore(&gridWeightAtomic[vi].y, 0);
                    atomicStore(&gridWeightAtomic[vi].z, 0);
                    atomicStore(&gridWeightAtomic[vi].w, 0);
                    gridVel[vi] = vec4<f32>(0.0);
                    gridVelOrig[vi] = vec4<f32>(0.0);
                }

                // Clear scalar grid
                if (id.x < uniforms.nx && id.y < uniforms.ny && id.z < uniforms.nz) {
                    let si = scalarIdx(id.x, id.y, id.z);
                    marker[si] = 0u;
                    pressure[si] = 0.0;
                    divergence[si] = 0.0;
                }
            }

            // ============ PARTICLE TO GRID (P2G) - Staggered MAC Grid ============
            // Matches WebGL transfertogrid.frag exactly
            @compute @workgroup_size(64)
            fn transferToGrid(@builtin(global_invocation_id) id: vec3<u32>) {
                let pIdx = id.x;
                if (pIdx >= uniforms.particleCount) { return; }

                let pos = positions[pIdx].xyz;
                let vel = velocities[pIdx].xyz;
                let g = worldToGrid(pos);  // Position in grid coordinates

                // For each nearby grid cell (splat to 2x2x2 neighborhood)
                let baseX = i32(floor(g.x));
                let baseY = i32(floor(g.y));
                let baseZ = i32(floor(g.z));

                for (var di = 0; di <= 1; di++) {
                    for (var dj = 0; dj <= 1; dj++) {
                        for (var dk = 0; dk <= 1; dk++) {
                            let cellX = u32(max(0, baseX + di));
                            let cellY = u32(max(0, baseY + dj));
                            let cellZ = u32(max(0, baseZ + dk));

                            if (cellX > uniforms.nx || cellY > uniforms.ny || cellZ > uniforms.nz) {
                                continue;
                            }

                            let cellIdx = velIdx(cellX, cellY, cellZ);

                            // MAC grid staggered positions:
                            // X velocity at (i, j+0.5, k+0.5)
                            // Y velocity at (i+0.5, j, k+0.5)
                            // Z velocity at (i+0.5, j+0.5, k)
                            // Scalar at (i+0.5, j+0.5, k+0.5)

                            let xPos = vec3<f32>(f32(cellX), f32(cellY) + 0.5, f32(cellZ) + 0.5);
                            let yPos = vec3<f32>(f32(cellX) + 0.5, f32(cellY), f32(cellZ) + 0.5);
                            let zPos = vec3<f32>(f32(cellX) + 0.5, f32(cellY) + 0.5, f32(cellZ));
                            let scalarPos = vec3<f32>(f32(cellX) + 0.5, f32(cellY) + 0.5, f32(cellZ) + 0.5);

                            let xWeight = kernel(g - xPos);
                            let yWeight = kernel(g - yPos);
                            let zWeight = kernel(g - zPos);
                            let scalarWeight = kernel(g - scalarPos);

                            // Accumulate weights
                            atomicAdd(&gridWeightAtomic[cellIdx].x, i32(xWeight * SCALE));
                            atomicAdd(&gridWeightAtomic[cellIdx].y, i32(yWeight * SCALE));
                            atomicAdd(&gridWeightAtomic[cellIdx].z, i32(zWeight * SCALE));
                            atomicAdd(&gridWeightAtomic[cellIdx].w, i32(scalarWeight * SCALE));

                            // Accumulate weighted velocities
                            atomicAdd(&gridVelAtomic[cellIdx].x, i32(vel.x * xWeight * SCALE));
                            atomicAdd(&gridVelAtomic[cellIdx].y, i32(vel.y * yWeight * SCALE));
                            atomicAdd(&gridVelAtomic[cellIdx].z, i32(vel.z * zWeight * SCALE));
                        }
                    }
                }
            }

            // ============ MARK CELLS ============
            @compute @workgroup_size(64)
            fn markCells(@builtin(global_invocation_id) id: vec3<u32>) {
                let pIdx = id.x;
                if (pIdx >= uniforms.particleCount) { return; }

                let pos = positions[pIdx].xyz;
                let g = worldToGrid(pos);

                let cellX = u32(clamp(i32(floor(g.x)), 0, i32(uniforms.nx) - 1));
                let cellY = u32(clamp(i32(floor(g.y)), 0, i32(uniforms.ny) - 1));
                let cellZ = u32(clamp(i32(floor(g.z)), 0, i32(uniforms.nz) - 1));

                let si = scalarIdx(cellX, cellY, cellZ);
                marker[si] = 1u;
            }

            // ============ NORMALIZE GRID ============
            @compute @workgroup_size(8, 4, 4)
            fn normalizeGrid(@builtin(global_invocation_id) id: vec3<u32>) {
                if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
                let vi = velIdx(id.x, id.y, id.z);

                let wx = f32(atomicLoad(&gridWeightAtomic[vi].x)) / SCALE;
                let wy = f32(atomicLoad(&gridWeightAtomic[vi].y)) / SCALE;
                let wz = f32(atomicLoad(&gridWeightAtomic[vi].z)) / SCALE;
                let ws = f32(atomicLoad(&gridWeightAtomic[vi].w)) / SCALE;

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

                gridVel[vi] = vec4<f32>(vx, vy, vz, ws);
                gridVelOrig[vi] = vec4<f32>(vx, vy, vz, ws);
            }

            // ============ ADD GRAVITY AND MOUSE FORCE ============
            @compute @workgroup_size(8, 4, 4)
            fn addGravity(@builtin(global_invocation_id) id: vec3<u32>) {
                if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
                let vi = velIdx(id.x, id.y, id.z);

                // Apply gravity to all cells (matches WebGL)
                gridVel[vi].y -= uniforms.gravity * uniforms.dt;

                // Apply mouse force (matches WebGL addforce.frag)
                // MAC grid staggered positions for velocity components
                let xPosition = vec3<f32>(f32(id.x), f32(id.y) + 0.5, f32(id.z) + 0.5);
                let yPosition = vec3<f32>(f32(id.x) + 0.5, f32(id.y), f32(id.z) + 0.5);
                let zPosition = vec3<f32>(f32(id.x) + 0.5, f32(id.y) + 0.5, f32(id.z));

                let kernelX = mouseKernel(xPosition);
                let kernelY = mouseKernel(yPosition);
                let kernelZ = mouseKernel(zPosition);

                // Force multiplier: 3.0 * smoothstep(0.0, 1/200, timeStep)
                let forceMultiplier = 3.0 * smoothstep(0.0, 1.0 / 200.0, uniforms.dt);

                gridVel[vi].x += uniforms.mouseVelocity.x * kernelX * forceMultiplier;
                gridVel[vi].y += uniforms.mouseVelocity.y * kernelY * forceMultiplier;
                gridVel[vi].z += uniforms.mouseVelocity.z * kernelZ * forceMultiplier;
            }

            // ============ ENFORCE BOUNDARY ============
            @compute @workgroup_size(8, 4, 4)
            fn enforceBoundary(@builtin(global_invocation_id) id: vec3<u32>) {
                if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
                let vi = velIdx(id.x, id.y, id.z);

                // Solid walls (matching WebGL enforceboundaries.frag)
                if (id.x == 0u) { gridVel[vi].x = 0.0; }
                if (id.x == uniforms.nx) { gridVel[vi].x = 0.0; }
                if (id.y == 0u) { gridVel[vi].y = 0.0; }
                if (id.y == uniforms.ny) { gridVel[vi].y = min(gridVel[vi].y, 0.0); }
                if (id.z == 0u) { gridVel[vi].z = 0.0; }
                if (id.z == uniforms.nz) { gridVel[vi].z = 0.0; }
            }

            // ============ COMPUTE DIVERGENCE ============
            @compute @workgroup_size(8, 4, 4)
            fn computeDivergence(@builtin(global_invocation_id) id: vec3<u32>) {
                if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }
                let si = scalarIdx(id.x, id.y, id.z);

                if (marker[si] == 0u) {
                    divergence[si] = 0.0;
                    return;
                }

                // Sample velocities at face centers (MAC grid)
                // Left face X velocity at (i, j+0.5, k+0.5) -> velIdx(i, j, k)
                // Right face X velocity at (i+1, j+0.5, k+0.5) -> velIdx(i+1, j, k)
                let leftX = gridVel[velIdx(id.x, id.y, id.z)].x;
                let rightX = gridVel[velIdx(id.x + 1u, id.y, id.z)].x;

                let bottomY = gridVel[velIdx(id.x, id.y, id.z)].y;
                let topY = gridVel[velIdx(id.x, id.y + 1u, id.z)].y;

                let backZ = gridVel[velIdx(id.x, id.y, id.z)].z;
                let frontZ = gridVel[velIdx(id.x, id.y, id.z + 1u)].z;

                var div = (rightX - leftX) + (topY - bottomY) + (frontZ - backZ);

                // Volume conservation: use scalar weight (w component)
                let density = gridVel[velIdx(id.x, id.y, id.z)].w;
                div -= max((density - uniforms.particleDensity) * 1.0, 0.0);

                divergence[si] = div;
            }

            // ============ JACOBI PRESSURE SOLVE ============
            @compute @workgroup_size(8, 4, 4)
            fn jacobi(@builtin(global_invocation_id) id: vec3<u32>) {
                if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }
                let si = scalarIdx(id.x, id.y, id.z);

                if (marker[si] == 0u) { return; }

                let div = divergence[si];

                // Sample neighbor pressures
                var pL = 0.0; var pR = 0.0; var pB = 0.0; var pT = 0.0; var pBk = 0.0; var pFr = 0.0;

                if (id.x > 0u) { pL = pressure[scalarIdx(id.x - 1u, id.y, id.z)]; }
                if (id.x < uniforms.nx - 1u) { pR = pressure[scalarIdx(id.x + 1u, id.y, id.z)]; }
                if (id.y > 0u) { pB = pressure[scalarIdx(id.x, id.y - 1u, id.z)]; }
                if (id.y < uniforms.ny - 1u) { pT = pressure[scalarIdx(id.x, id.y + 1u, id.z)]; }
                if (id.z > 0u) { pBk = pressure[scalarIdx(id.x, id.y, id.z - 1u)]; }
                if (id.z < uniforms.nz - 1u) { pFr = pressure[scalarIdx(id.x, id.y, id.z + 1u)]; }

                pressure[si] = (pL + pR + pB + pT + pBk + pFr - div) / 6.0;
            }

            // ============ APPLY PRESSURE GRADIENT (subtract.frag) ============
            @compute @workgroup_size(8, 4, 4)
            fn applyPressure(@builtin(global_invocation_id) id: vec3<u32>) {
                if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
                let vi = velIdx(id.x, id.y, id.z);

                var v = gridVel[vi];

                // For X velocity at face (i, j+0.5, k+0.5):
                // gradient = pressure[i,j,k] - pressure[i-1,j,k]
                let pRight = pressure[scalarIdx(id.x, id.y, id.z)];
                let pLeft = pressure[scalarIdx(id.x - 1u, id.y, id.z)];
                v.x -= (pRight - pLeft);

                // For Y velocity at face (i+0.5, j, k+0.5):
                // gradient = pressure[i,j,k] - pressure[i,j-1,k]
                let pTop = pressure[scalarIdx(id.x, id.y, id.z)];
                let pBottom = pressure[scalarIdx(id.x, id.y - 1u, id.z)];
                v.y -= (pTop - pBottom);

                // For Z velocity at face (i+0.5, j+0.5, k):
                // gradient = pressure[i,j,k] - pressure[i,j,k-1]
                let pFront = pressure[scalarIdx(id.x, id.y, id.z)];
                let pBack = pressure[scalarIdx(id.x, id.y, id.z - 1u)];
                v.z -= (pFront - pBack);

                gridVel[vi] = v;
            }

            // ============ STAGGERED VELOCITY SAMPLING ============
            // Sample X velocity: stored at (i, j+0.5, k+0.5)
            fn sampleXVelocity(g: vec3<f32>) -> f32 {
                // Shift to X-face coordinates
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
                            v += gridVel[velIdx(ix, iy, iz)].x * w;
                        }
                    }
                }
                return v;
            }

            // Sample Y velocity: stored at (i+0.5, j, k+0.5)
            fn sampleYVelocity(g: vec3<f32>) -> f32 {
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

            // Sample Z velocity: stored at (i+0.5, j+0.5, k)
            fn sampleZVelocity(g: vec3<f32>) -> f32 {
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

            fn sampleVelocity(p: vec3<f32>) -> vec3<f32> {
                let g = worldToGrid(p);
                return vec3<f32>(sampleXVelocity(g), sampleYVelocity(g), sampleZVelocity(g));
            }

            // Same for original velocity grid
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
                            v += gridVelOrig[velIdx(ix, iy, iz)].x * w;
                        }
                    }
                }
                return v;
            }

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

            fn sampleVelocityOrig(p: vec3<f32>) -> vec3<f32> {
                let g = worldToGrid(p);
                return vec3<f32>(sampleXVelocityOrig(g), sampleYVelocityOrig(g), sampleZVelocityOrig(g));
            }

            // ============ GRID TO PARTICLE (G2P) ============
            @compute @workgroup_size(64)
            fn gridToParticle(@builtin(global_invocation_id) id: vec3<u32>) {
                let pIdx = id.x;
                if (pIdx >= uniforms.particleCount) { return; }

                let pos = positions[pIdx].xyz;
                let velOld = velocities[pIdx].xyz;

                let vGridNew = sampleVelocity(pos);
                let vGridOld = sampleVelocityOrig(pos);

                // FLIP: particle velocity + grid velocity change
                let vFlip = velOld + (vGridNew - vGridOld);
                // PIC: just use grid velocity
                let vPic = vGridNew;
                // Blend
                let vNew = mix(vPic, vFlip, uniforms.fluidity);

                velocities[pIdx] = vec4<f32>(vNew, 0.0);
            }

            // ============ ADVECT PARTICLES ============
            @compute @workgroup_size(64)
            fn advect(@builtin(global_invocation_id) id: vec3<u32>) {
                let pIdx = id.x;
                if (pIdx >= uniforms.particleCount) { return; }

                var pos = positions[pIdx].xyz;

                // RK2 advection
                let v1 = sampleVelocity(pos);
                let midPos = pos + v1 * uniforms.dt * 0.5;
                let v2 = sampleVelocity(midPos);

                var step = v2 * uniforms.dt;

                // Turbulence using pre-computed random directions (matching WebGL)
                // WebGL: fract(v_coordinates + u_frameNumber / u_particlesResolution)
                // We simulate this by offsetting the index based on frame number
                let offset = u32(uniforms.frameNumber) % uniforms.particleCount;
                let randomIdx = (pIdx + offset) % uniforms.particleCount;
                let randomDir = randomDirs[randomIdx].xyz;
                step += TURBULENCE * randomDir * length(v1) * uniforms.dt;

                pos += step;

                // Clamp to bounds (same as WebGL)
                let eps = 0.01;
                pos = clamp(pos, vec3<f32>(eps), vec3<f32>(uniforms.width - eps, uniforms.height - eps, uniforms.depth - eps));

                positions[pIdx] = vec4<f32>(pos, 1.0);
            }
        `}),w=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:6,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:7,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:8,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:9,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:10,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}}]}),S=e.createPipelineLayout({bindGroupLayouts:[w]}),v=B=>e.createComputePipeline({layout:S,compute:{module:P,entryPoint:B}});this.clearGridPipeline=v("clearGrid"),this.transferToGridPipeline=v("transferToGrid"),this.normalizeGridPipeline=v("normalizeGrid"),this.markCellsPipeline=v("markCells"),this.addGravityPipeline=v("addGravity"),this.enforceBoundaryPipeline=v("enforceBoundary"),this.divergencePipeline=v("computeDivergence"),this.jacobiPipeline=v("jacobi"),this.applyPressurePipeline=v("applyPressure"),this.gridToParticlePipeline=v("gridToParticle"),this.advectPipeline=v("advect"),this.simBindGroup=e.createBindGroup({layout:w,entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:{buffer:a}},{binding:2,resource:{buffer:r}},{binding:3,resource:{buffer:this.gridVelocityBuffer}},{binding:4,resource:{buffer:this.gridWeightBuffer}},{binding:5,resource:{buffer:this.gridVelocityFloatBuffer}},{binding:6,resource:{buffer:this.gridVelocityOrigBuffer}},{binding:7,resource:{buffer:this.gridMarkerBuffer}},{binding:8,resource:{buffer:this.pressureBuffer}},{binding:9,resource:{buffer:this.pressureTempBuffer}},{binding:10,resource:{buffer:s}}]}),this.simBindGroupAlt=this.simBindGroup,this.updateUniforms(0,.99,40,10,[0,0,0],[0,0,0],[0,0,1])}updateUniforms(e,i,o,n,l,f,x){const a=new ArrayBuffer(112),r=new Uint32Array(a),s=new Float32Array(a);r[0]=this.nx,r[1]=this.ny,r[2]=this.nz,r[3]=e,s[4]=this.gridWidth,s[5]=this.gridHeight,s[6]=this.gridDepth,s[7]=1/60,s[8]=this.frameNumber,s[9]=i,s[10]=o,s[11]=n,s[12]=l[0],s[13]=l[1],s[14]=l[2],s[15]=0,s[16]=f[0],s[17]=f[1],s[18]=f[2],s[19]=0,s[20]=x[0],s[21]=x[1],s[22]=x[2],s[23]=0,this.device.queue.writeBuffer(this.uniformBuffer,0,a),this.frameNumber++}step(e,i,o,n,l,f,x,a){this.updateUniforms(i,o,n,l,f,x,a);const r=[Math.ceil((this.nx+1)/8),Math.ceil((this.ny+1)/4),Math.ceil((this.nz+1)/4)],s=[Math.ceil(this.nx/8),Math.ceil(this.ny/4),Math.ceil(this.nz/4)],u=Math.ceil(i/64);e.setBindGroup(0,this.simBindGroup),e.setPipeline(this.clearGridPipeline),e.dispatchWorkgroups(r[0],r[1],r[2]),e.setPipeline(this.transferToGridPipeline),e.dispatchWorkgroups(u),e.setPipeline(this.markCellsPipeline),e.dispatchWorkgroups(u),e.setPipeline(this.normalizeGridPipeline),e.dispatchWorkgroups(r[0],r[1],r[2]),e.setPipeline(this.addGravityPipeline),e.dispatchWorkgroups(r[0],r[1],r[2]),e.setPipeline(this.enforceBoundaryPipeline),e.dispatchWorkgroups(r[0],r[1],r[2]),e.setPipeline(this.divergencePipeline),e.dispatchWorkgroups(s[0],s[1],s[2]);for(let m=0;m<50;m++)e.setPipeline(this.jacobiPipeline),e.dispatchWorkgroups(s[0],s[1],s[2]);e.setPipeline(this.applyPressurePipeline),e.dispatchWorkgroups(r[0],r[1],r[2]),e.setPipeline(this.enforceBoundaryPipeline),e.dispatchWorkgroups(r[0],r[1],r[2]),e.setPipeline(this.gridToParticlePipeline),e.dispatchWorkgroups(u),e.setPipeline(this.advectPipeline),e.dispatchWorkgroups(u)}}function tt(t){const e=Math.round(Math.pow(t[0],.45454545454545453)*255),i=Math.round(Math.pow(t[1],1/2.2)*255),o=Math.round(Math.pow(t[2],1/2.2)*255);return"#"+[e,i,o].map(n=>n.toString(16).padStart(2,"0")).join("")}function di(t){const e=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(t);return e?[Math.pow(parseInt(e[1],16)/255,2.2),Math.pow(parseInt(e[2],16)/255,2.2),Math.pow(parseInt(e[3],16)/255,2.2)]:[0,0,0]}async function ui(){if(!navigator.gpu){alert("WebGPU is not supported in this browser.");return}const t=await navigator.gpu.requestAdapter();if(!t){alert("No appropriate GPU adapter found.");return}const e=await t.requestDevice({requiredLimits:{maxStorageBuffersPerShaderStage:10}}),i=document.getElementById("canvas"),o=i.getContext("webgpu"),n=window.devicePixelRatio||1;i.width=window.innerWidth*n,i.height=window.innerHeight*n;const l=navigator.gpu.getPreferredCanvasFormat();o.configure({device:e,format:l,alphaMode:"premultiplied"});let f=e.createTexture({size:[i.width,i.height],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT});const x=.22,a={particleRadius:.12,spacingFactor:3,boxWidth:24,boxHeight:10,boxDepth:15,particleCount:35e3,fluidity:.99,showWireframe:!0},r={boxWidth:a.boxWidth,boxHeight:a.boxHeight,boxDepth:a.boxDepth},s=()=>a.particleRadius/x,u=()=>-r.boxWidth/2,m=()=>0,h=()=>-r.boxDepth/2,y=()=>r.boxWidth,P=()=>r.boxHeight,w=()=>r.boxDepth,S=32,v=16,B=16,b=new si(i,[0,0,0]),T=new li(e,l,[a.boxWidth,a.boxHeight,a.boxDepth]),C=2e5,U=e.createBuffer({size:C*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),G=e.createBuffer({size:C*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),j=e.createBuffer({size:C*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),V=new Float32Array(C*4);for(let c=0;c<C;c++){const M=Math.random()*2*Math.PI,E=Math.random()*2-1;V[c*4+0]=Math.sqrt(1-E*E)*Math.cos(M),V[c*4+1]=Math.sqrt(1-E*E)*Math.sin(M),V[c*4+2]=E,V[c*4+3]=0}e.queue.writeBuffer(j,0,V);const O=new ci(e,S,v,B,y(),P(),w(),U,G,j),k=jt(2),L=e.createBuffer({size:k.vertices.byteLength,usage:GPUBufferUsage.VERTEX,mappedAtCreation:!0});new Float32Array(L.getMappedRange()).set(k.vertices),L.unmap();const N=e.createBuffer({size:k.normals.byteLength,usage:GPUBufferUsage.VERTEX,mappedAtCreation:!0});new Float32Array(N.getMappedRange()).set(k.normals),N.unmap();const W=e.createBuffer({size:k.indices.byteLength,usage:GPUBufferUsage.INDEX,mappedAtCreation:!0});new Uint16Array(W.getMappedRange()).set(k.indices),W.unmap();const A=jt(1),_=e.createBuffer({size:A.vertices.byteLength,usage:GPUBufferUsage.VERTEX,mappedAtCreation:!0});new Float32Array(_.getMappedRange()).set(A.vertices),_.unmap();const D=e.createBuffer({size:A.indices.byteLength,usage:GPUBufferUsage.INDEX,mappedAtCreation:!0});new Uint16Array(D.getMappedRange()).set(A.indices),D.unmap();const de=1024;let H=e.createTexture({size:[i.width,i.height],format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),te=e.createTexture({size:[i.width,i.height],format:"r16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),ie=e.createTexture({size:[i.width,i.height],format:l,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});const ge=e.createTexture({size:[de,de],format:"depth32float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});let ae=f.createView(),he=H.createView(),Ue=te.createView(),be=ie.createView();const Re=ge.createView(),we=e.createSampler({magFilter:"linear",minFilter:"linear"}),Oe=e.createSampler({magFilter:"linear",minFilter:"linear",compare:"less"}),d={dirToSun:[-.83,.42,-.36],floorY:0,skyColorHorizon:[1,1,1],sunPower:500,skyColorZenith:[.08,.37,.73],sunBrightness:1,skyColorGround:[.55,.5,.55],floorSize:100,tileCol1:[.20392157,.5176471,.7764706],tileScale:1,tileCol2:[.6081319,.36850303,.8584906],tileDarkFactor:-.35,tileCol3:[.3019758,.735849,.45801795],tileCol4:[.8018868,.6434483,.36690104]},ke={paused:!1,showStats:!1},se=new ai({horizontal:!0});if(se.dom.style.position="fixed",se.dom.style.bottom="0px",se.dom.style.left="0px",se.dom.style.display="none",document.body.appendChild(se.dom),!document.querySelector('link[href*="Material+Icons"]')){const c=document.createElement("link");c.href="https://fonts.googleapis.com/icon?family=Material+Icons",c.rel="stylesheet",document.head.appendChild(c)}const vt=document.createElement("style");vt.textContent=`
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
    `,document.head.appendChild(vt);const le=document.createElement("div");le.id="gui-container",window.innerWidth<=480&&le.classList.add("collapsed"),document.body.appendChild(le);const _e=document.createElement("div");_e.className="gui-header-main",le.appendChild(_e);const De=document.createElement("button");De.className="gui-toggle-btn",De.innerHTML='<span class="material-icons">menu</span>',_e.appendChild(De);const Fe=document.createElement("div");Fe.className="gui-title-area",_e.appendChild(Fe);const it=document.createElement("span");it.style.cssText=`
        font-size: 16px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    `,it.textContent="WebGPU 3D Fluid",Fe.appendChild(it);const Z=document.createElement("a");Z.href="https://github.com/jeantimex/fluid",Z.target="_blank",Z.rel="noopener noreferrer",Z.title="View on GitHub",Z.style.cssText=`
        display: flex;
        align-items: center;
        color: #fff;
        opacity: 0.7;
        transition: opacity 0.2s;
        margin-left: 10px;
    `,Z.onpointerenter=()=>Z.style.opacity="1",Z.onpointerleave=()=>Z.style.opacity="0.7",Z.innerHTML=`
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
    `,Fe.appendChild(Z);const Le=document.createElement("div");Le.className="gui-content-wrapper",le.appendChild(Le);const Yt=c=>{c&&c.stopPropagation(),le.classList.toggle("collapsed")};De.onclick=Yt,le.onclick=()=>{le.classList.contains("collapsed")&&le.classList.remove("collapsed")};const Ee=document.createElement("div");Ee.className="custom-gui-folder",Ee.style.cssText=`
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.02);
    `;const Pe=document.createElement("div");Pe.className="custom-gui-folder-header",Pe.style.cssText=`
        display: flex;
        align-items: center;
        padding: 1px;
        cursor: pointer;
        user-select: none;
        font-size: 11px;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.9);
    `,Pe.innerHTML=`
        <span class="material-icons folder-arrow" style="
            font-family: 'Material Icons';
            font-size: 16px;
            transition: transform 0.2s;
            transform: rotate(90deg);
            text-transform: none;
        ">chevron_right</span>
        About
    `;const R=document.createElement("div");R.className="custom-gui-folder-content",R.style.cssText=`
        overflow: hidden;
        max-height: none;
        transition: max-height 0.3s ease-out;
    `;let rt=!0;Pe.onclick=()=>{R.style.maxHeight==="none"&&(R.style.maxHeight=R.scrollHeight+"px",R.offsetHeight),rt=!rt;const c=Pe.querySelector(".folder-arrow");rt?(c.style.transform="rotate(90deg)",R.style.maxHeight=R.scrollHeight+"px"):(c.style.transform="rotate(0deg)",R.style.maxHeight="0")};const ot=document.createElement("div");ot.style.cssText=`
        padding: 5px 11px 5px 11px;
        font-size: 11px;
        font-weight: 400;
        opacity: 0.6;
        line-height: 1.4;
        letter-spacing: 0.01em;
        white-space: normal;
        overflow-wrap: break-word;
        max-width: 220px;
    `,ot.textContent="FLIP Fluid • Particle Simulation",R.appendChild(ot);const nt=document.createElement("div");nt.style.cssText=`
        padding: 0 11px 10px 11px;
        font-size: 10px;
        font-weight: 400;
        opacity: 1.0;
        letter-spacing: 0.01em;
    `,nt.innerHTML='Original Author: <a href="https://github.com/dli/fluid" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">David Li</a>',R.appendChild(nt);const at=document.createElement("div");at.style.cssText=`
        padding: 0 11px 10px 11px;
        font-size: 10px;
        font-weight: 400;
        opacity: 1.0;
        letter-spacing: 0.01em;
    `,at.innerHTML='WebGPU Author: <a href="https://github.com/jeantimex" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">jeantimex</a>',R.appendChild(at);const Ne=document.createElement("div");Ne.style.cssText=`
        padding: 5px 11px 10px 11px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    `;const st=document.createElement("div");st.style.cssText=`
        font-size: 10px;
        font-weight: 600;
        opacity: 0.8;
        text-transform: uppercase;
        margin-bottom: 4px;
    `,st.textContent="Features:",Ne.appendChild(st);const lt=document.createElement("ul");lt.style.cssText=`
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
    `,["FLIP Fluid Simulator (GPU)","Deferred Rendering Pipeline","Dynamic Shadow Mapping","Screen-Space Ambient Occlusion","FXAA Anti-Aliasing","Mouse Interaction"].forEach(c=>{const M=document.createElement("li");M.textContent=c,lt.appendChild(M)}),Ne.appendChild(lt),R.appendChild(Ne);const We=document.createElement("div");We.style.cssText=`
        padding: 5px 11px 10px 11px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    `;const ct=document.createElement("div");ct.style.cssText=`
        font-size: 10px;
        font-weight: 600;
        opacity: 0.8;
        text-transform: uppercase;
        margin-bottom: 4px;
    `,ct.textContent="Interactions:",We.appendChild(ct);const dt=document.createElement("ul");dt.style.cssText=`
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
    `,["Click & Drag: Orbit Camera","Mouse Move: Push Particles","Mouse Wheel: Zoom In/Out"].forEach(c=>{const M=document.createElement("li");M.textContent=c,dt.appendChild(M)}),We.appendChild(dt),R.appendChild(We),Ee.appendChild(Pe),Ee.appendChild(R),Le.appendChild(Ee);const Se=new ni({container:Le,title:"Simulation Settings"}),Me=Se.addFolder("Simulation"),yt={particleCount:0},Ht=Me.add(yt,"particleCount").name("Particle Count").disable();Me.add(a,"particleRadius",.05,.5,.01).name("Particle Radius").onChange(()=>{$e()}),Me.add(a,"spacingFactor",1,10,.1).name("Spacing Factor").onChange($e),Me.add(a,"fluidity",.5,.99,.01).name("Fluidity"),Me.add(a,"particleCount",1e3,C,1e3).name("Target Count").onFinishChange(()=>{Ae.reset()}),Me.close();const Ge=Se.addFolder("Container");Ge.add(a,"boxWidth",10,100,1).name("Box Width"),Ge.add(a,"boxHeight",5,50,1).name("Box Height"),Ge.add(a,"boxDepth",5,50,1).name("Box Depth"),Ge.add(a,"showWireframe").name("Show Wireframe"),Ge.close();const xe=Se.addFolder("Environment"),Xe={tileCol1:tt(d.tileCol1),tileCol2:tt(d.tileCol2),tileCol3:tt(d.tileCol3),tileCol4:tt(d.tileCol4)},je=c=>M=>{const E=di(M);d[c][0]=E[0],d[c][1]=E[1],d[c][2]=E[2]};xe.addColor(Xe,"tileCol1").name("Tile Color 1").onChange(je("tileCol1")),xe.addColor(Xe,"tileCol2").name("Tile Color 2").onChange(je("tileCol2")),xe.addColor(Xe,"tileCol3").name("Tile Color 3").onChange(je("tileCol3")),xe.addColor(Xe,"tileCol4").name("Tile Color 4").onChange(je("tileCol4")),xe.add(d,"sunBrightness",0,3,.1).name("Sun Brightness"),xe.add(d,"tileDarkFactor",-1,0,.05).name("Tile Dark Factor"),xe.close();const bt=Se.addFolder("Performance");bt.add(ke,"showStats").name("Show FPS").onChange(c=>{se.dom.style.display=c?"block":"none"}),bt.close();let ut=null;const Ae={togglePause:()=>{ke.paused=!ke.paused,ut&&ut.name(ke.paused?"Resume":"Pause")},reset:()=>{}};ut=Se.add(Ae,"togglePause").name("Pause"),Se.add(Ae,"reset").name("Reset Simulation"),window.addEventListener("keydown",c=>{c.target instanceof HTMLInputElement||c.target instanceof HTMLTextAreaElement||(c.key==="p"||c.key==="P")&&Ae.togglePause()});const ft=d.dirToSun,Ye=50,Zt=[ft[0]*Ye,ft[1]*Ye,ft[2]*Ye],qt=z.makeLookAtMatrix(new Float32Array(16),Zt,[0,0,0],[0,1,0]),He=40,Kt=z.makeOrthographicMatrixWebGPU(new Float32Array(16),-He,He,-He,He,.1,Ye*2),pt=new Float32Array(16);z.premultiplyMatrix(pt,qt,Kt);const wt=e.createShaderModule({code:`
            struct Uniforms {
                projectionMatrix: mat4x4<f32>,
                viewMatrix: mat4x4<f32>,
                sphereRadius: f32,
                positionScale: f32,
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
                let spherePos = positions[instanceIndex].xyz * uniforms.positionScale;
                let velocity = velocities[instanceIndex].xyz;
                let simOffset = vec3<f32>(uniforms.simOffsetX, uniforms.simOffsetY, uniforms.simOffsetZ);
                let worldPos = vertexPos * uniforms.sphereRadius + spherePos + simOffset;
                let viewPos = uniforms.viewMatrix * vec4<f32>(worldPos, 1.0);

                var out: VertexOutput;
                out.position = uniforms.projectionMatrix * viewPos;
                out.viewSpaceNormal = (uniforms.viewMatrix * vec4<f32>(vertexNormal, 0.0)).xyz;
                out.viewSpaceZ = viewPos.z;
                out.speed = length(velocity);
                return out;
            }

            @fragment
            fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
                let n = normalize(in.viewSpaceNormal);
                return vec4<f32>(n.x, n.y, in.speed, in.viewSpaceZ);
            }
        `}),Pt=e.createShaderModule({code:`
            struct Uniforms {
                projectionViewMatrix: mat4x4<f32>,
                sphereRadius: f32,
                positionScale: f32,
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
                return uniforms.projectionViewMatrix * vec4<f32>(worldPos, 1.0);
            }

            @fragment
            fn fs_main() {}
        `}),St=e.createShaderModule({code:`
            struct Uniforms {
                inverseViewMatrix: mat4x4<f32>,
                lightProjectionViewMatrix: mat4x4<f32>,
                resolution: vec2<f32>,
                fov: f32,
                shadowResolution: f32,
                // Camera position for ray casting
                cameraPos: vec3<f32>,
                _pad0: f32,
                // Scene parameters
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
                let K = vec4<f32>(0.0, -1.0/3.0, 2.0/3.0, -1.0);
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

            fn linearToSrgb(c: vec3<f32>) -> vec3<f32> { return pow(c, vec3<f32>(1.0/2.2)); }

            fn hashInt2(v: vec2<i32>) -> u32 { return u32(v.x) * 5023u + u32(v.y) * 96456u; }

            fn randomValue(state: ptr<function, u32>) -> f32 {
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

            // Sample shadow map with PCF for soft shadows
            fn sampleFloorShadow(worldPos: vec3<f32>) -> f32 {
                var lightSpacePos = uniforms.lightProjectionViewMatrix * vec4<f32>(worldPos, 1.0);
                lightSpacePos = lightSpacePos / lightSpacePos.w;
                // Note: Y is flipped for WebGPU texture coordinates
                let lightCoords = vec2<f32>(lightSpacePos.x * 0.5 + 0.5, 0.5 - lightSpacePos.y * 0.5);
                let lightDepth = lightSpacePos.z;

                // PCF shadow sampling (3x3 kernel)
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

                // Return no shadow (1.0) if outside light frustum bounds
                let inBounds = lightCoords.x >= 0.0 && lightCoords.x <= 1.0 &&
                               lightCoords.y >= 0.0 && lightCoords.y <= 1.0 &&
                               lightDepth >= 0.0 && lightDepth <= 1.0;
                return select(1.0, shadow, inBounds);
            }

            fn getSceneBackground(rayDir: vec3<f32>, floorShadow: f32) -> vec3<f32> {
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

                        // Random variation per tile
                        var rngState = hashInt2(vec2<i32>(i32(tileCoord.x), i32(tileCoord.y)));
                        let rv = randomSNorm3(&rngState) * vec3<f32>(0.2, 0.0, 0.73) * 0.1;
                        tileCol = tweakHsv(tileCol, rv);

                        // Checkerboard pattern
                        let isDarkTile = modulo(tileCoord.x, 2.0) == modulo(tileCoord.y, 2.0);
                        if (isDarkTile) {
                            tileCol = tweakHsv(tileCol, vec3<f32>(0.0, 0.0, uniforms.tileDarkFactor));
                        }

                        // Apply particle shadow to floor (passed in from uniform control flow)
                        let ambient = 0.4;  // Ambient light in shadow
                        let shadowFactor = ambient + (1.0 - ambient) * floorShadow;
                        tileCol *= shadowFactor;

                        return tileCol;
                    }
                }

                return getSkyColor(rayDir);
            }

            @fragment
            fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
                let data = textureSample(gBufferTex, linearSamp, in.uv);
                let occlusion = textureSample(occlusionTex, linearSamp, in.uv).r;

                let speed = data.b;
                let viewSpaceZ = data.a;

                let nx = data.r;
                let ny = data.g;
                let nz = sqrt(max(0.0, 1.0 - nx * nx - ny * ny));

                let tanHalfFov = tan(uniforms.fov / 2.0);
                let viewRay = vec3<f32>(
                    (in.uv.x * 2.0 - 1.0) * tanHalfFov * uniforms.resolution.x / uniforms.resolution.y,
                    (1.0 - 2.0 * in.uv.y) * tanHalfFov,
                    -1.0
                );
                let viewSpacePos = viewRay * max(-viewSpaceZ, 0.01);
                let worldSpacePos = (uniforms.inverseViewMatrix * vec4<f32>(viewSpacePos, 1.0)).xyz;

                // Shadow calculation with PCF
                var lightSpacePos = uniforms.lightProjectionViewMatrix * vec4<f32>(worldSpacePos, 1.0);
                lightSpacePos = lightSpacePos / lightSpacePos.w;
                // Note: Y is flipped for WebGPU texture coordinates
                let lightCoords = vec2<f32>(lightSpacePos.x * 0.5 + 0.5, 0.5 - lightSpacePos.y * 0.5);
                let lightDepth = lightSpacePos.z;

                var shadow = 0.0;
                let texelSize = 1.0 / uniforms.shadowResolution;
                for (var x = -1; x <= 1; x++) {
                    for (var y = -1; y <= 1; y++) {
                        let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
                        shadow += textureSampleCompare(shadowTex, shadowSamp, lightCoords + offset, lightDepth - 0.002);
                    }
                }
                shadow /= 9.0;

                let isBackground = speed < 0.0 || viewSpaceZ > -0.01;

                // Compute ray direction for background
                let rayDirNorm = normalize((uniforms.inverseViewMatrix * vec4<f32>(viewRay, 0.0)).xyz);

                // Compute floor shadow in uniform control flow (before any conditionals)
                let floorT = rayPlaneIntersect(uniforms.cameraPos, rayDirNorm, uniforms.floorY);
                let floorHitPos = uniforms.cameraPos + rayDirNorm * max(floorT, 0.0);
                let floorShadow = sampleFloorShadow(floorHitPos);

                let bgColor = getSceneBackground(rayDirNorm, floorShadow);

                // Particle color from speed
                let hue = max(0.6 - speed * 0.0025, 0.52);
                var particleColor = hsvToRGB(vec3<f32>(hue, 0.75, 1.0));

                let clampedOcclusion = min(occlusion * 0.5, 1.0);
                let ambient = 1.0 - clampedOcclusion * 0.7;
                let direct = 1.0 - (1.0 - shadow) * 0.8;
                particleColor *= ambient * direct;

                let finalColor = select(particleColor, bgColor, isBackground);
                return vec4<f32>(finalColor, 1.0);
            }
        `}),Mt=e.createShaderModule({code:`
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
                let delta = 1.0 / uniforms.resolution;

                let rgbNW = textureSample(inputTex, linearSamp, in.uv + vec2<f32>(-1.0, -1.0) * delta).rgb;
                let rgbNE = textureSample(inputTex, linearSamp, in.uv + vec2<f32>(1.0, -1.0) * delta).rgb;
                let rgbSW = textureSample(inputTex, linearSamp, in.uv + vec2<f32>(-1.0, 1.0) * delta).rgb;
                let rgbSE = textureSample(inputTex, linearSamp, in.uv + vec2<f32>(1.0, 1.0) * delta).rgb;
                let rgbM = textureSample(inputTex, linearSamp, in.uv).rgb;

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

                let dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);
                let rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
                dir = min(vec2<f32>(FXAA_SPAN_MAX), max(vec2<f32>(-FXAA_SPAN_MAX), dir * rcpDirMin)) * delta;

                let rgbA = 0.5 * (
                    textureSample(inputTex, linearSamp, in.uv + dir * (1.0 / 3.0 - 0.5)).rgb +
                    textureSample(inputTex, linearSamp, in.uv + dir * (2.0 / 3.0 - 0.5)).rgb
                );
                let rgbB = rgbA * 0.5 + 0.25 * (
                    textureSample(inputTex, linearSamp, in.uv + dir * -0.5).rgb +
                    textureSample(inputTex, linearSamp, in.uv + dir * 0.5).rgb
                );
                let lumaB = dot(rgbB, luma);

                if (lumaB < lumaMin || lumaB > lumaMax) {
                    return vec4<f32>(rgbA, 1.0);
                } else {
                    return vec4<f32>(rgbB, 1.0);
                }
            }
        `}),Ct=e.createShaderModule({code:`
            struct Uniforms {
                projectionMatrix: mat4x4<f32>,
                viewMatrix: mat4x4<f32>,
                resolution: vec2<f32>,
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

                // Extrude sphere 3x for AO range (reduced for performance)
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
                let coords = in.position.xy / uniforms.resolution;
                let data = textureSample(gBufferTex, linearSamp, coords);

                let viewSpaceZ = data.a;
                if (viewSpaceZ > -0.01) { return 0.0; }

                // Reconstruct view space position
                let nx = data.r;
                let ny = data.g;
                let nz = sqrt(max(0.0, 1.0 - nx * nx - ny * ny));
                let viewSpaceNormal = vec3<f32>(nx, ny, nz);

                let tanHalfFov = tan(uniforms.fov / 2.0);
                let viewRay = vec3<f32>(
                    (coords.x * 2.0 - 1.0) * tanHalfFov * uniforms.resolution.x / uniforms.resolution.y,
                    (1.0 - 2.0 * coords.y) * tanHalfFov,  // Adjusted for WebGPU screen coords (Y=0 at top)
                    -1.0
                );
                let viewSpacePos = viewRay * -viewSpaceZ;

                // Calculate occlusion from this sphere
                let di = in.viewSpaceSpherePos - viewSpacePos;
                let l = length(di);
                if (l < 0.001) { return 0.0; }

                let nl = dot(viewSpaceNormal, di / l);
                let h = l / in.sphereRadius;
                let h2 = h * h;
                let k2 = 1.0 - h2 * nl * nl;

                var result = max(0.0, nl) / h2;

                if (k2 > 0.0 && l > in.sphereRadius) {
                    result = nl * acos(-nl * sqrt((h2 - 1.0) / (1.0 - nl * nl))) - sqrt(k2 * (h2 - 1.0));
                    result = result / h2 + atan(sqrt(k2 / (h2 - 1.0)));
                    result /= PI;
                }

                return result;
            }
        `}),zt=e.createRenderPipeline({layout:"auto",vertex:{module:wt,entryPoint:"vs_main",buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]},{arrayStride:12,attributes:[{shaderLocation:1,offset:0,format:"float32x3"}]}]},fragment:{module:wt,entryPoint:"fs_main",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list",cullMode:"back"},depthStencil:{depthWriteEnabled:!0,depthCompare:"less",format:"depth24plus"}}),Tt=e.createRenderPipeline({layout:"auto",vertex:{module:Pt,entryPoint:"vs_main",buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]}]},fragment:{module:Pt,entryPoint:"fs_main",targets:[]},primitive:{topology:"triangle-list",cullMode:"back"},depthStencil:{depthWriteEnabled:!0,depthCompare:"less",format:"depth32float"}}),Bt=e.createRenderPipeline({layout:"auto",vertex:{module:Ct,entryPoint:"vs_main",buffers:[{arrayStride:12,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]}]},fragment:{module:Ct,entryPoint:"fs_main",targets:[{format:"r16float",blend:{color:{srcFactor:"one",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}}}]},primitive:{topology:"triangle-list",cullMode:"back"},depthStencil:{depthWriteEnabled:!1,depthCompare:"less",format:"depth24plus"}}),Ut=e.createRenderPipeline({layout:"auto",vertex:{module:St,entryPoint:"vs_main"},fragment:{module:St,entryPoint:"fs_main",targets:[{format:l}]},primitive:{topology:"triangle-strip"}}),kt=e.createRenderPipeline({layout:"auto",vertex:{module:Mt,entryPoint:"vs_main"},fragment:{module:Mt,entryPoint:"fs_main",targets:[{format:l}]},primitive:{topology:"triangle-strip"}}),Ze=e.createBuffer({size:160,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),mt=e.createBuffer({size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),qe=e.createBuffer({size:192,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),Ke=e.createBuffer({size:320,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),Et=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),$t=e.createBindGroup({layout:zt.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:Ze}},{binding:1,resource:{buffer:U}},{binding:2,resource:{buffer:G}}]}),Jt=e.createBindGroup({layout:Tt.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:mt}},{binding:1,resource:{buffer:U}}]});let Gt,At,It;function Vt(){Gt=e.createBindGroup({layout:Bt.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:qe}},{binding:1,resource:{buffer:U}},{binding:2,resource:H.createView()},{binding:3,resource:we}]}),At=e.createBindGroup({layout:Ut.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:Ke}},{binding:1,resource:H.createView()},{binding:2,resource:te.createView()},{binding:3,resource:ge.createView()},{binding:4,resource:we},{binding:5,resource:Oe}]}),It=e.createBindGroup({layout:kt.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:Et}},{binding:1,resource:ie.createView()},{binding:2,resource:we}]})}Vt();let q=0;function $e(){const c=new Float32Array(C*4),M=new Float32Array(C*4),E=s();if(T.boxes.length>0){q=Math.min(a.particleCount,C);let ve=0;for(const I of T.boxes)ve+=I.computeVolume();const ye=a.spacingFactor*a.particleRadius,et=q*Math.pow(ye,3),Ie=Math.min(1,et/ve),ue=Math.pow(Ie,1/3);console.log(`Spawning ${q} particles (S: ${E.toFixed(3)}, Fill: ${(Ie*100).toFixed(1)}%)`);let fe=0;for(let I=0;I<T.boxes.length;I++){const X=T.boxes[I],Ce=X.computeVolume();let re;I<T.boxes.length-1?re=Math.floor(q*Ce/ve):re=q-fe;const ze=X.max[0]-X.min[0],ht=X.max[1]-X.min[1],Te=X.max[2]-X.min[2],Ve=ze*ue,Y=ht*ue,oe=Te*ue,pe=(ze-Ve)/2,J=0,ne=(Te-oe)/2,ce=Math.pow(re,1/3),p=Math.max(1,Math.round(ce*Math.pow(Ve/Y,1/3))),me=Math.max(1,Math.round(ce*Math.pow(Y/oe,1/3))),Be=Math.max(1,Math.ceil(re/(p*me)));for(let Q=0;Q<re;Q++){const ee=fe+Q,Qt=Q%p,ei=Math.floor(Q/p)%me,ti=Math.floor(Q/(p*me)),ii=X.min[0]+pe+(Qt+.5+(Math.random()-.5)*.5)*(Ve/p),ri=X.min[1]+J+(ei+.5+(Math.random()-.5)*.5)*(Y/me),oi=X.min[2]+ne+(ti+.5+(Math.random()-.5)*.5)*(oe/Be);c[ee*4+0]=ii-u(),c[ee*4+1]=ri-m(),c[ee*4+2]=oi-h(),c[ee*4+3]=1,M[ee*4+0]=0,M[ee*4+1]=0,M[ee*4+2]=0,M[ee*4+3]=0}fe+=re}e.queue.writeBuffer(U,0,c),e.queue.writeBuffer(G,0,M)}yt.particleCount=q,Ht.updateDisplay()}$e(),Ae.reset=()=>{$e(),console.log("Simulation reset")};const Je=new Float32Array(16),Qe=Math.PI/3;function Rt(){const c=i.width/i.height;z.makePerspectiveMatrix(Je,Qe,c,.1,100)}Rt();let Ot=0,_t=0,Dt=0,Ft=0;i.addEventListener("pointerdown",c=>{c.preventDefault(),b.onMouseDown(c)}),document.addEventListener("pointerup",c=>{c.preventDefault(),b.onMouseUp()}),i.addEventListener("pointermove",c=>{c.preventDefault();const M=z.getMousePosition(c,i),E=i.getBoundingClientRect(),ve=M.x/E.width,ye=M.y/E.height;Ot=ve*2-1,_t=(1-ye)*2-1,b.onMouseMove(c)}),console.log("WebGPU Initialized with Particles");const K=new Float32Array(8);K[0]=a.particleRadius,K[1]=1,K[2]=u(),K[3]=m(),K[4]=h();const $=new Float32Array(8);$[0]=a.particleRadius,$[1]=1,$[2]=u(),$[3]=m(),$[4]=h();const F=new Float32Array(12);F[3]=a.particleRadius,F[4]=1,F[5]=u(),F[6]=m(),F[7]=h();const g=new Float32Array(40),gt=new Float32Array(2);function Lt(){se.begin();const c=e.createCommandEncoder(),M=.1;r.boxWidth+=(a.boxWidth-r.boxWidth)*M,r.boxHeight+=(a.boxHeight-r.boxHeight)*M,r.boxDepth+=(a.boxDepth-r.boxDepth)*M,O.gridWidth=y(),O.gridHeight=P(),O.gridDepth=w();const E=Math.tan(Qe/2),ve=i.width/i.height,ye=[Ot*E*ve,_t*E,-1],et=ye[0]*b.distance,Ie=ye[1]*b.distance;let ue=et-Dt,fe=Ie-Ft;b.isMouseDown()&&(ue=0,fe=0),Dt=et,Ft=Ie;const I=b.getViewMatrix(),X=z.invertMatrix(new Float32Array(16),I)||new Float32Array(16),Ce=[0,0,0];z.transformDirectionByMatrix(Ce,ye,X),z.normalizeVector(Ce,Ce);const re=[I[0],I[4],I[8]],ze=[I[1],I[5],I[9]],ht=[ue*re[0]+fe*ze[0],ue*re[1]+fe*ze[1],ue*re[2]+fe*ze[2]],Te=b.getPosition(),Ve=[Te[0]-u(),Te[1]-m(),Te[2]-h()];if(!ke.paused){const Y=c.beginComputePass(),oe=40,pe=r.boxWidth/32,J=a.spacingFactor*a.particleRadius,ne=Math.max(.5,Math.min(500,Math.pow(pe/J,3)));O.step(Y,q,a.fluidity,oe,ne,ht,Ve,Ce),Y.end()}if(q>0){const Y=u(),oe=m(),pe=h();K[0]=a.particleRadius,K[1]=1,K[2]=Y,K[3]=oe,K[4]=pe,$[0]=a.particleRadius,$[1]=1,$[2]=Y,$[3]=oe,$[4]=pe,F[3]=a.particleRadius,F[4]=1,F[5]=Y,F[6]=oe,F[7]=pe,e.queue.writeBuffer(Ze,0,Je),e.queue.writeBuffer(Ze,64,I),e.queue.writeBuffer(Ze,128,K);const J=c.beginRenderPass({colorAttachments:[{view:he,clearValue:{r:0,g:0,b:-1,a:0},loadOp:"clear",storeOp:"store"}],depthStencilAttachment:{view:ae,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});J.setPipeline(zt),J.setBindGroup(0,$t),J.setVertexBuffer(0,L),J.setVertexBuffer(1,N),J.setIndexBuffer(W,"uint16"),J.drawIndexed(k.indices.length,q),J.end(),e.queue.writeBuffer(mt,0,pt),e.queue.writeBuffer(mt,64,$);const ne=c.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:Re,depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});ne.setPipeline(Tt),ne.setBindGroup(0,Jt),ne.setVertexBuffer(0,_),ne.setIndexBuffer(D,"uint16"),ne.drawIndexed(A.indices.length,q),ne.end(),e.queue.writeBuffer(qe,0,Je),e.queue.writeBuffer(qe,64,I),F[0]=i.width,F[1]=i.height,F[2]=Qe,e.queue.writeBuffer(qe,128,F);const ce=c.beginRenderPass({colorAttachments:[{view:Ue,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}],depthStencilAttachment:{view:ae,depthLoadOp:"load",depthStoreOp:"store"}});ce.setPipeline(Bt),ce.setBindGroup(0,Gt),ce.setVertexBuffer(0,_),ce.setIndexBuffer(D,"uint16"),ce.drawIndexed(A.indices.length,q),ce.end(),e.queue.writeBuffer(Ke,0,X),e.queue.writeBuffer(Ke,64,pt);let p=0;g[p++]=i.width,g[p++]=i.height,g[p++]=Qe,g[p++]=de;const me=b.getPosition();g[p++]=me[0],g[p++]=me[1],g[p++]=me[2],g[p++]=0,g[p++]=d.dirToSun[0],g[p++]=d.dirToSun[1],g[p++]=d.dirToSun[2],g[p++]=d.floorY,g[p++]=d.skyColorHorizon[0],g[p++]=d.skyColorHorizon[1],g[p++]=d.skyColorHorizon[2],g[p++]=d.sunPower,g[p++]=d.skyColorZenith[0],g[p++]=d.skyColorZenith[1],g[p++]=d.skyColorZenith[2],g[p++]=d.sunBrightness,g[p++]=d.skyColorGround[0],g[p++]=d.skyColorGround[1],g[p++]=d.skyColorGround[2],g[p++]=d.floorSize,g[p++]=d.tileCol1[0],g[p++]=d.tileCol1[1],g[p++]=d.tileCol1[2],g[p++]=d.tileScale,g[p++]=d.tileCol2[0],g[p++]=d.tileCol2[1],g[p++]=d.tileCol2[2],g[p++]=d.tileDarkFactor,g[p++]=d.tileCol3[0],g[p++]=d.tileCol3[1],g[p++]=d.tileCol3[2],g[p++]=0,g[p++]=d.tileCol4[0],g[p++]=d.tileCol4[1],g[p++]=d.tileCol4[2],g[p++]=0,e.queue.writeBuffer(Ke,128,g);const Be=c.beginRenderPass({colorAttachments:[{view:be,clearValue:{r:.9,g:.9,b:.9,a:1},loadOp:"clear",storeOp:"store"}]});if(Be.setPipeline(Ut),Be.setBindGroup(0,At),Be.draw(4),Be.end(),a.showWireframe){const ee=c.beginRenderPass({colorAttachments:[{view:be,loadOp:"load",storeOp:"store"}],depthStencilAttachment:{view:ae,depthLoadOp:"load",depthStoreOp:"store"}});T.draw(ee,Je,b,[Y,oe,pe],[r.boxWidth,r.boxHeight,r.boxDepth]),ee.end()}gt[0]=i.width,gt[1]=i.height,e.queue.writeBuffer(Et,0,gt);const Q=c.beginRenderPass({colorAttachments:[{view:o.getCurrentTexture().createView(),clearValue:{r:.9,g:.9,b:.9,a:1},loadOp:"clear",storeOp:"store"}]});Q.setPipeline(kt),Q.setBindGroup(0,It),Q.draw(4),Q.end()}else c.beginRenderPass({colorAttachments:[{view:o.getCurrentTexture().createView(),clearValue:{r:.9,g:.9,b:.9,a:1},loadOp:"clear",storeOp:"store"}]}).end();e.queue.submit([c.finish()]),se.end(),se.update(),requestAnimationFrame(Lt)}requestAnimationFrame(Lt),window.addEventListener("resize",()=>{i.width=window.innerWidth*n,i.height=window.innerHeight*n,f.destroy(),f=e.createTexture({size:[i.width,i.height],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT}),ae=f.createView(),H.destroy(),H=e.createTexture({size:[i.width,i.height],format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),he=H.createView(),te.destroy(),te=e.createTexture({size:[i.width,i.height],format:"r16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),Ue=te.createView(),ie.destroy(),ie=e.createTexture({size:[i.width,i.height],format:l,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),be=ie.createView(),Vt(),Rt()})}ui();
