

const _refHydrated=new Set(); // ids of embedded reference packages already pushed into state.files
function refTrackKey(t){t=(t||'').toLowerCase().trim();if(t.startsWith('rt_'))t=t.slice(3);return t.split('-')[0];}
function refLapEntriesFor(track){
  // Match-on-upload preload: hydrate embedded reference packages whose track matches the uploaded
  // file's normalized key (same normalization as zonesFor: 'rt_suzuka-suzukagp' -> 'suzuka').
  // One state.files entry per package; all its laps are available in that entry's pool.
  // Idempotent via _refHydrated (re-uploading the same track adds nothing).
  const want=refTrackKey(track),out=[];
  (REFLAPS.packages||[]).forEach(pkg=>{
    if(_refHydrated.has(pkg.id))return;
    if(refTrackKey(pkg.track||REFLAPS.track)!==want)return; // pkg.track per package (block-level fallback for old blocks)
    _refHydrated.add(pkg.id);
    const laps=pkg.laps.map(l=>({lap:l.lap,dur:l.dur,topSpeed:l.top_speed,maxLatG:l.max_lat_g,
      maxBrakeG:l.max_brake_g,fuelUsed:l.fuel_used,startFuel:(l.start_fuel!=null)?l.start_fuel:null,
      corners:l.corners,apex:l.apex,smooth:l.smooth,line_grid:l.line_grid,traces:l.traces,map_pts:l.map_pts,map_tot_s:l.map_tot_s}));
    out.push({name:pkg.driver+' \u00b7 '+pkg.date+' ('+pkg.id+')',format:'ld',
      parsed:{preset:true,pkg,meta:{track:(pkg.track||REFLAPS.track),freq_hz:pkg.freq_hz,driver:pkg.driver,car:pkg.car,date:pkg.date},
              report:{laps,bestIdx:laps.findIndex(l=>l.lap===pkg.best_lap)}}});
  });
  return out;
}
const state={files:[],setup:null,combos:new Map(),currentFileIdx:-1,report:null,digest:'',chat:[],bounds:{left:null,right:null},level:null};
const _crossCache=new Map(); // fileIdx -> {meta,report}
function ldSession(fileIdx){
  const f=state.files[fileIdx];if(!f||f.format!=='ld')return null;
  if(f.parsed&&f.parsed.preset)return{preset:true,meta:f.parsed.meta,report:f.parsed.report}; // embedded reference lap — no raw channels
  let c=_crossCache.get(fileIdx);
  if(!c){try{c={meta:f.parsed.meta,report:buildReport(f.parsed.meta,f.parsed.chans,f.parsed.meta.freq_hz)};_crossCache.set(fileIdx,c);}catch(e){return null;}}
  return c;
}
function lapRecord(fileIdx,lapIdx){
  const s=ldSession(fileIdx);if(!s)return null;
  if(s.preset){const lap=s.report.laps[lapIdx];if(!lap)return null; // embedded reference lap
    return{fileIdx,lapIdx,lap:lap.lap,dur:lap.dur,topSpeed:lap.topSpeed,maxLatG:lap.maxLatG,
           maxBrakeG:lap.maxBrakeG,fuelUsed:lap.fuelUsed,startFuel:(lap.startFuel!=null)?lap.startFuel:null};}
  const f=state.files[fileIdx];const {meta,chans}=f.parsed;const freq=meta.freq_hz||20.0;
  const segs=getSegs(chans,freq);const keys=Object.keys(segs).map(Number).sort((a,b)=>a-b);
  const lap=s.report.laps[lapIdx];if(!lap)return null;
  const ki=keys.indexOf(lap.lap);if(ki<0)return null;
  const [a,b]=segs[keys[ki]];const Fuel=chans.get('Fuel Level');
  return {fileIdx,lapIdx,lap:lap.lap,dur:lap.dur,topSpeed:lap.topSpeed,maxLatG:lap.maxLatG,maxBrakeG:lap.maxBrakeG,fuelUsed:lap.fuelUsed,startFuel:Fuel?Fuel.vals[a]:null};
}
// Speed trace on a fixed 401-point lap-position grid (mirrors compare_laps.speed_series) so two
// cross-session traces are index-aligned for the delta chart.
function speedTraceFor(fileIdx,lapIdx){
  const c=cornersFor(fileIdx,lapIdx);if(!c)return null;
  if(c.preset){const tr=c.pkgLap&&c.pkgLap.traces;return tr?tr.speed.map((v,i)=>[+(i/4).toFixed(2),+v.toFixed(1)]):null;} // embedded reference lap — precomputed
  const S=c.chans.get('Ground Speed')||c.chans.get('Speed');if(!S)return null;
  let P=Array.from(c.chans.get('Car Pos Norm').vals.subarray(c.a,c.b));
  for(let w=0;w<P.length-1;w++)if(P[w+1]-P[w]<-0.5)for(let k=w+1;k<P.length;k++)P[k]+=1.0; // unwrap lap wrap
  let m=-Infinity;for(let k=0;k<P.length;k++){m=Math.max(m,P[k]);P[k]=m;} // absorb tiny backward noise (np.maximum.accumulate)
  const grid=[];for(let i=0;i<=400;i++)grid.push(i/400);
  const sv=interp(grid,P,S.vals.subarray(c.a,c.b));
  return grid.map((g,i)=>[+(g*100).toFixed(2),+sv[i].toFixed(1)]);
}
// Cumulative time from lap start at each of the shared 401-point lap-position grid points — exact
// sample times (uniform-rate logging: t = i/freq) interpolated onto the normalized position grid,
// with the same unwrap + running-max logic as speedTraceFor so point i aligns with point i of every
// other trace. Preset-aware: embedded reference laps walk their decimated map_pts instead (chord
// accumulation for position fraction; uniform-time scaling by map_tot_s — see drawPedalLines px()).
// Returns [[posPct, cumTimeS]...] on the 401 grid or null when the lap's position data is unavailable.
function cumTimeTraceFor(fileIdx,lapIdx){
  const c=cornersFor(fileIdx,lapIdx);if(!c)return null;
  let P,T;
  if(c.preset){ // embedded reference lap — decimated map_pts walk (no raw channels)
    const pts=c.pkgLap.map_pts,tot=c.pkgLap.map_tot_s;if(!pts||!tot||pts.length<2)return null;
    let L=0;P=[0];
    for(let i=1;i<pts.length;i++){L+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);P.push(L);}
    const tot2=L||1;let m=-Infinity;for(let k=0;k<P.length;k++){m=Math.max(m,P[k]);P[k]=m/tot2;} // running max + normalize to 0..1
    T=new Float64Array(P.length);const N=P.length-1;for(let i=0;i<N+1;i++)T[i]=tot*i/N;
  } else {
    const Pn=c.chans.get('Car Pos Norm');if(!Pn)return null;
    P=Array.from(Pn.vals.subarray(c.a,c.b));
    for(let w=0;w<P.length-1;w++)if(P[w+1]-P[w]<-0.5)for(let k=w+1;k<P.length;k++)P[k]+=1.0; // unwrap lap wrap
    let m=-Infinity;for(let k=0;k<P.length;k++){m=Math.max(m,P[k]);P[k]=m;} // absorb tiny backward noise (np.maximum.accumulate)
    T=new Float64Array(P.length);for(let i=0;i<P.length;i++)T[i]=i/c.freq;
  }
  const grid=[];for(let i=0;i<=400;i++)grid.push(i/400);
  const ct=interp(grid,P,T);
  return grid.map((g,i)=>[+(i/4).toFixed(2),+ct[i].toFixed(3)]);
}
// Pedal (brake + throttle) trace per lap on the same 401-point lap-position grid as speedTraceFor,
// so pedal charts align with the speed/delta charts by % of lap. Brake Pos / Throttle Pos are
// logged in percent (see brakingEvents thresholds). Returns {br:[[posPct,val]...], th:[...]},
// values clamped to 0..100; null when the lap channels are unavailable.
function pedalTraceFor(fileIdx,lapIdx){
  const c=cornersFor(fileIdx,lapIdx);if(!c)return null;
  if(c.preset){const tr=c.pkgLap&&c.pkgLap.traces;if(!tr)return null;return{br:tr.brk.map((v,i)=>[+(i/4).toFixed(2),+v.toFixed(1)]),th:tr.thr.map((v,i)=>[+(i/4).toFixed(2),+v.toFixed(1)])};} // embedded reference lap — precomputed
  const Bk=c.chans.get('Brake Pos'),Th=c.chans.get('Throttle Pos');
  if(!Bk||!Th)return null;
  let P=Array.from(c.chans.get('Car Pos Norm').vals.subarray(c.a,c.b));
  for(let w=0;w<P.length-1;w++)if(P[w+1]-P[w]<-0.5)for(let k=w+1;k<P.length;k++)P[k]+=1.0; // unwrap lap wrap
  let m=-Infinity;for(let k=0;k<P.length;k++){m=Math.max(m,P[k]);P[k]=m;} // absorb tiny backward noise (np.maximum.accumulate)
  const grid=[];for(let i=0;i<=400;i++)grid.push(i/400);
  const clamp=v=>Math.max(0,Math.min(100,v));
  const bv=interp(grid,P,Bk.vals.subarray(c.a,c.b)),tv=interp(grid,P,Th.vals.subarray(c.a,c.b));
  return {br:grid.map((g,i)=>[+(g*100).toFixed(2),+clamp(bv[i]).toFixed(1)]),th:grid.map((g,i)=>[+(g*100).toFixed(2),+clamp(tv[i]).toFixed(1)])};
}

// Steering-angle trace per lap on the same 401-point lap-position grid as speedTraceFor /
// pedalTraceFor. `Steering Angle` is signed degrees (left/right of straight), so values can be
// negative — drawComparisonCharts gets a minV to plot below the axis. Returns [[posPct,deg]...];
// null when the channel is unavailable.
function steerTraceFor(fileIdx,lapIdx){
  const c=cornersFor(fileIdx,lapIdx);if(!c)return null;
  if(c.preset){const tr=c.pkgLap&&c.pkgLap.traces;return tr?tr.stw.map((v,i)=>[+(i/4).toFixed(2),+v.toFixed(1)]):null;} // embedded reference lap — precomputed
  const S=c.chans.get('Steering Angle');if(!S)return null;
  let P=Array.from(c.chans.get('Car Pos Norm').vals.subarray(c.a,c.b));
  for(let w=0;w<P.length-1;w++)if(P[w+1]-P[w]<-0.5)for(let k=w+1;k<P.length;k++)P[k]+=1.0; // unwrap lap wrap
  let m=-Infinity;for(let k=0;k<P.length;k++){m=Math.max(m,P[k]);P[k]=m;} // absorb tiny backward noise (np.maximum.accumulate)
  const grid=[];for(let i=0;i<=400;i++)grid.push(i/400);
  const sv=interp(grid,P,S.vals.subarray(c.a,c.b));
  return grid.map((g,i)=>[+(g*100).toFixed(2),+sv[i].toFixed(1)]);
}
/* ---- pre-canned cross-session LLM review (core: testable headlessly, no DOM) ----
   Builds the canned "Braking Analysis between lap A and lap B" prompt plus a
   plain-text digest of the A vs B comparison. Delta convention: A - B
   (positive = A slower). Returns null when either slot is empty. */
function crossReviewPrompt(selA, selB){
  if(!selA||!selB)return null;
  const A=lapRecord(selA.fileIdx,selA.lapIdx),B=lapRecord(selB.fileIdx,selB.lapIdx);
  if(!A||!B)return null;
  const ds=A.dur-B.dur; // A−B (T-38 C4)
  const fname=fi=>{const f=state.files[fi];return f?f.name:'?';};
  const L=[];
  L.push('PRE-CANNED REVIEW REQUEST: Braking Analysis between lap A and lap B.');
  L.push('Using ONLY the measured cross-session data below, analyze the braking of lap A versus lap B:');
  L.push('- for each braking zone, compare braking point, entry speed, deceleration and brake duration;');
  L.push('- state which zones cost lap A the most time and the likely cause of each (late point that didn\'t carry, trail-brake release, coast gap, entry-speed loss);');
  L.push('- account for the start-of-lap fuel difference as a car-weight confounder when interpreting the time delta;');
  L.push('- finish with 2-3 concrete braking corrections for lap A. Cite the measured numbers.');
  L.push('');
  L.push('CROSS-SESSION COMPARISON (delta convention: A - B; positive = A slower)');
  L.push('A: L'+A.lap+' ('+fmtLap(A.dur)+') from '+fname(selA.fileIdx));
  L.push('B: L'+B.lap+' ('+fmtLap(B.dur)+') from '+fname(selB.fileIdx));
  L.push('Time delta: '+(ds>=0?'+':'')+ds.toFixed(3)+' s ('+(ds>0?'A slower':(ds<0?'A faster':'equal'))+')');
  if(A.startFuel!=null&&B.startFuel!=null){
    const fd=A.startFuel-B.startFuel;
    L.push('Start-of-lap fuel: A '+A.startFuel.toFixed(2)+' L, B '+B.startFuel.toFixed(2)+' L (delta '+(fd>=0?'+':'')+fd.toFixed(2)+' L)'+(Math.abs(fd)>=0.5?' — part of the time delta may be car weight, not driving':''));
  }
  const mtr=(n,vA,vB,u,d)=>{L.push(n+': A '+(isFinite(vA)?vA.toFixed(d):'-')+' '+u+', B '+(isFinite(vB)?vB.toFixed(d):'-')+' '+u+' (delta '+(isFinite(vA)&&isFinite(vB)?((vA-vB)>=0?'+':'')+(vA-vB).toFixed(d):'-')+' '+u+')');};
  mtr('Top speed',A.topSpeed,B.topSpeed,'km/h',1);
  mtr('Max lat G',A.maxLatG,B.maxLatG,'G',2);
  mtr('Max brake G',A.maxBrakeG,B.maxBrakeG,'G',2);
  const cA=cornersFor(selA.fileIdx,selA.lapIdx),cB=cornersFor(selB.fileIdx,selB.lapIdx);
  if(cA&&cB){
    const sA=smoothOf(cA),sB=smoothOf(cB);
    mtr('Throttle jerk RMS',sA.thr_jerk,sB.thr_jerk,'%/s^2',0);
    mtr('Brake rate max',sA.brk_rate_max,sB.brk_rate_max,'%/s',0);
    mtr('Steering corrections',sA.corr,sB.corr,'',0);
  }
  const mA=state.files[selA.fileIdx].parsed.meta,mB=state.files[selB.fileIdx].parsed.meta;
  const ntr=t=>{t=(t||'').toLowerCase().trim();if(t.startsWith('rt_'))t=t.slice(3);return t.split('-')[0];};
  if(ntr(mA.track)!==ntr(mB.track)){
    L.push('');
    L.push('Zone matching unavailable: tracks differ ('+(mA.track||'?')+' vs '+(mB.track||'?')+') — brake comparison is limited to the metrics above.');
  } else if(cA&&cB){
    const zones=zonesFor(mA.track);
    const {pairs,ua,ub}=matchZones(cA.corners,cB.corners); // internal A−B = slotA−slotB (T-38 C2/C4)
    const llm=lapLengthM(selA.fileIdx,selA.lapIdx)||0;
    const rows=buildRows(pairs,llm,zones,rankCorners(cA.corners),mA.track);
    L.push('');
    L.push('Braking zones (point / entry / decel / duration — A / B (delta = A - B)):');
    rows.forEach(r=>{
      let line=' - '+r.label+' ['+r.tag+(Math.abs(r.dpos)>=0.1?' '+(r.dpos>=0?'+':'')+r.dpos.toFixed(1)+' m':'')+']: entry '+r.entryA.toFixed(1)+' / '+r.entryB.toFixed(1)+' ('+(r.dEntry>=0?'+':'')+r.dEntry.toFixed(1)+') km/h, decel '+r.decelA.toFixed(2)+' / '+r.decelB.toFixed(2)+' G, duration '+r.durA.toFixed(2)+' / '+r.durB.toFixed(2)+' s';
      if(isFinite(r.vminA)&&isFinite(r.vminB))line+=', v-min '+r.vminA.toFixed(1)+' / '+r.vminB.toFixed(1)+' km/h'; // A / B
      const sf=s=>s?s.map(v=>v.toFixed(1)).join('\u00b7'):'\u2014'; // peak |slip| FL/FR/RL/RR deg; dash when channel absent
      if(r.slipA||r.slipB)line+='; slip \u00b0 FL/FR/RL/RR ('+sf(r.slipA)+' / '+sf(r.slipB)+')';
      const dz=decomposeZone(r);
      if(dz.causes.length)line+='; causes: '+dz.causes.map(c=>c.name+(isFinite(c.delta)?' '+(c.delta>=0?'+':'')+c.delta.toFixed(1)+c.unit:'')).join(', ');
      L.push(line);
    });
    const leaks=rankLeaks(rows);
    if(leaks.length)L.push('Top zone time deltas (A - B, by |Δ|): '+leaks.map(l=>l.corner_label+' '+(l.time_total_s>=0?'+':'')+l.time_total_s.toFixed(2)+' s').join(', '));
    if(ua.length||ub.length){
      const rA=rankCorners(cA.corners),rB=rankCorners(cB.corners); // ua = unmatched in slot A, ub = unmatched in slot B (T-38 C4)
      L.push('Unmatched braking events — only in A: '+(ua.map(a=>zoneRef(a.pos,zones,rA.get(a)||0,mA.track)+' (entry '+a.entry.toFixed(1)+' km/h)').join(', ')||'none')+'; only in B: '+(ub.map(b=>zoneRef(b.pos,zones,rB.get(b)||0,mA.track)+' (entry '+b.entry.toFixed(1)+' km/h)').join(', ')||'none'));
    }
  }
  return L.join('\n');
}
/* ---- cross-section setup display: Ref vs Chal setup lines for the Cross section ---- */
// Setup source per cross slot: the attached car-setup file (state.setup). Embedded reflap packages
// (parsed.preset) carry no setup yet (package contract v=1 has no setup field), so those slots
// resolve no setup yet. Returns a Map keyed by ACC setup section name (per-corner/<param> sections
// hold the VALUE) or null.
function crossSetupIni(fi){
  const f=state.files[fi];
  if(!f||f.format!=='ld')return null;
  if(f.parsed&&f.parsed.preset)return null; // embedded reference lap: package carries no setup yet
  const t=(state.setup&&state.setup.text)||null;if(!t)return null;
  const vals=new Map();let sec='';
  for(const line of t.split(/\r\n|\r|\n/)){
    const s=line.trim();if(!s||s[0]===';'||s[0]==='#')continue;
    if(s[0]==='['){sec=s.replace(/^\[|\]$/g,'').trim().toUpperCase();continue;}
    const i=s.indexOf('=');if(i<0)continue;
    const k=s.slice(0,i).trim().toUpperCase();const v=s.slice(i+1).trim();
    if(k==='VALUE')vals.set(sec,v);
  }
  return vals;
}
// Formatted setup lines for the assigned A vs B slots, with the B value enclosed in
// parentheses: "Tire Pressure FL 20(18)". Returns [] when neither slot resolves a setup.
function crossSetupLines(selA,selB){
  if(!selA||!selB)return [];
  const rI=crossSetupIni(selA.fileIdx),cI=crossSetupIni(selB.fileIdx);
  const rows=[
    ['Tire Pressure FL','PRESSURE_LF'],['Tire Pressure FR','PRESSURE_FR'],
    ['Tire Pressure RL','PRESSURE_RL'],['Tire Pressure RR','PRESSURE_RR'],
    ['Wing','WING_2'],['Front Brake Bias','FRONT_BIAS'],['ARB Front','ARB_FRONT'],
    ['ARB Rear','ARB_REAR'],['Camber LF','CAMBER_LF'],['Camber RF','CAMBER_RF'],
    ['Camber LR','CAMBER_LR'],['Camber RR','CAMBER_RR'],
  ];
  const out=[];
  for(const row of rows){
    const label=row[0],sec=row[1];
    const rv=rI?String(rI.get(sec)||'') : '';
    const cv=cI?String(cI.get(sec)||'') : '';
    const hasR=rv!=='' ;const hasC=cv!=='';
    if(!hasR&&!hasC)continue;
    if(hasR&&hasC)out.push(label+' '+rv+'('+cv+')');
    else if(hasR)out.push(label+' '+rv);
    else out.push(label+' ('+cv+')');
  }
  return out;
}
// Pre-canned LLM review #2: tire grip profile (front vs rear axle) for the filled cross-session slots.
// Same measured scaffolding as crossReviewPrompt, but the per-zone payload is entry / v-min speeds +
// peak |slip| FL/FR/RL/RR (no decel/duration/causes - this review coaches rotation & traction).
function crossGripPrompt(selA, selB){
  if(!selA||!selB)return null;
  const A=lapRecord(selA.fileIdx,selA.lapIdx),B=lapRecord(selB.fileIdx,selB.lapIdx);
  if(!A||!B)return null;
  const ds=A.dur-B.dur; // A−B (T-38 C4)
  const fname=fi=>{const f=state.files[fi];return f?f.name:'?';};
  const L=[];
  L.push('PRE-CANNED REVIEW REQUEST: Tire grip profile (front vs rear) between lap A and lap B.');
  L.push('Using ONLY the measured cross-session data below, analyze the tire grip of lap A versus lap B:');
  L.push('- for each corner read the front axle first (FL/FR slip angles): is the car rotating on entry? Cite the entry / v-min speeds next to the slip figures;');
  L.push('- then the rear axle (RL/RR slip angles): symmetric or one-sided, and what that says about traction through and out of the corner;');
  L.push('- explain each pattern in plain language for a beginner driver - early/slow braking, slow steering input, weight transfer. These are driver-side symptoms only;');
  L.push('- name setup candidates (balance, pressures, suspension) ONLY as candidates when the pattern makes them plausible - never assert a mechanical cause from this data alone.');
  L.push('Finish with 2-3 concrete driver corrections for lap A. Cite the measured numbers.');
  L.push('');
  L.push('CROSS-SESSION COMPARISON (delta convention: A - B; positive = A slower)');
  L.push('A: L'+A.lap+' ('+fmtLap(A.dur)+') from '+fname(selA.fileIdx));
  L.push('B: L'+B.lap+' ('+fmtLap(B.dur)+') from '+fname(selB.fileIdx));
  L.push('Time delta: '+(ds>=0?'+':'')+ds.toFixed(3)+' s ('+(ds>0?'A slower':(ds<0?'A faster':'equal'))+')');
  if(A.startFuel!=null&&B.startFuel!=null){
    const fd=A.startFuel-B.startFuel;
    L.push('Start-of-lap fuel: A '+A.startFuel.toFixed(2)+' L, B '+B.startFuel.toFixed(2)+' L (delta '+(fd>=0?'+':'')+fd.toFixed(2)+' L)'+(Math.abs(fd)>=0.5?' — part of the time delta may be car weight, not driving':''));
  }
  const mtr=(n,vA,vB,u,d)=>{L.push(n+': A '+(isFinite(vA)?vA.toFixed(d):'-')+' '+u+', B '+(isFinite(vB)?vB.toFixed(d):'-')+' '+u+' (delta '+(isFinite(vA)&&isFinite(vB)?((vA-vB)>=0?'+':'')+(vA-vB).toFixed(d):'-')+' '+u+')');};
  mtr('Top speed',A.topSpeed,B.topSpeed,'km/h',1);
  mtr('Max lat G',A.maxLatG,B.maxLatG,'G',2);
  const cA=cornersFor(selA.fileIdx,selA.lapIdx),cB=cornersFor(selB.fileIdx,selB.lapIdx);
  const mA=state.files[selA.fileIdx].parsed.meta,mB=state.files[selB.fileIdx].parsed.meta;
  const ntr=t=>{t=(t||'').toLowerCase().trim();if(t.startsWith('rt_'))t=t.slice(3);return t.split('-')[0];};
  if(ntr(mA.track)!==ntr(mB.track)){
    L.push('');
    L.push('Zone matching unavailable: tracks differ ('+(mA.track||'?')+' vs '+(mB.track||'?')+') — grip comparison is limited to the metrics above.');
  } else if(cA&&cB){
    const zones=zonesFor(mA.track);
    const {pairs,ua,ub}=matchZones(cA.corners,cB.corners); // internal A−B = slotA−slotB (T-38 C2/C4)
    const llm=lapLengthM(selA.fileIdx,selA.lapIdx)||0;
    const rows=buildRows(pairs,llm,zones,rankCorners(cA.corners),mA.track);
    L.push('');
    L.push('Tire grip zones (entry / v-min km/h + peak slip \u00b0 FL/FR/RL/RR — A / B):');
    const sf=s=>s?s.map(v=>v.toFixed(1)).join('\u00b7'):'\u2014'; // peak |slip| deg; dash when channel absent
    rows.forEach(r=>{
      let line=' - '+r.label+' ['+r.tag+(Math.abs(r.dpos)>=0.1?' '+(r.dpos>=0?'+':'')+r.dpos.toFixed(1)+' m':'')+']: entry '+r.entryA.toFixed(1)+' / '+r.entryB.toFixed(1)+' km/h';
      if(isFinite(r.vminA)&&isFinite(r.vminB))line+=', v-min '+r.vminA.toFixed(1)+' / '+r.vminB.toFixed(1)+' km/h';
      line+='; slip \u00b0 FL/FR/RL/RR ('+sf(r.slipA)+' / '+sf(r.slipB)+')';
      L.push(line);
    });
    if(ua.length||ub.length){
      const rA=rankCorners(cA.corners),rB=rankCorners(cB.corners); // ua = unmatched in slot A, ub = unmatched in slot B (T-38 C4)
      L.push('Unmatched braking events — only in A: '+(ua.map(a=>zoneRef(a.pos,zones,rA.get(a)||0,mA.track)).join(', ')||'none')+'; only in B: '+(ub.map(b=>zoneRef(b.pos,zones,rB.get(b)||0,mA.track)).join(', ')||'none'));
    }
  }
  return L.join('\n');
}

/* ---- pre-canned cross-session LLM review #3: car health A vs B from per-side setup scans (core:
   testable headlessly, no DOM) ----
   Per-side payload: stint medians over full laps (dur_s >= min_lap_s) of the buildReport().setupScan
   fields + event sums + flag prevalence + a one-line compared-lap readout in the single-session digest
   format. Deltas are shown as A \u2212 B, matching crossReviewPrompt /
   crossGripPrompt. hrow picks the canned request: 'all' (umbrella) or a row key mirroring Level 4
   ('tire','us','exit','brake','bottom','abs'). Returns null when either slot is empty; degrades per
   side when a file lacks the mechanical channels or is an embedded preset. */
function crossHealthPrompt(selA, selB, hrow){
  if(!selA||!selB)return null;
  const RA=lapRecord(selA.fileIdx,selA.lapIdx),RB=lapRecord(selB.fileIdx,selB.lapIdx);
  if(!RA||!RB)return null;
  const ds=RA.dur-RB.dur; // A−B (T-38 C4)
  const fname=fi=>{const f=state.files[fi];return f?f.name:'?';};
  const g=(v,d)=>(v==null||!isFinite(v))?'-':v.toFixed(d);
  const w4=a=>Array.isArray(a)&&a.length===4?a.map(x=>g(x,1)).join('/'): '-';
  // per-side setup-scan stats over full laps: medians (median64 = np.median), event sums, flag prevalence
  function sideStats(sel){
    let ss=null;
    const s=ldSession(sel.fileIdx);
    if(s&&s.report&&s.report.setupScan){
      ss=s.report.setupScan; // raw .ld with the full mechanical channel set
    } else {
      // embedded preset: per-lap `scan` dicts in the exact setupScan.laps entry shape (T-36,
      // _gen_reflaps.py v2) — flatten to lap level so medians/flags below work unchanged.
      const f=state.files[sel.fileIdx];
      const p=f&&f.parsed?f.parsed.pkg:null;
      if(f&&f.parsed&&f.parsed.preset&&p&&p.min_lap_s){ // entries without a package degrade to 'no setup scan'
        const laps=(p.laps||[]).map(l=>l.scan?Object.assign({},l.scan,{lap:l.lap,dur_s:l.dur}):null).filter(Boolean);
        if(laps.length)ss={min_lap_s:p.min_lap_s,laps};
      }
    }
    if(!ss)return null; // mechanical channels missing (raw) or no embedded scan (preset)

    const full=ss.laps.filter(l=>l.dur_s>=ss.min_lap_s);
    const med=k=>{const v=full.map(l=>l[k]).filter(x=>x!=null&&isFinite(x));return v.length?median64(v):null;};
    const medArr=(k,w)=>{const v=full.map(l=>Array.isArray(l[k])?l[k][w]:null).filter(x=>x!=null&&isFinite(x));return v.length?median64(v):null;};
    const medObj=(k,w)=>{const v=full.map(l=>(l[k]&&l[k][w]!=null)?l[k][w]:null).filter(x=>x!=null&&isFinite(x));return v.length?median64(v):null;};
    const sum=k=>{let t=null;for(const l of full){if(l[k]!=null)t=(t==null?0:t)+l[k];}return t;};
    const flagN=k=>full.filter(l=>l[k]).length;
    const lapNo=s.report.laps[sel.lapIdx]?s.report.laps[sel.lapIdx].lap:null;
    return {ss,full,med,medArr,medObj,sum,flagN,cmp:ss.laps.find(l=>l.lap===lapNo)};
  }
  function sideBlock(tag,sel){
    const st=sideStats(sel);
    if(!st)return [tag+': no setup scan (embedded preset lap or mechanical channels missing)'];
    const {ss,full}=st;
    const L=[tag+' ('+fname(sel.fileIdx)+'): '+full.length+' full laps of '+ss.laps.length];
    if(full.length){
      const fr=st.med('tire_F_minus_R_C');
      L.push('  tire: core end med '+w4([0,1,2,3].map(w=>st.medArr('tire_core_end_C',w)))+' C (F-R '+(fr==null?'-':(fr>=0?'+':'')+fr.toFixed(1))+'), pressure med '+[0,1,2,3].map(w=>g(st.medArr('pressure_median_psi',w),2)).join('/')+' psi');
      L.push('  understeer: max F-R slip diff med '+(st.med('us_max_f_r_diff_deg')==null?'-':st.med('us_max_f_r_diff_deg').toFixed(3))+' deg, candidate on '+st.flagN('understeer_candidate')+'/'+full.length+' full laps');
      L.push('  exit oversteer: counter-steer '+(st.sum('countersteer_events')==null?0:st.sum('countersteer_events'))+' events total, rear slip max med '+(st.med('rear_slip_ratio_max_pct')==null?'-':st.med('rear_slip_ratio_max_pct').toFixed(2))+' %, throttle hesitation '+(st.sum('throttle_hesitation_events')==null?0:st.sum('throttle_hesitation_events'))+' total, candidate on '+st.flagN('exit_oversteer_candidate')+'/'+full.length);
      L.push('  braking stability: brake events '+(st.sum('braking_events')==null?0:st.sum('braking_events'))+' total, max reversals/event med '+(st.med('max_brake_steering_reversals')==null?'-':st.med('max_brake_steering_reversals').toFixed(1))+', wheel gap med '+(st.med('peak_decel_wheel_speed_gap_rad_s')==null?'-':st.med('peak_decel_wheel_speed_gap_rad_s').toFixed(2))+' rad/s, rear-lock candidate on '+st.flagN('rear_lock_candidate')+'/'+full.length);
      L.push('  bottoming: travel p95 med '+(['FL','FR','RL','RR'].map(w=>g(st.medObj('bottoming_travel_p95_by_wheel',w),3)).join('/'))+' (fraction of max travel), vert G straight med '+(st.med('max_vert_g_straight')==null?'-':st.med('max_vert_g_straight').toFixed(2))+', candidate on '+st.flagN('bottoming_candidate')+'/'+full.length);
      L.push('  ABS/TC: abs '+(st.med('abs_active_pct')==null?'-':st.med('abs_active_pct').toFixed(1))+'% / '+(st.sum('abs_events')==null?0:st.sum('abs_events'))+' events, TC '+(st.med('tc_active_pct')==null?'-':st.med('tc_active_pct').toFixed(1))+'% / '+(st.sum('tc_events')==null?0:st.sum('tc_events'))+' events (full laps)');
    } else {
      L.push('  no full laps (all partial) - medians unavailable, compared lap only');
    }
    const c=st.cmp;
    if(c){
      L.push('  compared lap L'+c.lap+': core end '+w4(c.tire_core_end_C)+' C (F-R '+(c.tire_F_minus_R_C==null?'-':(c.tire_F_minus_R_C>=0?'+':'')+c.tire_F_minus_R_C.toFixed(1))+'), us max F-R slip diff '+(c.us_max_f_r_diff_deg==null?'-':c.us_max_f_r_diff_deg.toFixed(2))+' deg'+(c.understeer_candidate?' - UNDERSTEER CANDIDATE':'')+', counter-steer '+g(c.countersteer_events,0)+', rear slip max '+(c.rear_slip_ratio_max_pct==null?'-':c.rear_slip_ratio_max_pct.toFixed(2))+' %'+', brake events '+g(c.braking_events,0)+', max reversals '+g(c.max_brake_steering_reversals,0)+', wheel gap '+(c.peak_decel_wheel_speed_gap_rad_s==null?'-':c.peak_decel_wheel_speed_gap_rad_s.toFixed(2))+(c.rear_lock_candidate?' - REAR LOCK CANDIDATE':'')+', bottoming p95 '+((c.bottoming_travel_p95_by_wheel)?['FL','FR','RL','RR'].map(w=>g(c.bottoming_travel_p95_by_wheel[w],3)).join('/'): '-')+(c.bottoming_candidate?' - BOTTOMING CANDIDATE':'')+', ABS '+(c.abs_active_pct==null?'-':c.abs_active_pct.toFixed(1))+'% / '+g(c.abs_events,0)+' events, TC '+(c.tc_active_pct==null?'-':c.tc_active_pct.toFixed(1))+'% / '+g(c.tc_events,0)+' events'+(c.dur_s<ss.min_lap_s?' (partial lap - flags not classified)':''));
    } else {
      L.push('  compared lap: not in setup scan');
    }
    return L;
  }
  const A=sideStats(selA),B=sideStats(selB);
  // request text: both sides -> comparison framing; exactly one side has data -> absolute terms
  // (the old canned lines demanded "how did X change from A to B" even when a side had no scan —
  // T-36 audit of all pre-canned builders found this the only one-sided gap); neither -> NONE.
  const REQ_ONE={
    all:['Car health read (single side)','One side has no setup scan, so an A-vs-B comparison is not possible. Using ONLY the measured setup-scan lines below for the side that HAS data, give me a one-minute car health read in absolute terms: which rows flag, on which laps they appear, and what grows over the stint. Rank the 2-3 most plausible setup candidates to test first - each framed as a hypothesis to verify under comparable conditions (fuel mass disclosed), never a guaranteed fix. Cite the measured numbers.'],
    tire:['Tire management (single side)','Using ONLY the tire lines of the one side that has data below (the other side has no setup scan - comparison not possible): describe tyre behaviour in absolute terms - per-wheel core temps at lap end, front-to-rear balance, pressure vs the 26.8-27.2 psi window. Name setup candidates (pressures, compound, camber) ONLY when plausible - a fuel-mass difference can mimic thermal changes. Cite the measured numbers.'],
    us:['Understeer (single side)','Using ONLY the understeer lines of the one side that has data below (the other side has no setup scan - comparison not possible): describe steady-state front load in absolute terms - max F-R slip angle diff per lap, which laps exceed 1.0 deg. Name setup candidates (front wing, camber, balance) ONLY when plausible. Cite the measured numbers.'],
    exit:['Exit oversteer (single side)','Using ONLY the exit-oversteer lines of the one side that has data below (the other side has no setup scan - comparison not possible): describe exit behaviour in absolute terms - counter-steer events, rear slip max, throttle hesitation. Explain driver-side causes first and name setup candidates (rear grip / traction balance) ONLY when plausible. Cite the measured numbers.'],
    brake:['Braking stability (single side)','Using ONLY the braking-stability lines of the one side that has data below (the other side has no setup scan - comparison not possible): describe braking stability in absolute terms - steering reversals per event, peak-decel wheel-speed gap, rear-lock candidates. Name setup candidates (front brake bias first) ONLY when plausible. Cite the measured numbers.'],
    bottom:['Bottoming (single side)','Using ONLY the bottoming lines of the one side that has data below (the other side has no setup scan - comparison not possible): describe ride / bottoming behaviour in absolute terms - suspension travel p95 ratios, vertical G on straights. Name setup candidates (ride height, springs, anti-dive) ONLY when plausible. Cite the measured numbers.'],
    abs:['ABS / TC (single side)','Using ONLY the ABS/TC lines of the one side that has data below (the other side has no setup scan - comparison not possible): where and how often did the systems intervene? Repeated ABS points to late/heavy braking or brake-bias candidates; repeated TC on exits points to aggressive throttle-on or rear-grip/balance candidates. Note when a system reads flat zero - it may be disabled in setup, not absent. Cite the measured numbers.']
  };
  const REQ_NONE='No setup-scan data on either side (preset laps without an embedded scan, or raw files missing the mechanical channels) - nothing to review from this section. Load a .ld file with the full channel set and try again.';
  const REQ={
    all:['Car health read (A vs B)','Using ONLY the measured setup-scan lines below for both sides, give me a one-minute car health read of A vs B: which rows differ between sessions, on which side do they flag, and what grew from A to B? Rank the 2-3 most plausible setup candidates to test first - each framed as a hypothesis to verify under comparable conditions (fuel mass disclosed per side), never a guaranteed fix. Cite the measured numbers.'],
    tire:['Tire management (A vs B)','Using ONLY the tire lines of both sides\' setup scans below (core temp end / F-R, pressure medians over full laps): how did tire behaviour change from A to B? Frame deltas as A \u2212 B; name setup candidates (pressures, compound, camber) ONLY when plausible - a fuel-mass difference can mimic thermal changes. Cite the measured numbers.'],
    us:['Understeer (A vs B)','Using ONLY the understeer lines below (steady-state F\u2212R slip angle diff over full laps): how did steady-state front load change from A to B? Frame deltas as A \u2212 B; name setup candidates (front wing, camber, balance) ONLY when plausible. Cite the measured numbers.'],
    exit:['Exit oversteer (A vs B)','Using ONLY the exit-oversteer lines below (counter-steer events, rear slip max, throttle hesitation over full laps): how did exit behaviour change from A to B? Frame deltas as A \u2212 B; explain driver-side causes first and name setup candidates (rear grip / traction balance) ONLY when plausible. Cite the measured numbers.'],
    brake:['Braking stability (A vs B)','Using ONLY the braking-stability lines below (steering reversals per event, peak-decel wheel-speed gap, rear-lock candidates over full laps): how did braking stability change from A to B? Frame deltas as A \u2212 B; name setup candidates (front brake bias first) ONLY when plausible. Cite the measured numbers.'],
    bottom:['Bottoming (A vs B)','Using ONLY the bottoming lines below (suspension travel p95 ratios, vertical G on straights over full laps): how did ride / bottoming behaviour change from A to B? Frame deltas as A \u2212 B; name setup candidates (ride height, springs, anti-dive) ONLY when plausible. Cite the measured numbers.'],
    abs:['ABS / TC (A vs B)','Using ONLY the ABS/TC lines below (activation share + event counts over full laps): where and how often did the systems intervene on each side? Repeated ABS points to late/heavy braking or brake-bias candidates; repeated TC on exits points to aggressive throttle-on or rear-grip/balance candidates. Note when a system reads flat zero - it may be disabled in setup, not absent. Frame deltas as A \u2212 B.']
  };
  const key=(hrow&&REQ[hrow])?hrow:'all';
  // request text: both sides -> comparison framing; exactly one side has data -> absolute terms
  // (T-36 audit of all pre-canned builders found this the only one-sided gap); neither -> NONE.
  const req=(A&&B)?REQ[key]:(A||B)?[REQ_ONE[key][0],REQ_ONE[key][1]]:['No setup-scan data',REQ_NONE];
  const L=[];
  if(!(A&&B))L.push('NOTE: '+(A||B?'one side has no setup scan - the request below is in absolute terms, not a comparison.':'no setup-scan data on either side.'));
  L.push('PRE-CANNED REVIEW REQUEST: '+req[0]+'.');
  L.push(req[1]);
  L.push('');
  L.push((A&&B?'SETUP-SCAN COMPARISON':'SETUP-SCAN READ')+' (per-side full-lap medians + compared lap'+(A&&B?'; deltas are A - B':''));
  L.push('Side A: L'+RA.lap+' ('+fmtLap(RA.dur)+') from '+fname(selA.fileIdx));
  L.push('Side B: L'+RB.lap+' ('+fmtLap(RB.dur)+') from '+fname(selB.fileIdx));
  L.push('Time delta: '+(ds>=0?'+':'')+ds.toFixed(3)+' s ('+(ds>0?'A slower':(ds<0?'A faster':'equal'))+')');
  if(RA.startFuel!=null&&RB.startFuel!=null){
    const fd=RA.startFuel-RB.startFuel;
    L.push('Start-of-lap fuel: A '+RA.startFuel.toFixed(2)+' L, B '+RB.startFuel.toFixed(2)+' L (delta '+(fd>=0?'+':'')+fd.toFixed(2)+' L)'+(Math.abs(fd)>=0.5?' \u2014 part of the delta may be car weight, not setup':''));
  }
  L.push(...sideBlock('Side A',selA));
  L.push(...sideBlock('Side B',selB));
  // headline deltas (A − B) over full-lap medians - precomputed so the model does no arithmetic
  if(A&&B){
    const d=(name,va,vb,dig)=>{L.push(name+': A '+(va==null?'-':va.toFixed(dig))+', B '+(vb==null?'-':vb.toFixed(dig))+' (delta A\u2212B '+((va!=null&&vb!=null)?(((va-vb)>=0?'+':'')+(va-vb).toFixed(dig)):'-')+')');};
    d('F-R core C',A.med('tire_F_minus_R_C'),B.med('tire_F_minus_R_C'),1);
    d('core end C FL',A.medArr('tire_core_end_C',0),B.medArr('tire_core_end_C',0),1);
    d('core end C FR',A.medArr('tire_core_end_C',1),B.medArr('tire_core_end_C',1),1);
    d('core end C RL',A.medArr('tire_core_end_C',2),B.medArr('tire_core_end_C',2),1);
    d('core end C RR',A.medArr('tire_core_end_C',3),B.medArr('tire_core_end_C',3),1);
    d('us max F-R slip diff deg',A.med('us_max_f_r_diff_deg'),B.med('us_max_f_r_diff_deg'),3);
    d('counter-steer events total',A.sum('countersteer_events'),B.sum('countersteer_events'),0);
    d('wheel gap rad/s',A.med('peak_decel_wheel_speed_gap_rad_s'),B.med('peak_decel_wheel_speed_gap_rad_s'),2);
    d('abs active %',A.med('abs_active_pct'),B.med('abs_active_pct'),1);
    d('tc active %',A.med('tc_active_pct'),B.med('tc_active_pct'),1);
  }
  return L.join('\n');
}
