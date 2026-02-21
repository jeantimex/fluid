import{b as Y,c as P,a as F,O as ae,s as ne,r as oe,h as se,i as re,W as le,d as ce}from"./picking_system-DbKB4hfE.js";import{F as de}from"./fluid_simulation-RFjZi1M0.js";import{F as ue}from"./fluid_simulation-BonWjEVN.js";import{F as pe}from"./fluid_simulation-BegOHmur.js";import{F as me}from"./fluid_simulation-CbWbR05N.js";import{G as he}from"./lil-gui.esm-DA0aiWCL.js";import{S as ge}from"./main-DwTz-q1_.js";function R(a,e,i,o){const c=window.devicePixelRatio||1,g=Math.max(1,Math.floor(window.innerWidth*c)),t=Math.max(1,Math.floor(window.innerHeight*c));(a.width!==g||a.height!==t)&&(a.width=g,a.height=t),Y(e,i,o)}class fe{name="Marching Cubes";config={...F(),...P(),viscosityStrength:.01,iterationsPerFrame:2,densityTextureRes:150,isoLevel:75,surfaceColor:{r:15/255,g:91/255,b:234/255},shadowSoftness:2.5,showFluidShadows:!0,showBoundsWireframe:!1,boundsWireframeColor:{r:1,g:1,b:1},obstacleColor:{r:1,g:0,b:0},obstacleAlpha:1};device;context;canvas;format;supportsSubgroups;simulation=null;init(e){this.device=e.device,this.context=e.context,this.canvas=e.canvas,this.format=e.format,this.supportsSubgroups=e.supportsSubgroups,this.simulation=new de(this.device,this.context,this.canvas,this.config,this.format,this.supportsSubgroups)}applyCameraDefaults(e){e.radius=30,e.theta=Math.PI/6,e.phi=Math.PI/2.5}getInputState(){return this.simulation?.simulationState.input}reset(){this.simulation?.reset()}async step(e){this.simulation&&await this.simulation.step(e)}render(e){this.simulation?.render(e)}resize(){R(this.canvas,this.context,this.device,this.format)}}class be{name="Particles";config={...F(),...P(),viscosityStrength:.01,iterationsPerFrame:2,velocityDisplayMax:6.5,gradientResolution:64,densityTextureRes:150,densityOffset:0,densityMultiplier:.02,lightStepSize:.1,shadowSoftness:2.5,extinctionCoefficients:{x:2.12,y:.43,z:.3},showBoundsWireframe:!1,boundsWireframeColor:{r:1,g:1,b:1},showFluidShadows:!0,colorKeys:[{t:4064/65535,r:.13363299,g:.34235913,b:.7264151},{t:33191/65535,r:.2980392,g:1,b:.56327766},{t:46738/65535,r:1,g:.9309917,b:0},{t:1,r:.96862745,g:.28555763,b:.031372573}]};device;context;canvas;format;supportsSubgroups;simulation=null;init(e){this.device=e.device,this.context=e.context,this.canvas=e.canvas,this.format=e.format,this.supportsSubgroups=e.supportsSubgroups,this.simulation=new ue(this.device,this.context,this.canvas,this.config,this.format,this.supportsSubgroups)}applyCameraDefaults(e){e.radius=30,e.theta=Math.PI/6,e.phi=Math.PI/2.5}getInputState(){return this.simulation?.simulationState.input}reset(){this.simulation?.reset()}async step(e){this.simulation&&await this.simulation.step(e)}render(e){this.simulation?.render(e.viewMatrix)}resize(){R(this.canvas,this.context,this.device,this.format)}}class xe{name="Raymarch";config={...F(),...P(),viscosityStrength:.01,iterationsPerFrame:2,densityTextureRes:150,densityOffset:200,densityMultiplier:.05,stepSize:.02,lightStepSize:.1,renderScale:.5,maxSteps:512,extinctionCoefficients:{x:12,y:4,z:4},indexOfRefraction:1.33,numRefractions:4,tileDarkOffset:-.35,shadowSoftness:2.5,showFluidShadows:!0,showBoundsWireframe:!1,boundsWireframeColor:{r:1,g:1,b:1},obstacleColor:{r:1,g:0,b:0},obstacleAlpha:1};device;context;canvas;format;supportsSubgroups;simulation=null;init(e){this.device=e.device,this.context=e.context,this.canvas=e.canvas,this.format=e.format,this.supportsSubgroups=e.supportsSubgroups,this.simulation=new pe(this.device,this.context,this.canvas,this.config,this.format,this.supportsSubgroups)}applyCameraDefaults(e){e.radius=30,e.theta=Math.PI/6,e.phi=Math.PI/2.5}getInputState(){return this.simulation?.simulationState.input}reset(){this.simulation?.reset()}async step(e){this.simulation&&await this.simulation.step(e)}render(e){this.simulation?.render(e)}resize(){R(this.canvas,this.context,this.device,this.format)}}class Se{name="Screen Space";config={...F(),...P(),viscosityStrength:.01,iterationsPerFrame:2,screenSpaceDebugMode:4,foamSpawnRate:70,trappedAirVelocityMin:5,trappedAirVelocityMax:25,foamKineticEnergyMin:15,foamKineticEnergyMax:80,bubbleBuoyancy:1.4,bubbleScale:.3,foamLifetimeMin:10,foamLifetimeMax:30,waterColor:{r:.3,g:.9,b:.8},deepWaterColor:{r:.02,g:.15,b:.45},foamColor:{r:.95,g:.98,b:1},foamOpacity:2.5,sprayClassifyMaxNeighbours:5,bubbleClassifyMinNeighbours:15,foamParticleRadius:1,spawnRateFadeInTime:.75,spawnRateFadeStartTime:.1,bubbleChangeScaleSpeed:7,extinctionCoeff:{x:2.12,y:.43,z:.3},extinctionMultiplier:2.24,refractionStrength:9.15,shadowSoftness:2.5,showFluidShadows:!0,showBoundsWireframe:!1,boundsWireframeColor:{r:1,g:1,b:1},obstacleColor:{r:1,g:0,b:0},obstacleAlpha:1};device;context;canvas;format;supportsSubgroups;simulation=null;init(e){this.device=e.device,this.context=e.context,this.canvas=e.canvas,this.format=e.format,this.supportsSubgroups=e.supportsSubgroups,this.simulation=new me(this.device,this.context,this.canvas,this.config,this.format,this.supportsSubgroups)}applyCameraDefaults(e){e.radius=30,e.theta=Math.PI/6,e.phi=Math.PI/2.5}getInputState(){return this.simulation?.simulationState.input}reset(){this.simulation?.reset()}async step(e){this.simulation&&await this.simulation.step(e)}render(e){this.simulation?.render(e.viewMatrix)}resize(){R(this.canvas,this.context,this.device,this.format)}}const y=[{name:"Particles",create:()=>new be},{name:"Marching Cubes",create:()=>new fe},{name:"Raymarch",create:()=>new xe},{name:"Screen Space",create:()=>new Se}],q={particles:"Particles","marching-cubes":"Marching Cubes",raymarch:"Raymarch","screen-space":"Screen Space"},ye={Particles:"particles","Marching Cubes":"marching-cubes",Raymarch:"raymarch","Screen Space":"screen-space"};function we(){const e=new URLSearchParams(window.location.search).get("renderer")?.toLowerCase();return e&&q[e]?q[e]:null}function J(a){const e=ye[a];if(!e)return;const i=new URL(window.location.href);i.searchParams.set("renderer",e),window.history.replaceState({},"",i.toString())}function Ce(a){a.innerHTML="";const e=document.createElement("canvas");return e.id="sim-canvas",e.ariaLabel="Fluid simulation",a.appendChild(e),e}const G=document.querySelector("#app");if(!G)throw new Error("Missing #app container");const w=Ce(G),I=new ae,M={boundsSize:{x:1,y:1,z:1}},Q=document.createElement("style");Q.textContent=`
  #gui-container {
    position: fixed;
    top: 0;
    right: 0;
    z-index: 10001;
    background: #1a1a1a;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    box-sizing: border-box;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    width: 280px;
    max-width: 100vw;
    height: auto;
    max-height: 100vh;
    display: flex;
    flex-direction: column;
    user-select: none;
    overflow: hidden;
  }
  #gui-container.collapsed {
    width: 44px;
    height: 44px;
    border-radius: 22px;
    top: 10px;
    right: 10px;
    cursor: pointer;
    overflow: hidden;
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
  #gui-container .custom-gui-folder-header {
    display: flex;
    align-items: center;
    padding: 1px;
    cursor: pointer;
    user-select: none;
    font-size: 11px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.9);
  }
  #gui-container .custom-gui-folder-content {
    overflow: hidden;
    max-height: none;
    transition: max-height 0.3s ease-out;
  }
  @media (max-width: 480px) {
    #gui-container:not(.collapsed) {
      width: 100vw;
      top: 0;
      right: 0;
    }
  }
`;document.head.appendChild(Q);const f=document.createElement("div");f.id="gui-container";window.innerWidth<=480&&f.classList.add("collapsed");document.body.appendChild(f);const z=document.createElement("div");z.className="gui-header-main";f.appendChild(z);const E=document.createElement("button");E.className="gui-toggle-btn";E.innerHTML='<span class="material-icons">menu</span>';z.appendChild(E);const k=document.createElement("div");k.className="gui-title-area";z.appendChild(k);const T=document.createElement("div");T.className="gui-content-wrapper";f.appendChild(T);const ve=a=>{a&&a.stopPropagation(),f.classList.toggle("collapsed")};E.onclick=ve;f.onclick=()=>{f.classList.contains("collapsed")&&f.classList.remove("collapsed")};const U=document.createElement("span");U.style.cssText=`
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;U.textContent="WebGPU 3D Fluid";k.appendChild(U);const Me="https://github.com/jeantimex/fluid",m=document.createElement("a");m.href=Me;m.target="_blank";m.rel="noopener noreferrer";m.title="View on GitHub";m.style.cssText=`
  display: flex;
  align-items: center;
  color: #fff;
  opacity: 0.7;
  transition: opacity 0.2s;
  margin-left: 10px;
`;m.onpointerenter=()=>m.style.opacity="1";m.onpointerleave=()=>m.style.opacity="0.7";m.innerHTML=`
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
  </svg>
`;k.appendChild(m);const N=document.createElement("div");N.id="gui-subtitle";N.style.cssText=`
  padding: 5px 11px 5px 11px;
  font-size: 11px;
  font-weight: 400;
  opacity: 0.6;
  line-height: 1.4;
  letter-spacing: 0.01em;
  white-space: normal;
  overflow-wrap: break-word;
  max-width: 220px;
`;const V=document.createElement("div");V.style.cssText=`
  padding: 0 11px 10px 11px;
  font-size: 10px;
  font-weight: 400;
  opacity: 1.0;
  letter-spacing: 0.01em;
`;V.innerHTML='Original Author: <a href="https://github.com/SebLague" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">Sebastian Lague</a>';const _=document.createElement("div");_.style.cssText=`
  padding: 0 11px 10px 11px;
  font-size: 10px;
  font-weight: 400;
  opacity: 1.0;
  letter-spacing: 0.01em;
`;_.innerHTML='WebGPU Author: <a href="https://github.com/jeantimex" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">jeantimex</a>';const j=document.createElement("div");j.style.cssText=`
  padding: 0 11px 10px 11px;
  font-size: 10px;
  font-weight: 400;
  opacity: 1.0;
  letter-spacing: 0.01em;
  display: flex;
  align-items: center;
  gap: 4px;
`;j.innerHTML=`
  <svg width="14" height="14" viewBox="0 0 24 24" fill="#FF0000">
    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM9.5 16.5v-9l7 4.5-7 4.5z"/>
  </svg>
  <a href="https://youtu.be/kOkfC5fLfgE?si=IHlf5YZt_mAhDWKR" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">Coding Adventure: Rendering Fluids</a>
`;const Pe={Particles:"SPH Fluid • Particle Simulation",Raymarch:"SPH Fluid • Volumetric Raymarching","Marching Cubes":"SPH Fluid • Marching Cubes Reconstruction","Screen Space":"SPH Fluid • Screen-Space Rendering"},Fe={Particles:["SPH Fluid Simulator (GPU)","Billboard Particle Rendering","Frustum Culling","Dynamic Shadow Mapping","Precise Particle Interaction","Box/Sphere Obstacles"],Raymarch:["SPH Fluid Simulator (GPU)","Volumetric Density Splatting","Physically-Based Raymarching","Refraction & Reflection","Beer–Lambert Transmittance","Shadows & Ambient Occlusion"],"Marching Cubes":["SPH Fluid Simulator (GPU)","Marching Cubes Meshing (Compute)","Indirect Instanced Drawing","Lambertian Shading","Dynamic Shadow Mapping","Box/Sphere Obstacles"],"Screen Space":["SPH Fluid Simulator (GPU)","Multi-Pass Screen-Space Renderer","Curvature-Flow Smoothing","Foam & Spray Simulation","Refraction & Beer-Lambert Law","Bilateral Depth Filtering"]},Re={Particles:["Click & Drag (Background): Orbit Camera","Click & Drag (Fluid): Pull Particles","Shift + Click & Drag: Push Particles","Mouse Wheel: Zoom In/Out"],Raymarch:["Click & Drag (Background): Orbit Camera","Click & Drag (Fluid): Pull Particles","Shift + Click & Drag: Push Particles","Mouse Wheel: Zoom In/Out"],"Marching Cubes":["Click & Drag (Background): Orbit Camera","Click & Drag (Fluid): Pull Particles","Shift + Click & Drag: Push Particles","Mouse Wheel: Zoom In/Out"],"Screen Space":["Click & Drag (Background): Orbit Camera","Click & Drag (Fluid): Pull Particles","Shift + Click & Drag: Push Particles","Mouse Wheel: Zoom In/Out"]},x=document.createElement("div");x.style.cssText=`
  background: #1a1a1a;
  color: #fff;
  box-sizing: border-box;
`;x.appendChild(N);x.appendChild(V);x.appendChild(_);x.appendChild(j);const K=document.createElement("div");K.id="gui-features";K.style.cssText=`
  padding: 5px 11px 10px 11px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
`;x.appendChild(K);const Z=document.createElement("div");Z.id="gui-interactions";Z.style.cssText=`
  padding: 5px 11px 10px 11px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
`;x.appendChild(Z);const v=document.createElement("div");v.className="custom-gui-folder";v.style.cssText=`
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.02);
`;const C=document.createElement("div");C.className="custom-gui-folder-header";C.innerHTML=`
  <span class="material-icons folder-arrow" style="
    font-family: 'Material Icons';
    font-size: 16px;
    transition: transform 0.2s;
    transform: rotate(90deg);
    text-transform: none;
  ">chevron_right</span>
  About
`;const h=document.createElement("div");h.className="custom-gui-folder-content";let A=!0;C.onclick=()=>{h.style.maxHeight==="none"&&(h.style.maxHeight=h.scrollHeight+"px",h.offsetHeight),A=!A;const a=C.querySelector(".folder-arrow");A?(a.style.transform="rotate(90deg)",h.style.maxHeight=h.scrollHeight+"px"):(a.style.transform="rotate(0deg)",h.style.maxHeight="0")};v.appendChild(C);v.appendChild(h);h.appendChild(x);T.appendChild(v);const d=new he({container:T,title:"Simulation Settings"}),S=new ge({trackGPU:!0,horizontal:!0});S.dom.style.display="none";document.body.appendChild(S.dom);const ze=we(),X=ze??y[0].name,b={renderer:X,paused:!1,togglePause:()=>{b.paused=!b.paused,L&&L.name(b.paused?"Resume":"Pause")},reset:()=>l?.reset()};let L,l=null,B,H,O,ee,$=null,W=!1;d.add(b,"renderer",y.map(a=>a.name)).name("Renderer").onChange(a=>{J(a),ie(a)});function Ee(a){M.boundsSize.x=a.boundsSize.x,M.boundsSize.y=a.boundsSize.y,M.boundsSize.z=a.boundsSize.z}function ke(){return l?.getInputState()}function te(){const a=window.devicePixelRatio||1;w.width=Math.max(1,Math.floor(window.innerWidth*a)),w.height=Math.max(1,Math.floor(window.innerHeight*a))}function Te(a,e){const i=a.config,o=e.config;o.gravity=i.gravity,o.timeScale=i.timeScale,o.maxTimestepFPS=i.maxTimestepFPS,o.iterationsPerFrame=i.iterationsPerFrame,o.collisionDamping=i.collisionDamping,o.smoothingRadius=i.smoothingRadius,o.spawnDensity=i.spawnDensity,o.viscosityStrength=i.viscosityStrength,o.boundsSize.x=i.boundsSize.x,o.boundsSize.y=i.boundsSize.y,o.boundsSize.z=i.boundsSize.z,o.interactionRadius=i.interactionRadius,o.interactionStrength=i.interactionStrength,o.obstacleSize.x=i.obstacleSize.x,o.obstacleSize.y=i.obstacleSize.y,o.obstacleSize.z=i.obstacleSize.z,o.obstacleCentre.x=i.obstacleCentre.x,o.obstacleCentre.y=i.obstacleCentre.y,o.obstacleCentre.z=i.obstacleCentre.z,o.obstacleRotation.x=i.obstacleRotation.x,o.obstacleRotation.y=i.obstacleRotation.y,o.obstacleRotation.z=i.obstacleRotation.z,i.obstacleColor&&o.obstacleColor&&(o.obstacleColor.r=i.obstacleColor.r,o.obstacleColor.g=i.obstacleColor.g,o.obstacleColor.b=i.obstacleColor.b),typeof i.obstacleAlpha=="number"&&typeof o.obstacleAlpha=="number"&&(o.obstacleAlpha=i.obstacleAlpha);const c=i,g=o;c.renderScale!==void 0&&g.renderScale!==void 0&&(g.renderScale=c.renderScale);const t=i,n=o;t.floorAmbient!==void 0&&n.floorAmbient!==void 0&&(n.floorAmbient=t.floorAmbient,n.sceneExposure=t.sceneExposure,n.sunBrightness=t.sunBrightness,n.globalBrightness=t.globalBrightness,n.globalSaturation=t.globalSaturation,t.tileCol1&&n.tileCol1&&Object.assign(n.tileCol1,t.tileCol1),t.tileCol2&&n.tileCol2&&Object.assign(n.tileCol2,t.tileCol2),t.tileCol3&&n.tileCol3&&Object.assign(n.tileCol3,t.tileCol3),t.tileCol4&&n.tileCol4&&Object.assign(n.tileCol4,t.tileCol4))}function De(a){const e=document.getElementById("gui-subtitle");e&&(e.textContent=Pe[a.name]||"");const i=document.getElementById("gui-features");if(i){i.innerHTML="";const n=Fe[a.name];if(n&&n.length>0){i.style.display="block";const s=document.createElement("div");s.style.cssText=`
        font-size: 10px;
        font-weight: 600;
        opacity: 0.8;
        text-transform: uppercase;
        margin-bottom: 4px;
      `,s.textContent="Features:",i.appendChild(s);const r=document.createElement("ul");r.style.cssText=`
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
      `,n.forEach(u=>{const p=document.createElement("li");p.textContent=u,r.appendChild(p)}),i.appendChild(r)}else i.style.display="none"}const o=document.getElementById("gui-interactions");if(o){o.innerHTML="";const n=Re[a.name];if(n&&n.length>0){o.style.display="block";const s=document.createElement("div");s.style.cssText=`
        font-size: 10px;
        font-weight: 600;
        opacity: 0.8;
        text-transform: uppercase;
        margin-bottom: 4px;
      `,s.textContent="Interactions:",o.appendChild(s);const r=document.createElement("ul");r.style.cssText=`
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
      `,n.forEach(u=>{const p=document.createElement("li");p.textContent=u,r.appendChild(p)}),o.appendChild(r)}else o.style.display="none"}const c=[...d.folders];for(const n of c)n.destroy();const g=[...d.controllers];for(const n of g)n._name!=="Renderer"&&n.destroy();ne(a.config,{onReset:()=>l?.reset(),onSmoothingRadiusChange:()=>{}},{trackGPU:!0},d,S);const t=a.config;if(a.name==="Particles"){const n=d.folders.find(r=>r._title==="Particles");n&&n.add(t,"particleRadius",1,5,.1).name("Particle Radius");const s=d.folders.find(r=>r._title==="Shadow");s&&(s.add(t,"densityTextureRes",32,256,1).name("Volume Res").onFinishChange(()=>l?.reset()),s.add(t,"densityOffset",0,500,1).name("Density Offset"),s.add(t,"densityMultiplier",0,.2,.001).name("Density Multiplier"),s.add(t,"lightStepSize",.01,.5,.01).name("Light Step"),s.add(t,"showFluidShadows").name("Fluid Shadows"))}else if(a.name==="Raymarch"){const n=d.addFolder("Raymarch");n.close(),n.add(t,"densityTextureRes",32,256,1).name("Density Texture Res").onFinishChange(()=>l?.reset()),n.add(t,"densityOffset",0,400,1).name("Density Offset"),n.add(t,"densityMultiplier",0,.2,.001).name("Density Multiplier"),n.add(t,"renderScale",.1,1,.05).name("Render Scale"),n.add(t,"stepSize",.01,.5,.01).name("Step Size"),n.add(t,"maxSteps",32,2048,32).name("Max Steps");const s=n.addFolder("Extinction (Absorption)");s.add(t.extinctionCoefficients,"x",0,50,.1).name("Red"),s.add(t.extinctionCoefficients,"y",0,50,.1).name("Green"),s.add(t.extinctionCoefficients,"z",0,50,.1).name("Blue");const r=d.folders.find(u=>u._title==="Shadow");r&&r.add(t,"showFluidShadows").name("Fluid Shadows")}else if(a.name==="Marching Cubes"){const n=d.addFolder("Marching Cubes");n.close(),n.add(t,"densityTextureRes",32,256,1).name("Density Texture Res").onFinishChange(()=>l?.reset()),n.add(t,"isoLevel",0,200,1).name("Iso Level");const s={surfaceColor:oe(t.surfaceColor)};n.addColor(s,"surfaceColor").name("Surface Color").onChange(u=>{const p=se(u);t.surfaceColor.r=p.r/255,t.surfaceColor.g=p.g/255,t.surfaceColor.b=p.b/255});const r=d.folders.find(u=>u._title==="Shadow");r&&r.add(t,"showFluidShadows").name("Fluid Shadows")}else if(a.name==="Screen Space"){const n=d.folders.find(D=>D._title==="Particles");n&&n.add(t,"particleRadius",1,5,.1).name("Particle Radius");const s=d.addFolder("Foam");s.close(),s.add(t,"foamSpawnRate",0,1e3,1).name("Spawn Rate"),s.add(t,"trappedAirVelocityMin",0,50,.1).name("Air Vel Min"),s.add(t,"trappedAirVelocityMax",0,100,.1).name("Air Vel Max"),s.add(t,"foamKineticEnergyMin",0,50,.1).name("Kinetic Min"),s.add(t,"foamKineticEnergyMax",0,200,.1).name("Kinetic Max"),s.add(t,"bubbleBuoyancy",0,5,.1).name("Buoyancy"),s.add(t,"bubbleScale",0,2,.01).name("Scale"),s.add(t,"foamLifetimeMin",0,30,.1).name("Lifetime Min"),s.add(t,"foamLifetimeMax",0,60,.1).name("Lifetime Max"),s.addColor(t,"foamColor").name("Color"),s.add(t,"foamOpacity",0,20,.1).name("Opacity"),s.add(t,"sprayClassifyMaxNeighbours",0,20,1).name("Spray Max Neighbors"),s.add(t,"bubbleClassifyMinNeighbours",0,50,1).name("Bubble Min Neighbors"),s.add(t,"foamParticleRadius",.1,5,.1).name("Particle Radius"),s.add(t,"spawnRateFadeInTime",0,5,.01).name("Spawn Fade-In Time"),s.add(t,"spawnRateFadeStartTime",0,5,.01).name("Spawn Fade Start"),s.add(t,"bubbleChangeScaleSpeed",0,20,.1).name("Bubble Scale Speed");const r=d.addFolder("Rendering");r.close(),r.add(t.extinctionCoeff,"x",0,5,.01).name("Extinction R"),r.add(t.extinctionCoeff,"y",0,5,.01).name("Extinction G"),r.add(t.extinctionCoeff,"z",0,5,.01).name("Extinction B"),r.add(t,"extinctionMultiplier",0,10,.01).name("Extinction Multiplier"),r.add(t,"refractionStrength",0,20,.01).name("Refraction Strength");const u=d.folders.find(D=>D._title==="Shadow");u&&u.add(t,"showFluidShadows").name("Fluid Shadows");const p=d.addFolder("Debug");p.close(),p.add(t,"screenSpaceDebugMode",{Shaded:4,Depth:0,Thickness:1,Normal:2,Smooth:3}).name("Screen-Space View")}L=d.add(b,"togglePause").name(b.paused?"Resume":"Pause"),d.add(b,"reset").name("Reset Simulation")}async function ie(a){const e=y.find(o=>o.name===a);if(!e||l?.name===e.name)return;W=!0;const i=e.create();l?(Te(l,i),l.destroy?.()):i.applyCameraDefaults(I),l=i,Ee(l.config),te(),Y(H,B,O),l.init({device:B,context:H,canvas:w,format:O,supportsSubgroups:ee}),l.resize(),De(l),l.name==="Particles"&&l.reset(),W=!1}async function Ae(){try{({device:B,context:H,format:O,supportsSubgroups:ee}=await re(w))}catch(c){if(c instanceof le){G.innerHTML=`<p>${c.message}</p>`;return}throw c}$=ce(w,ke,I,M),window.addEventListener("resize",()=>{te(),l?.resize()});const a=X,e=y.find(c=>c.name===a)??y[0];if(!e)throw new Error("No adapters registered");await ie(e.name),J(e.name);let i=null;const o=async c=>{i===null&&(i=c),S.begin();const g=Math.min(.033,(c-i)/1e3);i=c,$?.(),l&&!W&&(b.paused||await l.step(g),l.render(I)),S.end(),S.update(),requestAnimationFrame(o)};requestAnimationFrame(o)}Ae();
