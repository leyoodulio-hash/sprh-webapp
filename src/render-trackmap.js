function drawTrackMap(r,outline,multi,lapIdx){
  const cv=$('trkMap');if(!cv)return;
  if(multi===undefined&&outline===undefined)outline=r.outline;
  const c=cv.getContext('2d'),W=cv.width,H=cv.height,pad=30;
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9,okCount=0;
  const acc=pts=>{if(!pts)return;pts.forEach(p=>{if(!isFinite(p[0])||!isFinite(p[1]))return;x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);okCount++;});};
  if(multi){multi.forEach(o=>acc(o.pts));}else{acc(outline);}
  if(okCount<2||(x1-x0)<1e-6||(y1-y0)<1e-6){cv.__tf=null;cv.__base=null;cv.__redraw=null;cv.__zoom=null;c.fillStyle='#8b949e';c.font='15px Segoe UI';c.textAlign='center';c.fillText('No usable track coordinates in this file (Car Coord X/Y missing or constant)',W/2,H/2);return;}
  const s=Math.min((W-2*pad)/(x1-x0),(H-2*pad)/(y1-y0));
  const ox=(W-(x1-x0)*s)/2,oy=(H-(y1-y0)*s)/2;
  let active=-1;
  function draw(){
    const Z=cv.__zoom||{k:1,ax:ox,ay:oy};cv.__zoom=Z;const S=s*Z.k;
    const X=wx=>Z.ax+(wx-x0)*S,Y=wy=>Z.ay+(y1-wy)*S; // world->screen incl. user zoom/pan
    cv.__base={ox,oy,s};cv.__redraw=draw;
    cv.__tf={ox:Z.ax,oy:Z.ay,s:S,x0,y1}; // effective transform so corner hit-tests track the zoom
    cv.__pedalData=null; // whole-session (multi) view has no per-point pedal data; single mode sets it below
    c.clearRect(0,0,W,H);c.lineJoin='round';c.lineCap='round';
    // Apex v-min points of the selected lap (glowing amber dots, single-lap view only)
    let apxB=null;if(!multi){const _a=apexPointsForLap(r,lapIdx);if(_a)apxB=_a;}
    // User-dropped track boundaries (left/right .csv) -> asphalt ribbon under the driver line.
    const bd=state.bounds;
    drawTrackRibbon(c,X,Y,bd?bd.left:null,bd?bd.right:null);
    if(multi){
      // whole session — one colored line per lap + legend
      multi.forEach((o,i)=>{
        c.strokeStyle=MAP_COLORS[i%MAP_COLORS.length];c.lineWidth=3;c.beginPath();let st=false;
        o.pts.forEach(p=>{if(!isFinite(p[0])||!isFinite(p[1]))return;const x=X(p[0]),y=Y(p[1]);st?c.lineTo(x,y):c.moveTo(x,y);st=true;});
        c.closePath();c.stroke();
      });
      let lx=pad,ly=24;
      multi.forEach((o,i)=>{
        if(lx>W-pad-70){lx=pad;ly+=18;}
        c.fillStyle=MAP_COLORS[i%MAP_COLORS.length];c.fillRect(lx,ly-5,12,4);
        c.fillStyle='#e6edf3';c.font='12px Segoe UI';c.textAlign='left';c.fillText(o.label,lx+17,ly);
        lx+=17+c.measureText(o.label).width+18;
      });
    }else{
      // track outline (car positioning for the selected lap) - pedal-colored racing line
      const pts=pedalLineForLap(r,lapIdx);
      if(pts){
        const col=(c1,c2,tm,a)=>'rgba('+Math.round(c1[0]+(c2[0]-c1[0])*tm)+','+Math.round(c1[1]+(c2[1]-c1[1])*tm)+','+Math.round(c1[2]+(c2[2]-c1[2])*tm)+','+(a).toFixed(3)+')';
        const DUAL=10; // % - both pedals at/above this => overlapping pedal-press cue
        for(let i=1;i<pts.length;i++){
          const p0=pts[i-1],p1=pts[i];if(!isFinite(p0.x)||!isFinite(p0.y)||!isFinite(p1.x)||!isFinite(p1.y))continue;
          const bbrake=(p0.brake+p1.brake)/2,cthr=(p0.throttle+p1.throttle)/2;const mx=Math.max(bbrake,cthr);
          let st;
          if(mx<2)st='rgba(139,148,158,0.28)';
          else if(bbrake>=DUAL&&cthr>=DUAL)st=col([255,224,64],[255,89,191],0,0.15+0.85*mx/100);
          else st=col([64,255,138],[255,59,59],bbrake/(bbrake+cthr),0.15+0.85*mx/100);
          c.strokeStyle=st;c.lineWidth=1.2+2.4*(mx/100);
          c.beginPath();c.moveTo(X(p0.x),Y(p0.y));c.lineTo(X(p1.x),Y(p1.y));c.stroke();
        }
        // Apex markers: glowing amber dot at each braking event's v-min point (selected lap only)
        const apx=apxB;
        if(apx){for(const p of apx){
          c.save();c.shadowColor='rgba(255,213,74,0.85)';c.shadowBlur=9;
          c.fillStyle='#ffd54a';c.beginPath();c.arc(X(p.x),Y(p.y),3.5,0,6.29);c.fill();c.restore();
          c.strokeStyle='#0d1117';c.lineWidth=1;c.beginPath();c.arc(X(p.x),Y(p.y),3.5,0,6.29);c.stroke();
        }}
        // hover-tooltip data for the selected lap (mirrors the cross-session pedal map readout)
        cv.__pedalData={pts,x0,y1,s,ox,oy,lapNum:(r&&r.laps&&lapIdx!=null)?r.laps[lapIdx].lap:0};
      }else{
        c.strokeStyle='#5a6b7d';c.lineWidth=4;c.beginPath();
        outline.forEach((p,i)=>{if(!isFinite(p[0])||!isFinite(p[1]))return;const x=X(p[0]),y=Y(p[1]);i?c.lineTo(x,y):c.moveTo(x,y);});
        c.closePath();c.stroke();
      }
    }
    const sp=(multi&&multi.length)?multi[0].pts[0]:outline[0];
    if(sp&&isFinite(sp[0])&&isFinite(sp[1])){c.fillStyle='#e6edf3';c.fillRect(X(sp[0])-4,Y(sp[1])-4,8,8);}
    r.cornerPts.forEach((p,i)=>{
      if(!isFinite(p[0])||!isFinite(p[1]))return;
      const on=active===i;
      const x=X(p[0]),y=Y(p[1]);
      c.beginPath();c.arc(x,y,on?8:5,0,6.29);
      c.fillStyle='#ff5c39';c.fill();
      if(on){c.strokeStyle='#fff';c.lineWidth=2;c.stroke();}
    });
    c.fillStyle='#8b949e';c.font='11px Segoe UI';c.textAlign='left';
    c.fillText('Pedal-colored racing line: bright = 100% application · amber dot = apex (v-min of the corner)',10,16);
    c.fillText('hover = lap % · brake / throttle / steer / speed · slip ° FL/FR/RL/RR',10,32);
    c.fillText('scroll = zoom · drag = pan · dblclick = reset',10,H-12);
  }
  function select(i){
    active=i;draw();
    document.querySelectorAll('#trkCorners .cbtn').forEach((b,j)=>b.classList.toggle('on',j===i));
    const tip=$('trkTip');
    if(i>=0&&r.bestZones[i]){
      const z=r.bestZones[i];
      tip.innerHTML='<b>'+esc(z.ref)+'</b> — entry '+z.entry.toFixed(1)+' km/h, decel '+z.decel.toFixed(2)+' G';
      tip.style.display='block';
    }else tip.style.display='none';
  }
  const box=$('trkCorners');
  if(box){
    box.innerHTML=''; // reset so lap-switch re-draws don't duplicate buttons
    r.bestZones.forEach((z,i)=>{
      const b=document.createElement('button');b.className='cbtn';b.textContent=z.ref;
      b.onclick=function(){select(i);};box.appendChild(b);
    });
  }
  // expose actions so the once-wired canvas listeners stay correct across lap switches (__tf is refreshed inside draw())
  cv.__select=select;cv.__reset=()=>{active=-1;draw();};
  if(!cv.__wired){
    cv.__wired=true;
    wireZoomPan(cv); // wheel-zoom / drag-pan / dblclick-reset (idempotent)
    cv.addEventListener('click',e=>{
      if(cv.__justPanned){cv.__justPanned=false;return;} // a drag-release is not a corner click
      const rect=cv.getBoundingClientRect(),tf=cv.__tf;if(!tf)return;
      const mx=(e.clientX-rect.left)*(W/rect.width),my=(e.clientY-rect.top)*(H/rect.height);
      let bi=-1,bd=20;
      r.cornerPts.forEach((p,i)=>{
        const dx=tf.ox+(p[0]-tf.x0)*tf.s-mx,dy=tf.oy+(tf.y1-p[1])*tf.s-my;
        if(Math.hypot(dx,dy)<bd){bd=Math.hypot(dx,dy);bi=i;}
      });
      if(bi>=0)cv.__select(bi);else cv.__reset();
    });
    cv.addEventListener('mousemove',e=>{
      if(cv.__panning)return; // panning owns the mouse — no corner tooltips mid-drag
      const rect=cv.getBoundingClientRect(),tf=cv.__tf;if(!tf)return;
      const mx=(e.clientX-rect.left)*(W/rect.width),my=(e.clientY-rect.top)*(H/rect.height);
      let bi=-1,bd=16;
      r.cornerPts.forEach((p,i)=>{
        const dx=tf.ox+(p[0]-tf.x0)*tf.s-mx,dy=tf.oy+(tf.y1-p[1])*tf.s-my;
        if(Math.hypot(dx,dy)<bd){bd=Math.hypot(dx,dy);bi=i;}
      });
      const tip=$('trkTip');
      if(bi>=0&&r.bestZones[bi]){
        const z=r.bestZones[bi];
        tip.innerHTML='<b>'+esc(z.ref)+'</b> — entry '+z.entry.toFixed(1)+' km/h, decel '+z.decel.toFixed(2)+' G';
        tip.style.display='block';tip.style.left=(e.pageX+14)+'px';tip.style.top=(e.pageY-12)+'px';
      }else tip.style.display='none';
    });
    // Pedal-point hover tooltip (single-lap view): same readout style as the cross-session pedal map —
    // lap position % + brake/throttle/steer/speed at the nearest driven point. Suppressed while
    // panning and when hovering a corner marker (the #trkTip handler owns that spot).
    if(!cv.__tipWired){
      cv.__tipWired=true;
      const tip=cv.__tipEl=document.createElement('div');
      tip.style.cssText='position:fixed;z-index:99;pointer-events:none;display:none;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:4px 8px;font:12px Segoe UI;color:#e6edf3;line-height:1.5';
      if(document&&document.body)document.body.appendChild(tip);
      cv.addEventListener('mousemove',e=>{
        const hide=()=>{tip.style.display='none';};
        if(cv.__panning){hide();return;}
        const D=cv.__pedalData;if(!D||!D.pts)return;
        const tf=cv.__tf;if(tf){ // corner marker under the cursor? let #trkTip own it
          const rect0=cv.getBoundingClientRect(),mx0=(e.clientX-rect0.left)*(W/rect0.width),my0=(e.clientY-rect0.top)*(H/rect0.height);
          for(const p of r.cornerPts||[]){if(!isFinite(p[0])||!isFinite(p[1]))continue;
            if(Math.hypot(tf.ox+(p[0]-tf.x0)*tf.s-mx0,tf.oy+(tf.y1-p[1])*tf.s-my0)<16){hide();return;}}
        }
        const rect=cv.getBoundingClientRect(),mx=(e.clientX-rect.left)*(W/rect.width),my=(e.clientY-rect.top)*(H/rect.height);
        const Z=cv.__zoom||{k:1,ax:D.ox,ay:D.oy},S=D.s*Z.k;
        const X=wx=>Z.ax+(wx-D.x0)*S,Y=wy=>Z.ay+(D.y1-wy)*S;
        let bi=-1,bd=Infinity;
        for(let i=0;i<D.pts.length;i++){const p=D.pts[i];if(!isFinite(p.x)||!isFinite(p.y))continue;const dx=X(p.x)-mx,dy=Y(p.y)-my,d=dx*dx+dy*dy;if(d<bd){bd=d;bi=i;}}
        if(bi<0||Math.sqrt(bd)>30){hide();return;}
        const p=D.pts[bi];
        const sl=isFinite(p.sfl)?'<br>Slip ° [FL/FR/RL/RR] '+p.sfl.toFixed(1)+' / '+p.sfr.toFixed(1)+' / '+p.srl.toFixed(1)+' / '+p.srr.toFixed(1):'';
        tip.innerHTML='Lap '+(D.lapNum!=null?D.lapNum:'')+' @ '+((bi/Math.max(1,D.pts.length-1)*100)).toFixed(0)+'%<br>Brake '+Math.round(p.brake)+'%<br>Throttle '+Math.round(p.throttle)+'%<br>Steer '+Math.round(p.steer)+'\u00b0<br>Speed '+p.speed.toFixed(1)+' km/h'+sl;
        tip.style.display='block';tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY+14)+'px';
      });
      cv.addEventListener('mouseleave',()=>{tip.style.display='none';});
    }
    cv.addEventListener('mouseleave',()=>{const tip=$('trkTip');tip.style.display='none';});
  }
  draw(); // initial render — mirrors compare_laps.py's trailing drawSpeed();drawMap() call
}

/* ---- lap comparison helper functions ---- */
function getTrackOutlineForLap(lapIdx){
  const r=state.report;
  const f=state.files[state.currentFileIdx];
  if(!f||f.format!=='ld')return null;
  const {meta,chans}=f.parsed;
  const CX=chans.get('Car Coord X');
  const CY=chans.get('Car Coord Y');
  if(!CX||!CY)return null;
  const freq=meta.freq_hz||20.0;
  const segs=getSegs(chans,freq);
  const keys=Object.keys(segs).map(Number).sort((a,b)=>a-b);
  const targetLap=r.laps[lapIdx].lap;
  const keyIdx=keys.indexOf(targetLap);
  if(keyIdx<0)return null;
  const [a,b]=segs[keys[keyIdx]];
  // all major braking events of the lap mapped onto track coords (same "real event" rule as brakingEvents) — hover a marker for peak Brake Pos % applied
  let brakes=[];
  if(chans.has('Brake Pos')){
    brakes=brakingEvents(chans,a,b,freq).map(ev=>({x:-CX.vals[a+ev.i],y:-CY.vals[a+ev.i],peakB:ev.peakB,entry:ev.entry,pos:ev.pos,dur:ev.dur}))
      .filter(p=>isFinite(p.x)&&isFinite(p.y));
  }
  const fb=brakes[0]||null; // events come back in sample order -> first = lap's first brake point
  return {outline:trackOutline(CX.vals,CY.vals,a,b),a:a,b:b,brakes:brakes,firstBrake:fb?[fb.x,fb.y]:null,firstBrakePct:fb?fb.pos:null,firstBrakeSpeed:fb?fb.entry:null};
}

/* ---- input overlay: speed / throttle / brake / steering stacked chart + technique markers ---- */
// Single-lap view of the four driver signals with measured technique flags. Thresholds are cited from
// compare_laps.py and setup_scan_prototype.py (documented in SKILLS.md, Skill 8):
//   drag  : brake still applied at turn-in > 5%          (compare_laps.py: btinA > 5)
//   coast : >= 0.4 s off throttle after release         (compare_laps.py dead-gap rule time branch |dc_t| >= 0.4)
//   chop  : throttle drop >= 30 pts within 0.5 s, speed >60 km/h, recovery to >=70% within 1 s (setup_scan_prototype.py THROTTLE_DROP=30)
//   wobble: steering reversals > 4 during a brake run of >= 0.5 s with |steer|>2 deg (setup_scan_prototype.py BRAKE_REV_MAX=4)
const OVL_PAD_L=46,OVL_PAD_R=12;
function getOverlayData(lapIdx){
  const r=state.report;
  const f=state.files[state.currentFileIdx];
  if(!r||!f||f.format!=='ld')return null;
  const {meta,chans}=f.parsed;
  const freq=meta.freq_hz||20.0;
  const segs=getSegs(chans,freq);
  const keys=Object.keys(segs).map(Number).sort((a,b)=>a-b);
  const keyIdx=keys.indexOf(r.laps[lapIdx].lap);
  if(keyIdx<0)return null;
  const [a,b]=segs[keys[keyIdx]];
  const n=b-a;
  const S=chans.get('Ground Speed')||chans.get('Speed');
  const T=chans.get('Throttle Pos'),B=chans.get('Brake Pos'),ST=chans.get('Steering Angle');
  if(!S)return null;
  // unwrapped lap position (same unwrap as speedSeries) — x-axis for series and markers
  let uw=null;
  const PN=chans.get('Car Pos Norm');
  if(PN){
    uw=new Float64Array(n);
    for(let i=0;i<n;i++)uw[i]=PN.vals[a+i];
    for(let i=1;i<n;i++){if(uw[i]-uw[i-1]<-0.5)for(let j=i;j<n;j++)uw[j]+=1;}
  }
  const xOf=i=>{ // absolute sample index -> unwrapped lap fraction in [0,1]
    if(!uw)return Math.min(1,Math.max(0,(i-a)/n));
    return Math.min(1,Math.max(0,uw[i-a]));
  };
  // downsampled series (N points across the lap)
  const N=480,step=Math.max(1,Math.floor(n/N));
  const pos=[],speed=[],thr=[],brk=[],steer=[];
  for(let i=a;i<b;i+=step){
    pos.push(xOf(i));
    speed.push(S.vals[i]);
    thr.push(T?T.vals[i]:0);
    brk.push(B?B.vals[i]:0);
    steer.push(ST?ST.vals[i]:0);
  }
  // technique markers from measured events (brakingEvents + throttle/steering scans)
  const markers=[];
  if(T&&B&&ST){
    for(const ev of brakingEvents(chans,a,b,freq)){
      const x=xOf(a+ev.i);
      markers.push({x,kind:'brake',lane:'brk',label:'Braking onset',
        detail:`entry ${ev.entry.toFixed(1)} km/h · peak decel ${ev.decel.toFixed(2)} G · ${ev.dur.toFixed(2)} s · attack ${(ev.onset||0).toFixed(0)} %/s`});
      if(ev.btin!=null&&ev.btin>5) // brake still applied at turn-in (compare_laps.py: btinA > 5)
        markers.push({x,kind:'drag',lane:'brk',label:'Brake at turn-in',detail:`${ev.btin.toFixed(0)}% brake still applied when steering begins`});
      if(ev.coast&&ev.coast[0]>=0.4) // coast gap >= 0.4 s (compare_laps.py dead-gap rule time branch)
        markers.push({x:Math.min(1,x+ev.coast[1]/2),kind:'coast',lane:'thr',label:'Coast after release',detail:`${ev.coast[0].toFixed(2)} s off throttle before reapplication`});
    }
    // steering wobble under braking — port of setup_scan_prototype.py rows 96-104 (brake runs >= 0.5 s, reversals > BRAKE_REV_MAX)
    let i=0;
    while(i<n){
      if(B.vals[a+i]>=15){
        let j=i;while(j<n&&B.vals[a+j]>=15)j++;
        if((j-i)/freq>=0.5){
          const signs=[];
          for(let t=i;t<j-1;t++){if(Math.abs(ST.vals[a+t+1])>2)signs.push(Math.sign(ST.vals[a+t+1]-ST.vals[a+t]));}
          let revs=0;for(let k=1;k<signs.length;k++)if(signs[k]!==signs[k-1])revs++;
          if(revs>4)markers.push({x:xOf(a+Math.floor((i+j)/2)),kind:'wobble',lane:'steer',label:'Steering wobble under braking',detail:`${revs} steering corrections during ${((j-i)/freq).toFixed(1)} s of braking`});
        }
        i=j;
      }else i++;
    }
    // throttle hesitation — port of setup_scan_prototype.py rows 86-94 (drop >=30 pts within 0.5 s, speed >60 km/h, recovery to >=70% within 1 s)
    const hes=new Uint8Array(n);
    for(let i2=0;i2+10<n;i2++){
      let fm=Infinity;for(let k=i2+1;k<=i2+10;k++)if(T.vals[a+k]<fm)fm=T.vals[a+k];
      if(fm<Infinity&&T.vals[a+i2]-fm>=30&&S.vals[a+i2]>60)hes[i2]=1;
    }
    i=0;
    while(i<n){
      if(hes[i]){
        let j=i;while(j<n&&hes[j])j++;
        const rec=j+20<=n&&T.vals.slice(a+j,Math.min(b,a+j+20)).some(v=>v>=70); // recovery to >=70% within 1 s (20 samples)
        if(rec){
          let md=0;for(let k=i;k<j;k++){let fm2=Infinity;for(let q=k+1;q<=Math.min(n-1,k+10);q++)if(T.vals[a+q]<fm2)fm2=T.vals[a+q];if(fm2<Infinity&&T.vals[a+k]-fm2>md)md=T.vals[a+k]-fm2;}
          markers.push({x:xOf(a+i),kind:'chop',lane:'thr',label:'Throttle hesitation',detail:`throttle dropped ${Math.round(md)} pts within 0.5 s at ${S.vals[a+i].toFixed(0)} km/h`});
        }
        i=j;
      }else i++;
    }
  }
  markers.sort((p,q)=>p.x-q.x);
  return {series:{pos,speed,thr,brk,steer},markers};
}

function drawOverlay(c,W,H,data){
  const sp=data.series,markers=data.markers;
  const padL=OVL_PAD_L,padR=OVL_PAD_R,padT=8,gap=10;
  const laneH={spd:96,thr:52,brk:52,steer:72};
  let y=padT;const lanes={};
  for(const k of ['spd','thr','brk','steer']){lanes[k]={y:y,h:laneH[k]};y+=laneH[k]+gap;}
  const plotW=W-padL-padR,X=x=>padL+x*plotW;
  let maxV=0;sp.speed.forEach(v=>{if(isFinite(v)&&v>maxV)maxV=v;});
  maxV=Math.ceil(maxV/20)*20||100;
  let maxSt=10;sp.steer.forEach(v=>{const a=Math.abs(v);if(a>maxSt)maxSt=a;});
  maxSt=Math.ceil(maxSt/10)*10;
  c.clearRect(0,0,W,H);c.font='11px Segoe UI';
  const laneDefs=[['spd','km/h','#7ee787'],['thr','throttle %','#5fd08a'],['brk','brake %','#ff5c39'],['steer','steering °','#4fc3f7']];
  for(const [k,lab,col] of laneDefs){
    const L=lanes[k];
    c.fillStyle='#10151c';c.fillRect(padL,L.y,plotW,L.h);
    c.strokeStyle='#21262d';c.strokeRect(padL+0.5,L.y+0.5,plotW-1,L.h-1);
    c.fillStyle=col;c.textAlign='right';c.fillText(lab,padL-6,L.y+L.h/2+4);
  }
  for(let p=0;p<=10;p++){const x=X(p/10);
    c.strokeStyle='#1b2129';c.beginPath();c.moveTo(x,lanes.spd.y);c.lineTo(x,y-gap);c.stroke();
    c.fillStyle='#8b949e';c.textAlign='center';c.fillText((p*10)+'%',x,H-8);}
  // speed line
  const Ys=v=>lanes.spd.y+laneH.spd-(v/maxV)*laneH.spd;
  c.strokeStyle='#7ee787';c.lineWidth=1.6;c.beginPath();let st=false;
  sp.pos.forEach((px,i)=>{if(!isFinite(px)||!isFinite(sp.speed[i]))return;const x=X(px),yy=Ys(sp.speed[i]);st?c.lineTo(x,yy):c.moveTo(x,yy);st=true;});
  c.stroke();
  // throttle / brake bars (0..100%)
  const bar=(vals,col,L)=>{for(let i=0;i<sp.pos.length;i++){const v=vals[i];if(!isFinite(v)||v<=0)continue;const h=Math.min(L.h,(v/100)*L.h);c.fillStyle=col;c.fillRect(X(sp.pos[i])-1,L.y+L.h-h,2,h);}};
  bar(sp.thr,'rgba(95,208,138,.75)',lanes.thr);
  bar(sp.brk,'rgba(255,92,57,.8)',lanes.brk);
  // steering line (zero-centered)
  const Yst=v=>lanes.steer.y+laneH.steer/2-(v/maxSt)*(laneH.steer/2);
  c.strokeStyle='#21262d';c.setLineDash([3,4]);c.beginPath();c.moveTo(padL,Yst(0));c.lineTo(W-padR,Yst(0));c.stroke();c.setLineDash([]);
  c.strokeStyle='#4fc3f7';c.lineWidth=1.4;c.beginPath();st=false;
  sp.pos.forEach((px,i)=>{if(!isFinite(px)||!isFinite(sp.steer[i]))return;const x=X(px),yy=Yst(sp.steer[i]);st?c.lineTo(x,yy):c.moveTo(x,yy);st=true;});
  c.stroke();
  // technique markers: dashed guide + icon on the relevant lane (nudged when two icons share a lane)
  const placed={};
  for(const m of markers){
    let ix=X(m.x);if(!isFinite(ix)||ix<padL-2||ix>W-padR+2)continue;
    if(placed[m.lane]!=null&&Math.abs(ix-placed[m.lane])<14)ix+=12;
    placed[m.lane]=ix;
    const L=lanes[m.lane],iy=L.y+9;
    c.strokeStyle='rgba(255,255,255,.18)';c.setLineDash([3,4]);c.beginPath();c.moveTo(ix,L.y);c.lineTo(ix,y-gap);c.stroke();c.setLineDash([]);
    if(m.kind==='brake'){ // red circle + "B" (same glyph as the track map's braking onset)
      c.beginPath();c.arc(ix,iy,7,0,6.29);c.fillStyle='#ff5c39';c.fill();
      c.strokeStyle='#fff';c.lineWidth=1.5;c.stroke();
      c.fillStyle='#fff';c.font='bold 10px Segoe UI';c.textAlign='center';c.textBaseline='middle';c.fillText('B',ix,iy+0.5);
    }else if(m.kind==='drag'){ // orange down-triangle: brake still applied at turn-in
      c.beginPath();c.moveTo(ix-6,iy-4);c.lineTo(ix+6,iy-4);c.lineTo(ix,iy+5);c.closePath();c.fillStyle='#ffb86c';c.fill();
    }else if(m.kind==='coast'){ // orange gap glyph: off throttle after release
      c.beginPath();c.moveTo(ix-9,iy);c.lineTo(ix-3,iy-4);c.lineTo(ix-3,iy+4);c.closePath();c.fillStyle='#ffb86c';c.fill();
      c.beginPath();c.moveTo(ix+9,iy);c.lineTo(ix+3,iy-4);c.lineTo(ix+3,iy+4);c.closePath();c.fill();
    }else if(m.kind==='chop'){ // amber down-chevron: throttle hesitation
      c.strokeStyle='#f2cc60';c.lineWidth=2;c.beginPath();c.moveTo(ix-5,iy-4);c.lineTo(ix,iy+4);c.lineTo(ix+5,iy-4);c.stroke();
    }else if(m.kind==='wobble'){ // amber zigzag: steering corrections under braking
      c.strokeStyle='#f2cc60';c.lineWidth=1.8;c.beginPath();c.moveTo(ix-9,iy+3);c.lineTo(ix-4,iy-3);c.lineTo(ix,iy+3);c.lineTo(ix+5,iy-3);c.lineTo(ix+9,iy+3);c.stroke();
    }
  }
  c.textBaseline='alphabetic';
}

// Separate single-signal line charts for the merged "Driver inputs & car positioning" section
// (2026-10-24): each canvas draws ONE signal of getOverlayData at full chart size, same axis style
// as drawComparisonCharts; technique markers are placed on their own lane's chart (m.lane).
const OVL_CHART_IDS={spd:'ovlSpdChart',thr:'ovlThrChart',brk:'ovlBrkChart',steer:'ovlStwChart'};
// getOverlayData series field names differ from the chart keys (speed, not spd).
const OVL_SKEY={spd:'speed',thr:'thr',brk:'brk',steer:'steer'};
function drawSignalChart(cv,key,data){
  cv=cv||$(OVL_CHART_IDS[key]);if(!cv)return;
  const c=cv.getContext('2d'),W=cv.width,H=cv.height;
  const sp=data.series,pos=sp.pos,vals=sp[OVL_SKEY[key]];
  if(!vals)return;
  const padL=46,padR=10,padT=14,padB=30,plotH=H-padT-padB;
  let lo,hi;
  if(key==='spd'){
    lo=0;let m=0;vals.forEach(v=>{if(isFinite(v)&&v>m)m=v;});hi=(Math.ceil(m/50)*50)||100;
  }else if(key==='steer'){
    let mn=0,mx=0;vals.forEach(v=>{if(isFinite(v)){if(v>mx)mx=v;if(v<mn)mn=v;}});
    lo=Math.floor(mn/50)*50;hi=(Math.ceil(mx/50)*50)||100;
  }else{lo=0;hi=100;} // thr / brk are percentages
  if(hi<=lo)hi=lo+50;
  const yOf=v=>H-padB-((v-lo)/(hi-lo))*plotH;
  c.clearRect(0,0,W,H);c.font='11px Segoe UI';
  const step=(key==='thr'||key==='brk')?25:50;
  for(let v=lo;v<=hi;v+=step){const y=yOf(v);c.strokeStyle='#21262d';c.beginPath();c.moveTo(padL,y);c.lineTo(W-padR,y);c.stroke();c.fillStyle='#8b949e';c.fillText(String(v),10,y+4);}
  for(let p=0;p<=10;p+=2){const x=padL+(p/10)*(W-padL-padR);c.strokeStyle='#21262d';c.beginPath();c.moveTo(x,padT);c.lineTo(x,H-padB);c.stroke();c.fillStyle='#8b949e';c.fillText((p*10)+'%',x-10,H-padB+18);}
  if(key==='steer'){ // dashed zero line (same as the old combined overlay)
    c.strokeStyle='#21262d';c.setLineDash([3,4]);c.beginPath();c.moveTo(padL,yOf(0));c.lineTo(W-padR,yOf(0));c.stroke();c.setLineDash([]);
  }
  const col={spd:'#7ee787',thr:'#5fd08a',brk:'#ff5c39',steer:'#4fc3f7'}[key];
  c.strokeStyle=col;c.lineWidth=1.8;c.beginPath();let started=false;
  for(let i=0;i<pos.length;i++){const px=pos[i],v=vals[i];if(!isFinite(px)||!isFinite(v))continue;const x=padL+px*(W-padL-padR),y=yOf(v);started?c.lineTo(x,y):c.moveTo(x,y);started=true;}
  c.stroke();
  // technique markers for this lane: dashed guide + icon (same glyphs as the old combined overlay)
  const placed={};
  for(const m of data.markers){
    if(m.lane!==key)continue;
    let ix=padL+m.x*(W-padL-padR);if(!isFinite(ix)||ix<padL-2||ix>W-padR+2)continue;
    if(placed[key]!=null&&Math.abs(ix-placed[key])<14)ix+=12;
    placed[key]=ix;
    const iy=padT+9;
    c.strokeStyle='rgba(255,255,255,.18)';c.setLineDash([3,4]);c.beginPath();c.moveTo(ix,padT);c.lineTo(ix,H-padB);c.stroke();c.setLineDash([]);
    if(m.kind==='brake'){ // red circle + "B" (same glyph as the track map's braking onset)
      c.beginPath();c.arc(ix,iy,7,0,6.29);c.fillStyle='#ff5c39';c.fill();
      c.strokeStyle='#fff';c.lineWidth=1.5;c.stroke();
      c.fillStyle='#fff';c.font='bold 10px Segoe UI';c.textAlign='center';c.textBaseline='middle';c.fillText('B',ix,iy+0.5);
    }else if(m.kind==='drag'){ // orange down-triangle: brake still applied at turn-in
      c.beginPath();c.moveTo(ix-6,iy-4);c.lineTo(ix+6,iy-4);c.lineTo(ix,iy+5);c.closePath();c.fillStyle='#ffb86c';c.fill();
    }else if(m.kind==='coast'){ // orange gap glyph: off throttle after release
      c.beginPath();c.moveTo(ix-9,iy);c.lineTo(ix-3,iy-4);c.lineTo(ix-3,iy+4);c.closePath();c.fillStyle='#ffb86c';c.fill();
      c.beginPath();c.moveTo(ix+9,iy);c.lineTo(ix+3,iy-4);c.lineTo(ix+3,iy+4);c.closePath();c.fill();
    }else if(m.kind==='chop'){ // amber down-chevron: throttle hesitation
      c.strokeStyle='#f2cc60';c.lineWidth=2;c.beginPath();c.moveTo(ix-5,iy-4);c.lineTo(ix,iy+4);c.lineTo(ix+5,iy-4);c.stroke();
    }else if(m.kind==='wobble'){ // amber zigzag: steering corrections under braking
      c.strokeStyle='#f2cc60';c.lineWidth=1.8;c.beginPath();c.moveTo(ix-9,iy+3);c.lineTo(ix-4,iy-3);c.lineTo(ix,iy+3);c.lineTo(ix+5,iy-3);c.lineTo(ix+9,iy+3);c.stroke();
    }
  }
  c.textBaseline='alphabetic';c.font='11px Segoe UI';
}

// Renders the four separate signal charts for one lap (merged section, 2026-10-24).
function renderSingleCharts(lapIdx){
  const data=getOverlayData(lapIdx);
  if(!data)return;
  for(const k of ['spd','thr','brk','steer']){
    const cv=$(OVL_CHART_IDS[k]);if(!cv)continue;
    drawSignalChart(cv,k,data);
    cv.__data=data; // hover readout uses the same series
  }
}

// Per-canvas hover: signal value at cursor + nearest technique flag for that lane.
function wireSingleChartsHover(){
  const tip=$('ovlTip');if(!tip)return;
  for(const k of ['spd','thr','brk','steer']){
    const cv=$(OVL_CHART_IDS[k]);if(!cv||cv.__wired)continue;cv.__wired=true;
    cv.addEventListener('mousemove',e=>{
      const data=cv.__data;if(!data)return;
      const rect=cv.getBoundingClientRect();
      const mx=(e.clientX-rect.left)*(cv.width/rect.width);
      const padL=46,padR=10;
      const fx=Math.min(1,Math.max(0,(mx-padL)/(cv.width-padL-padR)));
      const sp=data.series,pos=sp.pos,vals=sp[OVL_SKEY[k]];let bi=0,bd=Infinity;
      for(let i=0;i<pos.length;i++){const d=Math.abs(pos[i]-fx);if(d<bd){bd=d;bi=i;}}
      const lab={spd:'speed',thr:'throttle',brk:'brake',steer:'steering'}[k];
      let html=`${(fx*100).toFixed(0)}% — ${lab} ${isFinite(vals[bi])?vals[bi].toFixed(k==='steer'?1:0):'-'}${k==='spd'?' km/h':(k==='steer'?'°':' %')}`;
      let best=null,bd2=14; // nearest marker in screen px
      for(const m of data.markers){if(m.lane!==k)continue;const d=Math.abs(padL+m.x*(cv.width-padL-padR)-mx);if(d<bd2){bd2=d;best=m;}}
      if(best)html='<b>'+escHtml(best.label)+'</b> — '+escHtml(best.detail)+'<br>'+html;
      tip.innerHTML=html;tip.style.display='block';tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY-12)+'px';
    });
    cv.addEventListener('mouseleave',()=>{if(tip)tip.style.display='none';});
  }
}

// Static PNG of the overlay for a lap number (used by [overlay:<lap>] chat tags).
function overlayDataUrl(lapNum){
  const r=state.report;if(!r)return null;
  let idx=r.laps.findIndex(l=>l.lap===lapNum);if(idx<0)idx=r.bestIdx;
  const data=getOverlayData(idx);if(!data)return null;
  const cv=document.createElement('canvas');cv.width=680;cv.height=320;
  drawOverlay(cv.getContext('2d'),680,320,data);
  return cv.toDataURL('image/png');
}

/* ---- comparison chart rendering ---- */
