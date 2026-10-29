/* ================= Cross-session lap comparison — faithful port of compare_laps.py ================= */
function ordinal(n){const s=(n%100>=10&&n%100<14)?'th':({1:'st',2:'nd',3:'rd'}[n%10]||'th');return n+s;}

// Port of compare_laps.match: greedy nearest-neighbor pairing with wrap-around distance.
function matchZones(cA,cB,tol=0.02){
  const pairs=[],used=new Set();
  for(const a of cA){
    let bestJ=null,bestD=tol;
    for(let j=0;j<cB.length;j++){
      if(used.has(j))continue;
      let d=Math.abs(a.pos-cB[j].pos);d=Math.min(d,1.0-d); // wrap-around distance
      if(d<bestD){bestJ=j;bestD=d;}
    }
    if(bestJ!==null){used.add(bestJ);pairs.push([a,cB[bestJ]]);}
  }
  const ua=cA.filter(a=>!pairs.some(p=>p[0]===a));
  const ub=cB.filter(b=>!pairs.some(p=>p[1]===b));
  return {pairs,ua,ub};
}

// Port of compare_laps.build_rows: one row per matched zone with deltas and a 'key' flag.
function buildRows(pairs,lapLen,zones,rankA,track){
  rankA=rankA||new Map();
  const zoneTotal={};
  for(const [a] of pairs){const z=zoneNameOf(a.pos,zones,track);if(z!==null)zoneTotal[z]=(zoneTotal[z]||0)+1;}
  const rows=[],seen={};
  pairs.forEach(([a,b],i)=>{
    let label;
    const name=zoneNameOf(a.pos,zones,track);
    if(name!==null){
      seen[name]=(seen[name]||0)+1;
      label=zoneTotal[name]>1?`${name} - ${ordinal(seen[name])}`:name;
    } else label=`Zone ${rankA.has(a)?rankA.get(a):i+1}`;
    const dpos=(a.pos-b.pos)*lapLen;
    let coastA=a.coast,coastB=b.coast;
    if(coastA)coastA=[coastA[0],coastA[1]*lapLen]; // (s, m)
    if(coastB)coastB=[coastB[0],coastB[1]*lapLen];
    const key=(Math.abs(dpos)>8||Math.abs(a.entry-b.entry)>=3||Math.abs(a.decel-b.decel)>=0.15
      ||Math.abs(a.dur-b.dur)>=0.15||(a.thrOn&&b.thrOn&&Math.abs(a.thrOn[0]-b.thrOn[0])>=5)
      ||(coastA&&coastB&&Math.abs(coastA[0]-coastB[0])>=0.25));
    rows.push({label,pos:a.pos,dpos,tag:dpos<-8?'EARLY':(dpos>8?'LATE':'on pt'),
      entryA:a.entry,entryB:b.entry,dEntry:a.entry-b.entry,
      decelA:a.decel,decelB:b.decel,dDecel:a.decel-b.decel,
      durA:a.dur,durB:b.dur,dDur:a.dur-b.dur,
      thrA:a.thrOn,thrB:b.thrOn,key,onA:a.onset,onB:b.onset,btinA:a.btin,btinB:b.btin,coastA,coastB,
      vminA:a.vmin,vminB:b.vmin,slipA:a.slip,slipB:b.slip}); // v-min km/h + peak |slip| FL/FR/RL/RR deg (null when channels absent)
  });
  return rows;
}

// Port of compare_laps.decompose_zone: multi-cause decomposition (delta = A - B).
function decomposeZone(r){
  const causes=[];
  const dpos=r.dpos,dEntry=r.dEntry;
  if(dpos>8&&dEntry<=-3)causes.push({name:"Late point that didn't carry",valueA:null,valueB:null,delta:dpos,unit:'m',time_attr_s:null,action:'take an earlier, more progressive application'});
  else if(dpos<-8&&dEntry>=3)causes.push({name:'Early point over-braking',valueA:null,valueB:null,delta:dpos,unit:'m',time_attr_s:null,action:'push the point later and carry more speed in'});
  const coastA=r.coastA,coastB=r.coastB;
  if(coastA&&coastB){
    const dc_t=coastA[0]-coastB[0],dc_m=coastA[1]-coastB[1];
    if(Math.abs(dc_t)>=0.4||Math.abs(dc_m)>=20)causes.push({name:'Coasting dead gap',valueA:coastA[0],valueB:coastB[0],delta:dc_t,unit:'s',time_attr_s:dc_t,action:'eliminate the dead gap to carry momentum'});
  }
  const btinA=r.btinA,btinB=r.btinB;
  if(btinA!=null&&btinB!=null){
    const dbt=btinA-btinB;
    if(dbt>=8&&btinA>5)causes.push({name:'Brake drag at turn-in',valueA:btinA,valueB:btinB,delta:dbt,unit:'%',time_attr_s:null,action:'bleed the pedal off earlier to free the front'});
    else if(-dbt>=8&&btinB>5)causes.push({name:'Earlier brake-off at turn-in',valueA:btinA,valueB:btinB,delta:dbt,unit:'%',time_attr_s:null,action:'keep this - the freed front is carrying speed'});
  }
  const ddur=r.dDur;
  if(Math.abs(ddur)>=0.15&&Math.abs(dpos)<=8)causes.push({name:ddur>0?'Soft trail-brake release':'Firmer trail-brake release',valueA:r.durA,valueB:r.durB,delta:ddur,unit:'s',time_attr_s:ddur,action:ddur>0?'trail off more deliberately into turn-in':'keep the firmer release - it is paying off'});
  const donset=r.onA-r.onB;
  if(Math.abs(donset)>=30)causes.push({name:donset<0?'Weak initial attack':'Harder initial attack',valueA:r.onA,valueB:r.onB,delta:donset,unit:'%/s',time_attr_s:null,action:donset<0?'stomp the first hit to plant the front':'keep this - the planted front is paying off'});
  const thrA=r.thrA,thrB=r.thrB;
  if(thrA&&thrB){
    const stA=Math.abs(thrA[2]),stB=Math.abs(thrB[2]),dst=stA-stB;
    if(Math.abs(dst)>=10)causes.push({name:dst>0?'Wheel still off at full throttle':'Earlier wheel unwind at throttle-on',valueA:stA,valueB:stB,delta:dst,unit:'deg',time_attr_s:null,action:dst>0?'unwind the wheel earlier on entry':'keep this - straighter exit is paying off'});
  }
  let time_estimated_s=0.0;
  if(thrA&&thrB){
    const dv=thrA[0]-thrB[0];
    if(Math.abs(dv)>=5){
      const vA=thrA[0]/3.6,vB=thrB[0]/3.6;
      time_estimated_s=(vA>0&&vB>0)?200.0*(1.0/vA-1.0/vB):0.0;
      causes.push({name:'Exit speed at throttle-on',valueA:thrA[0],valueB:thrB[0],delta:dv,unit:'km/h',time_attr_s:time_estimated_s,action:dv<0?'carry more speed through the corner':'watch for over-braking or understeer on entry'});
    }
  }
  const coastA_s=coastA?coastA[0]:0.0,coastB_s=coastB?coastB[0]:0.0;
  const time_measured_s=r.dDur+(coastA_s-coastB_s);
  return {causes,time_measured_s,time_estimated_s,time_total_s:time_measured_s+time_estimated_s};
}

// Port of compare_laps.rank_leaks.
function rankLeaks(rows){
  const leaks=[];
  for(const r of rows){
    const d=decomposeZone(r);
    if(Math.abs(d.time_total_s)>=0.15)leaks.push({corner_label:r.label,pos_frac:Math.round(r.pos*1e4)/1e4,
      time_measured_s:+d.time_measured_s.toFixed(3),time_estimated_s:+d.time_estimated_s.toFixed(3),time_total_s:+d.time_total_s.toFixed(3),
      causes:d.causes.map(c=>({name:c.name,delta:+c.delta.toFixed(2),unit:c.unit}))});
  }
  leaks.sort((x,y)=>Math.abs(y.time_total_s)-Math.abs(x.time_total_s));
  return leaks;
}

function signed0(v){return (v<0?'-':'+')+Math.abs(v).toFixed(0);}
function signed1(v){return (v<0?'-':'+')+Math.abs(v).toFixed(1);}
function signed2(v){return (v<0?'-':'+')+Math.abs(v).toFixed(2);}

// Port of compare_laps.make_tip.
function makeTip(r){
  const d=decomposeZone(r);
  const causes=d.causes;
  const dt_zone=r.dDur+((r.coastA?r.coastA[0]:0)-(r.coastB?r.coastB[0]:0));
  const head=(dz)=>{if(dz>=0.15)return `Lost ${signed2(dz)}s: `;if(dz<=-0.15)return `Gained ${Math.abs(dz).toFixed(2)}s: `;return 'Mechanics note: ';};
  if(!causes.length){
    const bits=[];
    const dpos=r.dpos,de=r.dEntry;
    if(Math.abs(dpos)>8){
      if(dpos>0&&de<=-3)bits.push(`braked ${Math.abs(dpos).toFixed(0)} m later but entered ${Math.abs(de).toFixed(1)} km/h slower — the late point didn't carry; try an earlier, more progressive application`);
      else if(dpos>0)bits.push(`braked ${dpos.toFixed(0)} m later and held entry speed (${signed1(de)} km/h) — keep pushing this point if the exit stays clean`);
      else if(de>=3)bits.push(`braked ${Math.abs(dpos).toFixed(0)} m earlier yet entered ${de.toFixed(1)} km/h faster — there is room to push the point later`);
      else bits.push(`brake point moved ${Math.abs(dpos).toFixed(0)} m with similar entry speed`);
    }
    if(Math.abs(r.dDecel)>=0.15)bits.push(`peak decel ${r.decelA.toFixed(2)} vs ${r.decelB.toFixed(2)} G — a ${(r.dDecel>0?'harder':'softer')} application`);
    if(Math.abs(r.dDur)>=0.15)bits.push(`braking phase ran ${Math.abs(r.dDur).toFixed(2)} s ${(r.dDur>0?'longer':'shorter')}`);
    if(r.thrA&&r.thrB){const dv=r.thrA[0]-r.thrB[0];if(Math.abs(dv)>=5)bits.push(`throttle-on at ${r.thrA[0].toFixed(1)} vs ${r.thrB[0].toFixed(1)} km/h — ${(dv>0?'more':'less')} exit speed`);}
    if(!bits.length)return 'Consistent with lap B within thresholds — no action needed here.';
    return head(dt_zone)+bits.join('; ')+'.';
  }
  const fmt={m:v=>`${signed0(v)} m`,s:v=>`${signed2(v)} s`,'%':v=>`${signed1(v)} %`,'%/s':v=>`${signed0(v)} %/s`,deg:v=>`${signed0(v)} deg`,'km/h':v=>`${signed1(v)} km/h`};
  const parts=causes.map(c=>{let p=`${c.name}: ${fmt[c.unit](c.delta)}`;if(c.time_attr_s!=null&&Math.abs(c.time_attr_s)>=0.05)p+=` (${signed2(c.time_attr_s)} s)`;return p+' — '+c.action;});
  const tailBits=[`measured ${signed2(d.time_measured_s)} s`];
  if(Math.abs(d.time_estimated_s)>=0.05)tailBits.push(`estimated exit cost ${signed2(d.time_estimated_s)} s`);
  return head(dt_zone)+parts.join('; ')+'.'+'  ['+tailBits.join(', ')+`, total ${signed2(d.time_total_s)} s]`;
}

// Port of compare_laps.make_summary.
function makeSummary(lapA,lapB,tA,tB,fuelA,fuelB,rows){
  const dt=tA-tB;const faster=dt<0?lapA:lapB;
  const pts=[`Lap ${faster} was ${Math.abs(dt).toFixed(2)}s faster overall`];
  const dfuel=Math.abs(fuelA-fuelB);
  if(dfuel>=1.0){const more=fuelA>fuelB?lapA:lapB;pts.push(`Fuel load differs by ${dfuel.toFixed(1)} l (lap ${more} carried the extra) — part of the gap is weight, not driving`);}
  const keys=rows.filter(r=>r.key);
  if(keys.length){const top=[...keys].sort((x,y)=>(Math.abs(y.dpos)+2*Math.abs(y.dEntry)+10*Math.abs(y.dDecel))-(Math.abs(x.dpos)+2*Math.abs(x.dEntry)+10*Math.abs(x.dDecel))).slice(0,2);pts.push('Biggest differences: '+top.map(t=>t.label).join(' and '));}
  return pts;
}

// Port of compare_laps.smooth.
// Preset-aware Skill-1 smoothness: precomputed for embedded reference laps, raw computation otherwise.
function smoothOf(cc){return cc.preset?cc.pkgLap.smooth:smoothLap(cc.chans,cc.a,cc.b,cc.freq);}
function smoothLap(chans,a,b,freq){
  const T=chans.get('Throttle Pos').vals,B=chans.get('Brake Pos').vals,ST=chans.get('Steering Angle').vals;
  const dt=1/freq,n=b-a;
  let tjSq=0,tjN=0,brMax=0,srSq=0;const big=[];let prevTr=null;
  for(let i=a;i<b-1;i++){
    const tr=(T[i+1]-T[i])/dt,br=(B[i+1]-B[i])/dt,sr=(ST[i+1]-ST[i])/dt;
    if(prevTr!==null){const tj=(tr-prevTr)/dt;tjSq+=tj*tj;tjN++;}
    prevTr=tr;
    const ab=Math.abs(br);if(ab>brMax)brMax=ab;
    srSq+=sr*sr;if(Math.abs(sr)>5.0)big.push(sr);
  }
  let corr=0;if(big.length>2)for(let i=1;i<big.length;i++)if(Math.sign(big[i])!==Math.sign(big[i-1]))corr++;
  return {thr_jerk:Math.sqrt(tjSq/tjN),brk_rate_max:brMax,stw_rms:Math.sqrt(srSq/(n-1)),corr};
}

// np.interp on an increasing xp (clamps at both ends).
function interp(x,xp,fp){
  const out=new Float64Array(x.length);
  for(let i=0;i<x.length;i++){
    const v=x[i];
    if(v<=xp[0])out[i]=fp[0];
    else if(v>=xp[xp.length-1])out[i]=fp[fp.length-1];
    else{let lo=0,hi=xp.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(xp[mid]<=v)lo=mid;else hi=mid;}const t=(v-xp[lo])/(xp[hi]-xp[lo]);out[i]=fp[lo]*(1-t)+fp[hi]*t;}
  }
  return out;
}

// Port of compare_laps.line_offset (mean/max line deviation between two laps).
// One lap's racing line on the shared 401-point position grid — extracted from lineOffset (identical behavior).
function lineGridRaw(ch,a,b){
  const grid=[];for(let i=0;i<=400;i++)grid.push(i/400);
  let P=Array.from(ch.get('Car Pos Norm').vals.subarray(a,b));
  const X=ch.get('Car Coord X').vals,Y=ch.get('Car Coord Y').vals;
  for(let w=0;w<P.length-1;w++)if(P[w+1]-P[w]<-0.5)for(let k=w+1;k<P.length;k++)P[k]+=1.0; // unwrap 1.0 -> 0 wrap
  let m=-Infinity;for(let k=0;k<P.length;k++){m=Math.max(m,P[k]);P[k]=m;} // absorb tiny backward noise (np.maximum.accumulate)
  return[interp(grid,P,X.subarray(a,b)),interp(grid,P,Y.subarray(a,b))];
}
// 401-point track outline for any loaded lap — same shared pos grid as speedTraceFor (identical
// unwrap + running-max logic via lineGridRaw), so segment i of the outline aligns with point i of
// the speed trace. Negated map frame matches trackOutline/drawPedalLines. Preset-aware: embedded
// reference laps use their precomputed 401-pt line_grid (same coord space as lineGridRaw — see
// lineOffsetOf). Null only for missing/short coordinate data.
function outlineFor(fileIdx,lapIdx){
  const c=cornersFor(fileIdx,lapIdx);
  if(!c)return null;
  try{
    let X,Y;
    if(c.preset){const f=c.pkgLap.line_grid,N=f.length/2;X=f.slice(0,N);Y=f.slice(N);} // precomputed flat [x*401, y*401]
    else [X,Y]=lineGridRaw(c.chans,c.a,c.b);
    return Array.from(X).map((x,i)=>[+(-x).toFixed(2),+(-Y[i]).toFixed(2)]);
  }catch(e){return null;}
}
function lineOffsetStats(gA,gB){ // gA/gB = [x[],y[]] on the shared 401 grid; A=challenge, B=reference (offsets are absolute)
  const N=gA[0].length;let sum=0,maxV=-Infinity,maxI=0;
  for(let i=0;i<N;i++){const d=Math.hypot(gA[0][i]-gB[0][i],gA[1][i]-gB[1][i]);sum+=d;if(d>maxV){maxV=d;maxI=i;}}
  return{meanAbs:sum/N,max:maxV,maxPos:maxI/(N-1)};
}
function lineOffset(chA,a1,b1,chB,a2,b2){
  const lines=[lineGridRaw(chA,a1,b1),lineGridRaw(chB,a2,b2)];
  return lineOffsetStats(lines[0],lines[1]);
}
// Preset-aware racing-line offset: precomputed line_grid for embedded reference laps, raw grid otherwise (mixed OK).
function lineOffsetOf(cR,cC){ // cR = reference corner ctx, cC = challenge (offset is absolute, order only fixes A/B naming)
  const flat=f=>{const N=f.length/2;return[f.slice(0,N),f.slice(N)];};
  const gA=cC.preset?flat(cC.pkgLap.line_grid):lineGridRaw(cC.chans,cC.a,cC.b);
  const gB=cR.preset?flat(cR.pkgLap.line_grid):lineGridRaw(cR.chans,cR.a,cR.b);
  return lineOffsetStats(gA,gB);
}
// Clustered braking corners + sample range for one lap selection in a loaded file.
function cornersFor(fileIdx,lapIdx){
  const f=state.files[fileIdx];if(!f||f.format!=='ld')return null;
  const s=ldSession(fileIdx);if(!s)return null;
  if(s.preset){const lp=s.report.laps[lapIdx];if(!lp)return null; // embedded reference lap — precomputed corners
    return{preset:true,pkgLap:lp,corners:lp.corners,freq:f.parsed.meta.freq_hz};}
  const {meta,chans}=f.parsed;const freq=meta.freq_hz||20.0;
  const segs=getSegs(chans,freq);const keys=Object.keys(segs).map(Number).sort((a,b)=>a-b);
  const lap=s.report.laps[lapIdx];if(!lap)return null;
  const ki=keys.indexOf(lap.lap);if(ki<0)return null;
  const [a,b]=segs[keys[ki]];
  return {chans,a,b,freq,corners:cluster(brakingEvents(chans,a,b,freq))};
}
// Total path length of a lap in metres (from Car Coord X/Y) — mirrors compare_laps.main's lap_len.
function lapLengthM(fileIdx,lapIdx){
  const c=cornersFor(fileIdx,lapIdx);if(!c)return null;
  if(c.preset){const g=c.pkgLap.line_grid,N=g.length/2;let L=0;for(let i=1;i<N;i++)L+=Math.hypot(g[i]-g[i-1],g[N+i]-g[N+i-1]);return L;} // embedded reference lap — flat [x×401, y×401] grid
  const X=c.chans.get('Car Coord X').vals.subarray(c.a,c.b),Y=c.chans.get('Car Coord Y').vals.subarray(c.a,c.b);
  let L=0;for(let i=1;i<X.length;i++)L+=Math.hypot(X[i]-X[i-1],Y[i]-Y[i-1]);return L;
}
// Rank corners by position (1-based) for 'Zone N' labels — mirrors compare_laps.main's rankA/rankB.
function rankCorners(corners){const m=new Map();corners.slice().sort((x,y)=>x.pos-y.pos).forEach((c,i)=>m.set(c,i+1));return m;}
// Wheel-zoom / drag-pan / dblclick-reset for a canvas that exposes __base/__zoom/__redraw
// (contract set by the drawing function). Lives in core so both trkMap and cmpPedalLineMap can use it.
function wireZoomPan(cv){
  if(cv.__zoomWired)return;cv.__zoomWired=true;
  const pos=e=>{const rect=cv.getBoundingClientRect();return{x:(e.clientX-rect.left)*(cv.width/rect.width),y:(e.clientY-rect.top)*(cv.height/rect.height)};};
  cv.addEventListener('wheel',e=>{
    e.preventDefault();
    if(!cv.__base)return;
    const m=pos(e);const Z=cv.__zoom||{k:1,ax:cv.__base.ox,ay:cv.__base.oy};
    let f=Math.exp(-e.deltaY*0.0015);const k2=Math.min(30,Math.max(0.4,Z.k*f));f=k2/Z.k;
    cv.__zoom={k:k2,ax:m.x-(m.x-Z.ax)*f,ay:m.y-(m.y-Z.ay)*f}; // zoom centered on the cursor
    if(cv.__redraw)cv.__redraw();
  },{passive:false});
  let pan=null;
  const endPan=()=>{if(!pan)return;pan=null;cv.__panning=false;if(cv.style)cv.style.cursor='pointer';};
  cv.addEventListener('mousedown',e=>{
    if(e.button!==0||!cv.__base)return;
    pan={x:e.clientX,y:e.clientY,moved:false};cv.__panning=true;if(cv.style)cv.style.cursor='grabbing';
  });
  cv.addEventListener('mousemove',e=>{
    if(!pan)return;
    const rect=cv.getBoundingClientRect();
    const dx=(e.clientX-pan.x)*(cv.width/rect.width),dy=(e.clientY-pan.y)*(cv.height/rect.height);
    if(Math.abs(dx)+Math.abs(dy)>4)pan.moved=true; // small jitter must not count as a pan (keeps corner clicks working)
    if(pan.moved&&cv.__zoom){cv.__zoom.ax+=dx;cv.__zoom.ay+=dy;if(cv.__redraw)cv.__redraw();}
    pan.x=e.clientX;pan.y=e.clientY;
  });
  cv.addEventListener('mouseup',e=>{if(pan&&pan.moved)cv.__justPanned=true;endPan();});
  if(typeof window!=='undefined'&&window.addEventListener)window.addEventListener('mouseup',e=>{if(pan&&pan.moved)cv.__justPanned=true;endPan();});
  cv.addEventListener('dblclick',e=>{
    e.preventDefault();
    if(!cv.__base)return;
    cv.__zoom={k:1,ax:cv.__base.ox,ay:cv.__base.oy}; // reset to the identity fit of the current view
    if(cv.__redraw)cv.__redraw();
  });
}
// Pedal-colored racing line on the cross-session map (negated into the map frame, same as the single-session track map): each lap's line is stroked per segment with a
// color blended toward the dominant pedal at that point — A: green (100% throttle) → red
// (100% brake); B: blue (throttle) → purple (brake). Alpha + width scale with max input so
// coasting sections fade out (same aesthetic as drawPedalChart's brake fade). Pedals are read
// directly at each decimated sample index — no interpolation. Zoomable via wireZoomPan.
function drawPedalLines(cRef,cChal){
  const cv=$('cmpPedalLineMap');if(!cv||!cRef||!cChal)return;
  const px=cc=>{
    if(cc.preset){const pts=cc.pkgLap.map_pts.slice();pts.__tot=cc.pkgLap.map_tot_s;return pts;} // precomputed pedal-colored points
    const CX=cc.chans.get('Car Coord X'),CY=cc.chans.get('Car Coord Y');if(!CX||!CY)return[];
    const Bk=cc.chans.get('Brake Pos'),Th=cc.chans.get('Throttle Pos'),ST=cc.chans.get('Steering Angle'),SP=cc.chans.get('Ground Speed')||cc.chans.get('Speed');
    if(!Bk||!Th||!ST||!SP)return[];
    // per-wheel |slip| deg (FL/FR/RL/RR) — optional channels; undefined when absent
    const SF=cc.chans.get('Tire Slip Angle FL'),SRF=cc.chans.get('Tire Slip Angle FR'),SRL=cc.chans.get('Tire Slip Angle RL'),SRR=cc.chans.get('Tire Slip Angle RR');
    const hasSlip=SF&&SRF&&SRL&&SRR;
    const X=CX.vals.subarray(cc.a,cc.b),Y=CY.vals.subarray(cc.a,cc.b);
    const step=Math.max(1,Math.floor(X.length/700));const out=[];
    for(let i=0;i<X.length;i+=step)out.push([Math.round(-X[i]*100)/100,Math.round(-Y[i]*100)/100,Bk.vals[cc.a+i],Th.vals[cc.a+i],ST.vals[cc.a+i],SP.vals[cc.a+i],hasSlip?Math.abs(SF.vals[cc.a+i]):undefined,hasSlip?Math.abs(SRF.vals[cc.a+i]):undefined,hasSlip?Math.abs(SRL.vals[cc.a+i]):undefined,hasSlip?Math.abs(SRR.vals[cc.a+i]):undefined]); // [x,y,brake%,throttle%,steer°,km/h,|slipFL|..|slipRR|]
    out.__tot=(out.length>1)?(out.length-1)*step/(cc.freq||25):0; // seconds lap start→last point (MoTeC = uniform rate) — time-synced slider
    return out;};
  const oa=px(cRef),ob=px(cChal);
  if(oa.length<2||ob.length<2)return;
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9,n=0;
  for(const p of oa.concat(ob)){if(!isFinite(p[0])||!isFinite(p[1]))continue;x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);n++;}
  if(n<2)return;
  const W=cv.width,H=cv.height,pad=30,s=Math.min((W-2*pad)/(x1-x0),(H-2*pad)/(y1-y0));
  const ox=(W-(x1-x0)*s)/2,oy=(H-(y1-y0)*s)/2;cv.__zoom=null; // fresh fit per comparison
  cv.__sliderPct=null;cv.__clockT=null; // race clock (seconds) inactive until scrubbed / played
  const refT=[64,255,138],refB=[255,59,59],chalT=[77,159,255],chalP=[171,107,255]; // throttle/brake endpoint colors
  const DUAL=10; // % — both pedals at or above this => overlapping pedal-press cue (distinct hue + '*' in tooltip)
  const col=(c1,c2,t,a)=>'rgba('+Math.round(c1[0]+(c2[0]-c1[0])*t)+','+Math.round(c1[1]+(c2[1]-c1[1])*t)+','+Math.round(c1[2]+(c2[2]-c1[2])*t)+','+(a).toFixed(3)+')';
  function draw(){
    const Z=cv.__zoom||{k:1,ax:ox,ay:oy};cv.__zoom=Z;const S=s*Z.k;
    cv.__base={ox,oy,s};cv.__redraw=draw;
    const X=wx=>Z.ax+(wx-x0)*S,Y=wy=>Z.ay+(y1-wy)*S;
    const c=cv.getContext('2d');c.clearRect(0,0,W,H);c.lineJoin='round';c.lineCap='round';
    // Apex v-min points (glowing dots) — computed once for the dot pass below
    const refAp=apexPointsFor(cRef),chalAp=apexPointsFor(cChal);
    // Dropped track boundaries (side_l/side_r .csv) -> asphalt ribbon under the pedal lines.
    const bd=state.bounds;
    drawTrackRibbon(c,X,Y,bd?bd.left:null,bd?bd.right:null);
    const line=(pts,tCol,bCol,dCol)=>{
      for(let i=1;i<pts.length;i++){
        const p0=pts[i-1],p1=pts[i];if(!isFinite(p0[0])||!isFinite(p0[1])||!isFinite(p1[0])||!isFinite(p1[1]))continue;
        const b=(p0[2]+p1[2])/2,t=(p0[3]+p1[3])/2,mx=Math.max(b,t); // segment's average application
        if(mx<2){c.strokeStyle='rgba(139,148,158,0.28)';c.lineWidth=1;} // coasting: faint neutral
        else if(b>=DUAL&&t>=DUAL){c.strokeStyle=col(dCol,dCol,0,0.15+0.85*mx/100);c.lineWidth=1.2+2.4*(mx/100);} // both pedals at once: distinct hue
        else{c.strokeStyle=col(tCol,bCol,b/(b+t),0.15+0.85*mx/100);c.lineWidth=1.2+2.4*(mx/100);}
        c.beginPath();c.moveTo(X(p0[0]),Y(p0[1]));c.lineTo(X(p1[0]),Y(p1[1]));c.stroke();
      }};
    const tR=oa.__tot||((cRef.b-cRef.a)/(cRef.freq||25)),tC=ob.__tot||((cChal.b-cChal.a)/(cChal.freq||25)); // sample-derived total lap times (≈ dur)
    cv.__pedalData={oa,ob,x0,y1,s,ox,oy,tR,tC}; // latest geometry + totals for the hover tooltip & race-clock slider
    line(oa,refT,refB,[255,224,64]);line(ob,chalT,chalP,[255,89,191]);
    const sp=oa[0];if(isFinite(sp[0])&&isFinite(sp[1])){c.fillStyle='#e6edf3';c.fillRect(X(sp[0])-4,Y(sp[1])-4,8,8);}
    // Apex markers: glowing dot at each braking event's v-min point — Ref green, Chal blue
    const apDot=(p,fy,fc)=>{c.save();c.shadowColor=fy;c.shadowBlur=8;
      c.fillStyle=fc;c.beginPath();c.arc(X(p.x),Y(p.y),3,0,6.29);c.fill();c.restore();
      c.strokeStyle='#0d1117';c.lineWidth=1;c.beginPath();c.arc(X(p.x),Y(p.y),3,0,6.29);c.stroke();};
    for(const p of refAp)apDot(p,'rgba(64,255,138,0.7)','#40ff8a');
    for(const p of chalAp)apDot(p,'rgba(77,159,255,0.7)','#4d9fff');
    c.font='12px Segoe UI';c.textAlign='left';
    const leg=(y,label,cA,wA,cB,wB)=>{let x=10;c.fillStyle='#8b949e';c.fillText(label,x,y);x+=c.measureText(label).width+6;
      c.fillStyle=cA;c.fillText(wA,x,y);x+=c.measureText(wA).width+6;c.fillStyle=cB;c.fillText(wB,x,y);};
    leg(16,'A:','rgb(64,255,138)','throttle','rgb(255,59,59)','brake');
    leg(32,'B:','rgb(77,159,255)','throttle','rgb(171,107,255)','brake');
    leg(48,'overlap (both):','rgb(255,224,64)','A','rgb(255,89,191)','B · * in tooltip');
    c.fillStyle='#8b949e';c.font='11px Segoe UI';
    c.fillText('red/purple trail starts where braking is applied · dot = apex (v-min of corner) · track boundaries ribbon',10,64);
    c.fillText('bright = 100% application · line fades & thins as input drops · hover for (A/B) pedals + slip °',10,80);
    c.fillText('scroll = zoom \u00b7 drag = pan \u00b7 dblclick = reset',10,H-12);
    // Lap-position slider markers: A/B dots at the same lap fraction. Green = throttle dominant,
    // red = brake dominant (coasting reads as "not braking"); label letter identifies the car.
    const clockT=cv.__clockT;
    if(clockT!=null){
      const dot=(pts,i,ch)=>{const p=pts[i];if(!p||!isFinite(p[0])||!isFinite(p[1]))return;
        c.fillStyle=p[2]>p[3]?'#ff3b3b':'#40ff8a';c.beginPath();c.arc(X(p[0]),Y(p[1]),8,0,Math.PI*2);c.fill();
        c.strokeStyle='#0d1117';c.lineWidth=1.5;c.stroke();
        c.font='bold 11px Segoe UI';c.textAlign='center';c.fillStyle='#fff';c.fillText(ch,X(p[0]),Y(p[1])+4);c.textAlign='left';};
      // Race clock (seconds since start, [0, max(lapA,lapB)]): each car's dot sits where it is at
      // that same instant running its own lap; the faster car clamps at the finish line.
      const tR2=oa.__tot||((cRef.b-cRef.a)/(cRef.freq||25)),tC2=ob.__tot||((cChal.b-cChal.a)/(cChal.freq||25));
      dot(oa,Math.min(oa.length-1,Math.round(clockT/tR2*(oa.length-1))),'A');
      dot(ob,Math.min(ob.length-1,Math.round(clockT/tC2*(ob.length-1))),'B');
    }
  }
  wireZoomPan(cv); // idempotent — wires wheel/drag/dblclick once per canvas element
  // Hover tooltip: nearest point on each lap under the current zoom -> (Ref%/Chal%) per pedal, with '*'
  // when both pedals are pressed at once (>= DUAL %). Suppressed while panning. Wired once per
  // canvas; draw() refreshes cv.__pedalData so re-comparisons update it in place.
  if(!cv.__tipWired){
    cv.__tipWired=true;
    const tip=cv.__tipEl=document.createElement('div');
    tip.style.cssText='position:fixed;z-index:99;pointer-events:none;display:none;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:4px 8px;font:12px Segoe UI;color:#e6edf3;line-height:1.5';
    if(document&&document.body)document.body.appendChild(tip);
    const hide=()=>{tip.style.display='none';};
    cv.addEventListener('mousemove',e=>{
      if(cv.__panning){hide();return;}
      const D=cv.__pedalData;if(!D)return;
      const rect=cv.getBoundingClientRect(),mx=(e.clientX-rect.left)*(cv.width/rect.width),my=(e.clientY-rect.top)*(cv.height/rect.height);
      const Z=cv.__zoom||{k:1,ax:D.ox,ay:D.oy},S=D.s*Z.k;
      const X=wx=>Z.ax+(wx-D.x0)*S,Y=wy=>Z.ay+(D.y1-wy)*S;
      const near=pts=>{let bi=-1,bd=Infinity;for(let i=0;i<pts.length;i++){const p=pts[i];if(!isFinite(p[0])||!isFinite(p[1]))continue;const dx=X(p[0])-mx,dy=Y(p[1])-my,d=dx*dx+dy*dy;if(d<bd){bd=d;bi=i;}}return bi>=0&&Math.sqrt(bd)<=30?{p:pts[bi],i:bi}:null;};
      const na=near(D.oa),nb=near(D.ob);
      if(!na||!nb){hide();return;}
      const f=(v,pt)=>Math.round(v)+'%'+(pt[2]>=DUAL&&pt[3]>=DUAL?'*':'');
      const g=v=>Math.round(v)+'\u00b0'; // steering angle is already signed degrees (0 = straight)
      const h=v=>v.toFixed(1); // ground speed, km/h
      const sl=p=>isFinite(p[6])?p[6].toFixed(1)+'·'+p[7].toFixed(1)+'·'+p[8].toFixed(1)+'·'+p[9].toFixed(1):'\u2014'; // |slip| FL/FR/RL/RR deg
      tip.innerHTML='Lap '+(na.i/(D.oa.length-1)*100).toFixed(0)+'%<br>Brake ('+f(na.p[2],na.p)+'/&nbsp;'+f(nb.p[2],nb.p)+')<br>Throttle ('+f(na.p[3],na.p)+'/&nbsp;'+f(nb.p[3],nb.p)+')<br>Steer ('+g(na.p[4])+'/&nbsp;'+g(nb.p[4])+')<br>Speed ('+h(na.p[5])+'/&nbsp;'+h(nb.p[5])+' km/h)<br>Slip ° FL/FR/RL/RR ('+sl(na.p)+' / '+sl(nb.p)+')';
      tip.style.display='block';tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY+14)+'px';
    });
    cv.addEventListener('mouseleave',hide);
  }
  draw();
}
// Race clock core (playable-clock work, chunk 1): one time base in seconds over [0, T] where
// T = max(lap A duration, lap B duration). cv.__clockT is the single source of truth;
// __sliderPct mirrors it as a display % (t/T*100) so the slider stays scrubbable and the
// null = "inactive" gate keeps working for draw()/readout.
function raceClockTotals(cv){
  const D=cv&&cv.__pedalData;if(!D)return null;
  const tR=D.tR||1,tC=D.tC||1;
  return {tR,tC,T:Math.max(tR,tC)};
}
function syncRaceClock(cv){
  const T=raceClockTotals(cv);if(!T)return;
  cv.__sliderPct=cv.__clockT==null?null:cv.__clockT/T.T*100; // display sync for the slider element
  updateXcmpSliderRead();
  if(cv.__redraw)cv.__redraw();
}
function setClockT(cv,t){ // absolute seconds, clamped to [0, T]
  const T=raceClockTotals(cv);if(!cv||!T)return;
  cv.__clockT=Math.max(0,Math.min(T.T,t));
  syncRaceClock(cv);
}
function setClockPct(cv,pct){ // slider input path: % of full race time (max lap)
  const T=raceClockTotals(cv);if(!cv||!T)return;
  cv.__clockT=Math.max(0,Math.min(T.T,(+pct)/100*T.T));
  syncRaceClock(cv);
}
// Readout under the race-clock slider: same-instant telemetry for both cars.
function updateXcmpSliderRead(){
  const cv=$('cmpPedalLineMap');if(!cv)return;const D=cv.__pedalData;if(!D)return;
  const el=$('cmpSliderRead'),pl=$('cmpSliderPct');
  if(cv.__clockT==null){if(el)el.innerHTML='';if(pl)pl.textContent='0';return;}
  const tR=D.tR||1,tC=D.tC||1,T=Math.max(tR,tC),t=cv.__clockT;
  const iR=Math.min(D.oa.length-1,Math.round(t/tR*(D.oa.length-1))); // each car at its own pace, clamped at finish
  const iC=Math.min(D.ob.length-1,Math.round(t/tC*(D.ob.length-1)));
  const f=p=>p&&isFinite(p[2])?'brake '+Math.round(p[2])+'% \u00b7 throttle '+Math.round(p[3])+'% \u00b7 steer '+Math.round(p[4])+'\u00b0 \u00b7 speed '+p[5].toFixed(1)+' km/h':'\u2014';
  const aFin=t-tR>1e-9?' <b>(finished)</b>':''; // faster car flags finished once past its lap time
  const bFin=t-tC>1e-9?' <b>(finished)</b>':'';
  if(el)el.innerHTML='Clock <b>'+t.toFixed(1)+' s</b> of '+T.toFixed(1)+' s &nbsp;\u00b7&nbsp; A @lap '+(iR/Math.max(1,D.oa.length-1)*100).toFixed(1)+'%'+aFin+': '+f(D.oa[iR])+' &nbsp;\u00b7&nbsp; B @lap '+(iC/Math.max(1,D.ob.length-1)*100).toFixed(1)+'%'+bFin+': '+f(D.ob[iC]);
  if(pl)pl.textContent=(t/T*100).toFixed(0);
}
// Per-file cache of {meta,report} for cross-session comparison (built lazily).
// App state lives in the CORE section (not the browser-only block below): core functions
// like cornersFor/ldSession/lapRecord reference it, and 'use strict' makes a declaration
// inside the browser if-block invisible to them (ReferenceError on first file load).
