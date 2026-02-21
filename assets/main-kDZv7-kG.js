import{b as $,c as M,a as F,O as ee,s as te,r as ie,h as ae,i as ne,W as oe,d as se}from"./picking_system-DbKB4hfE.js";import{F as re}from"./fluid_simulation-RFjZi1M0.js";import{F as le}from"./fluid_simulation-BonWjEVN.js";import{F as ce}from"./fluid_simulation-BegOHmur.js";import{F as de}from"./fluid_simulation-CbWbR05N.js";import{G as ue}from"./lil-gui.esm-DA0aiWCL.js";import{S as pe}from"./main-DwTz-q1_.js";function P(o,e,n,i){const h=window.devicePixelRatio||1,x=Math.max(1,Math.floor(window.innerWidth*h)),t=Math.max(1,Math.floor(window.innerHeight*h));(o.width!==x||o.height!==t)&&(o.width=x,o.height=t),$(e,n,i)}class me{name="Marching Cubes";config={...F(),...M(),viscosityStrength:.01,iterationsPerFrame:2,densityTextureRes:150,isoLevel:75,surfaceColor:{r:15/255,g:91/255,b:234/255},shadowSoftness:2.5,showFluidShadows:!0,showBoundsWireframe:!1,boundsWireframeColor:{r:1,g:1,b:1},obstacleColor:{r:1,g:0,b:0},obstacleAlpha:1};device;context;canvas;format;supportsSubgroups;simulation=null;init(e){this.device=e.device,this.context=e.context,this.canvas=e.canvas,this.format=e.format,this.supportsSubgroups=e.supportsSubgroups,this.simulation=new re(this.device,this.context,this.canvas,this.config,this.format,this.supportsSubgroups)}applyCameraDefaults(e){e.radius=30,e.theta=Math.PI/6,e.phi=Math.PI/2.5}getInputState(){return this.simulation?.simulationState.input}reset(){this.simulation?.reset()}async step(e){this.simulation&&await this.simulation.step(e)}render(e){this.simulation?.render(e)}resize(){P(this.canvas,this.context,this.device,this.format)}}class he{name="Particles";config={...F(),...M(),viscosityStrength:.01,iterationsPerFrame:2,velocityDisplayMax:6.5,gradientResolution:64,densityTextureRes:150,densityOffset:0,densityMultiplier:.02,lightStepSize:.1,shadowSoftness:2.5,extinctionCoefficients:{x:2.12,y:.43,z:.3},showBoundsWireframe:!1,boundsWireframeColor:{r:1,g:1,b:1},showFluidShadows:!0,colorKeys:[{t:4064/65535,r:.13363299,g:.34235913,b:.7264151},{t:33191/65535,r:.2980392,g:1,b:.56327766},{t:46738/65535,r:1,g:.9309917,b:0},{t:1,r:.96862745,g:.28555763,b:.031372573}]};device;context;canvas;format;supportsSubgroups;simulation=null;init(e){this.device=e.device,this.context=e.context,this.canvas=e.canvas,this.format=e.format,this.supportsSubgroups=e.supportsSubgroups,this.simulation=new le(this.device,this.context,this.canvas,this.config,this.format,this.supportsSubgroups)}applyCameraDefaults(e){e.radius=30,e.theta=Math.PI/6,e.phi=Math.PI/2.5}getInputState(){return this.simulation?.simulationState.input}reset(){this.simulation?.reset()}async step(e){this.simulation&&await this.simulation.step(e)}render(e){this.simulation?.render(e.viewMatrix)}resize(){P(this.canvas,this.context,this.device,this.format)}}class ge{name="Raymarch";config={...F(),...M(),viscosityStrength:.01,iterationsPerFrame:2,densityTextureRes:150,densityOffset:200,densityMultiplier:.05,stepSize:.02,lightStepSize:.1,renderScale:.5,maxSteps:512,extinctionCoefficients:{x:12,y:4,z:4},indexOfRefraction:1.33,numRefractions:4,tileDarkOffset:-.35,shadowSoftness:2.5,showFluidShadows:!0,showBoundsWireframe:!1,boundsWireframeColor:{r:1,g:1,b:1},obstacleColor:{r:1,g:0,b:0},obstacleAlpha:1};device;context;canvas;format;supportsSubgroups;simulation=null;init(e){this.device=e.device,this.context=e.context,this.canvas=e.canvas,this.format=e.format,this.supportsSubgroups=e.supportsSubgroups,this.simulation=new ce(this.device,this.context,this.canvas,this.config,this.format,this.supportsSubgroups)}applyCameraDefaults(e){e.radius=30,e.theta=Math.PI/6,e.phi=Math.PI/2.5}getInputState(){return this.simulation?.simulationState.input}reset(){this.simulation?.reset()}async step(e){this.simulation&&await this.simulation.step(e)}render(e){this.simulation?.render(e)}resize(){P(this.canvas,this.context,this.device,this.format)}}class fe{name="Screen Space";config={...F(),...M(),viscosityStrength:.01,iterationsPerFrame:2,screenSpaceDebugMode:4,foamSpawnRate:70,trappedAirVelocityMin:5,trappedAirVelocityMax:25,foamKineticEnergyMin:15,foamKineticEnergyMax:80,bubbleBuoyancy:1.4,bubbleScale:.3,foamLifetimeMin:10,foamLifetimeMax:30,waterColor:{r:.3,g:.9,b:.8},deepWaterColor:{r:.02,g:.15,b:.45},foamColor:{r:.95,g:.98,b:1},foamOpacity:2.5,sprayClassifyMaxNeighbours:5,bubbleClassifyMinNeighbours:15,foamParticleRadius:1,spawnRateFadeInTime:.75,spawnRateFadeStartTime:.1,bubbleChangeScaleSpeed:7,extinctionCoeff:{x:2.12,y:.43,z:.3},extinctionMultiplier:2.24,refractionStrength:9.15,shadowSoftness:2.5,showFluidShadows:!0,showBoundsWireframe:!1,boundsWireframeColor:{r:1,g:1,b:1},obstacleColor:{r:1,g:0,b:0},obstacleAlpha:1};device;context;canvas;format;supportsSubgroups;simulation=null;init(e){this.device=e.device,this.context=e.context,this.canvas=e.canvas,this.format=e.format,this.supportsSubgroups=e.supportsSubgroups,this.simulation=new de(this.device,this.context,this.canvas,this.config,this.format,this.supportsSubgroups)}applyCameraDefaults(e){e.radius=30,e.theta=Math.PI/6,e.phi=Math.PI/2.5}getInputState(){return this.simulation?.simulationState.input}reset(){this.simulation?.reset()}async step(e){this.simulation&&await this.simulation.step(e)}render(e){this.simulation?.render(e.viewMatrix)}resize(){P(this.canvas,this.context,this.device,this.format)}}const R=[{name:"Particles",create:()=>new he},{name:"Marching Cubes",create:()=>new me},{name:"Raymarch",create:()=>new ge},{name:"Screen Space",create:()=>new fe}];function be(o){o.innerHTML="";const e=document.createElement("canvas");return e.id="sim-canvas",e.ariaLabel="Fluid simulation",o.appendChild(e),e}const G=document.querySelector("#app");if(!G)throw new Error("Missing #app container");const S=be(G),I=new ee,v={boundsSize:{x:1,y:1,z:1}},Y=document.createElement("style");Y.textContent=`
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
`;document.head.appendChild(Y);const g=document.createElement("div");g.id="gui-container";window.innerWidth<=480&&g.classList.add("collapsed");document.body.appendChild(g);const z=document.createElement("div");z.className="gui-header-main";g.appendChild(z);const E=document.createElement("button");E.className="gui-toggle-btn";E.innerHTML='<span class="material-icons">menu</span>';z.appendChild(E);const k=document.createElement("div");k.className="gui-title-area";z.appendChild(k);const T=document.createElement("div");T.className="gui-content-wrapper";g.appendChild(T);const xe=o=>{o&&o.stopPropagation(),g.classList.toggle("collapsed")};E.onclick=xe;g.onclick=()=>{g.classList.contains("collapsed")&&g.classList.remove("collapsed")};const N=document.createElement("span");N.style.cssText=`
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;N.textContent="WebGPU 3D Fluid";k.appendChild(N);const ye="https://github.com/jeantimex/fluid",p=document.createElement("a");p.href=ye;p.target="_blank";p.rel="noopener noreferrer";p.title="View on GitHub";p.style.cssText=`
  display: flex;
  align-items: center;
  color: #fff;
  opacity: 0.7;
  transition: opacity 0.2s;
  margin-left: 10px;
`;p.onpointerenter=()=>p.style.opacity="1";p.onpointerleave=()=>p.style.opacity="0.7";p.innerHTML=`
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
  </svg>
`;k.appendChild(p);const U=document.createElement("div");U.id="gui-subtitle";U.style.cssText=`
  padding: 5px 11px 5px 11px;
  font-size: 11px;
  font-weight: 400;
  opacity: 0.6;
  line-height: 1.4;
  letter-spacing: 0.01em;
  white-space: normal;
  overflow-wrap: break-word;
  max-width: 220px;
`;const _=document.createElement("div");_.style.cssText=`
  padding: 0 11px 10px 11px;
  font-size: 10px;
  font-weight: 400;
  opacity: 1.0;
  letter-spacing: 0.01em;
`;_.innerHTML='Original Author: <a href="https://github.com/SebLague" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">Sebastian Lague</a>';const V=document.createElement("div");V.style.cssText=`
  padding: 0 11px 10px 11px;
  font-size: 10px;
  font-weight: 400;
  opacity: 1.0;
  letter-spacing: 0.01em;
`;V.innerHTML='WebGPU Author: <a href="https://github.com/jeantimex" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">jeantimex</a>';const j=document.createElement("div");j.style.cssText=`
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
`;const Se={Particles:"SPH Fluid • Particle Simulation",Raymarch:"SPH Fluid • Volumetric Raymarching","Marching Cubes":"SPH Fluid • Marching Cubes Reconstruction","Screen Space":"SPH Fluid • Screen-Space Rendering"},Ce={Particles:["SPH Fluid Simulator (GPU)","Billboard Particle Rendering","Frustum Culling","Dynamic Shadow Mapping","Precise Particle Interaction","Box/Sphere Obstacles"],Raymarch:["SPH Fluid Simulator (GPU)","Volumetric Density Splatting","Physically-Based Raymarching","Refraction & Reflection","Beer–Lambert Transmittance","Shadows & Ambient Occlusion"],"Marching Cubes":["SPH Fluid Simulator (GPU)","Marching Cubes Meshing (Compute)","Indirect Instanced Drawing","Lambertian Shading","Dynamic Shadow Mapping","Box/Sphere Obstacles"],"Screen Space":["SPH Fluid Simulator (GPU)","Multi-Pass Screen-Space Renderer","Curvature-Flow Smoothing","Foam & Spray Simulation","Refraction & Beer-Lambert Law","Bilateral Depth Filtering"]},we={Particles:["Click & Drag (Background): Orbit Camera","Click & Drag (Fluid): Pull Particles","Shift + Click & Drag: Push Particles","Mouse Wheel: Zoom In/Out"],Raymarch:["Click & Drag (Background): Orbit Camera","Click & Drag (Fluid): Pull Particles","Shift + Click & Drag: Push Particles","Mouse Wheel: Zoom In/Out"],"Marching Cubes":["Click & Drag (Background): Orbit Camera","Click & Drag (Fluid): Pull Particles","Shift + Click & Drag: Push Particles","Mouse Wheel: Zoom In/Out"],"Screen Space":["Click & Drag (Background): Orbit Camera","Click & Drag (Fluid): Pull Particles","Shift + Click & Drag: Push Particles","Mouse Wheel: Zoom In/Out"]},b=document.createElement("div");b.style.cssText=`
  background: #1a1a1a;
  color: #fff;
  box-sizing: border-box;
`;b.appendChild(U);b.appendChild(_);b.appendChild(V);b.appendChild(j);const K=document.createElement("div");K.id="gui-features";K.style.cssText=`
  padding: 5px 11px 10px 11px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
`;b.appendChild(K);const Z=document.createElement("div");Z.id="gui-interactions";Z.style.cssText=`
  padding: 5px 11px 10px 11px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
`;b.appendChild(Z);const w=document.createElement("div");w.className="custom-gui-folder";w.style.cssText=`
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
`;const m=document.createElement("div");m.className="custom-gui-folder-content";let A=!0;C.onclick=()=>{m.style.maxHeight==="none"&&(m.style.maxHeight=m.scrollHeight+"px",m.offsetHeight),A=!A;const o=C.querySelector(".folder-arrow");A?(o.style.transform="rotate(90deg)",m.style.maxHeight=m.scrollHeight+"px"):(o.style.transform="rotate(0deg)",m.style.maxHeight="0")};w.appendChild(C);w.appendChild(m);m.appendChild(b);T.appendChild(w);const c=new ue({container:T,title:"Simulation Settings"}),y=new pe({trackGPU:!0,horizontal:!0});y.dom.style.display="none";document.body.appendChild(y.dom);const f={renderer:R[0].name,paused:!1,togglePause:()=>{f.paused=!f.paused,L&&L.name(f.paused?"Resume":"Pause")},reset:()=>l?.reset()};let L,l=null,B,H,O,J,q=null,W=!1;c.add(f,"renderer",R.map(o=>o.name)).name("Renderer").onChange(o=>X(o));function ve(o){v.boundsSize.x=o.boundsSize.x,v.boundsSize.y=o.boundsSize.y,v.boundsSize.z=o.boundsSize.z}function Me(){return l?.getInputState()}function Q(){const o=window.devicePixelRatio||1;S.width=Math.max(1,Math.floor(window.innerWidth*o)),S.height=Math.max(1,Math.floor(window.innerHeight*o))}function Fe(o,e){const n=o.config,i=e.config;i.gravity=n.gravity,i.timeScale=n.timeScale,i.maxTimestepFPS=n.maxTimestepFPS,i.iterationsPerFrame=n.iterationsPerFrame,i.collisionDamping=n.collisionDamping,i.smoothingRadius=n.smoothingRadius,i.spawnDensity=n.spawnDensity,i.viscosityStrength=n.viscosityStrength,i.boundsSize.x=n.boundsSize.x,i.boundsSize.y=n.boundsSize.y,i.boundsSize.z=n.boundsSize.z,i.interactionRadius=n.interactionRadius,i.interactionStrength=n.interactionStrength,i.obstacleSize.x=n.obstacleSize.x,i.obstacleSize.y=n.obstacleSize.y,i.obstacleSize.z=n.obstacleSize.z,i.obstacleCentre.x=n.obstacleCentre.x,i.obstacleCentre.y=n.obstacleCentre.y,i.obstacleCentre.z=n.obstacleCentre.z,i.obstacleRotation.x=n.obstacleRotation.x,i.obstacleRotation.y=n.obstacleRotation.y,i.obstacleRotation.z=n.obstacleRotation.z,n.obstacleColor&&i.obstacleColor&&(i.obstacleColor.r=n.obstacleColor.r,i.obstacleColor.g=n.obstacleColor.g,i.obstacleColor.b=n.obstacleColor.b),typeof n.obstacleAlpha=="number"&&typeof i.obstacleAlpha=="number"&&(i.obstacleAlpha=n.obstacleAlpha);const h=n,x=i;h.renderScale!==void 0&&x.renderScale!==void 0&&(x.renderScale=h.renderScale);const t=n,a=i;t.floorAmbient!==void 0&&a.floorAmbient!==void 0&&(a.floorAmbient=t.floorAmbient,a.sceneExposure=t.sceneExposure,a.sunBrightness=t.sunBrightness,a.globalBrightness=t.globalBrightness,a.globalSaturation=t.globalSaturation,t.tileCol1&&a.tileCol1&&Object.assign(a.tileCol1,t.tileCol1),t.tileCol2&&a.tileCol2&&Object.assign(a.tileCol2,t.tileCol2),t.tileCol3&&a.tileCol3&&Object.assign(a.tileCol3,t.tileCol3),t.tileCol4&&a.tileCol4&&Object.assign(a.tileCol4,t.tileCol4))}function Pe(o){const e=document.getElementById("gui-subtitle");e&&(e.textContent=Se[o.name]||"");const n=document.getElementById("gui-features");if(n){n.innerHTML="";const a=Ce[o.name];if(a&&a.length>0){n.style.display="block";const s=document.createElement("div");s.style.cssText=`
        font-size: 10px;
        font-weight: 600;
        opacity: 0.8;
        text-transform: uppercase;
        margin-bottom: 4px;
      `,s.textContent="Features:",n.appendChild(s);const r=document.createElement("ul");r.style.cssText=`
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
      `,a.forEach(d=>{const u=document.createElement("li");u.textContent=d,r.appendChild(u)}),n.appendChild(r)}else n.style.display="none"}const i=document.getElementById("gui-interactions");if(i){i.innerHTML="";const a=we[o.name];if(a&&a.length>0){i.style.display="block";const s=document.createElement("div");s.style.cssText=`
        font-size: 10px;
        font-weight: 600;
        opacity: 0.8;
        text-transform: uppercase;
        margin-bottom: 4px;
      `,s.textContent="Interactions:",i.appendChild(s);const r=document.createElement("ul");r.style.cssText=`
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
      `,a.forEach(d=>{const u=document.createElement("li");u.textContent=d,r.appendChild(u)}),i.appendChild(r)}else i.style.display="none"}const h=[...c.folders];for(const a of h)a.destroy();const x=[...c.controllers];for(const a of x)a._name!=="Renderer"&&a.destroy();te(o.config,{onReset:()=>l?.reset(),onSmoothingRadiusChange:()=>{}},{trackGPU:!0},c,y);const t=o.config;if(o.name==="Particles"){const a=c.folders.find(r=>r._title==="Particles");a&&a.add(t,"particleRadius",1,5,.1).name("Particle Radius");const s=c.folders.find(r=>r._title==="Shadow");s&&(s.add(t,"densityTextureRes",32,256,1).name("Volume Res").onFinishChange(()=>l?.reset()),s.add(t,"densityOffset",0,500,1).name("Density Offset"),s.add(t,"densityMultiplier",0,.2,.001).name("Density Multiplier"),s.add(t,"lightStepSize",.01,.5,.01).name("Light Step"),s.add(t,"showFluidShadows").name("Fluid Shadows"))}else if(o.name==="Raymarch"){const a=c.addFolder("Raymarch");a.close(),a.add(t,"densityTextureRes",32,256,1).name("Density Texture Res").onFinishChange(()=>l?.reset()),a.add(t,"densityOffset",0,400,1).name("Density Offset"),a.add(t,"densityMultiplier",0,.2,.001).name("Density Multiplier"),a.add(t,"renderScale",.1,1,.05).name("Render Scale"),a.add(t,"stepSize",.01,.5,.01).name("Step Size"),a.add(t,"maxSteps",32,2048,32).name("Max Steps");const s=a.addFolder("Extinction (Absorption)");s.add(t.extinctionCoefficients,"x",0,50,.1).name("Red"),s.add(t.extinctionCoefficients,"y",0,50,.1).name("Green"),s.add(t.extinctionCoefficients,"z",0,50,.1).name("Blue");const r=c.folders.find(d=>d._title==="Shadow");r&&r.add(t,"showFluidShadows").name("Fluid Shadows")}else if(o.name==="Marching Cubes"){const a=c.addFolder("Marching Cubes");a.close(),a.add(t,"densityTextureRes",32,256,1).name("Density Texture Res").onFinishChange(()=>l?.reset()),a.add(t,"isoLevel",0,200,1).name("Iso Level");const s={surfaceColor:ie(t.surfaceColor)};a.addColor(s,"surfaceColor").name("Surface Color").onChange(d=>{const u=ae(d);t.surfaceColor.r=u.r/255,t.surfaceColor.g=u.g/255,t.surfaceColor.b=u.b/255});const r=c.folders.find(d=>d._title==="Shadow");r&&r.add(t,"showFluidShadows").name("Fluid Shadows")}else if(o.name==="Screen Space"){const a=c.folders.find(D=>D._title==="Particles");a&&a.add(t,"particleRadius",1,5,.1).name("Particle Radius");const s=c.addFolder("Foam");s.close(),s.add(t,"foamSpawnRate",0,1e3,1).name("Spawn Rate"),s.add(t,"trappedAirVelocityMin",0,50,.1).name("Air Vel Min"),s.add(t,"trappedAirVelocityMax",0,100,.1).name("Air Vel Max"),s.add(t,"foamKineticEnergyMin",0,50,.1).name("Kinetic Min"),s.add(t,"foamKineticEnergyMax",0,200,.1).name("Kinetic Max"),s.add(t,"bubbleBuoyancy",0,5,.1).name("Buoyancy"),s.add(t,"bubbleScale",0,2,.01).name("Scale"),s.add(t,"foamLifetimeMin",0,30,.1).name("Lifetime Min"),s.add(t,"foamLifetimeMax",0,60,.1).name("Lifetime Max"),s.addColor(t,"foamColor").name("Color"),s.add(t,"foamOpacity",0,20,.1).name("Opacity"),s.add(t,"sprayClassifyMaxNeighbours",0,20,1).name("Spray Max Neighbors"),s.add(t,"bubbleClassifyMinNeighbours",0,50,1).name("Bubble Min Neighbors"),s.add(t,"foamParticleRadius",.1,5,.1).name("Particle Radius"),s.add(t,"spawnRateFadeInTime",0,5,.01).name("Spawn Fade-In Time"),s.add(t,"spawnRateFadeStartTime",0,5,.01).name("Spawn Fade Start"),s.add(t,"bubbleChangeScaleSpeed",0,20,.1).name("Bubble Scale Speed");const r=c.addFolder("Rendering");r.close(),r.add(t.extinctionCoeff,"x",0,5,.01).name("Extinction R"),r.add(t.extinctionCoeff,"y",0,5,.01).name("Extinction G"),r.add(t.extinctionCoeff,"z",0,5,.01).name("Extinction B"),r.add(t,"extinctionMultiplier",0,10,.01).name("Extinction Multiplier"),r.add(t,"refractionStrength",0,20,.01).name("Refraction Strength");const d=c.folders.find(D=>D._title==="Shadow");d&&d.add(t,"showFluidShadows").name("Fluid Shadows");const u=c.addFolder("Debug");u.close(),u.add(t,"screenSpaceDebugMode",{Shaded:4,Depth:0,Thickness:1,Normal:2,Smooth:3}).name("Screen-Space View")}L=c.add(f,"togglePause").name(f.paused?"Resume":"Pause"),c.add(f,"reset").name("Reset Simulation")}async function X(o){const e=R.find(i=>i.name===o);if(!e||l?.name===e.name)return;W=!0;const n=e.create();l?(Fe(l,n),l.destroy?.()):n.applyCameraDefaults(I),l=n,ve(l.config),Q(),$(H,B,O),l.init({device:B,context:H,canvas:S,format:O,supportsSubgroups:J}),l.resize(),Pe(l),l.name==="Particles"&&l.reset(),W=!1}async function Re(){try{({device:B,context:H,format:O,supportsSubgroups:J}=await ne(S))}catch(i){if(i instanceof oe){G.innerHTML=`<p>${i.message}</p>`;return}throw i}q=se(S,Me,I,v),window.addEventListener("resize",()=>{Q(),l?.resize()});const o=R[0];if(!o)throw new Error("No adapters registered");await X(o.name);let e=null;const n=async i=>{e===null&&(e=i),y.begin();const h=Math.min(.033,(i-e)/1e3);e=i,q?.(),l&&!W&&(f.paused||await l.step(h),l.render(I)),y.end(),y.update(),requestAnimationFrame(n)};requestAnimationFrame(n)}Re();
