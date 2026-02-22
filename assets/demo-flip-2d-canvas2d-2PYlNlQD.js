import{G as vt}from"./lil-gui.esm-DA0aiWCL.js";import{S as Ct}from"./main-DwTz-q1_.js";function Pt(l,a={},i={}){if(!document.querySelector('link[href*="Material+Icons"]')){const x=document.createElement("link");x.href="https://fonts.googleapis.com/icon?family=Material+Icons",x.rel="stylesheet",document.head.appendChild(x)}const s=document.createElement("style");s.textContent=`
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
  `,document.head.appendChild(s);const o=document.createElement("div");o.id="gui-container",window.innerWidth<=480&&o.classList.add("collapsed"),document.body.appendChild(o);const r=document.createElement("div");r.className="gui-header-main",o.appendChild(r);const n=document.createElement("button");n.className="gui-toggle-btn",n.innerHTML='<span class="material-icons">menu</span>',r.appendChild(n);const e=document.createElement("div");e.className="gui-title-area",r.appendChild(e);const c=document.createElement("div");c.className="gui-content-wrapper",o.appendChild(c);const h=x=>{x&&x.stopPropagation(),o.classList.toggle("collapsed")};if(n.onclick=h,o.onclick=()=>{o.classList.contains("collapsed")&&o.classList.remove("collapsed")},i.title){const x=document.createElement("span");if(x.style.cssText=`
      font-size: 16px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `,x.textContent=i.title,e.appendChild(x),i.githubUrl){const p=document.createElement("a");p.href=i.githubUrl,p.target="_blank",p.rel="noopener noreferrer",p.title="View on GitHub",p.style.cssText=`
        display: flex;
        align-items: center;
        color: #fff;
        opacity: 0.7;
        transition: opacity 0.2s;
        margin-left: 10px;
      `,p.onpointerenter=()=>p.style.opacity="1",p.onpointerleave=()=>p.style.opacity="0.7",p.innerHTML=`
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
      `,e.appendChild(p)}const b=document.createElement("div");b.style.cssText=`
      background: #1a1a1a;
      color: #fff;
      box-sizing: border-box;
    `;const v=document.createElement("div");v.className="custom-gui-folder",v.style.cssText=`
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.02);
    `;const w=document.createElement("div");w.className="custom-gui-folder-header",w.style.cssText=`
      display: flex;
      align-items: center;
      padding: 1px;
      cursor: pointer;
      user-select: none;
      font-size: 11px;
      font-weight: 700;
      color: rgba(255, 255, 255, 0.9);
    `,w.innerHTML=`
      <span class="material-icons folder-arrow" style="
        font-family: 'Material Icons';
        font-size: 16px;
        transition: transform 0.2s;
        transform: rotate(90deg);
        text-transform: none;
      ">chevron_right</span>
      About
    `;const C=document.createElement("div");C.className="custom-gui-folder-content",C.style.cssText=`
      overflow: hidden;
      max-height: none;
      transition: max-height 0.3s ease-out;
    `;let I=!0;if(w.onclick=()=>{C.style.maxHeight==="none"&&(C.style.maxHeight=C.scrollHeight+"px",C.offsetHeight),I=!I;const p=w.querySelector(".folder-arrow");I?(p.style.transform="rotate(90deg)",C.style.maxHeight=C.scrollHeight+"px"):(p.style.transform="rotate(0deg)",C.style.maxHeight="0")},i.subtitle){const p=document.createElement("div");p.style.cssText=`
        padding: 5px 11px 5px 11px;
        font-size: 11px;
        font-weight: 400;
        opacity: 0.6;
        line-height: 1.4;
        letter-spacing: 0.01em;
        white-space: normal;
        overflow-wrap: break-word;
        max-width: 220px;
      `,p.textContent=i.subtitle,C.appendChild(p)}const Y=document.createElement("div");if(Y.style.cssText=`
      padding: 0 11px 10px 11px;
      font-size: 10px;
      font-weight: 400;
      opacity: 1.0;
      letter-spacing: 0.01em;
    `,Y.innerHTML='Original Author: <a href="https://www.youtube.com/c/TenMinutePhysics" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">Ten Minute Physics</a>',C.appendChild(Y),i.buildTimestamp){const p=document.createElement("div");p.style.cssText=`
        padding: 0 11px 10px 11px;
        font-size: 10px;
        font-weight: 400;
        opacity: 0.6;
        letter-spacing: 0.01em;
      `;const R=new Date(i.buildTimestamp);p.textContent=`Build: ${R.toLocaleDateString()} ${R.toLocaleTimeString()}`,C.appendChild(p)}if(i.features&&i.features.length>0){const p=document.createElement("div");p.style.cssText=`
        padding: 5px 11px 10px 11px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      `;const R=document.createElement("div");R.style.cssText=`
        font-size: 10px;
        font-weight: 600;
        opacity: 0.8;
        text-transform: uppercase;
        margin-bottom: 4px;
      `,R.textContent="Features:",p.appendChild(R);const A=document.createElement("ul");A.style.cssText=`
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
      `,i.features.forEach(D=>{const S=document.createElement("li");S.textContent=D,A.appendChild(S)}),p.appendChild(A),C.appendChild(p)}if(i.interactions&&i.interactions.length>0){const p=document.createElement("div");p.style.cssText=`
        padding: 5px 11px 10px 11px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      `;const R=document.createElement("div");R.style.cssText=`
        font-size: 10px;
        font-weight: 600;
        opacity: 0.8;
        text-transform: uppercase;
        margin-bottom: 4px;
      `,R.textContent="Interactions:",p.appendChild(R);const A=document.createElement("ul");A.style.cssText=`
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
      `,i.interactions.forEach(D=>{const S=document.createElement("li");S.textContent=D,A.appendChild(S)}),p.appendChild(A),C.appendChild(p)}v.appendChild(w),v.appendChild(C),c.appendChild(b),c.appendChild(v)}const f=new vt({container:c,title:"Simulation Settings"}),m=new Ct({trackGPU:!1,horizontal:!0});m.dom.style.position="fixed",m.dom.style.bottom="10px",m.dom.style.left="10px",m.dom.style.zIndex="10000",document.body.appendChild(m.dom);const y=f.addFolder("Display");y.add(l,"showParticles").name("Particles"),y.add(l,"showGrid").name("Grid");const u=f.addFolder("Simulation");u.add(l,"compensateDrift").name("Compensate Drift"),u.add(l,"separateParticles").name("Separate Particles"),u.add(l,"flipRatio",0,1,.1).name("FLIP Ratio"),u.add(l,"gravity",-20,20,.01).name("Gravity");const g=f.addFolder("Solver");return g.add(l,"numPressureIters",1,200,1).name("Pressure Iters"),g.add(l,"numParticleIters",1,5,1).name("Particle Iters"),g.add(l,"overRelaxation",1,2,.01).name("Over Relaxation"),{gui:f,stats:m}}const P=document.getElementById("myCanvas"),t=P.getContext("webgl");P.focus();let G=3,O=1,z=1;function ct(){const l=window.devicePixelRatio||1,a=window.innerWidth,i=window.innerHeight;P.width=a*l,P.height=i*l,P.style.width=a+"px",P.style.height=i+"px",t.viewport(0,0,P.width,P.height),O=P.height/G,z=P.width/O,st()}const j=0,B=1,W=2;function F(l,a,i){return l<a?a:l>i?i:l}class wt{density;fNumX;fNumY;h;fInvSpacing;fNumCells;u;v;du;dv;prevU;prevV;p;s;cellType;cellColor;maxParticles;particlePos;particleColor;particleVel;particleDensity;particleRestDensity;particleRadius;pInvSpacing;pNumX;pNumY;pNumCells;numCellParticles;firstCellParticle;cellParticleIds;numParticles;constructor(a,i,s,o,r,n){this.density=a,this.fNumX=Math.floor(i/o)+1,this.fNumY=Math.floor(s/o)+1,this.h=Math.max(i/this.fNumX,s/this.fNumY),this.fInvSpacing=1/this.h,this.fNumCells=this.fNumX*this.fNumY,this.u=new Float32Array(this.fNumCells),this.v=new Float32Array(this.fNumCells),this.du=new Float32Array(this.fNumCells),this.dv=new Float32Array(this.fNumCells),this.prevU=new Float32Array(this.fNumCells),this.prevV=new Float32Array(this.fNumCells),this.p=new Float32Array(this.fNumCells),this.s=new Float32Array(this.fNumCells),this.cellType=new Int32Array(this.fNumCells),this.cellColor=new Float32Array(3*this.fNumCells),this.maxParticles=n,this.particlePos=new Float32Array(2*this.maxParticles),this.particleColor=new Float32Array(3*this.maxParticles);for(let e=0;e<this.maxParticles;e++)this.particleColor[3*e+2]=1;this.particleVel=new Float32Array(2*this.maxParticles),this.particleDensity=new Float32Array(this.fNumCells),this.particleRestDensity=0,this.particleRadius=r,this.pInvSpacing=1/(2.2*r),this.pNumX=Math.floor(i*this.pInvSpacing)+1,this.pNumY=Math.floor(s*this.pInvSpacing)+1,this.pNumCells=this.pNumX*this.pNumY,this.numCellParticles=new Int32Array(this.pNumCells),this.firstCellParticle=new Int32Array(this.pNumCells+1),this.cellParticleIds=new Int32Array(n),this.numParticles=0}integrateParticles(a,i){for(let s=0;s<this.numParticles;s++)this.particleVel[2*s+1]+=a*i,this.particlePos[2*s]+=this.particleVel[2*s]*a,this.particlePos[2*s+1]+=this.particleVel[2*s+1]*a}pushParticlesApart(a){this.numCellParticles.fill(0);for(let n=0;n<this.numParticles;n++){const e=this.particlePos[2*n],c=this.particlePos[2*n+1],h=F(Math.floor(e*this.pInvSpacing),0,this.pNumX-1),f=F(Math.floor(c*this.pInvSpacing),0,this.pNumY-1),m=h*this.pNumY+f;this.numCellParticles[m]++}let s=0;for(let n=0;n<this.pNumCells;n++)s+=this.numCellParticles[n],this.firstCellParticle[n]=s;this.firstCellParticle[this.pNumCells]=s;for(let n=0;n<this.numParticles;n++){const e=this.particlePos[2*n],c=this.particlePos[2*n+1],h=F(Math.floor(e*this.pInvSpacing),0,this.pNumX-1),f=F(Math.floor(c*this.pInvSpacing),0,this.pNumY-1),m=h*this.pNumY+f;this.firstCellParticle[m]--,this.cellParticleIds[this.firstCellParticle[m]]=n}const o=2*this.particleRadius,r=o*o;for(let n=0;n<a;n++)for(let e=0;e<this.numParticles;e++){const c=this.particlePos[2*e],h=this.particlePos[2*e+1],f=Math.floor(c*this.pInvSpacing),m=Math.floor(h*this.pInvSpacing),y=Math.max(f-1,0),u=Math.max(m-1,0),g=Math.min(f+1,this.pNumX-1),x=Math.min(m+1,this.pNumY-1);for(let b=y;b<=g;b++)for(let v=u;v<=x;v++){const w=b*this.pNumY+v,C=this.firstCellParticle[w],I=this.firstCellParticle[w+1];for(let Y=C;Y<I;Y++){const p=this.cellParticleIds[Y];if(p===e)continue;const R=this.particlePos[2*p],A=this.particlePos[2*p+1],D=R-c,S=A-h,k=D*D+S*S;if(k>r||k===0)continue;const T=Math.sqrt(k),_=.5*(o-T)/T,L=D*_,M=S*_;this.particlePos[2*e]-=L,this.particlePos[2*e+1]-=M,this.particlePos[2*p]+=L,this.particlePos[2*p+1]+=M;for(let N=0;N<3;N++){const V=this.particleColor[3*e+N],X=this.particleColor[3*p+N],H=(V+X)*.5;this.particleColor[3*e+N]=V+(H-V)*.001,this.particleColor[3*p+N]=X+(H-X)*.001}}}}}handleParticleCollisions(a,i,s){const o=1/this.fInvSpacing,r=this.particleRadius,n=s+r,e=n*n,c=o+r,h=(this.fNumX-1)*o-r,f=o+r,m=(this.fNumY-1)*o-r;for(let y=0;y<this.numParticles;y++){let u=this.particlePos[2*y],g=this.particlePos[2*y+1];const x=u-a,b=g-i;x*x+b*b<e&&(this.particleVel[2*y]=d.obstacleVelX,this.particleVel[2*y+1]=d.obstacleVelY),u<c&&(u=c,this.particleVel[2*y]=0),u>h&&(u=h,this.particleVel[2*y]=0),g<f&&(g=f,this.particleVel[2*y+1]=0),g>m&&(g=m,this.particleVel[2*y+1]=0),this.particlePos[2*y]=u,this.particlePos[2*y+1]=g}}updateParticleDensity(){const a=this.fNumY,i=this.h,s=this.fInvSpacing,o=.5*i,r=this.particleDensity;r.fill(0);for(let n=0;n<this.numParticles;n++){let e=this.particlePos[2*n],c=this.particlePos[2*n+1];e=F(e,i,(this.fNumX-1)*i),c=F(c,i,(this.fNumY-1)*i);const h=Math.floor((e-o)*s),f=(e-o-h*i)*s,m=Math.min(h+1,this.fNumX-2),y=Math.floor((c-o)*s),u=(c-o-y*i)*s,g=Math.min(y+1,this.fNumY-2),x=1-f,b=1-u;h<this.fNumX&&y<this.fNumY&&(r[h*a+y]+=x*b),m<this.fNumX&&y<this.fNumY&&(r[m*a+y]+=f*b),m<this.fNumX&&g<this.fNumY&&(r[m*a+g]+=f*u),h<this.fNumX&&g<this.fNumY&&(r[h*a+g]+=x*u)}if(this.particleRestDensity===0){let n=0,e=0;for(let c=0;c<this.fNumCells;c++)this.cellType[c]===j&&(n+=r[c],e++);e>0&&(this.particleRestDensity=n/e)}}transferVelocities(a,i=0){const s=this.fNumY,o=this.h,r=this.fInvSpacing,n=.5*o;if(a){this.prevU.set(this.u),this.prevV.set(this.v),this.du.fill(0),this.dv.fill(0),this.u.fill(0),this.v.fill(0);for(let e=0;e<this.fNumCells;e++)this.cellType[e]=this.s[e]===0?W:B;for(let e=0;e<this.numParticles;e++){const c=this.particlePos[2*e],h=this.particlePos[2*e+1],f=F(Math.floor(c*r),0,this.fNumX-1),m=F(Math.floor(h*r),0,this.fNumY-1),y=f*s+m;this.cellType[y]===B&&(this.cellType[y]=j)}}for(let e=0;e<2;e++){const c=e===0?0:n,h=e===0?n:0,f=e===0?this.u:this.v,m=e===0?this.prevU:this.prevV,y=e===0?this.du:this.dv;for(let u=0;u<this.numParticles;u++){let g=this.particlePos[2*u],x=this.particlePos[2*u+1];g=F(g,o,(this.fNumX-1)*o),x=F(x,o,(this.fNumY-1)*o);const b=Math.min(Math.floor((g-c)*r),this.fNumX-2),v=(g-c-b*o)*r,w=Math.min(b+1,this.fNumX-2),C=Math.min(Math.floor((x-h)*r),this.fNumY-2),I=(x-h-C*o)*r,Y=Math.min(C+1,this.fNumY-2),p=1-v,R=1-I,A=p*R,D=v*R,S=v*I,k=p*I,T=b*s+C,_=w*s+C,L=w*s+Y,M=b*s+Y;if(a){const N=this.particleVel[2*u+e];f[T]+=N*A,y[T]+=A,f[_]+=N*D,y[_]+=D,f[L]+=N*S,y[L]+=S,f[M]+=N*k,y[M]+=k}else{const N=e===0?s:1,V=this.cellType[T]!==B||this.cellType[T-N]!==B?1:0,X=this.cellType[_]!==B||this.cellType[_-N]!==B?1:0,H=this.cellType[L]!==B||this.cellType[L-N]!==B?1:0,Z=this.cellType[M]!==B||this.cellType[M-N]!==B?1:0,gt=this.particleVel[2*u+e],J=V*A+X*D+H*S+Z*k;if(J>0){const yt=(V*A*f[T]+X*D*f[_]+H*S*f[L]+Z*k*f[M])/J,xt=(V*A*(f[T]-m[T])+X*D*(f[_]-m[_])+H*S*(f[L]-m[L])+Z*k*(f[M]-m[M]))/J,bt=gt+xt;this.particleVel[2*u+e]=(1-i)*yt+i*bt}}}if(a){for(let u=0;u<f.length;u++)y[u]>0&&(f[u]/=y[u]);for(let u=0;u<this.fNumX;u++)for(let g=0;g<this.fNumY;g++){const x=this.cellType[u*s+g]===W;(x||u>0&&this.cellType[(u-1)*s+g]===W)&&(this.u[u*s+g]=this.prevU[u*s+g]),(x||g>0&&this.cellType[u*s+g-1]===W)&&(this.v[u*s+g]=this.prevV[u*s+g])}}}}solveIncompressibility(a,i,s,o=!0){this.p.fill(0),this.prevU.set(this.u),this.prevV.set(this.v);const r=this.fNumY,n=this.density*this.h/i;for(let e=0;e<a;e++)for(let c=1;c<this.fNumX-1;c++)for(let h=1;h<this.fNumY-1;h++){if(this.cellType[c*r+h]!==j)continue;const f=c*r+h,m=(c-1)*r+h,y=(c+1)*r+h,u=c*r+h-1,g=c*r+h+1,x=this.s[m],b=this.s[y],v=this.s[u],w=this.s[g],C=x+b+v+w;if(C===0)continue;let I=this.u[y]-this.u[f]+this.v[g]-this.v[f];if(this.particleRestDensity>0&&o){const A=this.particleDensity[c*r+h]-this.particleRestDensity;A>0&&(I=I-1*A)}const p=-I/C*s;this.p[f]+=n*p,this.u[f]-=x*p,this.u[y]+=b*p,this.v[f]-=v*p,this.v[g]+=w*p}}updateParticleColors(){const a=this.fInvSpacing;for(let i=0;i<this.numParticles;i++){this.particleColor[3*i]=F(this.particleColor[3*i]-.01,0,1),this.particleColor[3*i+1]=F(this.particleColor[3*i+1]-.01,0,1),this.particleColor[3*i+2]=F(this.particleColor[3*i+2]+.01,0,1);const o=this.particlePos[2*i],r=this.particlePos[2*i+1],n=F(Math.floor(o*a),1,this.fNumX-1),e=F(Math.floor(r*a),1,this.fNumY-1),c=n*this.fNumY+e,h=this.particleRestDensity;h>0&&this.particleDensity[c]/h<.7&&(this.particleColor[3*i]=.8,this.particleColor[3*i+1]=.8,this.particleColor[3*i+2]=1)}}setSciColor(a,i,s,o){i=Math.min(Math.max(i,s),o-1e-4);const r=o-s;i=r===0?.5:(i-s)/r;const n=.25,e=Math.floor(i/n),c=(i-e*n)/n;let h,f,m;switch(e){case 0:h=0,f=c,m=1;break;case 1:h=0,f=1,m=1-c;break;case 2:h=c,f=1,m=0;break;case 3:h=1,f=1-c,m=0;break;default:h=0,f=0,m=0}this.cellColor[3*a]=h,this.cellColor[3*a+1]=f,this.cellColor[3*a+2]=m}updateCellColors(){this.cellColor.fill(0);for(let a=0;a<this.fNumCells;a++)if(this.cellType[a]===W)this.cellColor[3*a]=.5,this.cellColor[3*a+1]=.5,this.cellColor[3*a+2]=.5;else if(this.cellType[a]===j){let i=this.particleDensity[a];this.particleRestDensity>0&&(i/=this.particleRestDensity),this.setSciColor(a,i,0,2)}}simulate(a,i,s,o,r,n,e,c,h,f,m){const u=a/1;for(let g=0;g<1;g++)this.integrateParticles(u,i),c&&this.pushParticlesApart(r),this.handleParticleCollisions(h,f,m),this.transferVelocities(!0),this.updateParticleDensity(),this.solveIncompressibility(o,u,n,e),this.transferVelocities(!1,s);this.updateParticleColors(),this.updateCellColors()}}const d={gravity:-9.81,dt:1/120,flipRatio:.9,numPressureIters:100,numParticleIters:2,overRelaxation:1.9,compensateDrift:!0,separateParticles:!0,obstacleX:0,obstacleY:0,obstacleRadius:.15,paused:!1,obstacleVelX:0,obstacleVelY:0,showParticles:!0,showGrid:!1,fluid:null};function st(){d.obstacleRadius=.15,d.overRelaxation=1.9,d.dt=1/60,d.numPressureIters=50,d.numParticleIters=2;const l=100,a=1*G,i=1*z,s=a/l,o=1e3,r=.8,n=.6,e=.3*s,c=2*e,h=Math.sqrt(3)/2*c,f=Math.floor((n*i-2*s-2*e)/c),m=Math.floor((r*a-2*s-2*e)/h),y=f*m,u=new wt(o,i,a,s,e,y);d.fluid=u,u.numParticles=f*m;let g=0;for(let b=0;b<f;b++)for(let v=0;v<m;v++)u.particlePos[g++]=s+e+c*b+(v%2===0?0:e),u.particlePos[g++]=s+e+h*v;const x=u.fNumY;for(let b=0;b<u.fNumX;b++)for(let v=0;v<u.fNumY;v++){let w=1;(b===0||b===u.fNumX-1||v===0)&&(w=0),u.s[b*x+v]=w}ot(3,2,!0)}const At=`
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
	`,Rt=`
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
	`,Nt=`
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
	`,St=`
		precision mediump float;
		varying vec3 fragColor;

		void main() {
			gl_FragColor = vec4(fragColor, 1.0);
		}
	`;function lt(l,a,i){const s=l.createShader(l.VERTEX_SHADER);l.shaderSource(s,a),l.compileShader(s),l.getShaderParameter(s,l.COMPILE_STATUS)||console.log("vertex shader compile error: "+l.getShaderInfoLog(s));const o=l.createShader(l.FRAGMENT_SHADER);l.shaderSource(o,i),l.compileShader(o),l.getShaderParameter(o,l.COMPILE_STATUS)||console.log("fragment shader compile error: "+l.getShaderInfoLog(o));const r=l.createProgram();return l.attachShader(r,s),l.attachShader(r,o),l.linkProgram(r),r}let E=null,U=null,K=null,Q=null,q=null,tt=null,$=null,et=null;function Ft(){if(t.clearColor(0,0,0,1),t.clear(t.COLOR_BUFFER_BIT),t.viewport(0,0,t.canvas.width,t.canvas.height),E==null&&(E=lt(t,At,Rt)),U==null&&(U=lt(t,Nt,St)),q==null){const s=d.fluid;q=t.createBuffer();const o=new Float32Array(2*s.fNumCells);let r=0;for(let n=0;n<s.fNumX;n++)for(let e=0;e<s.fNumY;e++)o[r++]=(n+.5)*s.h,o[r++]=(e+.5)*s.h;t.bindBuffer(t.ARRAY_BUFFER,q),t.bufferData(t.ARRAY_BUFFER,o,t.DYNAMIC_DRAW),t.bindBuffer(t.ARRAY_BUFFER,null)}if(tt==null&&(tt=t.createBuffer()),d.showGrid){const s=.9*d.fluid.h/z*P.width;t.useProgram(E),t.uniform2f(t.getUniformLocation(E,"domainSize"),z,G),t.uniform1f(t.getUniformLocation(E,"pointSize"),s),t.uniform1f(t.getUniformLocation(E,"drawDisk"),0),t.bindBuffer(t.ARRAY_BUFFER,q);const o=t.getAttribLocation(E,"attrPosition");t.enableVertexAttribArray(o),t.vertexAttribPointer(o,2,t.FLOAT,!1,0,0),t.bindBuffer(t.ARRAY_BUFFER,tt),t.bufferData(t.ARRAY_BUFFER,d.fluid.cellColor,t.DYNAMIC_DRAW);const r=t.getAttribLocation(E,"attrColor");t.enableVertexAttribArray(r),t.vertexAttribPointer(r,3,t.FLOAT,!1,0,0),t.drawArrays(t.POINTS,0,d.fluid.fNumCells),t.disableVertexAttribArray(o),t.disableVertexAttribArray(r),t.bindBuffer(t.ARRAY_BUFFER,null)}if(d.showParticles){t.clear(t.DEPTH_BUFFER_BIT);const s=2*d.fluid.particleRadius/z*P.width;t.useProgram(E),t.uniform2f(t.getUniformLocation(E,"domainSize"),z,G),t.uniform1f(t.getUniformLocation(E,"pointSize"),s),t.uniform1f(t.getUniformLocation(E,"drawDisk"),1),K==null&&(K=t.createBuffer()),Q==null&&(Q=t.createBuffer()),t.bindBuffer(t.ARRAY_BUFFER,K),t.bufferData(t.ARRAY_BUFFER,d.fluid.particlePos,t.DYNAMIC_DRAW);const o=t.getAttribLocation(E,"attrPosition");t.enableVertexAttribArray(o),t.vertexAttribPointer(o,2,t.FLOAT,!1,0,0),t.bindBuffer(t.ARRAY_BUFFER,Q),t.bufferData(t.ARRAY_BUFFER,d.fluid.particleColor,t.DYNAMIC_DRAW);const r=t.getAttribLocation(E,"attrColor");t.enableVertexAttribArray(r),t.vertexAttribPointer(r,3,t.FLOAT,!1,0,0),t.drawArrays(t.POINTS,0,d.fluid.numParticles),t.disableVertexAttribArray(o),t.disableVertexAttribArray(r),t.bindBuffer(t.ARRAY_BUFFER,null)}const l=50;if($==null){$=t.createBuffer();const s=2*Math.PI/l,o=new Float32Array(2*l+2);let r=0;o[r++]=0,o[r++]=0;for(let e=0;e<l;e++)o[r++]=Math.cos(e*s),o[r++]=Math.sin(e*s);t.bindBuffer(t.ARRAY_BUFFER,$),t.bufferData(t.ARRAY_BUFFER,o,t.DYNAMIC_DRAW),t.bindBuffer(t.ARRAY_BUFFER,null),et=t.createBuffer();const n=new Uint16Array(3*l);r=0;for(let e=0;e<l;e++)n[r++]=0,n[r++]=1+e,n[r++]=1+(e+1)%l;t.bindBuffer(t.ELEMENT_ARRAY_BUFFER,et),t.bufferData(t.ELEMENT_ARRAY_BUFFER,n,t.DYNAMIC_DRAW),t.bindBuffer(t.ELEMENT_ARRAY_BUFFER,null)}t.clear(t.DEPTH_BUFFER_BIT);const a=[1,0,0];t.useProgram(U),t.uniform2f(t.getUniformLocation(U,"domainSize"),z,G),t.uniform3f(t.getUniformLocation(U,"color"),a[0],a[1],a[2]),t.uniform2f(t.getUniformLocation(U,"translation"),d.obstacleX,d.obstacleY),t.uniform1f(t.getUniformLocation(U,"scale"),d.obstacleRadius+d.fluid.particleRadius);const i=t.getAttribLocation(U,"attrPosition");t.enableVertexAttribArray(i),t.bindBuffer(t.ARRAY_BUFFER,$),t.vertexAttribPointer(i,2,t.FLOAT,!1,0,0),t.bindBuffer(t.ELEMENT_ARRAY_BUFFER,et),t.drawElements(t.TRIANGLES,3*l,t.UNSIGNED_SHORT,0),t.disableVertexAttribArray(i)}function ot(l,a,i){let s=0,o=0;i||(s=(l-d.obstacleX)/d.dt,o=(a-d.obstacleY)/d.dt),d.obstacleX=l,d.obstacleY=a;const r=d.obstacleRadius,n=d.fluid,e=n.fNumY;for(let c=1;c<n.fNumX-2;c++)for(let h=1;h<n.fNumY-2;h++){n.s[c*e+h]=1;const f=(c+.5)*n.h-l,m=(h+.5)*n.h-a;f*f+m*m<r*r&&(n.s[c*e+h]=0,n.u[c*e+h]=s,n.u[(c+1)*e+h]=s,n.v[c*e+h]=o,n.v[c*e+h+1]=o)}d.obstacleVelX=s,d.obstacleVelY=o}let rt=!1;function ht(l,a){const i=P.getBoundingClientRect(),s=window.devicePixelRatio||1,o=(l-i.left)*s,r=(a-i.top)*s;rt=!0;const n=o/O,e=(P.height-r)/O;ot(n,e,!0),d.paused=!1}function ft(l,a){if(rt){const i=P.getBoundingClientRect(),s=window.devicePixelRatio||1,o=(l-i.left)*s,r=(a-i.top)*s,n=o/O,e=(P.height-r)/O;ot(n,e,!1)}}function dt(){rt=!1,d.obstacleVelX=0,d.obstacleVelY=0}P.addEventListener("mousedown",l=>{ht(l.clientX,l.clientY)});P.addEventListener("mouseup",l=>{dt()});P.addEventListener("mousemove",l=>{ft(l.clientX,l.clientY)});P.addEventListener("touchstart",l=>{ht(l.touches[0].clientX,l.touches[0].clientY)});P.addEventListener("touchend",l=>{dt()});P.addEventListener("touchmove",l=>{l.preventDefault(),l.stopImmediatePropagation(),ft(l.touches[0].clientX,l.touches[0].clientY)},{passive:!1});document.addEventListener("keydown",l=>{switch(l.key){case"p":d.paused=!d.paused;break;case"m":d.paused=!1,pt(),d.paused=!0;break}});let it;const nt={togglePause:()=>{d.paused=!d.paused,it&&it.name(d.paused?"Resume":"Pause")},reset:()=>st()},{stats:at,gui:ut}=Pt(d,{onReset:nt.reset},{title:"Canvas 2D FLIP Fluid",subtitle:"Hybrid FLIP/PIC Fluid Simulation",features:["FLIP/PIC Hybrid Solver","Staggered MAC Grid","Incompressible Pressure Solver","Interactive Obstacle","Particle Drift Compensation"],interactions:["Click & Drag: Move Obstacle","P: Pause/Resume","M: Step Simulation"],githubUrl:"https://github.com/jeantimex/fluid",buildTimestamp:"2026-02-22T19:11:34.089Z"});it=ut.add(nt,"togglePause").name(d.paused?"Resume":"Pause");ut.add(nt,"reset").name("Reset Simulation");function pt(){!d.paused&&d.fluid&&d.fluid.simulate(d.dt,d.gravity,d.flipRatio,d.numPressureIters,d.numParticleIters,d.overRelaxation,d.compensateDrift,d.separateParticles,d.obstacleX,d.obstacleY,d.obstacleRadius)}function mt(){at.begin(),pt(),Ft(),at.end(),requestAnimationFrame(mt)}st();ct();window.addEventListener("resize",ct);mt();
