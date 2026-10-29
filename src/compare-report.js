function fmtLap(t){const m=Math.floor(t/60);return `${m}:${(t-m*60).toFixed(3).padStart(6,'0')}`;}
function fmtT(s){const m=Math.floor(s/60);return `${m}:${(s-m*60).toFixed(3).padStart(6,'0')}`;}

// Build the full report for one parsed file.
function buildReport(meta,chans,freq){
  const segs=getSegs(chans,freq);
  const keys=Object.keys(segs).map(Number).sort((a,b)=>a-b);
  if(!keys.length)throw new Error('no full start-to-finish laps found');
  const S=chans.get('Ground Speed'),Lat=chans.get('CG Accel Lateral'),
        Long=chans.get('CG Accel Longitudinal'),Fuel=chans.get('Fuel Level');
  const laps=keys.map(k=>{
    const [a,b]=segs[k];
    let top=-Infinity,latG=0,brkG=0;
    for(let i=a;i<b;i++){
      if(S&&S.vals[i]>top)top=S.vals[i];
      if(Lat){const v=Math.abs(Lat.vals[i]);if(v>latG)latG=v;}
      if(Long){const v=-Long.vals[i];if(v>brkG)brkG=v;}
    }
    const fuelUsed=Fuel?(Fuel.vals[a]-Fuel.vals[b-1]):null;
    return {lap:k,dur:(b-a)/freq,topSpeed:top,maxLatG:latG,maxBrakeG:brkG,
            fuelUsed:fuelUsed>0?fuelUsed:null};
  });
  const bestIdx=laps.reduce((bi,l,i)=>l.dur<laps[bi].dur?i:bi,0);
  const zones=zonesFor(meta.track);
  const perLap={};
  for(const k of keys)perLap[k]=cluster(brakingEvents(chans,...segs[k],freq));
  const bestZones=perLap[keys[bestIdx]].map((c,i)=>({...c,ref:zoneRef(c.pos,zones,i+1,meta.track)}));
  // entry-speed matrix: rows = best-lap zones, cols = all full laps (nearest corner within 3% of lap)
  const matrix={cols:keys,rows:bestZones.map(z=>({ref:z.ref,pos:z.pos,
    cells:keys.map(k=>{let best=null,bd=0.03;for(const c of perLap[k]){const d=Math.abs(c.pos-z.pos);if(d<bd){bd=d;best=c.entry;}}return best;})}))};
  // corner phase speeds: entry / v-min / exit (speed at first throttle-on) per zone x lap
  const phases={cols:keys,rows:bestZones.map(z=>({ref:z.ref,pos:z.pos,
    cells:keys.map(k=>{let best=null,bd=0.03;for(const c of perLap[k]){const d=Math.abs(c.pos-z.pos);if(d<bd){bd=d;best=c;}}
      return best?{e:best.entry,v:best.vmin,x:best.thrOn?best.thrOn[0]:null,st:best.thrOn?best.thrOn[2]:null,
        t5:best.thr50,co:best.coast?best.coast[0]:null,sl:best.slip}:null;})}))};
  // --- track map data (outline, corner points, speed trace) for the best lap ---
  const CX=chans.get('Car Coord X'),CY=chans.get('Car Coord Y');
  let outline=null,cornerPts=null,speedTrace=null;
  if(CX&&CY){
    const [ba,bb]=segs[keys[bestIdx]];
    // clamp to the coord arrays' length (mirrors Python slicing ch['Car Coord X'][a:b])
    const cxb=Math.min(bb,CX.vals.length);
    outline=trackOutline(CX.vals,CY.vals,ba,cxb);
    cornerPts=cornerPoints(CX.vals,CY.vals,ba,cxb,bestZones);
  }
  if(S){
    const [ba,bb]=segs[keys[bestIdx]];
    speedTrace=speedSeries(chans,'Car Pos Norm',S.vals,ba,bb);
  }
  // --- L2 setup scan (beta) — port of setup_scan_prototype.py::scan_lap (SETUP_RESEARCH.md §3/§4).
  //     PROVISIONAL thresholds - flags are candidates to verify, not verdicts.
  //     Chunk A: tire scan (§4a): core temp end / stint delta / F−R, pressure median + window.
  const P_WIN=[26.8,27.2],SET_MIN_LAP_S=60.0;
  function _med(v){const s=Float64Array.from(v).sort();const n=s.length;if(!n)return null;return n%2?s[(n-1)/2]:0.5*(s[n/2-1]+s[n/2]);}
  let setupScan=null;
  {
    const WHEELS=['FL','FR','RL','RR'];
    const TC=WHEELS.map(w=>chans.get('Tire Temp Core '+w));
    const PR=WHEELS.map(w=>chans.get('Tire Pressure '+w));
    const LI=chans.get('Lap Invalidated');
    // rows 1/3 (understeer): steady-state segments need lat G + speed + the 4 slip-angle channels
    const US_SLIP=['Tire Slip Angle FL','Tire Slip Angle FR','Tire Slip Angle RL','Tire Slip Angle RR'].map(n=>chans.get(n));
    const usOk=Lat&&S&&US_SLIP.every(x=>x);
    // row 4 (braking instability): pedal/steer inputs + wheel angular speed; ABS Active is
    // not in the MECH render gate -> optional here. Row 5: suspension travel + vertical G.
    const STEER=chans.get('Steering Angle'),BRK=chans.get('Brake Pos'),THR=chans.get('Throttle Pos');
    // row 2: rear slip RATIO (distinct from the slip-ANGLE channels in US_SLIP)
    const SR_RL=chans.get('Tire Slip Ratio RL'),SR_RR=chans.get('Tire Slip Ratio RR');
    const LG=chans.get('CG Accel Longitudinal');
    const WSA=WHEELS.map(w=>chans.get('Wheel Angular Speed '+w));
    const ABS=chans.get('ABS Active'),TCA=chans.get('TC Active');
    const TRV=WHEELS.map(w=>chans.get('Suspension Travel '+w));
    const MTRV=WHEELS.map(w=>chans.get('Max Sus Travel '+w));
    const VG=chans.get('CG Accel Vertical');
    // linear-interp percentile (numpy default) for travel-ratio p95
    const pctl=(arr,q)=>{
      const s=Array.from(arr).sort((x,y)=>x-y),n=s.length;if(!n)return null;
      const i=(n-1)*q,lo=Math.floor(i),fr=i-lo;
      return lo+1<n?s[lo]+(s[lo+1]-s[lo])*fr:s[lo];};
    if(TC.every(x=>x)&&PR.every(x=>x)){
      setupScan={pressure_window:P_WIN.slice(),min_lap_s:SET_MIN_LAP_S,us_slip_diff_deg:1.0,laps:[]};
      for(const L of laps){
        const s2=segs[L.lap];if(!s2)continue;
        const [a,b]=s2,coreEnd=[],stintDelta=[];
        for(let w=0;w<4;w++){coreEnd.push(TC[w].vals[b-1]);stintDelta.push(TC[w].vals[b-1]-TC[w].vals[a]);}
        const frC=0.5*(coreEnd[0]+coreEnd[1])-0.5*(coreEnd[2]+coreEnd[3]);
        const pres=[],outWin=[];
        for(let w=0;w<4;w++){const m=_med(PR[w].vals.subarray(a,b));pres.push(m);if(!(m>=P_WIN[0]&&m<=P_WIN[1]))outWin.push(WHEELS[w]);}
        // rows 1/3: steady-state cornering segments (|latG|>=0.35 G, speed>=40 km/h, >=1 s).
        // Per segment: mean F−R slip-angle diff; candidate if any > 1.0 deg. (Prototype's
        // per-segment understeer gradient is context-only and not ported.)
        let usN=0,usMax=null,inSeg=false,sStart=0;
        const closeUs=e=>{
          if((e-sStart)/freq<1.0)return;
          let sum=0;
          for(let j=sStart;j<e;j++)sum+=0.5*(Math.abs(US_SLIP[0].vals[j])+Math.abs(US_SLIP[1].vals[j]))-0.5*(Math.abs(US_SLIP[2].vals[j])+Math.abs(US_SLIP[3].vals[j]));
          const d=sum/(e-sStart);usN++;if(usMax===null||d>usMax)usMax=d;
        };
        if(usOk){
          for(let i=a;i<b;i++){
            const on=Math.abs(Lat.vals[i])>=0.35&&S.vals[i]>=40.0;
            if(on){if(!inSeg){inSeg=true;sStart=i;}}
            else if(inSeg){inSeg=false;closeUs(i);}
          }
          if(inSeg)closeUs(b);
        }
        const s={lap:L.lap,dur_s:Math.round(L.dur*100)/100,
          invalidated:LI?Array.from(LI.vals.subarray(a,b)).some(v=>v):false,
          tire_core_end_C:coreEnd.map(v=>Math.round(v*10)/10),
          tire_stint_delta_C:stintDelta.map(v=>Math.round(v*10)/10),
          tire_F_minus_R_C:Math.round(frC*10)/10,
          pressure_median_psi:pres.map(v=>v==null?null:Math.round(v*100)/100),
          pressure_outside_window:outWin,
          steady_segments:usOk?usN:null,
          us_max_f_r_diff_deg:usOk?(usMax===null?null:Math.round(usMax*1000)/1000):null,
          understeer_candidate:usOk&&usMax!==null&&usMax>1.0};
        // row 5 (bottoming): travel-ratio p95 per wheel — prototype semantics: wheels missing
        // either channel are skipped; mx<=0 samples contribute 0 to the ratio array.
        const ratios={};
        for(let w=0;w<4;w++){
          if(!TRV[w]||!MTRV[w])continue;
          const rv=[];
          for(let j=a;j<b;j++)rv.push(MTRV[w].vals[j]>0?TRV[w].vals[j]/MTRV[w].vals[j]:0);
          ratios[WHEELS[w]]=Math.round(pctl(rv,0.95)*1000)/1000;
        }
        let maxVert=null;
        if(VG){
          for(let j=a;j<b;j++){
            const v=Math.abs(VG.vals[j]);
            if(Math.abs(Lat.vals[j])<0.15&&S.vals[j]>120&&(maxVert===null||v>maxVert))maxVert=v;
          }
        }
        // row 4 (braking instability): brake>=15% sustained >=0.5s events; steering reversals
        // per event count sign flips of steer diffs where |steer after|>2 deg (prototype).
        const brkEv=(BRK&&STEER)?[]:null;
        if(brkEv){
          let inE=false,es=a;
          for(let j=a;j<b;j++){
            if(BRK.vals[j]>=15.0){if(!inE){inE=true;es=j;}}
            else if(inE){inE=false;if((j-es)/freq>=0.5)brkEv.push([es,j]);}
          }
          if(inE&&(b-es)/freq>=0.5)brkEv.push([es,b]);
        }
        let maxRev=0;
        for(const ev of brkEv){
          const s0=ev[0],e0=ev[1];let rev=0,prev=null;
          for(let j=s0+1;j<e0;j++){
            if(Math.abs(STEER.vals[j])>2.0){
              const sg=Math.sign(STEER.vals[j]-STEER.vals[j-1]);
              if(prev!==null&&sg!==prev)rev++;
              prev=sg;
            }
          }
          if(rev>maxRev)maxRev=rev;
        }
        // peak-decel F/R wheel-speed gap: bottom 10% long-G samples of the lap
        let gap=null,rearLock=false;
        if(LG&&WSA.every(x=>x)){
          const lgv=[];for(let j=a;j<b;j++)lgv.push(LG.vals[j]);
          const q=pctl(lgv,0.10);
          let sw=0,n=0,absPk=false;
          for(let j=a;j<b;j++){
            if(LG.vals[j]<=q){
              sw+=0.5*(WSA[0].vals[j]+WSA[1].vals[j])-0.5*(WSA[2].vals[j]+WSA[3].vals[j]);
              n++;
              if(ABS&&ABS.vals[j]>1e-9)absPk=true;
            }
          }
          if(n){gap=Math.round((sw/n)*100)/100;rearLock=gap>5.0&&absPk;}
        }
        maxVert=maxVert==null?null:Math.round(maxVert*100)/100;
        s.braking_events=brkEv?brkEv.length:null;
        s.max_brake_steering_reversals=brkEv?maxRev:null;
        s.peak_decel_wheel_speed_gap_rad_s=gap;
        // PROVISIONAL flag (prototype): >4 steer reversals per event OR rear lock
        s.rear_lock_candidate=rearLock;
        s.bottoming_travel_p95_by_wheel=Object.keys(ratios).length?ratios:null;
        s.max_vert_g_straight=maxVert;
        // PROVISIONAL flags (prototype): any travel p95 >= 0.90 OR vert G on straights >= 3.0
        s.bottoming_candidate=Object.values(ratios).some(v=>v>=0.90)||(maxVert||0)>=3.0;
        // row 2 (exit oversteer): counter-steering events + max rear slip ratio + throttle hesitation.
        // Counter-steer: sign(steer) != sign(latG), |latG| >= 0.30 G, thr >= 50%, speed >= 60 km/h,
        // steer != 0, sustained >= 0.15 s (prototype CS_* constants).
        const csEv=(STEER&&THR&&Lat)?[]:null;
        if(csEv){
          let inC=false,cs0=a;
          for(let j=a;j<b;j++){
            const on=Math.sign(STEER.vals[j])!==Math.sign(Lat.vals[j])&&Math.abs(Lat.vals[j])>=0.30
              &&THR.vals[j]>=50&&S.vals[j]>=60&&STEER.vals[j]!==0;
            if(on){if(!inC){inC=true;cs0=j;}}
            else if(inC){inC=false;if((j-cs0)/freq>=0.15)csEv.push([cs0,j]);}
          }
          if(inC&&(b-cs0)/freq>=0.15)csEv.push([cs0,b]);
        }
        let rearSlip=null;
        if(SR_RL&&SR_RR){
          let m=0;
          for(let j=a;j<b;j++)m=Math.max(m,Math.abs(SR_RL.vals[j]),Math.abs(SR_RR.vals[j]));
          rearSlip=Math.round(m*100)/100;
        }
        // Throttle hesitation: drop of >= 30 points within the next 10 samples at speed > 60 km/h,
        // counting only blips that recover to >= 70% throttle within 1 s (20 samples) after the drop.
        let hesN=0;
        if(THR&&S){
          const nHes=b-a-10;
          if(nHes>0){
            const mark=new Array(nHes).fill(false);
            for(let i=a;i<a+nHes;i++){
              let fmin=Infinity;
              for(let k=i+1;k<=i+10;k++)fmin=Math.min(fmin,THR.vals[k]);
              if(THR.vals[i]-fmin>=30&&S.vals[i]>60)mark[i-a]=true;
            }
            let inM=false,ms=0;
            for(let i=0;i<nHes;i++){
              if(mark[i]){if(!inM){inM=true;ms=i;}}
              else if(inM){
                inM=false;
                const e=i; // exclusive relative end of the marked run
                if(e+20<=b-a){let rec=false;for(let k=e;k<e+20;k++)if(THR.vals[a+k]>=70){rec=true;break;}if(rec)hesN++;}
              }
            }
            if(inM){
              const e=nHes;
              if(e+20<=b-a){let rec=false;for(let k=e;k<e+20;k++)if(THR.vals[a+k]>=70){rec=true;break;}if(rec)hesN++;}
            }
          }
        }
        s.countersteer_events=csEv?csEv.length:null;
        s.rear_slip_ratio_max_pct=rearSlip;
        s.throttle_hesitation_events=(THR&&S)?hesN:null;
        // PROVISIONAL flag (prototype): >= 2 counter-steer events
        s.exit_oversteer_candidate=csEv!==null&&csEv.length>=2;
        // row 6 (electronic intervention): ABS / TC activation share + event counts.
        // A contiguous active run >= 0.1 s is one event (prototype ABS_TC_MIN_S).
        // Context only - no flag threshold yet (SETUP_RESEARCH.md sec-7 calibration).
        // Epsilon test: builds encoding 'inactive' as raw -30000 + shift=1 compute to
        // ~±1e-16 around zero in float arithmetic - a bare >0 counts everything active.
        let absPct=null,absEv=0;
        if(ABS){let n=0,inA=false,a0=a;
          for(let j=a;j<b;j++){const on=ABS.vals[j]>1e-9;
            if(on){n++;if(!inA){inA=true;a0=j;}}
            else if(inA){inA=false;if((j-a0)/freq>=0.1)absEv++;}
          }
          if(inA&&(b-a0)/freq>=0.1)absEv++;
          absPct=Math.round(100*n/(b-a)*100)/100;
        }
        let tcPct=null,tcEv=0;
        if(TCA){let n=0,inT=false,t0=a;
          for(let j=a;j<b;j++){const on=TCA.vals[j]>1e-9;
            if(on){n++;if(!inT){inT=true;t0=j;}}
            else if(inT){inT=false;if((j-t0)/freq>=0.1)tcEv++;}
          }
          if(inT&&(b-t0)/freq>=0.1)tcEv++;
          tcPct=Math.round(100*n/(b-a)*100)/100;
        }
        s.abs_active_pct=absPct;s.abs_events=ABS?absEv:null;
        s.tc_active_pct=tcPct;s.tc_events=TCA?tcEv:null;
        setupScan.laps.push(s);
      }
    }
  }
  return {meta,freq,laps,bestIdx,perLap,bestZones,matrix,phases,zones,setupScan,outline,cornerPts,speedTrace};
}

// Downsampled [x_m, y_m] outline of one lap (port of compare_laps.track_outline).
function trackOutline(X,Y,a,b,n=700){
  const len=b-a;const step=Math.max(1,Math.floor(len/n)); // integer step — typed arrays need int indices
  const pts=[];
  for(let i=a;i<b;i+=step)pts.push([Math.round(-X[i]*100)/100,Math.round(-Y[i]*100)/100]); // negate -> map frame (north-up track orientation)
  return pts;
}

// [x_m, y_m] at each braking zone onset (port of compare_laps.corner_points).
function cornerPoints(X,Y,a,b,zones){
  const len=b-a;
  // cumulative distance
  let total=0;const cd=new Float64Array(len);cd[0]=0;
  for(let i=1;i<len;i++){total+=Math.hypot(X[a+i]-X[a+i-1],Y[a+i]-Y[a+i-1]);cd[i]=total;}
  const pts=[];
  for(const z of zones){
    let target=z.pos*total;
    // binary search in cd
    let lo=0,hi=len-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(cd[mid]<target)lo=mid+1;else hi=mid;}
    const i=Math.min(lo,len-1);
    pts.push([Math.round(-X[a+i]*100)/100,Math.round(-Y[a+i]*100)/100]);
  }
  return pts;
}

// Downsampled [pos_fraction, km/h] pairs for one lap (port of compare_laps.speed_series).
function speedSeries(chans,posNormName,S,a,b,n=400){
  const PN=chans.get(posNormName);
  if(!PN)return null;
  const len=b-a;const p=new Float64Array(len);
  for(let i=0;i<len;i++)p[i]=PN.vals[a+i];
  // unwrap lap crossings (pos drops by >0.5 means we crossed the line)
  for(let i=1;i<len;i++){if(p[i]-p[i-1]<-0.5){for(let j=i;j<len;j++)p[j]+=1;}}
  // enforce monotonic non-decreasing position (mirrors np.maximum.accumulate)
  for(let i=1;i<len;i++)if(p[i]<p[i-1])p[i]=p[i-1];
  const step=Math.max(1,Math.floor(len/n)); // integer step — typed arrays need int indices
  const pts=[];
  for(let i=0;i<len;i+=step)pts.push([Math.round(p[i]*1e5)/1e5,Math.round(S[a+i]*10)/10]);
  return pts;
}

// Compact text digest — attached to the LLM system prompt and copyable from the UI.
function buildDigest(report){
  const m=report.meta,L=[];
  L.push(`SRPH telemetry digest - ${m.track} | car ${m.car} | driver ${m.driver}`);
  L.push(`Session: ${m.date} ${m.time}${m.comment?` | comment: ${m.comment}`:''} | ${report.freq} Hz, ${m.n_channs} channels`);
  L.push('Laps (computed from Session Lap Count):');
  report.laps.forEach((l,i)=>{
    const bits=[`L${l.lap} ${fmtLap(l.dur)}`];
    if(isFinite(l.topSpeed))bits.push(`top ${l.topSpeed.toFixed(1)} km/h`);
    if(l.maxLatG>0.5)bits.push(`latG ${l.maxLatG.toFixed(2)}`);
    if(l.maxBrakeG>0.5)bits.push(`brakeG ${l.maxBrakeG.toFixed(2)}`);
    if(l.fuelUsed!=null)bits.push(`fuel -${l.fuelUsed.toFixed(2)} l`);
    L.push('  '+(i===report.bestIdx?'[best] ':'')+bits.join('  '));
  });
  if(report.bestZones.length){
    L.push(`Best-lap braking zones (lap ${report.laps[report.bestIdx].lap}):`);
    for(const z of report.bestZones)
      L.push(`- ${z.ref} | entry ${z.entry.toFixed(1)} km/h | decel ${z.decel.toFixed(2)} G | ${z.dur.toFixed(2)} s`);
  }
  if(report.matrix.rows.length){
    L.push('Entry speed by zone (km/h):');
    L.push(['zone',...report.matrix.cols.map(k=>'L'+k)].join('\t'));
    for(const r of report.matrix.rows)
      L.push([r.ref,...r.cells.map(c=>c==null?'-':c.toFixed(1))].join('\t'));
  }
  if(report.phases&&report.phases.rows.length){
    L.push('Corner phase speeds (km/h) [entry / v-min / exit]:');
    for(const r of report.phases.rows)
      L.push(`- ${r.ref} | `+r.cells.map((c,i)=>`L${report.phases.cols[i]}:${c?`${c.e.toFixed(0)}/${c.v.toFixed(0)}/${c.x!=null?c.x.toFixed(0):'-'}`:'-'}`).join('  '));
    L.push('Exit technique [steer° at full throttle / s brake-off to 50% throttle / coast gap s]:');
    for(const r of report.phases.rows)
      L.push(`- ${r.ref} | `+r.cells.map((c,i)=>`L${report.phases.cols[i]}:${c?`${Math.round(c.st!=null?c.st:0)}/${c.t5!=null?c.t5.toFixed(1):'-'}/${c.co!=null?c.co.toFixed(1):'-'}`:'-'}`).join('  '));
    L.push('Peak tire slip angle per corner (deg) [FL / FR / RL / RR]:');
    for(const r of report.phases.rows)
      L.push(`- ${r.ref} | `+r.cells.map((c,i)=>`L${report.phases.cols[i]}:${c&&c.sl?c.sl.map(v=>v.toFixed(1)).join('/'):'-'}`).join('  '));
  }
  if(report.setupScan){
    const ss=report.setupScan;
    L.push('Setup scan (beta - PROVISIONAL thresholds; flags are candidates to verify, not verdicts):');
    for(const s of ss.laps){
      if(s.dur_s<ss.min_lap_s)continue; // partial laps: indicators computed, flags not classified
      const pOut=s.pressure_outside_window.length?'pressure outside window: '+s.pressure_outside_window.join(' '):'pressures in 26.8-27.2 psi window';
      const us=s.steady_segments==null?'slip channels missing':(s.us_max_f_r_diff_deg==null?'no steady-state segments'
        :'steady segs '+s.steady_segments+', max F-R slip diff '+s.us_max_f_r_diff_deg.toFixed(2)+' deg'+(s.understeer_candidate?' - UNDERSTEER CANDIDATE (>1.0 deg)':''));
      const cs2=s.countersteer_events==null?'exit oversteer: no input data'
        :'counter-steer '+s.countersteer_events+' events, rear slip max '+(s.rear_slip_ratio_max_pct==null?'-':s.rear_slip_ratio_max_pct)+'%, throttle hesitations '+s.throttle_hesitation_events+(s.exit_oversteer_candidate?' - EXIT OVERSTEER CANDIDATE (>=2 counter-steer)':'');
      const brk4=s.braking_events==null?'braking: no input data'
        :'braking '+s.braking_events+' events, max steer reversals '+s.max_brake_steering_reversals+', wheel-speed gap '+(s.peak_decel_wheel_speed_gap_rad_s==null?'-':s.peak_decel_wheel_speed_gap_rad_s)+' rad/s'+((s.max_brake_steering_reversals>4||s.rear_lock_candidate)?' - BRAKING INSTABILITY CANDIDATE (reversals >4 or rear lock)':'');
      const bot=s.bottoming_travel_p95_by_wheel
        ?'bottoming travel p95 '+Object.values(s.bottoming_travel_p95_by_wheel).map(v=>v.toFixed(2)).join('/')+' G, vert G straight '+(s.max_vert_g_straight==null?'-':s.max_vert_g_straight.toFixed(2))+' G'+(s.bottoming_candidate?' - BOTTOMING CANDIDATE (p95 >=0.90 or vertG >=3.0)':'')
        :'bottoming: no travel data';
      const abs6=(s.abs_active_pct==null&&s.tc_active_pct==null)?'ABS/TC: no data'
        :'ABS '+(s.abs_active_pct==null?'-':s.abs_active_pct)+'% / '+(s.abs_events==null?'-':s.abs_events)+' events, TC '+(s.tc_active_pct==null?'-':s.tc_active_pct)+'% / '+(s.tc_events==null?'-':s.tc_events)+' events';
      L.push(`- L${s.lap}: core end ${s.tire_core_end_C.map(v=>v.toFixed(1)).join('/')} C (F-R ${(s.tire_F_minus_R_C>=0?'+':'')+s.tire_F_minus_R_C.toFixed(1)}), stint delta [${s.tire_stint_delta_C.map(v=>(v>=0?'+':'')+v.toFixed(1))}] C; ${pOut}; ${us}; ${cs2}; ${brk4}; ${bot}; ${abs6}`);
    }
  }
  return L.join('\n');
}


