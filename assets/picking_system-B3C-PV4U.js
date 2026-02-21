import{G as ae}from"./lil-gui.esm-DA0aiWCL.js";import{S as le}from"./main-DwTz-q1_.js";function Z(n){const e=s=>Math.max(0,Math.min(255,Math.round(s*255))),t=e(n.r).toString(16).padStart(2,"0"),r=e(n.g).toString(16).padStart(2,"0"),i=e(n.b).toString(16).padStart(2,"0");return`#${t}${r}${i}`}function Q(n){const e=n.trim().replace("#","");if(e.length!==6)return{r:0,g:0,b:0};const t=Number.parseInt(e,16);return{r:t>>16&255,g:t>>8&255,b:t&255}}function ee(n){let e=0;for(const t of n.spawnRegions){const r=t.size.x*t.size.y*t.size.z,i=Math.ceil(r*n.spawnDensity);e+=i}return e}function Ie(n,e,t={},r,i){let s,o;if(!document.querySelector('link[href*="Material+Icons"]')){const c=document.createElement("link");c.href="https://fonts.googleapis.com/icon?family=Material+Icons",c.rel="stylesheet",document.head.appendChild(c)}if(r)s=r;else{const c=document.createElement("style");c.textContent=`
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
    `,document.head.appendChild(c);const f=document.createElement("div");f.id="gui-container",window.innerWidth<=480&&f.classList.add("collapsed"),document.body.appendChild(f);const g=document.createElement("div");g.className="gui-header-main",f.appendChild(g);const T=document.createElement("button");T.className="gui-toggle-btn",T.innerHTML='<span class="material-icons">menu</span>',g.appendChild(T);const M=document.createElement("div");M.className="gui-title-area",g.appendChild(M);const L=document.createElement("div");L.className="gui-content-wrapper",f.appendChild(L);const se=D=>{D&&D.stopPropagation(),f.classList.toggle("collapsed")};if(T.onclick=se,f.onclick=()=>{f.classList.contains("collapsed")&&f.classList.remove("collapsed")},t.title){const D=document.createElement("span");if(D.style.cssText=`
        font-size: 16px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      `,D.textContent=t.title,M.appendChild(D),t.githubUrl){const b=document.createElement("a");b.href=t.githubUrl,b.target="_blank",b.rel="noopener noreferrer",b.title="View on GitHub",b.style.cssText=`
          display: flex;
          align-items: center;
          color: #fff;
          opacity: 0.7;
          transition: opacity 0.2s;
          margin-left: 10px;
        `,b.onpointerenter=()=>b.style.opacity="1",b.onpointerleave=()=>b.style.opacity="0.7",b.innerHTML=`
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
        `,M.appendChild(b)}const J=document.createElement("div");J.style.cssText=`
        background: #1a1a1a;
        color: #fff;
        box-sizing: border-box;
      `;const Y=document.createElement("div");Y.className="custom-gui-folder",Y.style.cssText=`
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.02);
      `;const _=document.createElement("div");_.className="custom-gui-folder-header",_.style.cssText=`
        display: flex;
        align-items: center;
        padding: 1px;
        cursor: pointer;
        user-select: none;
        font-size: 11px;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.9);
      `,_.innerHTML=`
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
      `;let W=!0;if(_.onclick=()=>{R.style.maxHeight==="none"&&(R.style.maxHeight=R.scrollHeight+"px",R.offsetHeight),W=!W;const b=_.querySelector(".folder-arrow");W?(b.style.transform="rotate(90deg)",R.style.maxHeight=R.scrollHeight+"px"):(b.style.transform="rotate(0deg)",R.style.maxHeight="0")},t.subtitle){const b=document.createElement("div");b.style.cssText=`
          padding: 5px 11px 5px 11px;
          font-size: 11px;
          font-weight: 400;
          opacity: 0.6;
          line-height: 1.4;
          letter-spacing: 0.01em;
          white-space: normal;
          overflow-wrap: break-word;
          max-width: 220px;
        `,b.textContent=t.subtitle,R.appendChild(b)}const H=document.createElement("div");H.style.cssText=`
        padding: 0 11px 10px 11px;
        font-size: 10px;
        font-weight: 400;
        opacity: 1.0;
        letter-spacing: 0.01em;
      `,H.innerHTML='Original Author: <a href="https://github.com/SebLague" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">Sebastian Lague</a>',R.appendChild(H);const K=document.createElement("div");K.style.cssText=`
        padding: 0 11px 10px 11px;
        font-size: 10px;
        font-weight: 400;
        opacity: 1.0;
        letter-spacing: 0.01em;
      `,K.innerHTML='WebGPU Author: <a href="https://github.com/jeantimex" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">jeantimex</a>',R.appendChild(K);const q=document.createElement("div");if(q.style.cssText=`
        padding: 0 11px 10px 11px;
        font-size: 10px;
        font-weight: 400;
        opacity: 1.0;
        letter-spacing: 0.01em;
        display: flex;
        align-items: center;
        gap: 4px;
      `,q.innerHTML=`
        <svg width="14" height="14" viewBox="0 0 24 24" fill="#FF0000">
          <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM9.5 16.5v-9l7 4.5-7 4.5z"/>
        </svg>
        <a href="https://youtu.be/kOkfC5fLfgE?si=IHlf5YZt_mAhDWKR" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">Coding Adventure: Rendering Fluids</a>
      `,R.appendChild(q),t.features&&t.features.length>0){const b=document.createElement("div");b.style.cssText=`
          padding: 5px 11px 10px 11px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        `;const U=document.createElement("div");U.style.cssText=`
          font-size: 10px;
          font-weight: 600;
          opacity: 0.8;
          text-transform: uppercase;
          margin-bottom: 4px;
        `,U.textContent="Features:",b.appendChild(U);const A=document.createElement("ul");A.style.cssText=`
          margin: 0;
          padding: 0 0 0 14px;
          font-size: 10px;
          opacity: 0.7;
          line-height: 1.4;
        `,t.features.forEach(j=>{const N=document.createElement("li");N.textContent=j,A.appendChild(N)}),b.appendChild(A),R.appendChild(b)}if(t.interactions&&t.interactions.length>0){const b=document.createElement("div");b.style.cssText=`
          padding: 5px 11px 10px 11px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        `;const U=document.createElement("div");U.style.cssText=`
          font-size: 10px;
          font-weight: 600;
          opacity: 0.8;
          text-transform: uppercase;
          margin-bottom: 4px;
        `,U.textContent="Interactions:",b.appendChild(U);const A=document.createElement("ul");A.style.cssText=`
          margin: 0;
          padding: 0 0 0 14px;
          font-size: 10px;
          opacity: 0.7;
          line-height: 1.4;
        `,t.interactions.forEach(j=>{const N=document.createElement("li");N.textContent=j,A.appendChild(N)}),b.appendChild(A),R.appendChild(b)}Y.appendChild(_),Y.appendChild(R),L.appendChild(J),L.appendChild(Y)}s=new ae({container:L,title:"Simulation Settings"})}i?o=i:(o=new le({trackGPU:t.trackGPU??!1,horizontal:!0}),document.body.appendChild(o.dom)),o.dom.style.display="none";const a={showStats:!1},d=s.addFolder("Fluid");d.close();const u={particleCount:ee(n)},w=()=>{u.particleCount=ee(n),B.updateDisplay()};d.add(n,"spawnDensity",100,2e3,10).name("Spawn Density").onFinishChange(()=>{w(),e.onReset()});const B=d.add(u,"particleCount").name("Particle Count").disable();d.add(n,"gravity",-30,30,1).name("Gravity"),d.add(n,"collisionDamping",0,1,.01).name("Collision Damping"),d.add(n,"smoothingRadius",.05,1,.01).name("Smoothing Radius").onChange(()=>e.onSmoothingRadiusChange()),d.add(n,"targetDensity",0,3e3,10).name("Target Density"),d.add(n,"pressureMultiplier",0,2e3,10).name("Pressure Multiplier"),d.add(n,"nearPressureMultiplier",0,40,.1).name("Near Pressure Multiplier"),d.add(n,"viscosityStrength",0,.5,.001).name("Viscosity Strength"),d.add(n,"jitterStr",0,.1,.001).name("Jitter Strength").onFinishChange(()=>e.onReset());const h=s.addFolder("Obstacle");h.close();const I={"Rectangular Cuboid":"box",Sphere:"sphere"};n.obstacleShape||(n.obstacleShape="box");const O=h.add(n,"obstacleShape",I).name("Shape");typeof n.showObstacle=="boolean"&&h.add(n,"showObstacle").name("Show Obstacle");const G=h.add(n.obstacleSize,"x",0,10,.1).name("Size X"),l=h.add(n.obstacleSize,"y",0,10,.1).name("Size Y"),p=h.add(n.obstacleSize,"z",0,10,.1).name("Size Z");typeof n.obstacleRadius!="number"&&(n.obstacleRadius=0);const m=h.add(n,"obstacleRadius",0,10,.1).name("Radius");h.add(n.obstacleCentre,"x",-10,10,.1).name("Position X");const y=h.add(n.obstacleCentre,"y",-10,10,.1).name("Bottom Y");h.add(n.obstacleCentre,"z",-10,10,.1).name("Position Z");const S=h.add(n.obstacleRotation,"x",-180,180,1).name("Rotation X"),P=h.add(n.obstacleRotation,"y",-180,180,1).name("Rotation Y"),E=h.add(n.obstacleRotation,"z",-180,180,1).name("Rotation Z");n.obstacleColor&&h.addColor(n,"obstacleColor").name("Color"),typeof n.obstacleAlpha=="number"&&h.add(n,"obstacleAlpha",0,1,.01).name("Alpha");const C=()=>{n.obstacleShape==="box"?(G.show(),l.show(),p.show(),m.hide(),S.show(),P.show(),E.show(),y.name("Bottom Y")):(G.hide(),l.hide(),p.hide(),m.show(),S.hide(),P.hide(),E.hide(),y.name("Center Y"))};C(),O.onChange(C);const v=s.addFolder("Container");if(v.close(),v.add(n.boundsSize,"x",1,50,.1).name("Size X"),v.add(n.boundsSize,"y",1,50,.1).name("Size Y"),v.add(n.boundsSize,"z",1,50,.1).name("Size Z"),"showBoundsWireframe"in n){const c=n;if(v.add(c,"showBoundsWireframe").name("Show Wireframe"),c.boundsWireframeColor){const f={color:Z(c.boundsWireframeColor)};v.addColor(f,"color").name("Wireframe Color").onChange(g=>{const T=Q(g);c.boundsWireframeColor.r=T.r/255,c.boundsWireframeColor.g=T.g/255,c.boundsWireframeColor.b=T.b/255})}}const x=s.addFolder("Environment");if(x.close(),"floorAmbient"in n){const c=n;x.add(c,"floorAmbient",0,1,.01).name("Ambient Light"),x.add(c,"sceneExposure",.1,5,.1).name("Exposure"),typeof c.sunBrightness=="number"&&x.add(c,"sunBrightness",0,5,.1).name("Sun Brightness"),!("densityTextureRes"in n)&&"shadowSoftness"in n&&(x.add(c,"shadowSoftness",0,4,.05).name("Shadow Softness"),"shadowRadiusScale"in n&&x.add(c,"shadowRadiusScale",.2,3,.05).name("Shadow Radius")),typeof c.globalBrightness=="number"&&x.add(c,"globalBrightness",.1,4,.1).name("Brightness"),typeof c.globalSaturation=="number"&&x.add(c,"globalSaturation",0,2,.1).name("Saturation");const f={tileCol1:Z(c.tileCol1),tileCol2:Z(c.tileCol2),tileCol3:Z(c.tileCol3),tileCol4:Z(c.tileCol4)},g=T=>M=>{const L=Q(M);c[T].r=Math.pow(L.r/255,2.2),c[T].g=Math.pow(L.g/255,2.2),c[T].b=Math.pow(L.b/255,2.2)};x.addColor(f,"tileCol1").name("Tile Color 1").onChange(g("tileCol1")),x.addColor(f,"tileCol2").name("Tile Color 2").onChange(g("tileCol2")),x.addColor(f,"tileCol3").name("Tile Color 3").onChange(g("tileCol3")),x.addColor(f,"tileCol4").name("Tile Color 4").onChange(g("tileCol4"))}if("shadowSoftness"in n){const c=s.addFolder("Shadow");c.close();const f=n;typeof f.shadowSoftness=="number"&&c.add(f,"shadowSoftness",0,4,.05).name("Softness")}const k=s.addFolder("Interaction");k.close(),k.add(n,"interactionRadius",0,2,.01).name("Radius"),k.add(n,"interactionStrength",0,200,1).name("Strength");const z=s.addFolder("Performance");return z.close(),z.add(n,"timeScale",0,2,.01).name("Time Scale"),z.add(n,"maxTimestepFPS",0,120,1).name("Max Timestep FPS"),z.add(n,"iterationsPerFrame",1,8,1).name("Iterations Per Frame"),z.add(a,"showStats").name("Show FPS").onChange(c=>{o.dom.style.display=c?"block":"none"}),s.close(),{gui:s,stats:o,uiState:a}}function Oe(n,e,t,r){const i=1/Math.tan(n/2),s=1/(t-r),o=new Float32Array(16);return o[0]=i/e,o[5]=i,o[10]=(r+t)*s,o[11]=-1,o[14]=2*r*t*s,o}function Te(n,e,t,r,i,s){const o=1/(e-n),a=1/(r-t),d=1/(s-i),u=new Float32Array(16);return u[0]=2*o,u[5]=2*a,u[10]=d,u[12]=-(e+n)*o,u[13]=-(r+t)*a,u[14]=-i*d,u[15]=1,u}function Le(n){const e=new Float32Array(16),t=n[0],r=n[1],i=n[2],s=n[3],o=n[4],a=n[5],d=n[6],u=n[7],w=n[8],B=n[9],h=n[10],I=n[11],O=n[12],G=n[13],l=n[14],p=n[15],m=t*a-r*o,y=t*d-i*o,S=t*u-s*o,P=r*d-i*a,E=r*u-s*a,C=i*u-s*d,v=w*G-B*O,x=w*l-h*O,k=w*p-I*O,z=B*l-h*G,c=B*p-I*G,f=h*p-I*l;let g=m*f-y*c+S*z+P*k-E*x+C*v;return g&&(g=1/g,e[0]=(a*f-d*c+u*z)*g,e[1]=(i*c-r*f-s*z)*g,e[2]=(G*C-l*E+p*P)*g,e[3]=(h*E-B*C-I*P)*g,e[4]=(d*k-o*f-u*x)*g,e[5]=(t*f-i*k+s*x)*g,e[6]=(l*S-O*C-p*y)*g,e[7]=(w*C-h*S+I*y)*g,e[8]=(o*c-a*k+u*v)*g,e[9]=(r*k-t*c-s*v)*g,e[10]=(O*E-G*S+p*m)*g,e[11]=(B*S-w*E-I*m)*g,e[12]=(a*x-o*z-d*v)*g,e[13]=(t*z-r*x+i*v)*g,e[14]=(G*y-O*P-l*m)*g,e[15]=(w*P-B*y+h*m)*g),e}function de(n,e,t){const r=ne(ce(n,e)),i=ne(te(t,r)),s=te(r,i),o=new Float32Array(16);return o[0]=i.x,o[1]=s.x,o[2]=r.x,o[3]=0,o[4]=i.y,o[5]=s.y,o[6]=r.y,o[7]=0,o[8]=i.z,o[9]=s.z,o[10]=r.z,o[11]=0,o[12]=-V(i,n),o[13]=-V(s,n),o[14]=-V(r,n),o[15]=1,o}function Ue(n,e){const t=new Float32Array(16);for(let r=0;r<4;r++)for(let i=0;i<4;i++){let s=0;for(let o=0;o<4;o++)s+=n[o*4+r]*e[i*4+o];t[i*4+r]=s}return t}function ce(n,e){return{x:n.x-e.x,y:n.y-e.y,z:n.z-e.z}}function ne(n){const e=Math.sqrt(n.x*n.x+n.y*n.y+n.z*n.z);return{x:n.x/e,y:n.y/e,z:n.z/e}}function te(n,e){return{x:n.y*e.z-n.z*e.y,y:n.z*e.x-n.x*e.z,z:n.x*e.y-n.y*e.x}}function V(n,e){return n.x*e.x+n.y*e.y+n.z*e.z}function X(n,e){return{x:n.x*e,y:n.y*e,z:n.z*e}}function F(n,e){return{x:n.x+e.x,y:n.y+e.y,z:n.z+e.z}}function ue(n,e,t,r){let i=(t.x-n.x)/e.x,s=(r.x-n.x)/e.x;i>s&&([i,s]=[s,i]);let o=(t.y-n.y)/e.y,a=(r.y-n.y)/e.y;if(o>a&&([o,a]=[a,o]),i>a||o>s)return!1;o>i&&(i=o),a<s&&(s=a);let d=(t.z-n.z)/e.z,u=(r.z-n.z)/e.z;return d>u&&([d,u]=[u,d]),!(i>u||d>s)}function pe(n,e,t,r){let i=(t.x-n.x)/e.x,s=(r.x-n.x)/e.x;i>s&&([i,s]=[s,i]);let o=(t.y-n.y)/e.y,a=(r.y-n.y)/e.y;if(o>a&&([o,a]=[a,o]),i>a||o>s)return{hit:!1,tmin:0,tmax:0};o>i&&(i=o),a<s&&(s=a);let d=(t.z-n.z)/e.z,u=(r.z-n.z)/e.z;return d>u&&([d,u]=[u,d]),i>u||d>s?{hit:!1,tmin:0,tmax:0}:(d>i&&(i=d),u<s&&(s=u),{hit:!0,tmin:i,tmax:s})}class Ae{radius=5;theta=0;phi=Math.PI/2;target={x:0,y:0,z:0};minRadius=2;maxRadius=100;constructor(){}rotate(e,t){this.theta+=e,this.phi+=t;const r=.001;this.phi=Math.max(r,Math.min(Math.PI-r,this.phi))}zoom(e){this.radius+=e,this.radius=Math.max(this.minRadius,Math.min(this.maxRadius,this.radius))}get viewMatrix(){const e=this.radius*Math.sin(this.phi)*Math.sin(this.theta),t=this.radius*Math.cos(this.phi),r=this.radius*Math.sin(this.phi)*Math.cos(this.theta),i=F(this.target,{x:e,y:t,z:r});return de(i,this.target,{x:0,y:1,z:0})}get basis(){const e=this.viewMatrix,t={x:e[0],y:e[4],z:e[8]},r={x:e[1],y:e[5],z:e[9]},i={x:e[2],y:e[6],z:e[10]},s={x:-i.x,y:-i.y,z:-i.z};return{right:t,up:r,forward:s}}get position(){const e=this.radius*Math.sin(this.phi)*Math.sin(this.theta),t=this.radius*Math.cos(this.phi),r=this.radius*Math.sin(this.phi)*Math.cos(this.theta);return F(this.target,{x:e,y:t,z:r})}}function Me(n,e,t,r){let i=!1,s=!1,o=0,a=0,d=0,u=0;const w=(l,p)=>{const m=n.getBoundingClientRect(),y=l-m.left,S=p-m.top,P=y/m.width*2-1,E=-(S/m.height*2-1),C=Math.PI/3,v=Math.tan(C/2),x=n.width/n.height,{right:k,up:z,forward:c}=t.basis,f=F(c,F(X(k,P*x*v),X(z,E*v))),g=Math.sqrt(f.x*f.x+f.y*f.y+f.z*f.z);return{origin:t.position,dir:{x:f.x/g,y:f.y/g,z:f.z/g}}},B=l=>{const p=t.basis.forward,m=l.dir.x*p.x+l.dir.y*p.y+l.dir.z*p.z;if(Math.abs(m)<1e-6)return null;const y=l.origin,P=-(y.x*p.x+y.y*p.y+y.z*p.z)/m;return P<0?null:F(y,X(l.dir,P))},h=l=>{const p=r.boundsSize,m=p.x*.5,y=p.z*.5,S=-5,P={x:-m,y:S,z:-y},E={x:m,y:S+p.y,z:y},C=pe(l.origin,l.dir,P,E);if(!C.hit)return null;const v={x:0,y:S+p.y*.5,z:0},x={x:l.origin.x-v.x,y:l.origin.y-v.y,z:l.origin.z-v.z},k=-(x.x*l.dir.x+x.y*l.dir.y+x.z*l.dir.z),z=Math.max(C.tmin,Math.min(C.tmax,k));return z<0?null:F(l.origin,X(l.dir,z))},I=l=>{const p=e();if(!p)return;const m=w(l.clientX,l.clientY);p.rayOrigin=m.origin,p.rayDir=m.dir;const y=h(m)??B(m);y&&(p.worldX=y.x,p.worldY=y.y,p.worldZ=y.z)};n.addEventListener("pointerdown",l=>{const p=e();if(!p)return;l.cancelable&&l.preventDefault();const m=r.boundsSize,y=m.x*.5,S=m.z*.5,P=-5,E={x:-y,y:P,z:-S},C={x:y,y:P+m.y,z:S},v=w(l.clientX,l.clientY),x=ue(v.origin,v.dir,E,C);p.rayOrigin=v.origin,p.rayDir=v.dir;const k=l.button===2||l.button===0&&l.shiftKey;x&&(k||p.isHoveringFluid)?(s=!0,I(l),k?(p.push=!0,p.pull=!1):(p.pull=!0,p.push=!1)):(i=!0,o=l.clientX,a=l.clientY)}),n.addEventListener("pointermove",l=>{const p=e();if(!p)return;l.cancelable&&l.preventDefault();const m=w(l.clientX,l.clientY);if(p.rayOrigin=m.origin,p.rayDir=m.dir,s)I(l);else if(i){const y=l.clientX-o,S=l.clientY-a;o=l.clientX,a=l.clientY;const P=.005;d=-y*P,u=-S*P,t.rotate(d,u)}}),n.addEventListener("pointerup",()=>{const l=e();l&&(s&&(s=!1,l.pull=!1,l.push=!1),i=!1)}),n.addEventListener("pointerleave",()=>{const l=e();l&&(l.pull=!1,l.push=!1,i=!1,s=!1)}),n.addEventListener("wheel",l=>{t.zoom(l.deltaY*.01),l.preventDefault()},{passive:!1}),n.addEventListener("contextmenu",l=>l.preventDefault());const O=.92,G=1e-4;return function(){!i&&(Math.abs(d)>G||Math.abs(u)>G)&&(t.rotate(d,u),d*=O,u*=O)}}function fe(){const n=navigator.userAgent.toLowerCase(),t=["android","iphone","ipad","ipod","mobile","tablet"].some(s=>n.includes(s)),r="ontouchstart"in window||navigator.maxTouchPoints>0,i=window.innerWidth<1024;return t||r&&i}class $ extends Error{constructor(e){super(e),this.name="WebGPUInitError"}}async function De(n){if(!navigator.gpu)throw new $("WebGPU is not supported in this browser.");const e=await navigator.gpu.requestAdapter();if(!e)throw new $("Unable to acquire a WebGPU adapter.");const t=e.features.has("subgroups");t&&console.log("WebGPU subgroups supported - enabling optimized prefix sum");const r=[];t&&r.push("subgroups");const i=await e.requestDevice({requiredFeatures:r}),s=n.getContext("webgpu");if(!s)throw new $("Unable to create a WebGPU context.");const o=navigator.gpu.getPreferredCanvasFormat(),a=fe();return a&&console.log("Mobile device detected - enabling shared memory optimizations"),{device:i,context:s,format:o,supportsSubgroups:t,isMobile:a}}function _e(n,e,t){n.configure({device:e,format:t,alphaMode:"opaque"})}function Fe(){return{timeScale:2,maxTimestepFPS:60,iterationsPerFrame:2,gravity:-10,collisionDamping:.95,smoothingRadius:.2,targetDensity:630,pressureMultiplier:288,nearPressureMultiplier:2.16,viscosityStrength:.01,boundsSize:{x:24,y:10,z:15},showObstacle:!0,obstacleShape:"box",obstacleRadius:0,obstacleSize:{x:0,y:0,z:0},obstacleCentre:{x:0,y:-5,z:0},obstacleRotation:{x:0,y:0,z:0},obstacleColor:{r:1,g:0,b:0},obstacleAlpha:.8,interactionRadius:2,interactionStrength:50,particleRadius:2.5,spawnDensity:600,initialVelocity:{x:0,y:0,z:0},jitterStr:.035,spawnRegions:[{position:{x:-8.3,y:-1.3,z:3.65},size:{x:7,y:7,z:7}},{position:{x:-8.3,y:-1.3,z:-3.65},size:{x:7,y:7,z:7}}]}}function Ye(){return{dirToSun:{x:-.83,y:.42,z:-.36},floorAmbient:.58,sceneExposure:1.1,sunBrightness:1,skyColorHorizon:{r:1,g:1,b:1},skyColorZenith:{r:.08,g:.37,b:.73},skyColorGround:{r:.55,g:.5,b:.55},sunPower:500,floorSize:{x:100,y:1,z:100},floorCenter:{x:0,y:-5.5,z:0},tileScale:1,tileDarkFactor:-.35,tileCol1:{r:.20392157,g:.5176471,b:.7764706},tileCol2:{r:.6081319,g:.36850303,b:.8584906},tileCol3:{r:.3019758,g:.735849,b:.45801795},tileCol4:{r:.8018868,g:.6434483,b:.36690104},tileColVariation:{x:.33,y:0,z:.47},globalBrightness:1,globalSaturation:1}}function Ne(n,e,t,r){let i=e;n[i++]=t.dirToSun.x,n[i++]=t.dirToSun.y,n[i++]=t.dirToSun.z,n[i++]=t.floorAmbient,n[i++]=t.skyColorHorizon.r,n[i++]=t.skyColorHorizon.g,n[i++]=t.skyColorHorizon.b,n[i++]=t.sunPower,n[i++]=t.skyColorZenith.r,n[i++]=t.skyColorZenith.g,n[i++]=t.skyColorZenith.b,n[i++]=t.sceneExposure,n[i++]=t.skyColorGround.r,n[i++]=t.skyColorGround.g,n[i++]=t.skyColorGround.b,n[i++]=0,n[i++]=t.floorSize.x,n[i++]=t.floorSize.y,n[i++]=t.floorSize.z,n[i++]=t.tileScale,n[i++]=t.floorCenter.x,n[i++]=t.floorCenter.y,n[i++]=t.floorCenter.z,n[i++]=t.tileDarkFactor,n[i++]=t.tileCol1.r,n[i++]=t.tileCol1.g,n[i++]=t.tileCol1.b,n[i++]=t.sunBrightness,n[i++]=t.tileCol2.r,n[i++]=t.tileCol2.g,n[i++]=t.tileCol2.b,n[i++]=t.globalBrightness,n[i++]=t.tileCol3.r,n[i++]=t.tileCol3.g,n[i++]=t.tileCol3.b,n[i++]=t.globalSaturation,n[i++]=t.tileCol4.r,n[i++]=t.tileCol4.g,n[i++]=t.tileCol4.b,n[i++]=0,n[i++]=t.tileColVariation.x,n[i++]=t.tileColVariation.y,n[i++]=t.tileColVariation.z,n[i++]=0;const s=r.showObstacle!==!1,a=(r.obstacleShape??"box")==="sphere";n[i++]=r.obstacleCentre.x,n[i++]=a?r.obstacleCentre.y:r.obstacleCentre.y+r.obstacleSize.y*.5,n[i++]=r.obstacleCentre.z,n[i++]=0;const d=r.obstacleRadius??0,u=s?a?d:r.obstacleSize.x*.5:0,w=s?a?d:r.obstacleSize.y*.5:0,B=s?a?d:r.obstacleSize.z*.5:0;n[i++]=u,n[i++]=w,n[i++]=B,n[i++]=0,n[i++]=r.obstacleRotation.x,n[i++]=r.obstacleRotation.y,n[i++]=r.obstacleRotation.z,n[i++]=s?r.obstacleAlpha??.8:0;const h=r.obstacleColor??{r:1,g:0,b:0};n[i++]=h.r,n[i++]=h.g,n[i++]=h.b,n[i++]=a?1:0}function ge(n){let e=n>>>0;return()=>(e=1664525*e+1013904223>>>0,e/4294967296)}function me(n,e){const t=n.x*n.y*n.z,r=Math.ceil(t*e),i=Math.pow(r/t,1/3);return{x:Math.max(1,Math.ceil(n.x*i)),y:Math.max(1,Math.ceil(n.y*i)),z:Math.max(1,Math.ceil(n.z*i))}}function he(n,e){const t=n.size,r=n.position,i=me(t,e),s=new Array(i.x*i.y*i.z);let o=0;for(let a=0;a<i.z;a+=1)for(let d=0;d<i.y;d+=1)for(let u=0;u<i.x;u+=1){const w=i.x===1?.5:u/(i.x-1),B=i.y===1?.5:d/(i.y-1),h=i.z===1?.5:a/(i.z-1),I=(w-.5)*t.x+r.x,O=(B-.5)*t.y+r.y,G=(h-.5)*t.z+r.z;s[o]={x:I,y:O,z:G},o+=1}return s}function Ze(n){const e=ge(42),t=[];for(const o of n.spawnRegions){const a=he(o,n.spawnDensity);for(const d of a){const u=(e()-.5)*n.jitterStr,w=(e()-.5)*n.jitterStr,B=(e()-.5)*n.jitterStr;t.push({x:d.x+u,y:d.y+w,z:d.z+B})}}const r=t.length,i=new Float32Array(r*4),s=new Float32Array(r*4);for(let o=0;o<r;o+=1){const a=o*4;i[a]=t[o].x,i[a+1]=t[o].y,i[a+2]=t[o].z,i[a+3]=1,s[a]=n.initialVelocity.x,s[a+1]=n.initialVelocity.y,s[a+2]=n.initialVelocity.z,s[a+3]=0}return{positions:i,velocities:s,count:r}}class oe{static DEFAULT_MAX_FOAM_PARTICLES=128e4;positions;predicted;velocities;densities;keys;indices;sortOffsets;particleCellOffsets=null;spatialOffsets=null;sortedKeys=null;groupSumsL1;groupSumsL2;scanScratch;positionsSorted;predictedSorted;velocitiesSorted;visibleIndices;indirectDraw;foamPositions=null;foamVelocities=null;foamCounter=null;maxFoamParticles;velocityReadback;densityReadback;particleCount;device;constructor(e,t,r={}){this.device=e,this.particleCount=t.count;const{gridTotalCells:i,includeFoam:s,maxFoamParticles:o=oe.DEFAULT_MAX_FOAM_PARTICLES}=r;if(this.positions=this.createBufferFromArray(t.positions,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.predicted=this.createBufferFromArray(new Float32Array(t.positions),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.velocities=this.createBufferFromArray(t.velocities,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC),this.densities=this.createEmptyBuffer(t.count*2*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC),this.keys=this.createEmptyBuffer(t.count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.indices=this.createEmptyBuffer(t.count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),i!==void 0){this.particleCellOffsets=this.createEmptyBuffer(t.count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.sortOffsets=this.createEmptyBuffer((i+1)*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);const a=Math.ceil((i+1)/512),d=Math.ceil(a/512);this.groupSumsL1=this.createEmptyBuffer(a*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.groupSumsL2=this.createEmptyBuffer(d*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST)}else{this.sortOffsets=this.createEmptyBuffer(t.count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.spatialOffsets=this.createEmptyBuffer(t.count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.sortedKeys=this.createEmptyBuffer(t.count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST);const a=Math.ceil(t.count/512),d=Math.ceil(a/512);this.groupSumsL1=this.createEmptyBuffer(a*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.groupSumsL2=this.createEmptyBuffer(d*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST)}this.scanScratch=this.createEmptyBuffer(4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.positionsSorted=this.createEmptyBuffer(t.count*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.predictedSorted=this.createEmptyBuffer(t.count*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.velocitiesSorted=this.createEmptyBuffer(t.count*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.visibleIndices=this.createEmptyBuffer(t.count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.indirectDraw=this.createEmptyBuffer(16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.INDIRECT),s?(this.foamPositions=this.createEmptyBuffer(o*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.foamVelocities=this.createEmptyBuffer(o*16,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.foamCounter=this.createEmptyBuffer(4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.maxFoamParticles=o):this.maxFoamParticles=0,this.velocityReadback=e.createBuffer({size:t.count*16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),this.densityReadback=e.createBuffer({size:t.count*8,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST})}createBufferFromArray(e,t){const r=this.device.createBuffer({size:e.byteLength,usage:t,mappedAtCreation:!0});return(e instanceof Float32Array?new Float32Array(r.getMappedRange()):new Uint32Array(r.getMappedRange())).set(e),r.unmap(),r}createEmptyBuffer(e,t){return this.device.createBuffer({size:e,usage:t})}destroy(){this.positions.destroy(),this.predicted.destroy(),this.velocities.destroy(),this.densities.destroy(),this.keys.destroy(),this.indices.destroy(),this.sortOffsets.destroy(),this.groupSumsL1.destroy(),this.groupSumsL2.destroy(),this.scanScratch.destroy(),this.positionsSorted.destroy(),this.predictedSorted.destroy(),this.velocitiesSorted.destroy(),this.visibleIndices.destroy(),this.indirectDraw.destroy(),this.velocityReadback.destroy(),this.densityReadback.destroy(),this.particleCellOffsets?.destroy(),this.spatialOffsets?.destroy(),this.sortedKeys?.destroy(),this.foamPositions?.destroy(),this.foamVelocities?.destroy(),this.foamCounter?.destroy()}}const ye=`/**
 * ============================================================================
 * LINEAR GRID HASH KERNEL
 * ============================================================================
 *
 * Pipeline Stage: 2 of 8 (After external forces)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Assigns each particle to a Linear Grid Index based on its predicted position.
 * This is the first step of the O(1) neighbor search acceleration.
 *
 * Linear Grid vs Spatial Hash:
 * ----------------------------
 * Instead of hashing (which has collisions), we use a deterministic mapping
 * from 3D cell coordinates to a 1D index:
 *
 *   index = x + width * (y + height * z)
 *
 * Requirements:
 * - Fixed simulation bounds (minBounds, maxBounds)
 * - Grid resolution calculated from bounds / radius
 * - Particles outside bounds are clamped to the nearest boundary cell
 *
 * Advantages:
 * - No hash collisions (two particles in different cells never share a key)
 * - Contiguous X-rows allow "Strip Optimization" in neighbor search
 * - Deterministic iteration order
 *
 * Output:
 * -------
 *   keys[i]    = grid index for particle i
 *   indices[i] = i (original particle index, preserved through sorting)
 * ============================================================================
 */

// Beginner note: keys[] are cell IDs used for sorting; indices[] keeps the original index.

/**
 * Hash Parameters Uniform Buffer
 *
 * Memory Layout (32 bytes, two vec4-sized rows):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    radius         - Grid cell size (= smoothing radius)
 *   4      4    particleCount  - Number of particles (as f32)
 *   8      4    minBoundsX     - Minimum X of simulation domain
 *  12      4    minBoundsY     - Minimum Y of simulation domain
 *  16      4    minBoundsZ     - Minimum Z of simulation domain
 *  20      4    gridResX       - Grid resolution along X axis
 *  24      4    gridResY       - Grid resolution along Y axis
 *  28      4    gridResZ       - Grid resolution along Z axis
 * ------
 * Total: 32 bytes
 */
struct HashParams {
  radius: f32,
  particleCount: f32,
  minBoundsX: f32,
  minBoundsY: f32,
  minBoundsZ: f32,
  gridResX: f32,
  gridResY: f32,
  gridResZ: f32,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Linear Grid Hash compute pass
//
//   Binding 0: predicted[]  - Predicted particle positions from external forces
//              Format: vec4<f32> per particle (xyz = position, w = 1.0)
//
//   Binding 1: keys[]       - Output linear grid indices (one u32 per particle)
//              These keys are deterministic (no collisions) and contiguous
//              along the X axis for strip optimisation in neighbor search
//
//   Binding 2: indices[]    - Output original particle indices (identity mapping)
//              Tracks which particle each key belongs to after sorting
//
//   Binding 3: params       - Uniform hash parameters (radius, bounds, resolution)
// ============================================================================

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> indices: array<u32>;
@group(0) @binding(3) var<uniform> params: HashParams;

/**
 * Converts a 3D world-space position to a linear grid index.
 *
 * Steps:
 *   1. Shift position into local space: pos - minBounds
 *   2. Divide by cell size (radius) to get cell coordinates
 *   3. Clamp to [0, gridRes - 1] on each axis (boundary safety)
 *   4. Linearise: index = x + width × (y + height × z)
 *
 * The clamp ensures particles slightly outside the domain are assigned to
 * the nearest boundary cell rather than producing out-of-range indices.
 *
 * @param pos - World-space position
 * @returns Linear grid index in [0, gridTotalCells - 1]
 */
fn getGridIndex(pos: vec3<f32>) -> u32 {
    let gridRes = vec3<u32>(u32(params.gridResX), u32(params.gridResY), u32(params.gridResZ));
    let minBounds = vec3<f32>(params.minBoundsX, params.minBoundsY, params.minBoundsZ);
    
    let localPos = pos - minBounds;
    
    // Clamp to valid grid range [0, gridRes-1]
    let cellX = u32(clamp(floor(localPos.x / params.radius), 0.0, f32(gridRes.x - 1u)));
    let cellY = u32(clamp(floor(localPos.y / params.radius), 0.0, f32(gridRes.y - 1u)));
    let cellZ = u32(clamp(floor(localPos.z / params.radius), 0.0, f32(gridRes.z - 1u)));
    
    // Linear index: x + width * (y + height * z)
    return cellX + gridRes.x * (cellY + gridRes.y * cellZ);
}

/**
 * Main Compute Kernel
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 * Each thread processes exactly one particle.
 *
 * Writes:
 *   keys[i]    = linear grid index for particle i
 *   indices[i] = i (identity mapping, preserved through sorting)
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Convert float particle count to integer with rounding
  let count = u32(params.particleCount + 0.5);

  // Bounds check: one thread per particle
  if (index >= count) {
    return;
  }

  // Compute deterministic grid index from predicted position
  let pos = predicted[index].xyz;
  keys[index] = getGridIndex(pos);

  // Store identity mapping (will be rearranged by scatter)
  indices[index] = index;
}
`,ie=`/**
 * ============================================================================
 * COUNTING SORT KERNELS (LINEAR GRID)
 * ============================================================================
 *
 * Pipeline Stage: Part of Stage 3 (Counting Sort)
 * Entry Points: clearOffsets, countOffsets
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Prepares the histogram for the Linear Grid sort.
 *
 * Key Changes from Spatial Hash:
 * - We compute a "Rank" (local offset) for each particle within its cell
 *   using atomicAdd. This is stored in \`particleCellOffsets\`.
 * - This Rank + Start (from Prefix Sum) allows for a contention-free Scatter pass.
 *
 * ============================================================================
 */

// Beginner note: clearOffsets zeros the histogram, countOffsets fills it and
// records each particle’s local rank within its grid cell.

/**
 * Sort Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    particleCount   - Total number of particles
 *   4      4    gridTotalCells  - Total cells in the linear grid
 *   8      8    pad0            - Padding for 16-byte alignment
 * ------
 * Total: 16 bytes
 */
struct SortParams {
  particleCount: u32,
  gridTotalCells: u32,
  pad0: vec2<u32>,
};

// ============================================================================
// KERNEL 1: CLEAR OFFSETS
// ============================================================================
// Bind Group 0: Used exclusively by clearOffsets
//
//   Binding 0: sortOffsets[] - Histogram / prefix-sum buffer to clear
//              Size: (gridTotalCells + 1) elements
//              The extra "+1" element serves as a sentinel: after prefix sum,
//              sortOffsets[gridTotalCells] holds the total particle count,
//              which is the "end" index for the last occupied cell.
//
//   Binding 1: params        - Uniform with grid cell count
// ============================================================================

@group(0) @binding(0) var<storage, read_write> sortOffsets: array<atomic<u32>>;
@group(0) @binding(1) var<uniform> params: SortParams;

/**
 * Clear Offsets Kernel
 *
 * Zeros all histogram entries including the sentinel element.
 * Must run before countOffsets to ensure a clean histogram.
 *
 * Dispatch: ceil((gridTotalCells + 1) / 256) workgroups
 */
@compute @workgroup_size(256)
fn clearOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check: includes the sentinel at position gridTotalCells
  if (index > params.gridTotalCells) {
    return;
  }

  atomicStore(&sortOffsets[index], 0u);
}

// ============================================================================
// KERNEL 2: COUNT OFFSETS & COMPUTE RANK
// ============================================================================
// Bind Group 1: Used exclusively by countOffsets
// (Separate group number to allow different pipeline layout from clearOffsets)
//
//   Binding 0: keys[]                - Linear grid indices from hash_linear.wgsl
//   Binding 1: sortOffsetsCount[]    - Histogram buffer (aliased with sortOffsets)
//              Type: atomic<u32> for thread-safe increment
//   Binding 2: countParams           - Uniform with particle count
//   Binding 3: particleCellOffsets[] - Output: per-particle rank within its cell
//              The rank is the return value of atomicAdd (0-based offset)
// ============================================================================

@group(1) @binding(0) var<storage, read> keys: array<u32>;
@group(1) @binding(1) var<storage, read_write> sortOffsetsCount: array<atomic<u32>>;
@group(1) @binding(2) var<uniform> countParams: SortParams;
@group(1) @binding(3) var<storage, read_write> particleCellOffsets: array<u32>;

/**
 * Count Offsets & Compute Rank Kernel
 *
 * Builds a histogram of particles per grid cell AND simultaneously computes
 * each particle's local rank (offset) within its cell.
 *
 * The rank is the key difference from the spatial-hash variant: it enables
 * the scatter pass to compute destination indices without contention
 * (dest = start + rank), eliminating atomicAdd from the scatter.
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn countOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check: one thread per particle
  if (index >= countParams.particleCount) {
    return;
  }

  let key = keys[index];

  // atomicAdd returns the OLD value, which is the 0-based rank of this
  // particle among all particles in the same cell. Subsequent particles
  // in the same cell get incrementing ranks (1, 2, 3, ...).
  particleCellOffsets[index] = atomicAdd(&sortOffsetsCount[key], 1u);
}
`,be=`/**
 * ============================================================================
 * PARALLEL PREFIX SUM (SCAN) SHADER - BLELLOCH ALGORITHM
 * ============================================================================
 *
 * Pipeline Stage: Part of Stage 3 (Counting Sort)
 * Entry Points: blockScan, blockCombine
 * Workgroup Size: 256 threads (processes 512 elements per workgroup)
 *
 * Purpose:
 * --------
 * Computes the exclusive prefix sum (scan) of the histogram array.
 * This transforms counts into starting offsets for each bucket:
 *
 *   Input:   [2, 1, 3, 2, 0, 1]  <- counts per bucket
 *   Output:  [0, 2, 3, 6, 8, 8]  <- starting index for each bucket
 *
 * The output tells us: "Bucket k starts at index offsets[k]"
 *
 * Blelloch Scan Algorithm:
 * ------------------------
 * The Blelloch scan is a work-efficient parallel algorithm with two phases:
 *
 * PHASE 1: UP-SWEEP (Reduction)
 * Build a balanced binary tree of partial sums from leaves to root.
 *
 *   Level 0:  [a₀] [a₁] [a₂] [a₃] [a₄] [a₅] [a₆] [a₇]  <- Input
 *              ↘↙     ↘↙     ↘↙     ↘↙
 *   Level 1:  [a₀][a₀₁]  [a₂][a₂₃]  [a₄][a₄₅]  [a₆][a₆₇]
 *                  ↘↙          ↘↙
 *   Level 2:  [a₀][a₀₁][a₂][a₀₋₃]    [a₄][a₄₅][a₆][a₄₋₇]
 *                        ↘↙
 *   Level 3:  [a₀][a₀₁][a₂][a₀₋₃][a₄][a₄₅][a₆][TOTAL]  <- Root has total
 *
 * PHASE 2: DOWN-SWEEP (Distribution)
 * Traverse down the tree, propagating partial sums:
 *
 *   1. Set root to identity (0 for addition)
 *   2. At each level, for each node:
 *      - Left child = parent
 *      - Right child = parent + old left child
 *
 *   Result: Exclusive prefix sum at each position
 *
 * Hierarchical Processing (3 Levels):
 * ------------------------------------
 * For arrays larger than 512 elements, we use a 3-level hierarchy:
 *
 *   Level 0 (L0): Process 512-element blocks, save block totals
 *   Level 1 (L1): Scan block totals (if > 512 blocks, do another level)
 *   Level 2 (L2): Scan L1 totals (handles up to 512³ = 134M elements)
 *   Combine: Add scanned block totals back to each block
 *
 *     ┌─────────────────────────────────────────────────────────────┐
 *     │                    Input Array (N elements)                 │
 *     └─────────────────────────────────────────────────────────────┘
 *            ↓ blockScan L0
 *     ┌─────┬─────┬─────┬─────┬─────┐
 *     │ B0  │ B1  │ B2  │ B3  │ ... │  Each block scanned, totals saved
 *     └─────┴─────┴─────┴─────┴─────┘
 *     └──────── groupSums L0 ────────┘
 *            ↓ blockScan L1
 *     ┌─────────────────────────────┐
 *     │ Scanned group sums (L1)     │
 *     └─────────────────────────────┘
 *            ↓ blockCombine L0
 *     ┌─────────────────────────────────────────────────────────────┐
 *     │    Final prefix sum (each block + its scanned group sum)    │
 *     └─────────────────────────────────────────────────────────────┘
 *
 * Performance:
 * ------------
 * - O(n) work complexity (same as sequential)
 * - O(log n) step complexity (parallel depth)
 * - Shared memory reduces global memory bandwidth
 * - Each thread handles 2 elements (coalesced access)
 *
 * ============================================================================
 */

// Beginner note: scan turns per-cell counts into start offsets so each cell
// knows where its particles live in the sorted arrays.

/**
 * Scan Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    count   - Number of elements to scan
 *   4     12    pad0    - Padding for 16-byte alignment
 * ------
 * Total: 16 bytes
 */
struct Params {
  count: u32,
  pad0: vec3<u32>,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Prefix sum compute pass
//
//   Binding 0: data[]       - Input/output array (in-place scan)
//              Size: 'count' elements
//              Contains histogram on input, offsets on output
//
//   Binding 1: groupSums[]  - Block total sums for hierarchical scan
//              Size: ceil(count / 512) elements
//              Written by blockScan, read by next level
//
//   Binding 2: params       - Uniform with element count
//
//   Binding 3: scannedGroupSums[] - (for blockCombine only)
//              The group sums AFTER they've been scanned
//              Used to add block offsets in the combine phase
// ============================================================================

@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@group(0) @binding(1) var<storage, read_write> groupSums: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

/**
 * Workgroup Shared Memory
 *
 * Size: 512 elements (2 per thread × 256 threads)
 *
 * Used for:
 * - Loading data from global memory (coalesced)
 * - Performing the up-sweep and down-sweep in fast shared memory
 * - Avoiding global memory round-trips during the algorithm
 */
var<workgroup> temp: array<u32, 512>;

/**
 * Block Scan Kernel (Blelloch Algorithm)
 *
 * Performs an exclusive prefix sum on a block of 512 elements.
 * Each workgroup processes one block independently.
 *
 * Dispatch: ceil(count / 512) workgroups
 *
 * Input: data[] contains histogram counts
 * Output:
 *   - data[] contains local prefix sums within each block
 *   - groupSums[] contains the total sum of each block
 *
 * The local prefix sums will be adjusted by blockCombine to create
 * the global prefix sum.
 *
 * Example (block of 8 elements for clarity):
 *   Input:     [2, 1, 3, 2, 0, 1, 2, 1]
 *   After scan: [0, 2, 3, 6, 8, 8, 9, 11]  <- Local exclusive scan
 *   Block sum:  12 (saved to groupSums)
 */
@compute @workgroup_size(256)
fn blockScan(@builtin(global_invocation_id) global_id: vec3<u32>, @builtin(local_invocation_id) local_id: vec3<u32>, @builtin(workgroup_id) group_id: vec3<u32>) {
    let tid = local_id.x;       // Thread ID within workgroup [0, 255]
    let gid = global_id.x;      // Global thread ID
    let groupIndex = group_id.x; // Which block/workgroup

    // Each thread loads 2 elements (coalesced memory access pattern)
    let idx1 = 2u * gid;
    let idx2 = 2u * gid + 1u;
    let n = params.count;

    // Load from global memory to shared memory
    // Pad with 0 for elements beyond array bounds (handles non-power-of-2 sizes)
    if (idx1 < n) { temp[2u * tid] = data[idx1]; } else { temp[2u * tid] = 0u; }
    if (idx2 < n) { temp[2u * tid + 1u] = data[idx2]; } else { temp[2u * tid + 1u] = 0u; }

    // Synchronize: all threads must finish loading before we start the algorithm
    workgroupBarrier();

    // ========================================================================
    // PHASE 1: UP-SWEEP (REDUCTION)
    // ========================================================================
    // Build a tree of partial sums. After this phase, temp[511] contains
    // the total sum of all 512 elements.
    //
    // Iteration pattern (for 512 elements):
    //   d=256: 256 threads, offset=1  -> pairs at distance 1
    //   d=128: 128 threads, offset=2  -> pairs at distance 2
    //   d=64:   64 threads, offset=4  -> pairs at distance 4
    //   ...
    //   d=1:     1 thread,  offset=256 -> final pair at distance 256
    //
    // Each iteration halves the active threads and doubles the stride.
    var offset = 1u;
    for (var d = 256u; d > 0u; d = d >> 1u) {
        workgroupBarrier();
        if (tid < d) {
            // Indices into the binary tree:
            // ai = left child, bi = right child (bi = ai's sibling)
            let ai = offset * (2u * tid + 1u) - 1u;
            let bi = offset * (2u * tid + 2u) - 1u;
            // Sum flows up: right child = left + right
            temp[bi] = temp[bi] + temp[ai];
        }
        offset = offset * 2u;
    }

    // ========================================================================
    // SAVE BLOCK SUM & CLEAR ROOT
    // ========================================================================
    // Only thread 0 performs these operations (single-threaded section)
    if (tid == 0u) {
        // Save the total sum of this block for the next level of the hierarchy
        // This will be scanned to compute block offsets
        if (groupIndex < arrayLength(&groupSums)) {
            groupSums[groupIndex] = temp[511u];
        }
        // Clear the last element to start the down-sweep
        // This is what makes it an EXCLUSIVE scan (first output is 0)
        temp[511u] = 0u;
    }

    // ========================================================================
    // PHASE 2: DOWN-SWEEP (DISTRIBUTION)
    // ========================================================================
    // Propagate partial sums down the tree to compute prefix sums.
    //
    // At each node:
    //   1. Save left child value (t)
    //   2. Left child = current (parent's prefix sum)
    //   3. Right child = current + t (includes left subtree)
    //
    // Iteration pattern (reverse of up-sweep):
    //   d=1:     1 thread,  offset=256
    //   d=2:     2 threads, offset=128
    //   d=4:     4 threads, offset=64
    //   ...
    //   d=256: 256 threads, offset=1
    for (var d = 1u; d < 512u; d = d * 2u) {
        offset = offset >> 1u;
        workgroupBarrier();
        if (tid < d) {
            let ai = offset * (2u * tid + 1u) - 1u;
            let bi = offset * (2u * tid + 2u) - 1u;
            // Swap and accumulate
            let t = temp[ai];
            temp[ai] = temp[bi];
            temp[bi] = temp[bi] + t;
        }
    }

    // Final sync before writing results
    workgroupBarrier();

    // Write results back to global memory
    if (idx1 < n) { data[idx1] = temp[2u * tid]; }
    if (idx2 < n) { data[idx2] = temp[2u * tid + 1u]; }
}

// Binding for the combine phase (scanned group sums from level above)
@group(0) @binding(3) var<storage, read> scannedGroupSums: array<u32>;

/**
 * Block Combine Kernel
 *
 * After blockScan completes on all blocks:
 *   - Each block has its local exclusive scan
 *   - groupSums contains the total of each block
 *   - scannedGroupSums contains the exclusive scan of block totals
 *
 * This kernel adds the block's base offset to all elements in that block,
 * converting local scans to global scans.
 *
 * Example:
 *   Block 0 local scan: [0, 2, 5, 8]   scannedGroupSums[0] = 0
 *   Block 1 local scan: [0, 1, 4, 6]   scannedGroupSums[1] = 10
 *
 *   After combine:
 *   Block 0: [0, 2, 5, 8]     (unchanged, base = 0)
 *   Block 1: [10, 11, 14, 16] (each element + 10)
 *
 * Dispatch: ceil(count / 512) workgroups
 */
@compute @workgroup_size(256)
fn blockCombine(@builtin(global_invocation_id) global_id: vec3<u32>, @builtin(workgroup_id) group_id: vec3<u32>) {
    let groupIndex = group_id.x;

    // Block 0 already has the correct values (its base offset is 0)
    if (groupIndex == 0u) { return; }

    // Get the cumulative offset for this block from the scanned group sums
    // This is the sum of all elements in blocks 0 through (groupIndex - 1)
    let groupAdd = scannedGroupSums[groupIndex];

    // Each thread processes 2 elements
    let idx1 = 2u * global_id.x;
    let idx2 = 2u * global_id.x + 1u;
    let n = params.count;

    // Add the block offset to convert local scan to global scan
    if (idx1 < n) { data[idx1] = data[idx1] + groupAdd; }
    if (idx2 < n) { data[idx2] = data[idx2] + groupAdd; }
}
`,xe=`/**
 * ============================================================================
 * SUBGROUP-OPTIMIZED PARALLEL PREFIX SUM (SCAN) SHADER
 * ============================================================================
 *
 * Pipeline Stage: Part of Stage 3 (Counting Sort)
 * Entry Points: blockScan, blockCombine
 * Workgroup Size: 256 threads (processes 512 elements per workgroup)
 *
 * Purpose:
 * --------
 * Same as prefix_sum.wgsl but uses subgroup operations for massive speedup.
 * Subgroup operations execute in a single instruction across all lanes in
 * a subgroup (typically 32 lanes on NVIDIA, 64 on AMD).
 *
 * Key Optimization:
 * -----------------
 * The Blelloch algorithm requires O(log n) iterations for the up-sweep and
 * down-sweep phases. With subgroups, we can do the entire prefix sum within
 * a subgroup in ONE instruction using subgroupExclusiveAdd().
 *
 * Algorithm:
 * ----------
 * 1. Each thread loads 2 values (512 total per workgroup)
 * 2. For each value, use subgroupExclusiveAdd() for instant within-subgroup scan
 * 3. Last lane of each subgroup writes subgroup total to shared memory
 * 4. Sequential scan of subgroup totals (only ~8-16 values)
 * 5. Each thread adds its subgroup's base offset
 * 6. Write results back to global memory
 *
 * Performance:
 * ------------
 * - Reduces log(512) = 9 iterations to effectively 3-4 steps
 * - Eliminates most workgroupBarrier() calls
 * - Single instruction for 32/64 element prefix sums
 *
 * ============================================================================
 */

// Enable subgroup operations
enable subgroups;

/**
 * Scan Parameters Uniform Buffer
 */
struct Params {
  count: u32,
  pad0: vec3<u32>,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================

@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@group(0) @binding(1) var<storage, read_write> groupSums: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

/**
 * Workgroup Shared Memory
 *
 * Layout:
 * - temp[0..511]: Working space for 512 elements
 * - subgroupTotals[0..15]: Totals from each subgroup (256 threads / subgroup_size)
 */
var<workgroup> temp: array<u32, 512>;
var<workgroup> subgroupTotals: array<u32, 16>;  // Max 16 subgroups for 256 threads

/**
 * Block Scan Kernel (Subgroup-Optimized)
 *
 * Uses subgroupExclusiveAdd for instant within-subgroup prefix sums,
 * then combines subgroup results using shared memory.
 */
@compute @workgroup_size(256)
fn blockScan(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(local_invocation_id) local_id: vec3<u32>,
    @builtin(workgroup_id) group_id: vec3<u32>,
    @builtin(subgroup_size) sg_size: u32,
    @builtin(subgroup_invocation_id) sg_lane: u32
) {
    let tid = local_id.x;
    let gid = global_id.x;
    let groupIndex = group_id.x;
    let n = params.count;

    // Calculate subgroup ID within workgroup
    let sg_id = tid / sg_size;
    let num_subgroups = 256u / sg_size;

    // ========================================================================
    // PHASE 1: LOAD DATA
    // ========================================================================
    // Each thread loads 2 elements
    let idx1 = 2u * gid;
    let idx2 = 2u * gid + 1u;

    var val1 = 0u;
    var val2 = 0u;
    if (idx1 < n) { val1 = data[idx1]; }
    if (idx2 < n) { val2 = data[idx2]; }

    // ========================================================================
    // PHASE 2: SUBGROUP PREFIX SUM (Single instruction!)
    // ========================================================================
    // Compute prefix sum within each subgroup for both values
    // We process as pairs: first do val1, then val1+val2 for the second element

    // For the first element of each thread's pair
    let prefix1 = subgroupExclusiveAdd(val1);

    // Get the total of val1 within this subgroup (needed for val2's offset)
    let total1_in_subgroup = subgroupAdd(val1);

    // For the second element, we need: prefix of all val1's + prefix of val2's in earlier threads
    // But since we're processing pairs, we handle this differently

    // Store to shared memory: each thread writes its pair
    temp[2u * tid] = val1;
    temp[2u * tid + 1u] = val2;

    workgroupBarrier();

    // ========================================================================
    // PHASE 3: SEQUENTIAL SCAN WITHIN SHARED MEMORY (Hybrid approach)
    // ========================================================================
    // Now we have 512 elements. We'll use subgroup operations on chunks.
    //
    // Approach: Each thread processes 2 elements using subgroup operations
    // Thread k handles elements at position (k*2) and (k*2+1)
    // Combined value for subgroup scan = val1 + val2

    let combined = val1 + val2;

    // Subgroup exclusive scan on combined values
    // This gives us the sum of all pairs BEFORE this thread within the subgroup
    let sg_prefix = subgroupExclusiveAdd(combined);

    // Get subgroup total (sum of all combined values in this subgroup)
    let sg_total = subgroupAdd(combined);

    // Last lane in each subgroup stores the subgroup total
    if (sg_lane == sg_size - 1u) {
        subgroupTotals[sg_id] = sg_total;
    }

    workgroupBarrier();

    // ========================================================================
    // PHASE 4: SCAN SUBGROUP TOTALS
    // ========================================================================
    // Only thread 0 scans the subgroup totals (sequential but tiny: 4-8 values)
    if (tid == 0u) {
        var running = 0u;
        for (var i = 0u; i < num_subgroups; i++) {
            let t = subgroupTotals[i];
            subgroupTotals[i] = running;
            running += t;
        }
        // Save block total for hierarchical scan
        if (groupIndex < arrayLength(&groupSums)) {
            groupSums[groupIndex] = running;
        }
    }

    workgroupBarrier();

    // ========================================================================
    // PHASE 5: COMPUTE FINAL VALUES
    // ========================================================================
    // Final prefix for each pair = subgroup base offset + within-subgroup prefix
    let base_offset = subgroupTotals[sg_id];
    let pair_prefix = base_offset + sg_prefix;

    // Write results:
    // First element's prefix = pair_prefix
    // Second element's prefix = pair_prefix + val1
    if (idx1 < n) { data[idx1] = pair_prefix; }
    if (idx2 < n) { data[idx2] = pair_prefix + val1; }
}

// Binding for the combine phase
@group(0) @binding(3) var<storage, read> scannedGroupSums: array<u32>;

/**
 * Block Combine Kernel
 *
 * Adds the scanned block offset to each element in the block.
 * Same as original - subgroup operations don't help here since
 * we're just adding a uniform value to all elements.
 */
@compute @workgroup_size(256)
fn blockCombine(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(workgroup_id) group_id: vec3<u32>
) {
    let groupIndex = group_id.x;

    // Block 0 already has correct values
    if (groupIndex == 0u) { return; }

    let groupAdd = scannedGroupSums[groupIndex];
    let idx1 = 2u * global_id.x;
    let idx2 = 2u * global_id.x + 1u;
    let n = params.count;

    if (idx1 < n) { data[idx1] = data[idx1] + groupAdd; }
    if (idx2 < n) { data[idx2] = data[idx2] + groupAdd; }
}
`,ve=`/**
 * ============================================================================
 * CONTENTION-FREE SCATTER KERNEL
 * ============================================================================
 *
 * Pipeline Stage: Final step of Stage 3
 * Entry Point: scatter
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Places particles into their sorted positions.
 *
 * Optimization: "Rank + Start"
 * - Instead of atomicAdd on global memory (which causes high contention),
 *   we use the precomputed \`particleCellOffsets\` (Rank) and \`sortOffsets\` (Start).
 * - Destination = Start + Rank.
 * - This is 100% parallel and contention-free.
 *
 * ============================================================================
 */

// Beginner note: scatter computes each particle’s final sorted slot so
// neighbors in the same cell become contiguous in memory.

/**
 * Sort Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    particleCount   - Total number of particles
 *   4      4    gridTotalCells  - Total cells in the linear grid
 *   8      8    pad0            - Padding for 16-byte alignment
 * ------
 * Total: 16 bytes
 */
struct SortParams {
  particleCount: u32,
  gridTotalCells: u32,
  pad0: vec2<u32>,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Contention-free scatter compute pass
//
//   Binding 0: keys[]               - Linear grid indices from hash_linear.wgsl
//              Used to look up the cell's start offset
//
//   Binding 1: sortOffsets[]        - Prefix-sum result (cell start offsets)
//              Read-only via atomicLoad (no concurrent writes)
//
//   Binding 2: indices[]            - Output: sorted index mapping
//              indices[dest] = original particle index
//
//   Binding 3: params               - Uniform with particle count
//
//   Binding 4: particleCellOffsets[] - Per-particle rank within its cell
//              Computed by countOffsets in sort_linear.wgsl
// ============================================================================

@group(0) @binding(0) var<storage, read> keys: array<u32>;
@group(0) @binding(1) var<storage, read_write> sortOffsets: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> indices: array<u32>;
@group(0) @binding(3) var<uniform> params: SortParams;
@group(0) @binding(4) var<storage, read> particleCellOffsets: array<u32>;

/**
 * Contention-Free Scatter Kernel
 *
 * Places each particle at its sorted position using:
 *   dest = start + rank
 *
 * Where:
 *   start = sortOffsets[key]           (from prefix sum — cell start index)
 *   rank  = particleCellOffsets[index] (from countOffsets — particle's local offset)
 *
 * This avoids the atomicAdd used in the spatial-hash scatter, making the
 * write pattern fully deterministic and contention-free. Each particle
 * writes to a unique destination with no synchronisation needed.
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check: one thread per particle
  if (index >= params.particleCount) {
    return;
  }

  let key = keys[index];

  // Read the cell's start offset (no mutation — just a load)
  let start = atomicLoad(&sortOffsets[key]);

  // Read the pre-computed rank of this particle within its cell
  let localOffset = particleCellOffsets[index];

  // Compute the unique destination: start of cell + particle's rank
  let dest = start + localOffset;

  // Write the original particle index to the sorted position
  indices[dest] = index;
}
`,re=`/**
 * ============================================================================
 * PARTICLE REORDERING KERNELS
 * ============================================================================
 *
 * Pipeline Stage: Stage 4 (After spatial hash sorting)
 * Entry Points: reorder, copyBack
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Physically rearranges particle data in memory to match the sorted order.
 * This is crucial for cache-efficient neighbor search.
 *
 * Why Physical Reordering Matters:
 * --------------------------------
 * Without reordering (using indirect lookup):
 *
 *   Memory Layout:        [P0] [P1] [P2] [P3] [P4] [P5] [P6] [P7]
 *   Sorted Indices:       [3, 7, 1, 5, 0, 2, 4, 6]
 *
 *   To access neighbors of particle in sorted position 0:
 *     Read P3 (memory addr 3) - CACHE MISS
 *     Read P7 (memory addr 7) - CACHE MISS (likely evicted P3's cache line)
 *     Read P1 (memory addr 1) - CACHE MISS
 *     ... random access pattern = terrible cache performance
 *
 * With physical reordering:
 *
 *   Original:             [P0] [P1] [P2] [P3] [P4] [P5] [P6] [P7]
 *   After Reorder:        [P3] [P7] [P1] [P5] [P0] [P2] [P4] [P6]
 *   (particles in same cell are now contiguous)
 *
 *   To access neighbors in cell 0:
 *     Read position 0 - CACHE MISS (loads cache line)
 *     Read position 1 - CACHE HIT (same cache line)
 *     Read position 2 - CACHE HIT (same or adjacent cache line)
 *     ... sequential access pattern = excellent cache performance
 *
 * Performance Impact:
 * -------------------
 *   - Random memory access: ~100-300 cycles per load (cache miss)
 *   - Sequential access: ~4-10 cycles per load (cache hit)
 *   - For neighbor search with ~50 neighbors, that's 5-30x speedup!
 *
 * Two-Kernel Design:
 * ------------------
 *   1. reorder: Copy from original → sorted buffers (gather)
 *   2. copyBack: Copy from sorted → original buffers (simple copy)
 *
 * Why not in-place?
 *   - Parallel in-place permutation is complex and requires synchronization
 *   - Double-buffering (sorted buffers) is simpler and equally fast
 *   - GPUs have plenty of memory bandwidth for the extra copy
 *
 * Data Flow:
 * ----------
 *   Before reorder:
 *     positions[]       = [P0, P1, P2, P3, P4, P5, P6, P7]  (original order)
 *     indices[]         = [3, 7, 1, 5, 0, 2, 4, 6]          (sorted order mapping)
 *
 *   After reorder:
 *     positionsSorted[] = [P3, P7, P1, P5, P0, P2, P4, P6]  (spatially sorted)
 *
 *   After copyBack:
 *     positions[]       = [P3, P7, P1, P5, P0, P2, P4, P6]  (for next frame)
 *
 * ============================================================================
 */

// Beginner note: reorder copies particle data into sorted buffers;
// copyBack writes sorted data back to the primary arrays.

/**
 * Reorder Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    particleCount   - Total number of particles to reorder
 *   4     12    pad0            - Padding for 16-byte alignment
 * ------
 * Total: 16 bytes
 */
struct SortParams {
  particleCount: u32,
  pad0: vec3<u32>,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Reorder/CopyBack compute pass
//
//   Binding 0: indices[]          - Sorted index mapping (from scatter.wgsl)
//              indices[i] = original particle index that belongs at sorted position i
//
//   Binding 1: positions[]        - Original particle positions (source for reorder)
//   Binding 2: velocities[]       - Original particle velocities
//   Binding 3: predicted[]        - Original predicted positions
//
//   Binding 4: positionsSorted[]  - Destination for reordered positions
//   Binding 5: velocitiesSorted[] - Destination for reordered velocities
//   Binding 6: predictedSorted[]  - Destination for reordered predicted positions
//
//   Binding 7: params             - Uniform with particle count
//
// Memory Layout per particle:
//   vec4<f32> = 16 bytes (xyz + padding/w component)
//   Total per particle: 48 bytes (3 vec4s)
// ============================================================================

@group(0) @binding(0) var<storage, read> indices: array<u32>;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> positionsSorted: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> velocitiesSorted: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> predictedSorted: array<vec4<f32>>;
@group(0) @binding(7) var<uniform> params: SortParams;

/**
 * Reorder Kernel (Gather Operation)
 *
 * Rearranges particle data from original order to sorted order.
 *
 * This is a "gather" operation:
 *   - Sequential writes to sorted buffer (good for coalescing)
 *   - Random reads from original buffer (unavoidable)
 *
 * Why gather instead of scatter?
 *   - GPU memory writes are more expensive to coalesce than reads
 *   - Sequential writes + random reads > random writes + sequential reads
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn reorder(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;

  // Bounds check
  if (i >= params.particleCount) { return; }

  // indices[i] tells us which original particle belongs at sorted position i
  // This is the mapping computed by the counting sort scatter phase
  let sortedIndex = indices[i];

  // Gather: Read from scattered location, write to contiguous location
  //
  // sortedIndex may be anywhere in [0, particleCount)
  // i is sequential across threads in a workgroup
  //
  // After this, particles in the same grid cell are contiguous in the
  // sorted buffers, enabling cache-efficient neighbor search
  positionsSorted[i] = positions[sortedIndex];
  velocitiesSorted[i] = velocities[sortedIndex];
  predictedSorted[i] = predicted[sortedIndex];
}

/**
 * CopyBack Kernel
 *
 * Copies sorted data back to the primary buffers for use in the next frame.
 *
 * Why copy back?
 *   - The simulation uses positions[], velocities[], predicted[] as primary buffers
 *   - Density, pressure, viscosity shaders read from these buffers
 *   - After reorder, the sorted data is in the "Sorted" buffers
 *   - This copy makes the sorted order the canonical order
 *
 * Alternative design (not used):
 *   - Swap buffer pointers instead of copying
 *   - More complex buffer management, minimal performance gain
 *   - Current approach is simpler and memory bandwidth is not the bottleneck
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn copyBack(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;

  // Bounds check
  if (i >= params.particleCount) { return; }

  // Simple linear copy (excellent memory coalescing)
  // Both reads and writes are sequential across threads
  positions[i] = positionsSorted[i];
  velocities[i] = velocitiesSorted[i];
  predicted[i] = predictedSorted[i];
}
`;class Xe{device;hashPipeline;clearOffsetsPipeline;countOffsetsPipeline;prefixScanPipeline;prefixCombinePipeline;scatterPipeline;reorderPipeline;copyBackPipeline;hashBG;clearBG;countBG;scanL0BG;scanL1BG;scanL2BG;combineL1BG;combineL0BG;scatterBG;reorderBG;copyBackBG;constructor(e,t=!1){this.device=e;const r=t?xe:be;t&&console.log("SpatialGrid: Using subgroup-optimized prefix sum"),this.hashPipeline=this.createPipeline(ye,"main"),this.clearOffsetsPipeline=this.createPipeline(ie,"clearOffsets"),this.countOffsetsPipeline=this.createPipeline(ie,"countOffsets"),this.prefixScanPipeline=this.createPipeline(r,"blockScan"),this.prefixCombinePipeline=this.createPipeline(r,"blockCombine"),this.scatterPipeline=this.createPipeline(ve,"scatter"),this.reorderPipeline=this.createPipeline(re,"reorder"),this.copyBackPipeline=this.createPipeline(re,"copyBack")}createPipeline(e,t){return this.device.createComputePipeline({layout:"auto",compute:{module:this.device.createShaderModule({code:e}),entryPoint:t}})}createBindGroups(e,t){if(!e.particleCellOffsets)throw new Error("SpatialGrid requires FluidBuffers allocated with gridTotalCells (Linear Grid mode).");this.hashBG=this.device.createBindGroup({layout:this.hashPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.predicted}},{binding:1,resource:{buffer:e.keys}},{binding:2,resource:{buffer:e.indices}},{binding:3,resource:{buffer:t.hash}}]}),this.clearBG=this.device.createBindGroup({layout:this.clearOffsetsPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.sortOffsets}},{binding:1,resource:{buffer:t.sort}}]}),this.countBG=this.device.createBindGroup({layout:this.countOffsetsPipeline.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:e.keys}},{binding:1,resource:{buffer:e.sortOffsets}},{binding:2,resource:{buffer:t.sort}},{binding:3,resource:{buffer:e.particleCellOffsets}}]}),this.scanL0BG=this.device.createBindGroup({layout:this.prefixScanPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.sortOffsets}},{binding:1,resource:{buffer:e.groupSumsL1}},{binding:2,resource:{buffer:t.scanL0}}]}),this.scanL1BG=this.device.createBindGroup({layout:this.prefixScanPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.groupSumsL1}},{binding:1,resource:{buffer:e.groupSumsL2}},{binding:2,resource:{buffer:t.scanL1}}]}),this.scanL2BG=this.device.createBindGroup({layout:this.prefixScanPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.groupSumsL2}},{binding:1,resource:{buffer:e.scanScratch}},{binding:2,resource:{buffer:t.scanL2}}]}),this.combineL1BG=this.device.createBindGroup({layout:this.prefixCombinePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.groupSumsL1}},{binding:2,resource:{buffer:t.scanL1}},{binding:3,resource:{buffer:e.groupSumsL2}}]}),this.combineL0BG=this.device.createBindGroup({layout:this.prefixCombinePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.sortOffsets}},{binding:2,resource:{buffer:t.scanL0}},{binding:3,resource:{buffer:e.groupSumsL1}}]}),this.scatterBG=this.device.createBindGroup({layout:this.scatterPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.keys}},{binding:1,resource:{buffer:e.sortOffsets}},{binding:2,resource:{buffer:e.indices}},{binding:3,resource:{buffer:t.sort}},{binding:4,resource:{buffer:e.particleCellOffsets}}]}),this.reorderBG=this.device.createBindGroup({layout:this.reorderPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.indices}},{binding:1,resource:{buffer:e.positions}},{binding:2,resource:{buffer:e.velocities}},{binding:3,resource:{buffer:e.predicted}},{binding:4,resource:{buffer:e.positionsSorted}},{binding:5,resource:{buffer:e.velocitiesSorted}},{binding:6,resource:{buffer:e.predictedSorted}},{binding:7,resource:{buffer:t.sort}}]}),this.copyBackBG=this.device.createBindGroup({layout:this.copyBackPipeline.getBindGroupLayout(0),entries:[{binding:1,resource:{buffer:e.positions}},{binding:2,resource:{buffer:e.velocities}},{binding:3,resource:{buffer:e.predicted}},{binding:4,resource:{buffer:e.positionsSorted}},{binding:5,resource:{buffer:e.velocitiesSorted}},{binding:6,resource:{buffer:e.predictedSorted}},{binding:7,resource:{buffer:t.sort}}]})}dispatch(e,t,r){const i=Math.ceil(t/256),s=Math.ceil((r+1)/512),o=Math.ceil(s/512),a=Math.ceil(o/512);e.setPipeline(this.hashPipeline),e.setBindGroup(0,this.hashBG),e.dispatchWorkgroups(i),e.setPipeline(this.clearOffsetsPipeline),e.setBindGroup(0,this.clearBG),e.dispatchWorkgroups(Math.ceil((r+1)/256)),e.setPipeline(this.countOffsetsPipeline),e.setBindGroup(1,this.countBG),e.dispatchWorkgroups(i),e.setPipeline(this.prefixScanPipeline),e.setBindGroup(0,this.scanL0BG),e.dispatchWorkgroups(s),s>1&&(e.setBindGroup(0,this.scanL1BG),e.dispatchWorkgroups(o)),o>1&&(e.setBindGroup(0,this.scanL2BG),e.dispatchWorkgroups(a)),e.setPipeline(this.prefixCombinePipeline),o>1&&(e.setBindGroup(0,this.combineL1BG),e.dispatchWorkgroups(o)),s>1&&(e.setBindGroup(0,this.combineL0BG),e.dispatchWorkgroups(s)),e.setPipeline(this.scatterPipeline),e.setBindGroup(0,this.scatterBG),e.dispatchWorkgroups(i),e.setPipeline(this.reorderPipeline),e.setBindGroup(0,this.reorderBG),e.dispatchWorkgroups(i),e.setPipeline(this.copyBackPipeline),e.setBindGroup(0,this.copyBackBG),e.dispatchWorkgroups(i)}}const Pe=`/**
 * ============================================================================
 * EXTERNAL FORCES & PREDICTION SHADER
 * ============================================================================
 *
 * Pipeline Stage: 1 of 8 (First compute pass)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * This shader kicks off each simulation frame by:
 *   1. Applying external forces (gravity, user interaction)
 *   2. Updating velocities based on accumulated acceleration
 *   3. Computing predicted positions for spatial hashing
 *
 * Position Based Dynamics (PBD) Prediction:
 * -----------------------------------------
 * Instead of using current positions for neighbor search, we predict where
 * particles WILL be at the end of the timestep. This improves stability:
 *
 *   predicted[i] = position[i] + velocity[i] * predictionFactor
 *
 * The prediction factor (1/120) is tuned to match typical simulation rates.
 * Using predicted positions ensures that pressure forces are calculated
 * based on the future configuration, preventing particles from "overshooting"
 * and penetrating each other.
 *
 * Interactive Force Model:
 * ------------------------
 * When the user clicks/drags, particles within 'interactionRadius' experience:
 *
 *   - Pull (positive strength): Attracted toward input point
 *   - Push (negative strength): Repelled from input point
 *
 * The force uses a smooth falloff from center (100%) to edge (0%):
 *
 *   centreT = 1 - (distance / radius)
 *   force = direction * centreT * interactionStrength
 *
 * A velocity damping term (-vel * centreT) is applied near the interaction
 * center to prevent particles from orbiting/exploding at the click point.
 *
 * Data Flow:
 * ----------
 *   Input:
 *     - positions[]     : Current particle positions (read-only)
 *     - velocities[]    : Current velocities (read-write)
 *     - params          : Simulation parameters
 *
 *   Output:
 *     - velocities[]    : Updated with acceleration * dt
 *     - predicted[]     : Predicted position for spatial hashing
 *
 * ============================================================================
 */

// Beginner note: one invocation = one particle. The compute grid is 1D (id.x).
// Uniforms are tiny per-frame constants; storage buffers hold all particles.

/**
 * Simulation Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned for WebGPU):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    deltaTime           - Frame timestep in seconds
 *   4      4    gravity             - Gravity acceleration (typically -9.8)
 *   8      4    interactionRadius   - Mouse interaction sphere radius
 *  12      4    interactionStrength - Force magnitude (+ = pull, - = push)
 *  16     16    inputPoint          - 3D mouse position (vec4, w unused)
 * ------
 * Total: 32 bytes
 */
struct SimParams {
  deltaTime: f32,
  gravity: f32,
  interactionRadius: f32,
  interactionStrength: f32,
  inputPoint: vec4<f32>,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: External Forces compute pass
//
//   Binding 0: positions[]  - Current particle positions (read-only)
//              Format: vec4<f32> per particle, xyz = position, w = 1.0
//
//   Binding 1: velocities[] - Particle velocities (read-write)
//              Format: vec4<f32> per particle, xyz = velocity, w = 0.0
//
//   Binding 2: predicted[]  - Output predicted positions for spatial hashing
//              Format: vec4<f32> per particle, xyz = predicted pos, w = 1.0
//
//   Binding 3: params       - Uniform parameters for this pass
// ============================================================================

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> params: SimParams;

/**
 * Main Compute Kernel
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 * Each thread processes exactly one particle.
 *
 * Algorithm:
 * 1. Early exit if thread index exceeds particle count
 * 2. Load current position and velocity
 * 3. Compute gravity acceleration (constant downward force)
 * 4. If user interaction is active:
 *    a. Check if particle is within interaction radius
 *    b. Compute smooth falloff factor (1 at center, 0 at edge)
 *    c. Apply interaction force toward/away from input point
 *    d. Apply velocity damping to prevent orbital instability
 *    e. Optionally reduce gravity (for "lifting" effect during pull)
 * 5. Integrate velocity: v_new = v_old + accel * dt
 * 6. Predict position: pred = pos + vel * (1/120)
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check: Ensure we don't access beyond the buffer
  // Note: arrayLength() returns the number of elements, not bytes
  if (index >= arrayLength(&positions)) {
    return;
  }

  // Load current state
  // .xyz extracts the 3D vector, ignoring the w component
  let pos = positions[index].xyz;
  var vel = velocities[index].xyz;

  // ========================================================================
  // GRAVITY FORCE
  // ========================================================================
  // Constant downward acceleration (Y-axis is up in this coordinate system)
  // Typical value: -9.8 m/s² for Earth-like gravity
  let gravityAccel = vec3<f32>(0.0, params.gravity, 0.0);
  var finalAccel = gravityAccel;

  // ========================================================================
  // USER INTERACTION FORCE
  // ========================================================================
  // Only compute if user is actively interacting (strength != 0)
  // interactionStrength > 0 = pull toward cursor
  // interactionStrength < 0 = push away from cursor
  if (params.interactionStrength != 0.0) {
      // Vector from particle to input point
      let offset = params.inputPoint.xyz - pos;
      let sqrDst = dot(offset, offset);  // Squared distance (avoid sqrt when possible)
      let radius = params.interactionRadius;

      // Check if particle is within interaction sphere
      // Also check sqrDst > epsilon to avoid division by zero at exact center
      if (sqrDst < radius * radius && sqrDst > 0.000001) {
          let dst = sqrt(sqrDst);

          // Smooth falloff function:
          //   edgeT = 0 at center, 1 at edge
          //   centreT = 1 at center, 0 at edge
          // This creates a smooth force field that's strongest at the click point
          let edgeT = dst / radius;
          let centreT = 1.0 - edgeT;

          // Normalized direction toward input point
          let dirToCentre = offset / dst;

          // Reduce gravity influence when pulling (creates a "lifting" effect)
          // saturate() clamps to [0, 1] range
          // At strength=10, gravity is completely cancelled at the center
          let gravityWeight = 1.0 - (centreT * saturate(params.interactionStrength / 10.0));

          // Interaction acceleration: scales with distance falloff and strength
          let interactionAccel = dirToCentre * centreT * params.interactionStrength;

          // Final acceleration combines:
          //   1. Gravity (optionally reduced during pull)
          //   2. Interaction force (toward or away from cursor)
          //   3. Velocity damping (prevents particles from orbiting the cursor)
          // The damping term (-vel * centreT) is crucial for stable interaction
          finalAccel = gravityAccel * gravityWeight + interactionAccel - vel * centreT;
      }
  }

  // ========================================================================
  // VELOCITY INTEGRATION
  // ========================================================================
  // Semi-implicit Euler: v(t+dt) = v(t) + a(t) * dt
  // Position will be updated in the integrate shader after pressure/viscosity
  vel = vel + finalAccel * params.deltaTime;
  velocities[index] = vec4<f32>(vel, 0.0);

  // ========================================================================
  // POSITION PREDICTION (PBD)
  // ========================================================================
  // Predict where the particle will be at the end of this frame.
  // This predicted position is used for spatial hashing (neighbor search).
  //
  // Why 1/120?
  //   - Matches common simulation tick rates (120 Hz)
  //   - Provides a good balance between prediction accuracy and stability
  //   - Consistent with the Unity reference implementation
  //
  // Note: The actual position update uses the full deltaTime in integrate.wgsl
  let predictionFactor = 1.0 / 120.0;
  predicted[index] = vec4<f32>(pos + vel * predictionFactor, 1.0);
}
`,Se=`/**
 * ============================================================================
 * DENSITY KERNEL (LINEAR GRID + STRIP OPTIMIZATION)
 * ============================================================================
 *
 * Pipeline Stage: Stage 5
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Computes fluid density using the Linear Grid for O(1) neighbor search.
 *
 * Optimization: Strip Processing
 * ------------------------------
 * Instead of checking 27 individual neighbor cells, we iterate over 3 Z-planes
 * and 3 Y-rows. Inside each Y-row, the X-cells are contiguous in the Linear Grid Index.
 *
 *   Row: [ Cell(x-1), Cell(x), Cell(x+1) ]
 *
 * Because indices are contiguous:
 *   Key(x-1) = K
 *   Key(x)   = K + 1
 *   Key(x+1) = K + 2
 *
 * We can fetch the particle range for the ENTIRE strip in one go:
 *   Start = sortOffsets[Key(x-1)]
 *   End   = sortOffsets[Key(x+1) + 1]
 *
 * This reduces 27 loop setups to 9, and eliminates the "if (key != target)" check
 * inside the inner loop, drastically reducing memory bandwidth.
 * ============================================================================
 */

// Beginner note: this pass reads predicted positions + sortOffsets and writes
// per-particle density/near-density for the pressure solver.

/**
 * Density Parameters Uniform Buffer
 *
 * Memory Layout (48 bytes):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    radius          - Smoothing radius h (= grid cell size)
 *   4      4    spikyPow2Scale  - Normalisation for (h-r)² kernel: 15/(2πh⁵)
 *   8      4    spikyPow3Scale  - Normalisation for (h-r)³ kernel: 15/(πh⁶)
 *  12      4    particleCountF  - Particle count as f32 (for GPU convenience)
 *  16     12    minBounds       - Minimum corner of simulation domain (xyz)
 *  28      4    pad0            - Padding
 *  32     12    gridRes         - Grid resolution per axis (xyz as f32)
 *  44      4    pad1            - Padding
 * ------
 * Total: 48 bytes
 */
struct DensityParams {
  radius: f32,
  spikyPow2Scale: f32,
  spikyPow3Scale: f32,
  particleCountF: f32,
  minBounds: vec3<f32>,
  pad0: f32,
  gridRes: vec3<f32>,
  pad1: f32,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Density compute pass (Linear Grid)
//
//   Binding 0: predicted[]   - Predicted particle positions (spatially sorted)
//              Used for distance calculations during neighbor iteration
//
//   Binding 1: sortOffsets[] - Cell start/end offsets from prefix sum
//              Used for strip-optimised neighbor lookup
//
//   Binding 2: densities[]   - Output: (density, nearDensity) per particle
//              vec2<f32>: x = standard density, y = near-density
//
//   Binding 3: params        - Uniform density parameters
// ============================================================================

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> sortOffsets: array<u32>;
@group(0) @binding(2) var<storage, read_write> densities: array<vec2<f32>>;
@group(0) @binding(3) var<uniform> params: DensityParams;

/**
 * Converts 3D integer cell coordinates to a linear grid index.
 *
 * Uses row-major linearisation: index = x + width × (y + height × z).
 * The caller must ensure coordinates are within [0, gridRes - 1].
 */
fn getGridIndex(x: i32, y: i32, z: i32) -> u32 {
    let gridRes = vec3<u32>(params.gridRes);
    return u32(x) + gridRes.x * (u32(y) + gridRes.y * u32(z));
}

/** Spiky² kernel: W(r,h) = (h-r)² × scale. Compact support: 0 for r ≥ h. */
fn spikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * scale;
  }
  return 0.0;
}

/** Spiky³ kernel: W(r,h) = (h-r)³ × scale. Sharper falloff for near-density. */
fn spikyPow3(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * v * scale;
  }
  return 0.0;
}

/**
 * Main Density Compute Kernel (Strip-Optimised)
 *
 * For each particle, iterates over the 3×3 neighborhood of Y-Z rows.
 * Within each row, the X-cells are contiguous in the linear grid, so we
 * fetch the particle range for the entire 3-cell strip in one go:
 *   start = sortOffsets[getGridIndex(minX, y, z)]
 *   end   = sortOffsets[getGridIndex(maxX, y, z) + 1]
 *
 * This reduces 27 separate cell lookups to 9 strips and eliminates the
 * per-particle key comparison in the inner loop.
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);

  if (i >= count) { return; }

  let pos = predicted[i].xyz;
  let gridRes = vec3<i32>(params.gridRes);

  let localPos = pos - params.minBounds;
  let cellX = i32(floor(localPos.x / params.radius));
  let cellY = i32(floor(localPos.y / params.radius));
  let cellZ = i32(floor(localPos.z / params.radius));
  
  let cx = clamp(cellX, 0, gridRes.x - 1);
  let cy = clamp(cellY, 0, gridRes.y - 1);
  let cz = clamp(cellZ, 0, gridRes.z - 1);

  var density = 0.0;
  var nearDensity = 0.0;
  let radiusSq = params.radius * params.radius;

  // Search ranges
  let minZ = max(0, cz - 1);
  let maxZ = min(gridRes.z - 1, cz + 1);
  let minY = max(0, cy - 1);
  let maxY = min(gridRes.y - 1, cy + 1);
  let minX = max(0, cx - 1);
  let maxX = min(gridRes.x - 1, cx + 1);

  // Strip Optimization Loop
  for (var z = minZ; z <= maxZ; z++) {
    for (var y = minY; y <= maxY; y++) {
      let startKey = getGridIndex(minX, y, z);
      let endKey = getGridIndex(maxX, y, z);
      
      let start = sortOffsets[startKey];
      let end = sortOffsets[endKey + 1u];

      for (var j = start; j < end; j++) {
          let neighborPos = predicted[j].xyz;
          let offset = neighborPos - pos;
          let dstSq = dot(offset, offset);

          if (dstSq <= radiusSq) {
              let dst = sqrt(dstSq);
              density = density + spikyPow2(dst, params.radius, params.spikyPow2Scale);
              nearDensity = nearDensity + spikyPow3(dst, params.radius, params.spikyPow3Scale);
          }
      }
    }
  }

  densities[i] = vec2<f32>(density, nearDensity);
}
`,we=`/**
 * ============================================================================
 * DENSITY KERNEL (SHARED MEMORY OPTIMIZATION)
 * ============================================================================
 *
 * Pipeline Stage: Stage 5
 * Entry Point: main
 * Workgroup Size: 64 threads (optimized for mobile GPUs)
 *
 * Purpose:
 * --------
 * Computes fluid density using workgroup shared memory to reduce global
 * memory bandwidth. This is especially beneficial for mobile GPUs.
 *
 * Optimization Strategy:
 * ----------------------
 * Since particles are sorted by cell (from the spatial grid), particles in
 * the same workgroup tend to be spatially close. We exploit this by:
 *
 *   1. Computing a workgroup-wide bounding box of neighbor cells
 *   2. Collaboratively loading ALL potential neighbors into shared memory
 *   3. Each thread filters to its actual neighbors during computation
 *
 * This trades some extra distance checks for much faster memory access.
 *
 * Why this works:
 * ---------------
 * Sorted particles → nearby particles in same workgroup → overlapping neighbors
 * → shared memory is reused by multiple threads → reduced global memory reads
 *
 * Memory: ~8KB shared memory (512 × vec3 × 4 bytes = 6KB + overhead)
 *
 * ============================================================================
 */

const TILE_SIZE: u32 = 512u;
const WORKGROUP_SIZE: u32 = 64u;

struct DensityParams {
  radius: f32,
  spikyPow2Scale: f32,
  spikyPow3Scale: f32,
  particleCountF: f32,
  minBounds: vec3<f32>,
  pad0: f32,
  gridRes: vec3<f32>,
  pad1: f32,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> sortOffsets: array<u32>;
@group(0) @binding(2) var<storage, read_write> densities: array<vec2<f32>>;
@group(0) @binding(3) var<uniform> params: DensityParams;

// Shared memory for neighbor positions
var<workgroup> sharedPositions: array<vec3<f32>, TILE_SIZE>;

// Workgroup-shared bounds (computed collaboratively)
var<workgroup> wgMinCell: vec3<i32>;
var<workgroup> wgMaxCell: vec3<i32>;
var<workgroup> wgNeighborStart: u32;
var<workgroup> wgNeighborEnd: u32;

// Atomics for workgroup reduction
var<workgroup> wgMinX: atomic<i32>;
var<workgroup> wgMinY: atomic<i32>;
var<workgroup> wgMinZ: atomic<i32>;
var<workgroup> wgMaxX: atomic<i32>;
var<workgroup> wgMaxY: atomic<i32>;
var<workgroup> wgMaxZ: atomic<i32>;

fn getGridIndex(x: i32, y: i32, z: i32) -> u32 {
  let gridRes = vec3<u32>(params.gridRes);
  return u32(x) + gridRes.x * (u32(y) + gridRes.y * u32(z));
}

fn spikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * scale;
  }
  return 0.0;
}

fn spikyPow3(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * v * scale;
  }
  return 0.0;
}

@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) globalId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(workgroup_id) workgroupId: vec3<u32>
) {
  let particleIndex = globalId.x;
  let localIndex = localId.x;
  let particleCount = u32(params.particleCountF + 0.5);
  let gridRes = vec3<i32>(params.gridRes);

  let hasParticle = particleIndex < particleCount;

  // =========================================================================
  // PHASE 1: Compute workgroup-wide neighbor bounds
  // =========================================================================

  // Initialize atomics (thread 0 only)
  if (localIndex == 0u) {
    atomicStore(&wgMinX, gridRes.x);
    atomicStore(&wgMinY, gridRes.y);
    atomicStore(&wgMinZ, gridRes.z);
    atomicStore(&wgMaxX, -1);
    atomicStore(&wgMaxY, -1);
    atomicStore(&wgMaxZ, -1);
  }
  workgroupBarrier();

  // Each thread contributes its neighbor bounds
  var pos = vec3<f32>(0.0);
  var myCellX: i32 = 0;
  var myCellY: i32 = 0;
  var myCellZ: i32 = 0;

  if (hasParticle) {
    pos = predicted[particleIndex].xyz;
    let localPos = pos - params.minBounds;
    myCellX = clamp(i32(floor(localPos.x / params.radius)), 0, gridRes.x - 1);
    myCellY = clamp(i32(floor(localPos.y / params.radius)), 0, gridRes.y - 1);
    myCellZ = clamp(i32(floor(localPos.z / params.radius)), 0, gridRes.z - 1);

    // Neighbor range for this particle (3x3x3 neighborhood)
    let minX = max(0, myCellX - 1);
    let minY = max(0, myCellY - 1);
    let minZ = max(0, myCellZ - 1);
    let maxX = min(gridRes.x - 1, myCellX + 1);
    let maxY = min(gridRes.y - 1, myCellY + 1);
    let maxZ = min(gridRes.z - 1, myCellZ + 1);

    // Atomic min/max to find workgroup bounds
    atomicMin(&wgMinX, minX);
    atomicMin(&wgMinY, minY);
    atomicMin(&wgMinZ, minZ);
    atomicMax(&wgMaxX, maxX);
    atomicMax(&wgMaxY, maxY);
    atomicMax(&wgMaxZ, maxZ);
  }
  workgroupBarrier();

  // Thread 0 computes the neighbor range
  if (localIndex == 0u) {
    let minX = atomicLoad(&wgMinX);
    let minY = atomicLoad(&wgMinY);
    let minZ = atomicLoad(&wgMinZ);
    let maxX = atomicLoad(&wgMaxX);
    let maxY = atomicLoad(&wgMaxY);
    let maxZ = atomicLoad(&wgMaxZ);

    wgMinCell = vec3<i32>(minX, minY, minZ);
    wgMaxCell = vec3<i32>(maxX, maxY, maxZ);

    // Get particle index range for the bounding box
    if (maxX >= 0 && maxY >= 0 && maxZ >= 0) {
      let startKey = getGridIndex(minX, minY, minZ);
      let endKey = getGridIndex(maxX, maxY, maxZ);
      wgNeighborStart = sortOffsets[startKey];
      wgNeighborEnd = sortOffsets[endKey + 1u];
    } else {
      wgNeighborStart = 0u;
      wgNeighborEnd = 0u;
    }
  }
  workgroupBarrier();

  let rangeStart = wgNeighborStart;
  let rangeEnd = wgNeighborEnd;

  // =========================================================================
  // PHASE 2: Process neighbors in tiles using shared memory
  // =========================================================================

  var density = 0.0;
  var nearDensity = 0.0;
  let radiusSq = params.radius * params.radius;

  var tileStart = rangeStart;
  loop {
    if (tileStart >= rangeEnd) { break; }

    let tileEnd = min(tileStart + TILE_SIZE, rangeEnd);
    let tileCount = tileEnd - tileStart;

    // Collaborative loading: each thread loads multiple elements
    let loadsPerThread = (tileCount + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;
    for (var l = 0u; l < loadsPerThread; l++) {
      let loadIdx = localIndex + l * WORKGROUP_SIZE;
      if (loadIdx < tileCount) {
        let globalIdx = tileStart + loadIdx;
        sharedPositions[loadIdx] = predicted[globalIdx].xyz;
      }
    }

    workgroupBarrier();

    // Each thread computes density from shared memory
    if (hasParticle) {
      for (var j = 0u; j < tileCount; j++) {
        let neighborPos = sharedPositions[j];
        let offset = neighborPos - pos;
        let dstSq = dot(offset, offset);

        if (dstSq <= radiusSq) {
          let dst = sqrt(dstSq);
          density += spikyPow2(dst, params.radius, params.spikyPow2Scale);
          nearDensity += spikyPow3(dst, params.radius, params.spikyPow3Scale);
        }
      }
    }

    workgroupBarrier();
    tileStart = tileEnd;
  }

  // =========================================================================
  // PHASE 3: Write results
  // =========================================================================

  if (hasParticle) {
    densities[particleIndex] = vec2<f32>(density, nearDensity);
  }
}
`,Be=`/**
 * ============================================================================
 * PRESSURE KERNEL (LINEAR GRID + STRIP OPTIMIZATION)
 * ============================================================================
 *
 * Pipeline Stage: Stage 6 (Second SPH physics pass)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Computes pressure forces using the Linear Grid for O(1) neighbor search,
 * with the strip optimisation for contiguous X-row iteration.
 *
 * This is the Linear Grid variant of pressure.wgsl. The physics are identical
 * (symmetric dual-pressure EOS), but neighbor iteration uses sortOffsets
 * with strip ranges instead of spatial hash key matching.
 *
 * See pressure.wgsl for detailed physics documentation (equation of state,
 * kernel gradient derivation, symmetric pressure averaging).
 * ============================================================================
 */

// Beginner note: pressure uses density to compute forces that repel particles.

/**
 * Pressure Parameters Uniform Buffer
 *
 * Memory Layout (64 bytes):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    dt                     - Sub-step timestep
 *   4      4    targetDensity          - Rest density ρ₀
 *   8      4    pressureMultiplier     - Stiffness k for standard pressure
 *  12      4    nearPressureMultiplier - Stiffness for near-pressure
 *  16      4    radius                 - Smoothing radius h
 *  20      4    spikyPow2DerivScale    - Gradient normalisation for Spiky² kernel
 *  24      4    spikyPow3DerivScale    - Gradient normalisation for Spiky³ kernel
 *  28      4    particleCountF         - Particle count as f32
 *  32     12    minBounds              - Minimum corner of simulation domain
 *  44      4    pad0                   - Padding
 *  48     12    gridRes                - Grid resolution per axis (f32)
 *  60      4    pad1                   - Padding
 * ------
 * Total: 64 bytes
 */
struct PressureParams {
  dt: f32,
  targetDensity: f32,
  pressureMultiplier: f32,
  nearPressureMultiplier: f32,
  radius: f32,
  spikyPow2DerivScale: f32,
  spikyPow3DerivScale: f32,
  particleCountF: f32,
  minBounds: vec3<f32>,
  pad0: f32,
  gridRes: vec3<f32>,
  pad1: f32,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Pressure compute pass (Linear Grid)
//
//   Binding 0: predicted[]   - Predicted positions (for neighbor distances)
//   Binding 1: velocities[]  - Velocities (updated with pressure acceleration)
//   Binding 2: densities[]   - Computed densities from density pass
//              vec2: x = density, y = near-density
//   Binding 3: sortOffsets[] - Cell start/end offsets for strip iteration
//   Binding 4: params        - Pressure parameters
// ============================================================================

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> densities: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> sortOffsets: array<u32>;
@group(0) @binding(4) var<uniform> params: PressureParams;

/**
 * Converts 3D integer cell coordinates to a linear grid index.
 * index = x + width × (y + height × z)
 */
fn getGridIndex(x: i32, y: i32, z: i32) -> u32 {
    let gridRes = vec3<u32>(params.gridRes);
    return u32(x) + gridRes.x * (u32(y) + gridRes.y * u32(z));
}

/** Gradient of Spiky² kernel: dW/dr = -(h-r) × scale. */
fn derivativeSpikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst <= radius) {
    let v = radius - dst;
    return -v * scale;
  }
  return 0.0;
}

/** Gradient of Spiky³ kernel: dW/dr = -(h-r)² × scale. Stronger at close range. */
fn derivativeSpikyPow3(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst <= radius) {
    let v = radius - dst;
    return -v * v * scale;
  }
  return 0.0;
}

/**
 * Main Pressure Force Kernel (Strip-Optimised)
 *
 * For each particle:
 *   1. Compute pressure from EOS: P = k × (ρ - ρ₀)
 *   2. Iterate over 3×3 Y-Z row strips using sortOffsets ranges
 *   3. For each neighbor, compute symmetric averaged pressure force
 *   4. Update velocity: v += (force / density) × dt
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);

  if (i >= count) { return; }

  let densityPair = densities[i];
  let density = densityPair.x;
  let nearDensity = densityPair.y;

  if (density <= 0.0) { return; }

  let pressure = (density - params.targetDensity) * params.pressureMultiplier;
  let nearPressure = params.nearPressureMultiplier * nearDensity;

  let pos = predicted[i].xyz;
  let gridRes = vec3<i32>(params.gridRes);
  let localPos = pos - params.minBounds;
  
  let cellX = i32(floor(localPos.x / params.radius));
  let cellY = i32(floor(localPos.y / params.radius));
  let cellZ = i32(floor(localPos.z / params.radius));
  
  let cx = clamp(cellX, 0, gridRes.x - 1);
  let cy = clamp(cellY, 0, gridRes.y - 1);
  let cz = clamp(cellZ, 0, gridRes.z - 1);

  let radiusSq = params.radius * params.radius;
  var force = vec3<f32>(0.0);

  let minZ = max(0, cz - 1);
  let maxZ = min(gridRes.z - 1, cz + 1);
  let minY = max(0, cy - 1);
  let maxY = min(gridRes.y - 1, cy + 1);
  let minX = max(0, cx - 1);
  let maxX = min(gridRes.x - 1, cx + 1);

  for (var z = minZ; z <= maxZ; z++) {
    for (var y = minY; y <= maxY; y++) {
      let startKey = getGridIndex(minX, y, z);
      let endKey = getGridIndex(maxX, y, z);
      let start = sortOffsets[startKey];
      let end = sortOffsets[endKey + 1u];

      for (var j = start; j < end; j++) {
            let neighborIndex = j;
            if (neighborIndex != i) {
                let neighborPos = predicted[neighborIndex].xyz;
                let offset = neighborPos - pos;
                let dstSq = dot(offset, offset);

                if (dstSq <= radiusSq) {
                    let dst = sqrt(dstSq);
                    let invDst = select(0.0, 1.0 / dst, dst > 0.0);
                    let dir = offset * invDst;

                    let nDens = densities[neighborIndex];
                    let nPressure = (nDens.x - params.targetDensity) * params.pressureMultiplier;
                    let nNearPressure = params.nearPressureMultiplier * nDens.y;

                    let sharedPressure = (pressure + nPressure) * 0.5;
                    let sharedNearPressure = (nearPressure + nNearPressure) * 0.5;

                    if (nDens.x > 0.0) {
                        let scale = derivativeSpikyPow2(dst, params.radius, params.spikyPow2DerivScale) * (sharedPressure / nDens.x);
                        force = force + dir * scale;
                    }
                    if (nDens.y > 0.0) {
                        let scale = derivativeSpikyPow3(dst, params.radius, params.spikyPow3DerivScale) * (sharedNearPressure / nDens.y);
                        force = force + dir * scale;
                    }
                }
            }
      }
    }
  }

  let accel = force / density;
  velocities[i] = vec4<f32>(velocities[i].xyz + accel * params.dt, 0.0);
}
`,Ce=`/**
 * ============================================================================
 * PRESSURE KERNEL (SHARED MEMORY OPTIMIZATION)
 * ============================================================================
 *
 * Pipeline Stage: Stage 6
 * Entry Point: main
 * Workgroup Size: 64 threads (optimized for mobile GPUs)
 *
 * Purpose:
 * --------
 * Computes pressure forces using workgroup shared memory to reduce global
 * memory bandwidth. Uses the same collaborative loading strategy as the
 * density shader.
 *
 * ============================================================================
 */

const TILE_SIZE: u32 = 384u;  // Smaller than density since we store more data
const WORKGROUP_SIZE: u32 = 64u;

struct PressureParams {
  dt: f32,
  targetDensity: f32,
  pressureMultiplier: f32,
  nearPressureMultiplier: f32,
  radius: f32,
  spikyPow2DerivScale: f32,
  spikyPow3DerivScale: f32,
  particleCountF: f32,
  minBounds: vec3<f32>,
  pad0: f32,
  gridRes: vec3<f32>,
  pad1: f32,
};

// Neighbor data packed into shared memory
struct NeighborData {
  pos: vec3<f32>,
  density: f32,
  nearDensity: f32,
}

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> densities: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> sortOffsets: array<u32>;
@group(0) @binding(4) var<uniform> params: PressureParams;

// Shared memory for neighbor data
var<workgroup> sharedPos: array<vec3<f32>, TILE_SIZE>;
var<workgroup> sharedDensity: array<f32, TILE_SIZE>;
var<workgroup> sharedNearDensity: array<f32, TILE_SIZE>;

// Workgroup-shared bounds
var<workgroup> wgNeighborStart: u32;
var<workgroup> wgNeighborEnd: u32;

// Atomics for workgroup reduction
var<workgroup> wgMinX: atomic<i32>;
var<workgroup> wgMinY: atomic<i32>;
var<workgroup> wgMinZ: atomic<i32>;
var<workgroup> wgMaxX: atomic<i32>;
var<workgroup> wgMaxY: atomic<i32>;
var<workgroup> wgMaxZ: atomic<i32>;

fn getGridIndex(x: i32, y: i32, z: i32) -> u32 {
  let gridRes = vec3<u32>(params.gridRes);
  return u32(x) + gridRes.x * (u32(y) + gridRes.y * u32(z));
}

fn derivativeSpikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst <= radius) {
    let v = radius - dst;
    return -v * scale;
  }
  return 0.0;
}

fn derivativeSpikyPow3(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst <= radius) {
    let v = radius - dst;
    return -v * v * scale;
  }
  return 0.0;
}

@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) globalId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(workgroup_id) workgroupId: vec3<u32>
) {
  let particleIndex = globalId.x;
  let localIndex = localId.x;
  let particleCount = u32(params.particleCountF + 0.5);
  let gridRes = vec3<i32>(params.gridRes);

  let hasParticle = particleIndex < particleCount;

  // =========================================================================
  // PHASE 1: Compute workgroup-wide neighbor bounds
  // =========================================================================

  if (localIndex == 0u) {
    atomicStore(&wgMinX, gridRes.x);
    atomicStore(&wgMinY, gridRes.y);
    atomicStore(&wgMinZ, gridRes.z);
    atomicStore(&wgMaxX, -1);
    atomicStore(&wgMaxY, -1);
    atomicStore(&wgMaxZ, -1);
  }
  workgroupBarrier();

  var pos = vec3<f32>(0.0);
  var myDensity = 0.0;
  var myNearDensity = 0.0;
  var myPressure = 0.0;
  var myNearPressure = 0.0;

  if (hasParticle) {
    pos = predicted[particleIndex].xyz;
    let densityPair = densities[particleIndex];
    myDensity = densityPair.x;
    myNearDensity = densityPair.y;

    if (myDensity > 0.0) {
      myPressure = (myDensity - params.targetDensity) * params.pressureMultiplier;
      myNearPressure = params.nearPressureMultiplier * myNearDensity;
    }

    let localPos = pos - params.minBounds;
    let cellX = clamp(i32(floor(localPos.x / params.radius)), 0, gridRes.x - 1);
    let cellY = clamp(i32(floor(localPos.y / params.radius)), 0, gridRes.y - 1);
    let cellZ = clamp(i32(floor(localPos.z / params.radius)), 0, gridRes.z - 1);

    let minX = max(0, cellX - 1);
    let minY = max(0, cellY - 1);
    let minZ = max(0, cellZ - 1);
    let maxX = min(gridRes.x - 1, cellX + 1);
    let maxY = min(gridRes.y - 1, cellY + 1);
    let maxZ = min(gridRes.z - 1, cellZ + 1);

    atomicMin(&wgMinX, minX);
    atomicMin(&wgMinY, minY);
    atomicMin(&wgMinZ, minZ);
    atomicMax(&wgMaxX, maxX);
    atomicMax(&wgMaxY, maxY);
    atomicMax(&wgMaxZ, maxZ);
  }
  workgroupBarrier();

  if (localIndex == 0u) {
    let minX = atomicLoad(&wgMinX);
    let minY = atomicLoad(&wgMinY);
    let minZ = atomicLoad(&wgMinZ);
    let maxX = atomicLoad(&wgMaxX);
    let maxY = atomicLoad(&wgMaxY);
    let maxZ = atomicLoad(&wgMaxZ);

    if (maxX >= 0 && maxY >= 0 && maxZ >= 0) {
      let startKey = getGridIndex(minX, minY, minZ);
      let endKey = getGridIndex(maxX, maxY, maxZ);
      wgNeighborStart = sortOffsets[startKey];
      wgNeighborEnd = sortOffsets[endKey + 1u];
    } else {
      wgNeighborStart = 0u;
      wgNeighborEnd = 0u;
    }
  }
  workgroupBarrier();

  // Skip if this particle has no density
  if (hasParticle && myDensity <= 0.0) {
    return;
  }

  let rangeStart = wgNeighborStart;
  let rangeEnd = wgNeighborEnd;

  // =========================================================================
  // PHASE 2: Process neighbors in tiles using shared memory
  // =========================================================================

  var force = vec3<f32>(0.0);
  let radiusSq = params.radius * params.radius;

  var tileStart = rangeStart;
  loop {
    if (tileStart >= rangeEnd) { break; }

    let tileEnd = min(tileStart + TILE_SIZE, rangeEnd);
    let tileCount = tileEnd - tileStart;

    // Collaborative loading
    let loadsPerThread = (tileCount + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;
    for (var l = 0u; l < loadsPerThread; l++) {
      let loadIdx = localIndex + l * WORKGROUP_SIZE;
      if (loadIdx < tileCount) {
        let globalIdx = tileStart + loadIdx;
        sharedPos[loadIdx] = predicted[globalIdx].xyz;
        let d = densities[globalIdx];
        sharedDensity[loadIdx] = d.x;
        sharedNearDensity[loadIdx] = d.y;
      }
    }

    workgroupBarrier();

    // Compute pressure forces from shared memory
    if (hasParticle && myDensity > 0.0) {
      for (var j = 0u; j < tileCount; j++) {
        let neighborGlobalIdx = tileStart + j;
        if (neighborGlobalIdx != particleIndex) {
          let neighborPos = sharedPos[j];
          let offset = neighborPos - pos;
          let dstSq = dot(offset, offset);

          if (dstSq <= radiusSq && dstSq > 0.0) {
            let dst = sqrt(dstSq);
            let dir = offset / dst;

            let nDensity = sharedDensity[j];
            let nNearDensity = sharedNearDensity[j];

            if (nDensity > 0.0) {
              let nPressure = (nDensity - params.targetDensity) * params.pressureMultiplier;
              let nNearPressure = params.nearPressureMultiplier * nNearDensity;

              let sharedPressure = (myPressure + nPressure) * 0.5;
              let sharedNearPressure = (myNearPressure + nNearPressure) * 0.5;

              let scale1 = derivativeSpikyPow2(dst, params.radius, params.spikyPow2DerivScale) * (sharedPressure / nDensity);
              let scale2 = derivativeSpikyPow3(dst, params.radius, params.spikyPow3DerivScale) * (sharedNearPressure / nDensity);

              force += dir * (scale1 + scale2);
            }
          }
        }
      }
    }

    workgroupBarrier();
    tileStart = tileEnd;
  }

  // =========================================================================
  // PHASE 3: Update velocity
  // =========================================================================

  if (hasParticle && myDensity > 0.0) {
    let accel = force / myDensity;
    velocities[particleIndex] = vec4<f32>(velocities[particleIndex].xyz + accel * params.dt, 0.0);
  }
}
`,ke=`/**
 * ============================================================================
 * VISCOSITY KERNEL (LINEAR GRID + STRIP OPTIMIZATION)
 * ============================================================================
 *
 * Pipeline Stage: Stage 7 (Third SPH physics pass)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Applies viscous damping using the Linear Grid for neighbor search, with
 * strip optimisation for contiguous X-row iteration.
 *
 * This is the Linear Grid variant of viscosity.wgsl. The physics are
 * identical (Poly6-weighted velocity averaging), but neighbor iteration
 * uses sortOffsets with strip ranges instead of spatial hash key matching.
 *
 * See viscosity.wgsl for detailed physics documentation (Poly6 kernel,
 * viscosity force formulation, numerical stability benefits).
 * ============================================================================
 */

// Beginner note: viscosity smooths velocity differences to reduce jitter.

/**
 * Viscosity Parameters Uniform Buffer
 *
 * Memory Layout (48 bytes):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    dt                - Sub-step timestep
 *   4      4    viscosityStrength - Viscosity coefficient μ
 *   8      4    radius            - Smoothing radius h
 *  12      4    poly6Scale        - Normalisation for Poly6 kernel: 315/(64πh⁹)
 *  16      4    particleCountF    - Particle count as f32
 *  20      4    minBoundsX        - Minimum X of simulation domain
 *  24      4    minBoundsY        - Minimum Y of simulation domain
 *  28      4    minBoundsZ        - Minimum Z of simulation domain
 *  32      4    gridResX          - Grid resolution along X axis
 *  36      4    gridResY          - Grid resolution along Y axis
 *  40      4    gridResZ          - Grid resolution along Z axis
 *  44      4    pad0              - Padding
 * ------
 * Total: 48 bytes
 */
struct ViscosityParams {
  dt: f32,
  viscosityStrength: f32,
  radius: f32,
  poly6Scale: f32,
  particleCountF: f32,
  minBoundsX: f32,
  minBoundsY: f32,
  minBoundsZ: f32,
  gridResX: f32,
  gridResY: f32,
  gridResZ: f32,
  pad0: f32,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Viscosity compute pass (Linear Grid)
//
//   Binding 0: predicted[]   - Predicted positions (for neighbor distances)
//   Binding 1: velocities[]  - Velocities (updated with viscosity damping)
//   Binding 2: sortOffsets[] - Cell start/end offsets for strip iteration
//   Binding 4: params        - Viscosity parameters (note: binding 3 skipped)
// ============================================================================

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> sortOffsets: array<u32>;
@group(0) @binding(4) var<uniform> params: ViscosityParams;

/**
 * Converts 3D integer cell coordinates to a linear grid index.
 * index = x + width × (y + height × z)
 */
fn getGridIndex(x: i32, y: i32, z: i32) -> u32 {
    let gridRes = vec3<u32>(u32(params.gridResX), u32(params.gridResY), u32(params.gridResZ));
    return u32(x) + gridRes.x * (u32(y) + gridRes.y * u32(z));
}

/** Poly6 kernel: W(r,h) = (h²-r²)³ × scale. Smooth, positive, max at r=0. */
fn smoothingKernelPoly6(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius * radius - dst * dst;
    return v * v * v * scale;
  }
  return 0.0;
}

/**
 * Main Viscosity Kernel (Strip-Optimised)
 *
 * For each particle, iterates over the 3×3 Y-Z row strips and computes
 * a Poly6-weighted velocity difference from each neighbor:
 *   force += (v_neighbor - v_self) × W(distance)
 *
 * Final update: v += force × viscosityStrength × dt
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);

  if (i >= count) { return; }

  let pos = predicted[i].xyz;
  let vel = velocities[i].xyz;

  let gridRes = vec3<i32>(i32(params.gridResX), i32(params.gridResY), i32(params.gridResZ));
  let minBounds = vec3<f32>(params.minBoundsX, params.minBoundsY, params.minBoundsZ);
  let localPos = pos - minBounds;
  
  let cellX = i32(floor(localPos.x / params.radius));
  let cellY = i32(floor(localPos.y / params.radius));
  let cellZ = i32(floor(localPos.z / params.radius));
  
  let cx = clamp(cellX, 0, gridRes.x - 1);
  let cy = clamp(cellY, 0, gridRes.y - 1);
  let cz = clamp(cellZ, 0, gridRes.z - 1);

  let radiusSq = params.radius * params.radius;
  var force = vec3<f32>(0.0);

  let minZ = max(0, cz - 1);
  let maxZ = min(gridRes.z - 1, cz + 1);
  let minY = max(0, cy - 1);
  let maxY = min(gridRes.y - 1, cy + 1);
  let minX = max(0, cx - 1);
  let maxX = min(gridRes.x - 1, cx + 1);

  for (var z = minZ; z <= maxZ; z++) {
    for (var y = minY; y <= maxY; y++) {
      let startKey = getGridIndex(minX, y, z);
      let endKey = getGridIndex(maxX, y, z);
      let start = sortOffsets[startKey];
      let end = sortOffsets[endKey + 1u];

      for (var j = start; j < end; j++) {
            let neighborIndex = j;
            if (neighborIndex != i) {
                let neighborPos = predicted[neighborIndex].xyz;
                let offset = neighborPos - pos;
                let dstSq = dot(offset, offset);

                if (dstSq <= radiusSq) {
                    let dst = sqrt(dstSq);
                    let weight = smoothingKernelPoly6(dst, params.radius, params.poly6Scale);
                    let neighborVel = velocities[neighborIndex].xyz;
                    force = force + (neighborVel - vel) * weight;
                }
            }
      }
    }
  }

  velocities[i] = vec4<f32>(velocities[i].xyz + force * params.viscosityStrength * params.dt, 0.0);
}
`,ze=`/**
 * ============================================================================
 * INTEGRATION & COLLISION SHADER
 * ============================================================================
 *
 * Pipeline Stage: Stage 8 (Final compute pass)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Updates particle positions based on velocity and handles boundary collisions.
 * This is the final step that commits all physics calculations to position.
 *
 * Time Integration:
 * -----------------
 * Uses simple Euler integration (also called Forward Euler):
 *
 *   position_new = position_old + velocity × dt
 *
 * While more sophisticated integrators exist (Verlet, RK4), Euler is sufficient
 * here because:
 *   1. SPH forces are already computed at predicted positions
 *   2. Timestep is small (typically 1/60 or 1/120 second)
 *   3. Pressure forces provide inherent stability
 *
 * Boundary Collision:
 * -------------------
 * The simulation domain is an axis-aligned box defined by [minBounds, maxBounds].
 *
 *     ┌─────────────────────┐  maxBounds
 *     │                     │
 *     │          ↑          │
 *     │          │          │
 *     │   ←──────┼──────→   │
 *     │          │          │
 *     │          ↓          │
 *     │                     │
 *     └─────────────────────┘  minBounds
 *
 * Collision response:
 *   1. Check if particle is outside [minBounds, maxBounds]
 *   2. If outside, clamp position to boundary
 *   3. Reflect velocity component: vel = -vel × damping
 *
 * Collision Damping:
 *   - 1.0 = perfectly elastic (no energy loss)
 *   - 0.5 = moderate damping (half velocity on bounce)
 *   - 0.0 = perfectly inelastic (stops on contact)
 *
 * Typical values: 0.7 - 0.95 for realistic fluid behavior.
 *
 * Coordinate System:
 * ------------------
 *   +Y = Up
 *   +X = Right
 *   +Z = Forward (out of screen)
 *
 * ============================================================================
 */

// Beginner note: this pass writes final positions (and clamps to bounds).

/**
 * Integration Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    dt               - Timestep for position integration
 *   4      4    collisionDamping - Velocity multiplier on collision [0, 1]
 *   8      4    hasObstacle      - Flag for dynamic obstacle (unused currently)
 *  12      4    obstacleShape    - 0 = box, 1 = sphere
 *  16     12    minBounds        - Minimum corner of simulation box (x, y, z)
 *  28      4    pad1             - Padding
 *  32     12    maxBounds        - Maximum corner of simulation box (x, y, z)
 *  44      4    pad2             - Padding
 *  48     12    obstacleCenter   - Center of dynamic obstacle
 *  60      4    pad3             - Padding
 *  64     12    obstacleHalf     - Half-extents of obstacle
 *  76      4    pad4             - Padding
 *  80     12    obstacleRotation - Rotation in degrees (XYZ)
 *  92      4    pad5             - Padding
 * ------
 * Total: 96 bytes
 *
 * Note: obstacleRotation is in degrees to match GUI controls.
 */
struct IntegrateParams {
  dt: f32,
  collisionDamping: f32,
  hasObstacle: f32,
  obstacleShape: f32,
  minBounds: vec3<f32>,
  pad1: f32,
  maxBounds: vec3<f32>,
  pad2: f32,
  obstacleCenter: vec3<f32>,
  pad3: f32,
  obstacleHalf: vec3<f32>,
  pad4: f32,
  obstacleRotation: vec3<f32>,
  pad5: f32,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Integration compute pass
//
//   Binding 0: positions[]  - Particle positions (read-write)
//              Updated with: pos_new = pos_old + vel × dt
//
//   Binding 1: velocities[] - Particle velocities (read-write)
//              Modified on collision: vel = -vel × damping
//
//   Binding 2: params       - Integration parameters
// ============================================================================

@group(0) @binding(0) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: IntegrateParams;

fn rotateX(v: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}

fn rotateY(v: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

fn rotateZ(v: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(v.x * c - v.y * s, v.x * s + v.y * c, v.z);
}

fn toRadians(v: vec3<f32>) -> vec3<f32> {
  return v * (3.14159265 / 180.0);
}

fn rotateLocalToWorld(v: vec3<f32>, rot: vec3<f32>) -> vec3<f32> {
  var r = v;
  r = rotateX(r, rot.x);
  r = rotateY(r, rot.y);
  r = rotateZ(r, rot.z);
  return r;
}

fn rotateWorldToLocal(v: vec3<f32>, rot: vec3<f32>) -> vec3<f32> {
  var r = v;
  r = rotateZ(r, -rot.z);
  r = rotateY(r, -rot.y);
  r = rotateX(r, -rot.x);
  return r;
}

/**
 * Main Integration Compute Kernel
 *
 * Updates positions and handles boundary collisions.
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 * Each thread processes exactly one particle.
 *
 * Algorithm:
 * 1. Load current position and velocity
 * 2. Integrate: pos += vel × dt
 * 3. For each axis (X, Y, Z):
 *    a. Check if outside bounds
 *    b. If yes, clamp position and reflect velocity
 * 4. Store updated position and velocity
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check using arrayLength for safety
  if (index >= arrayLength(&positions)) {
    return;
  }

  // Load current state
  var pos = positions[index].xyz;
  var vel = velocities[index].xyz;

  // ========================================================================
  // TIME INTEGRATION (Euler Method)
  // ========================================================================
  // p(t + dt) = p(t) + v(t) × dt
  //
  // At this point, velocity has been updated by:
  //   - External forces (gravity, interaction)
  //   - Pressure forces
  //   - Viscosity forces
  //
  // The integration commits all these changes to position.
  pos = pos + vel * params.dt;

  // ========================================================================
  // OBSTACLE COLLISION HANDLING (AABB)
  // ========================================================================
  // If enabled, check if particle is inside the obstacle box.
  // If so, push it out to the nearest face and reflect velocity.

  if (params.hasObstacle > 0.5) {
    let obsCenter = params.obstacleCenter;
    let obsHalf = params.obstacleHalf;
    let isSphere = params.obstacleShape > 0.5;

    if (isSphere) {
      let radius = obsHalf.x;
      let delta = pos - obsCenter;
      let dist = length(delta);
      if (dist < radius && radius > 0.0) {
        let normal = delta / max(dist, 1e-5);
        pos = obsCenter + normal * radius;
        let vn = dot(vel, normal);
        if (vn < 0.0) {
          vel = vel - (1.0 + params.collisionDamping) * vn * normal;
        }
      }
    } else {
      let rot = toRadians(params.obstacleRotation);

      // Calculate position relative to obstacle center
      var localPos = rotateWorldToLocal(pos - obsCenter, rot);

      // Check if inside obstacle (overlap on all axes)
      // We use a small epsilon for robustness, though strict inequality is fine
      if (abs(localPos.x) < obsHalf.x && 
          abs(localPos.y) < obsHalf.y && 
          abs(localPos.z) < obsHalf.z) {

          // Determine penetration depth on each axis
          // (Distance to the nearest face)
          let depthX = obsHalf.x - abs(localPos.x);
          let depthY = obsHalf.y - abs(localPos.y);
          let depthZ = obsHalf.z - abs(localPos.z);

          // Find the axis of least penetration (closest face)
          if (depthX < depthY && depthX < depthZ) {
              // ---- X-AXIS COLLISION ----
              // Snap to surface
              localPos.x = obsHalf.x * sign(localPos.x);
              let normal = rotateLocalToWorld(vec3<f32>(sign(localPos.x), 0.0, 0.0), rot);
              pos = obsCenter + rotateLocalToWorld(localPos, rot);
              let vn = dot(vel, normal);
              if (vn < 0.0) {
                vel = vel - (1.0 + params.collisionDamping) * vn * normal;
              }
          } else if (depthY < depthZ) {
              // ---- Y-AXIS COLLISION ----
              localPos.y = obsHalf.y * sign(localPos.y);
              let normal = rotateLocalToWorld(vec3<f32>(0.0, sign(localPos.y), 0.0), rot);
              pos = obsCenter + rotateLocalToWorld(localPos, rot);
              let vn = dot(vel, normal);
              if (vn < 0.0) {
                vel = vel - (1.0 + params.collisionDamping) * vn * normal;
              }
          } else {
              // ---- Z-AXIS COLLISION ----
              localPos.z = obsHalf.z * sign(localPos.z);
              let normal = rotateLocalToWorld(vec3<f32>(0.0, 0.0, sign(localPos.z)), rot);
              pos = obsCenter + rotateLocalToWorld(localPos, rot);
              let vn = dot(vel, normal);
              if (vn < 0.0) {
                vel = vel - (1.0 + params.collisionDamping) * vn * normal;
              }
          }
      }
    }
  }

  // ========================================================================
  // BOUNDARY COLLISION HANDLING
  // ========================================================================
  // For each axis, check if particle has crossed the boundary.
  //
  // Collision detection: check if pos is outside [minBounds, maxBounds]
  //
  // Collision response:
  //   1. Clamp position to boundary
  //   2. Reflect velocity: vel = -vel × damping

  // ---- X-AXIS COLLISION ----
  if (pos.x < params.minBounds.x) {
    pos.x = params.minBounds.x;
    vel.x = -vel.x * params.collisionDamping;
  } else if (pos.x > params.maxBounds.x) {
    pos.x = params.maxBounds.x;
    vel.x = -vel.x * params.collisionDamping;
  }

  // ---- Y-AXIS COLLISION ----
  if (pos.y < params.minBounds.y) {
    pos.y = params.minBounds.y;
    vel.y = -vel.y * params.collisionDamping;
  } else if (pos.y > params.maxBounds.y) {
    pos.y = params.maxBounds.y;
    vel.y = -vel.y * params.collisionDamping;
  }

  // ---- Z-AXIS COLLISION ----
  if (pos.z < params.minBounds.z) {
    pos.z = params.minBounds.z;
    vel.z = -vel.z * params.collisionDamping;
  } else if (pos.z > params.maxBounds.z) {
    pos.z = params.maxBounds.z;
    vel.z = -vel.z * params.collisionDamping;
  }

  // ========================================================================
  // WRITE BACK RESULTS
  // ========================================================================
  // Store updated position (w = 1.0 for homogeneous coordinates)
  // Store updated velocity (w = 0.0, velocity is a direction/rate)
  positions[index] = vec4<f32>(pos, 1.0);
  velocities[index] = vec4<f32>(vel, 0.0);
}
`;class We{device;externalForcesPipeline;densityPipeline;pressurePipeline;viscosityPipeline;integratePipeline;externalBG;densityBG;pressureBG;viscosityBG;integrateBG;densityPressureWorkgroupSize;constructor(e,t=!1){this.device=e;const r=t?we:Se,i=t?Ce:Be;this.densityPressureWorkgroupSize=t?64:256,t&&console.log("FluidPhysics: Using shared memory optimized shaders"),this.externalForcesPipeline=this.createPipeline(Pe,"main"),this.densityPipeline=this.createPipeline(r,"main"),this.pressurePipeline=this.createPipeline(i,"main"),this.viscosityPipeline=this.createPipeline(ke,"main"),this.integratePipeline=this.createPipeline(ze,"main")}createPipeline(e,t){return this.device.createComputePipeline({layout:"auto",compute:{module:this.device.createShaderModule({code:e}),entryPoint:t}})}createBindGroups(e,t){this.externalBG=this.device.createBindGroup({layout:this.externalForcesPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.positions}},{binding:1,resource:{buffer:e.velocities}},{binding:2,resource:{buffer:e.predicted}},{binding:3,resource:{buffer:t.external}}]}),this.densityBG=this.device.createBindGroup({layout:this.densityPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.predicted}},{binding:1,resource:{buffer:e.sortOffsets}},{binding:2,resource:{buffer:e.densities}},{binding:3,resource:{buffer:t.density}}]}),this.pressureBG=this.device.createBindGroup({layout:this.pressurePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.predicted}},{binding:1,resource:{buffer:e.velocities}},{binding:2,resource:{buffer:e.densities}},{binding:3,resource:{buffer:e.sortOffsets}},{binding:4,resource:{buffer:t.pressure}}]}),this.viscosityBG=this.device.createBindGroup({layout:this.viscosityPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.predicted}},{binding:1,resource:{buffer:e.velocities}},{binding:2,resource:{buffer:e.sortOffsets}},{binding:4,resource:{buffer:t.viscosity}}]}),this.integrateBG=this.device.createBindGroup({layout:this.integratePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.positions}},{binding:1,resource:{buffer:e.velocities}},{binding:2,resource:{buffer:t.integrate}}]})}step(e,t,r,i,s=!0,o=!0){const a=Math.ceil(r/256),d=Math.ceil(r/this.densityPressureWorkgroupSize);e.setPipeline(this.externalForcesPipeline),e.setBindGroup(0,this.externalBG),e.dispatchWorkgroups(a),o&&t.dispatch(e,r,i),e.setPipeline(this.densityPipeline),e.setBindGroup(0,this.densityBG),e.dispatchWorkgroups(d),e.setPipeline(this.pressurePipeline),e.setBindGroup(0,this.pressureBG),e.dispatchWorkgroups(d),s&&(e.setPipeline(this.viscosityPipeline),e.setBindGroup(0,this.viscosityBG),e.dispatchWorkgroups(a)),e.setPipeline(this.integratePipeline),e.setBindGroup(0,this.integrateBG),e.dispatchWorkgroups(a)}}const He=`/**
 * Simple wireframe shader for rendering bounding box edges.
 */

// Beginner note: vertices are provided by a CPU-built line list.

struct Uniforms {
  viewProjection: mat4x4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) color: vec4<f32>,
}

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
}

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  output.position = uniforms.viewProjection * vec4<f32>(input.position, 1.0);
  output.color = input.color;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  return input.color;
}
`,Ke=`struct ShadowUniforms {
  lightViewProjection: mat4x4<f32>,
  shadowSoftness: f32,
  particleShadowRadius: f32,
  pad0: f32,
  pad1: f32,
};

// Beginner note: this shared struct is included by multiple shaders so the
// shadow map uniforms stay consistent across passes.
`;function qe(n,e){let t=n;for(const[r,i]of Object.entries(e)){const s=`#include "${r}"`;t=t.split(s).join(i)}return t}const Re=`// =============================================================================
// Particle Picking Shader
// =============================================================================
// Finds the intersection of a ray with the fluid particles.

struct Ray {
  origin: vec3<f32>,
  pad0: f32,
  direction: vec3<f32>,
  pad1: f32,
};

struct PickingUniforms {
  ray: Ray,
  particleRadius: f32,
  particleCount: u32,
  pad0: f32,
  pad1: f32,
};

struct PickingResult {
  hitPos: vec3<f32>,
  hitDist: f32,
  particleIndex: i32, // -1 if no hit
  hit: u32,           // 1 if hit, 0 if no hit
  pad0: u32,
  pad1: u32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> uniforms: PickingUniforms;
@group(0) @binding(2) var<storage, read_write> result: PickingResult;

/**
 * Finds the intersection of a ray and a sphere.
 * Returns the distance to the intersection point, or -1.0 if no hit.
 */
fn raySphereIntersection(rayOrigin: vec3<f32>, rayDir: vec3<f32>, sphereCenter: vec3<f32>, radius: f32) -> f32 {
  let oc = rayOrigin - sphereCenter;
  let b = dot(oc, rayDir);
  let c = dot(oc, oc) - radius * radius;
  let h = b * b - c;
  if (h < 0.0) { return -1.0; } // No intersection
  let h_sqrt = sqrt(h);
  let t = -b - h_sqrt;
  if (t < 0.0) { return -b + h_sqrt; } // If inside, use the exit point
  return t;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= uniforms.particleCount) { return; }

  let pos = positions[index].xyz;
  let t = raySphereIntersection(uniforms.ray.origin, uniforms.ray.direction, pos, uniforms.particleRadius);

  if (t > 0.0) {
    // Note: This simple check has a race condition but is usually fine for picking.
    // For a single ray, we want the minimum t.
    if (t < result.hitDist) {
        result.hitDist = t;
        result.hitPos = uniforms.ray.origin + uniforms.ray.direction * t;
        result.particleIndex = i32(index);
        result.hit = 1u;
    }
  }
}

@compute @workgroup_size(1)
fn clear() {
  result.hitPos = vec3<f32>(0.0);
  result.hitDist = 1e10;
  result.particleIndex = -1;
  result.hit = 0u;
}`;class je{device;pipeline;clearPipeline;bindGroupLayout;uniformsBuffer;resultBuffer;readbackBuffer;bindGroup;constructor(e){this.device=e;const t=e.createShaderModule({code:Re});this.bindGroupLayout=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]});const r=e.createPipelineLayout({bindGroupLayouts:[this.bindGroupLayout]});this.pipeline=e.createComputePipeline({layout:r,compute:{module:t,entryPoint:"main"}}),this.clearPipeline=e.createComputePipeline({layout:r,compute:{module:t,entryPoint:"clear"}}),this.uniformsBuffer=e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.resultBuffer=e.createBuffer({size:32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST}),this.readbackBuffer=e.createBuffer({size:32,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST})}createBindGroup(e){this.bindGroup=this.device.createBindGroup({layout:this.bindGroupLayout,entries:[{binding:0,resource:{buffer:e}},{binding:1,resource:{buffer:this.uniformsBuffer}},{binding:2,resource:{buffer:this.resultBuffer}}]})}dispatch(e,t,r,i,s){const o=new Float32Array(12);o[0]=t.x,o[1]=t.y,o[2]=t.z,o[4]=r.x,o[5]=r.y,o[6]=r.z,o[8]=i,new Uint32Array(o.buffer)[9]=s,this.device.queue.writeBuffer(this.uniformsBuffer,0,o);const a=e.beginComputePass();a.setPipeline(this.clearPipeline),a.setBindGroup(0,this.bindGroup),a.dispatchWorkgroups(1),a.end();const d=e.beginComputePass();d.setPipeline(this.pipeline),d.setBindGroup(0,this.bindGroup),d.dispatchWorkgroups(Math.ceil(s/256)),d.end(),e.copyBufferToBuffer(this.resultBuffer,0,this.readbackBuffer,0,32)}async getResult(){await this.readbackBuffer.mapAsync(GPUMapMode.READ);const e=new Float32Array(this.readbackBuffer.getMappedRange()),t=new Uint32Array(e.buffer)[5]===1;let r=null;return t&&(r={hitPos:{x:e[0],y:e[1],z:e[2]},hitDist:e[3],particleIndex:new Int32Array(e.buffer)[4],hit:!0}),this.readbackBuffer.unmap(),r}}export{We as F,Ae as O,je as P,Xe as S,$ as W,Fe as a,_e as b,Ye as c,Me as d,Ue as e,Ne as f,de as g,Q as h,De as i,Te as j,Ke as k,Ze as l,Oe as m,oe as n,ne as o,qe as p,Le as q,Z as r,Ie as s,He as w};
