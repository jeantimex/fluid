import{G as ht}from"./lil-gui.esm-DA0aiWCL.js";import{S as xt}from"./main-DwTz-q1_.js";function Dt(){return{timeScale:1,maxTimestepFPS:60,iterationsPerFrame:2,gravity:12,collisionDamping:.95,smoothingRadius:.35,targetDensity:55,pressureMultiplier:500,nearPressureMultiplier:5,viscosityStrength:.01,boundsSize:{x:17.1,y:9.3},obstacleSize:{x:0,y:0},obstacleCentre:{x:0,y:0},interactionRadius:2,interactionStrength:90,velocityDisplayMax:6.5,particleRadius:2.5,boundsPaddingPx:10,gradientResolution:64,colorKeys:[{t:4064/65535,r:.13363299,g:.34235913,b:.7264151},{t:33191/65535,r:.2980392,g:1,b:.56327766},{t:46738/65535,r:1,g:.9309917,b:0},{t:1,r:.96862745,g:.28555763,b:.031372573}],spawnDensity:35,initialVelocity:{x:0,y:0},jitterStr:.03,spawnRegions:[{position:{x:0,y:.66},size:{x:6.42,y:4.39}}]}}function mt(t,e,i){if(t<e){const c=e*e-t*t;return c*c*c*i}return 0}function yt(t,e,i){if(t<e){const c=e-t;return c*c*c*i}return 0}function gt(t,e,i){if(t<e){const c=e-t;return c*c*i}return 0}function ft(t,e,i){if(t<=e){const c=e-t;return-c*c*i}return 0}function bt(t,e,i){return t<=e?-(e-t)*i:0}function Tt(t,e){const i=[...t].sort((n,g)=>n.t-g.t),c=new Array(e);for(let n=0;n<e;n+=1){const g=e===1?0:n/(e-1);let l=i[0],w=i[i.length-1];for(let k=0;k<i.length-1;k+=1){const q=i[k],G=i[k+1];if(g>=q.t&&g<=G.t){l=q,w=G;break}}const S=w.t-l.t||1,D=(g-l.t)/S,z=l.r+(w.r-l.r)*D,K=l.g+(w.g-l.g)*D,L=l.b+(w.b-l.b)*D;c[n]={r:z,g:K,b:L}}return c}const wt=15823,vt=9737333,W=[[-1,1],[0,1],[1,1],[-1,0],[0,0],[1,0],[-1,-1],[0,-1],[1,-1]];function et(t,e){const i=Math.imul(t|0,wt),c=Math.imul(e|0,vt);return i+c>>>0}function zt(t,e,i){const c={particleRadius:e.particleRadius,smoothingRadius:e.smoothingRadius,targetDensity:e.targetDensity,pressureMultiplier:e.pressureMultiplier,nearPressureMultiplier:e.nearPressureMultiplier,viscosityStrength:e.viscosityStrength};let n=e.smoothingRadius,g=n*n,l=4/(Math.PI*Math.pow(n,8)),w=10/(Math.PI*Math.pow(n,5)),S=6/(Math.PI*Math.pow(n,4)),D=30/(Math.PI*Math.pow(n,5)),z=12/(Math.PI*Math.pow(n,4));function K(){n=e.smoothingRadius,g=n*n,l=4/(Math.PI*Math.pow(n,8)),w=10/(Math.PI*Math.pow(n,5)),S=6/(Math.PI*Math.pow(n,4)),D=30/(Math.PI*Math.pow(n,5)),z=12/(Math.PI*Math.pow(n,4))}function L(){const a=Math.max(1e-4,c.particleRadius),o=e.particleRadius/a,d=o*o;e.smoothingRadius=c.smoothingRadius*o,e.targetDensity=c.targetDensity*d,e.pressureMultiplier=c.pressureMultiplier/d,e.nearPressureMultiplier=c.nearPressureMultiplier/d,e.viscosityStrength=c.viscosityStrength/o,K()}function k(a){const o=t.positions,d=t.predicted,p=t.velocities,u=t.input.pull,s=t.input.push?-e.interactionStrength:u?e.interactionStrength:0,x=t.input.worldX,y=t.input.worldY,v=e.interactionRadius,C=v*v;for(let M=0;M<t.count;M+=1){const f=M*2;let r=p[f],h=p[f+1],b=0,E=-e.gravity;if(s!==0){const P=x-o[f],H=y-o[f+1],Y=P*P+H*H;if(Y<C){const T=Math.sqrt(Y),R=1-T/v,X=T>0?1/T:0,J=P*X,O=H*X,A=1-R*Math.min(1,s/10);b=b*A+J*R*s-r*R,E=E*A+O*R*s-h*R}}r+=b*a,h+=E*a,p[f]=r,p[f+1]=h;const I=1/120;d[f]=o[f]+r*I,d[f+1]=o[f+1]+h*I}}function q(){const a=t.positions,o=t.predicted,d=t.velocities,p=1/120;for(let u=0;u<t.count;u+=1){const m=u*2;o[m]=a[m]+d[m]*p,o[m+1]=a[m+1]+d[m+1]*p}}function G(){const a=t.count,o=t.predicted,d=t.keys,p=t.sortedKeys,u=t.indices,m=t.sortOffsets;m.fill(0);for(let r=0;r<a;r+=1){const h=r*2,b=Math.floor(o[h]/n),E=Math.floor(o[h+1]/n),P=et(b,E)%a;d[r]=P,m[P]+=1}let s=0;for(let r=0;r<a;r+=1){const h=m[r];m[r]=s,s+=h}for(let r=0;r<a;r+=1){const h=d[r],b=m[h];m[h]=b+1,u[b]=r,p[b]=h}const x=t.positions,y=t.velocities,v=t.positionsSorted,C=t.predictedSorted,M=t.velocitiesSorted;for(let r=0;r<a;r+=1){const h=u[r]*2,b=r*2;v[b]=x[h],v[b+1]=x[h+1],C[b]=o[h],C[b+1]=o[h+1],M[b]=y[h],M[b+1]=y[h+1]}t.positions=v,t.predicted=C,t.velocities=M,t.positionsSorted=x,t.predictedSorted=o,t.velocitiesSorted=y;const f=t.spatialOffsets;f.fill(a);for(let r=0;r<a;r+=1)(r===0||p[r]!==p[r-1])&&(f[p[r]]=r)}function $(){const a=t.count,o=t.predicted,d=t.densities,p=t.sortedKeys,u=t.spatialOffsets;for(let m=0;m<a;m+=1){const s=m*2,x=o[s],y=o[s+1],v=Math.floor(x/n),C=Math.floor(y/n);let M=0,f=0;for(let r=0;r<W.length;r+=1){const h=W[r],b=v+h[0],E=C+h[1],I=et(b,E)%a;let P=u[I];for(;P<a&&p[P]===I;){const Y=P*2,T=o[Y]-x,_=o[Y+1]-y,R=T*T+_*_;if(R<=g){const X=Math.sqrt(R);M+=gt(X,n,S),f+=yt(X,n,w)}P+=1}}d[s]=M,d[s+1]=f}}function N(a){const o=t.count,d=t.predicted,p=t.velocities,u=t.densities,m=t.sortedKeys,s=t.spatialOffsets;for(let x=0;x<o;x+=1){const y=x*2,v=u[y],C=u[y+1];if(v<=0)continue;const M=(v-e.targetDensity)*e.pressureMultiplier,f=e.nearPressureMultiplier*C,r=d[y],h=d[y+1],b=Math.floor(r/n),E=Math.floor(h/n);let I=0,P=0;for(let H=0;H<W.length;H+=1){const Y=W[H],T=b+Y[0],_=E+Y[1],R=et(T,_)%o;let X=s[R];for(;X<o&&m[X]===R;){if(X!==x){const O=X*2,A=d[O]-r,B=d[O+1]-h,it=A*A+B*B;if(it<=g){const tt=Math.sqrt(it),st=tt>0?1/tt:0,rt=A*st,at=B*st,nt=u[O],ot=u[O+1],lt=(nt-e.targetDensity)*e.pressureMultiplier,dt=e.nearPressureMultiplier*ot,pt=(M+lt)*.5,ut=(f+dt)*.5;if(nt>0){const Z=bt(tt,n,z)*(pt/nt);I+=rt*Z,P+=at*Z}if(ot>0){const Z=ft(tt,n,D)*(ut/ot);I+=rt*Z,P+=at*Z}}}X+=1}}p[y]+=I/v*a,p[y+1]+=P/v*a}}function j(a){const o=t.count,d=t.predicted,p=t.velocities,u=t.sortedKeys,m=t.spatialOffsets;for(let s=0;s<o;s+=1){const x=s*2,y=d[x],v=d[x+1],C=Math.floor(y/n),M=Math.floor(v/n);let f=0,r=0;const h=p[x],b=p[x+1];for(let E=0;E<W.length;E+=1){const I=W[E],P=C+I[0],H=M+I[1],Y=et(P,H)%o;let T=m[Y];for(;T<o&&u[T]===Y;){if(T!==s){const R=T*2,X=d[R]-y,J=d[R+1]-v,O=X*X+J*J;if(O<=g){const A=Math.sqrt(O),B=mt(A,n,l);f+=(p[R]-h)*B,r+=(p[R+1]-b)*B}}T+=1}}p[x]+=f*e.viscosityStrength*a,p[x+1]+=r*e.viscosityStrength*a}}function U(){const a=t.positions,o=t.velocities,d=window.devicePixelRatio||1,u=(Math.max(1,Math.round(e.particleRadius))+e.boundsPaddingPx)*d/i(),m=Math.max(0,e.boundsSize.x*.5-u),s=Math.max(0,e.boundsSize.y*.5-u),x=e.obstacleSize.x*.5,y=e.obstacleSize.y*.5,v=e.obstacleSize.x>0&&e.obstacleSize.y>0;for(let C=0;C<t.count;C+=1){const M=C*2;let f=a[M],r=a[M+1],h=o[M],b=o[M+1];const E=m-Math.abs(f),I=s-Math.abs(r);if(E<=0&&(f=m*Math.sign(f),h*=-e.collisionDamping),I<=0&&(r=s*Math.sign(r),b*=-e.collisionDamping),v){const P=f-e.obstacleCentre.x,H=r-e.obstacleCentre.y,Y=x-Math.abs(P),T=y-Math.abs(H);Y>=0&&T>=0&&(Y<T?(f=x*Math.sign(P)+e.obstacleCentre.x,h*=-e.collisionDamping):(r=y*Math.sign(H)+e.obstacleCentre.y,b*=-e.collisionDamping))}a[M]=f,a[M+1]=r,o[M]=h,o[M+1]=b}}function F(a){const o=t.positions,d=t.velocities;for(let p=0;p<t.count;p+=1){const u=p*2;o[u]+=d[u]*a,o[u+1]+=d[u+1]*a}U()}function Q(a,o){o?k(a):q(),G(),$(),N(a),j(a),F(a)}function V(a){const o=e.maxTimestepFPS?1/e.maxTimestepFPS:Number.POSITIVE_INFINITY,p=Math.min(a*e.timeScale,o)/e.iterationsPerFrame;for(let u=0;u<e.iterationsPerFrame;u+=1)Q(p,!0)}return{step:V,substep:Q,predictPositions:q,runSpatialHash:G,calculateDensities:$,calculatePressure:N,calculateViscosity:j,updatePositions:F,refreshSettings:K,applyParticleScale:L}}function Mt(t){let e=t>>>0;return()=>(e=1664525*e+1013904223>>>0,e/4294967296)}function St(t,e){const i=t.x*t.y,c=Math.ceil(i*e),n=t.x+t.y,g=t.x/n,l=t.y/n,w=Math.sqrt(c/(g*l)),S=Math.ceil(g*w),D=Math.ceil(l*w);return{x:S,y:D}}function Ct(t,e){const i=t.size,c=t.position,n=St(i,e),g=new Array(n.x*n.y);let l=0;for(let w=0;w<n.y;w+=1)for(let S=0;S<n.x;S+=1){const D=n.x===1?.5:S/(n.x-1),z=n.y===1?.5:w/(n.y-1),K=(D-.5)*i.x+c.x,L=(z-.5)*i.y+c.y;g[l]={x:K,y:L},l+=1}return g}function Rt(t){const e=Mt(42),i=[];for(const l of t.spawnRegions){const w=Ct(l,t.spawnDensity);for(const S of w){const D=e()*Math.PI*2,z=Math.cos(D),K=Math.sin(D),L=(e()-.5)*t.jitterStr;i.push({x:S.x+z*L,y:S.y+K*L})}}const c=i.length,n=new Float32Array(c*2),g=new Float32Array(c*2);for(let l=0;l<c;l+=1)n[l*2]=i[l].x,n[l*2+1]=i[l].y,g[l*2]=t.initialVelocity.x,g[l*2+1]=t.initialVelocity.y;return{positions:n,velocities:g,count:c}}function ct(t){let e=0;for(const i of t.spawnRegions){const c=i.size.x*i.size.y,n=Math.ceil(c*t.spawnDensity),g=i.size.x+i.size.y,l=i.size.x/g,w=i.size.y/g,S=Math.sqrt(n/(l*w)),D=Math.ceil(l*S),z=Math.ceil(w*S);e+=D*z}return e}function Ft(t,e,i={}){if(!document.querySelector('link[href*="Material+Icons"]')){const F=document.createElement("link");F.href="https://fonts.googleapis.com/icon?family=Material+Icons",F.rel="stylesheet",document.head.appendChild(F)}const c=document.createElement("style");c.textContent=`
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
  `,document.head.appendChild(c);const n=document.createElement("div");n.id="gui-container",window.innerWidth<=480&&n.classList.add("collapsed"),document.body.appendChild(n);const g=document.createElement("div");g.className="gui-header-main",n.appendChild(g);const l=document.createElement("button");l.className="gui-toggle-btn",l.innerHTML='<span class="material-icons">menu</span>',g.appendChild(l);const w=document.createElement("div");w.className="gui-title-area",g.appendChild(w);const S=document.createElement("div");S.className="gui-content-wrapper",n.appendChild(S);const D=F=>{F&&F.stopPropagation(),n.classList.toggle("collapsed")};if(l.onclick=D,n.onclick=()=>{n.classList.contains("collapsed")&&n.classList.remove("collapsed")},i.title){const F=document.createElement("span");if(F.style.cssText=`
      font-size: 16px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `,F.textContent=i.title,w.appendChild(F),i.githubUrl){const s=document.createElement("a");s.href=i.githubUrl,s.target="_blank",s.rel="noopener noreferrer",s.title="View on GitHub",s.style.cssText=`
        display: flex;
        align-items: center;
        color: #fff;
        opacity: 0.7;
        transition: opacity 0.2s;
        margin-left: 10px;
      `,s.onpointerenter=()=>s.style.opacity="1",s.onpointerleave=()=>s.style.opacity="0.7",s.innerHTML=`
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
      `,w.appendChild(s)}const Q=document.createElement("div");Q.style.cssText=`
      background: #1a1a1a;
      color: #fff;
      box-sizing: border-box;
    `;const V=document.createElement("div");V.className="custom-gui-folder",V.style.cssText=`
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(255, 255, 255, 0.02);
    `;const a=document.createElement("div");a.className="custom-gui-folder-header",a.style.cssText=`
      display: flex;
      align-items: center;
      padding: 1px;
      cursor: pointer;
      user-select: none;
      font-size: 11px;
      font-weight: 700;
      color: rgba(255, 255, 255, 0.9);
    `,a.innerHTML=`
      <span class="material-icons folder-arrow" style="
        font-family: 'Material Icons';
        font-size: 16px;
        transition: transform 0.2s;
        transform: rotate(90deg);
        text-transform: none;
      ">chevron_right</span>
      About
    `;const o=document.createElement("div");o.className="custom-gui-folder-content",o.style.cssText=`
      overflow: hidden;
      max-height: none;
      transition: max-height 0.3s ease-out;
    `;let d=!0;if(a.onclick=()=>{o.style.maxHeight==="none"&&(o.style.maxHeight=o.scrollHeight+"px",o.offsetHeight),d=!d;const s=a.querySelector(".folder-arrow");d?(s.style.transform="rotate(90deg)",o.style.maxHeight=o.scrollHeight+"px"):(s.style.transform="rotate(0deg)",o.style.maxHeight="0")},i.subtitle){const s=document.createElement("div");s.style.cssText=`
        padding: 5px 11px 5px 11px;
        font-size: 11px;
        font-weight: 400;
        opacity: 0.6;
        line-height: 1.4;
        letter-spacing: 0.01em;
        white-space: normal;
        overflow-wrap: break-word;
        max-width: 220px;
      `,s.textContent=i.subtitle,o.appendChild(s)}const p=document.createElement("div");p.style.cssText=`
      padding: 0 11px 10px 11px;
      font-size: 10px;
      font-weight: 400;
      opacity: 1.0;
      letter-spacing: 0.01em;
    `,p.innerHTML='Original Author: <a href="https://github.com/SebLague" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">Sebastian Lague</a>',o.appendChild(p);const u=document.createElement("div");u.style.cssText=`
      padding: 0 11px 10px 11px;
      font-size: 10px;
      font-weight: 400;
      opacity: 1.0;
      letter-spacing: 0.01em;
    `,u.innerHTML='WebGPU Author: <a href="https://github.com/jeantimex" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">jeantimex</a>',o.appendChild(u);const m=document.createElement("div");if(m.style.cssText=`
      padding: 0 11px 10px 11px;
      font-size: 10px;
      font-weight: 400;
      opacity: 1.0;
      letter-spacing: 0.01em;
      display: flex;
      align-items: center;
      gap: 4px;
    `,m.innerHTML=`
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#FF0000">
              <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM9.5 16.5v-9l7 4.5-7 4.5z"/>
            </svg>
            <a href="https://youtu.be/rSKMYc1CQHE?si=oe9BznpAUnMWUslT" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">Coding Adventure: Simulating Fluids</a>
          `,o.appendChild(m),i.features&&i.features.length>0){const s=document.createElement("div");s.style.cssText=`
        padding: 5px 11px 10px 11px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      `;const x=document.createElement("div");x.style.cssText=`
        font-size: 10px;
        font-weight: 600;
        opacity: 0.8;
        text-transform: uppercase;
        margin-bottom: 4px;
      `,x.textContent="Features:",s.appendChild(x);const y=document.createElement("ul");y.style.cssText=`
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
      `,i.features.forEach(v=>{const C=document.createElement("li");C.textContent=v,y.appendChild(C)}),s.appendChild(y),o.appendChild(s)}if(i.interactions&&i.interactions.length>0){const s=document.createElement("div");s.style.cssText=`
        padding: 5px 11px 10px 11px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      `;const x=document.createElement("div");x.style.cssText=`
        font-size: 10px;
        font-weight: 600;
        opacity: 0.8;
        text-transform: uppercase;
        margin-bottom: 4px;
      `,x.textContent="Interactions:",s.appendChild(x);const y=document.createElement("ul");y.style.cssText=`
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
      `,i.interactions.forEach(v=>{const C=document.createElement("li");C.textContent=v,y.appendChild(C)}),s.appendChild(y),o.appendChild(s)}V.appendChild(a),V.appendChild(o),S.appendChild(Q),S.appendChild(V)}const z=new ht({container:S,title:"Simulation Settings"}),K=new xt({trackGPU:i.trackGPU??!1,horizontal:!0});K.dom.style.display="none",document.body.appendChild(K.dom);const L={showStats:!1},k=z.addFolder("Fluid");k.close();const q={particleCount:ct(t)},G=()=>{q.particleCount=ct(t),$.updateDisplay()};k.add(t,"spawnDensity",10,300,1).name("Spawn Density").onFinishChange(()=>{G(),e.onReset()});const $=k.add(q,"particleCount").name("Particle Count").disable();k.add(t,"gravity",-30,30,1).name("Gravity"),k.add(t,"collisionDamping",0,1,.01).name("Collision Damping"),k.add(t,"smoothingRadius",.05,3,.01).name("Smoothing Radius").onChange(()=>e.onSmoothingRadiusChange()),k.add(t,"targetDensity",0,3e3,1).name("Target Density"),k.add(t,"pressureMultiplier",0,2e3,1).name("Pressure Multiplier"),k.add(t,"nearPressureMultiplier",0,40,.1).name("Near Pressure Multiplier"),k.add(t,"viscosityStrength",0,.2,.001).name("Viscosity Strength"),k.add(t,"particleRadius",1,5,.1).name("Particle Radius");const N=z.addFolder("Obstacle");N.close(),N.add(t.obstacleSize,"x",0,20,.01).name("Size X"),N.add(t.obstacleSize,"y",0,20,.01).name("Size Y"),N.add(t.obstacleCentre,"x",-10,10,.01).name("Center X"),N.add(t.obstacleCentre,"y",-10,10,.01).name("Center Y");const j=z.addFolder("Interaction");j.close(),j.add(t,"interactionRadius",0,10,.01).name("Radius"),j.add(t,"interactionStrength",0,200,1).name("Strength");const U=z.addFolder("Performance");return U.close(),U.add(t,"timeScale",0,2,.01).name("Time Scale"),U.add(t,"maxTimestepFPS",0,120,1).name("Max Timestep FPS"),U.add(t,"iterationsPerFrame",1,8,1).name("Iterations Per Frame"),U.add(L,"showStats").name("Show FPS").onChange(F=>{K.dom.style.display=F?"block":"none"}),{gui:z,stats:K,uiState:L}}export{zt as a,Tt as b,Rt as c,Dt as d,Ft as s};
