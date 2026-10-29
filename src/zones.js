const TRACK_ZONES={
  suzuka:[
    [0.00,0.15,'Start Straight / T1-T2'],
    [0.15,0.35,'The Esses (T3-T6)'],
    [0.35,0.45,'Dunlop & Degner approach'],
    [0.45,0.60,'Degner Curves & Hairpin'],
    [0.60,0.75,'Spoon Curve'],
    [0.75,0.90,'Back Straight / 130R'],
    [0.90,1.01,'Casio Triangle Chicane'],
  ],
};
function trackKey(track){let t=(track||'').toLowerCase().trim();if(t.length>3&&t[2]==='_')t=t.slice(3);return t.split('-')[0];} // mirrors _norm_track in compare_laps.py ('rt_suzuka-suzukagp' -> 'suzuka', 'ks_nordschleife-...' -> 'nordschleife')
function zonesFor(track){return TRACK_ZONES[trackKey(track)]||null;}
function cornerName(pos,zones){for(const [lo,hi,name] of (zones||[])){if(lo<=pos&&pos<hi)return name;}return null;}
// Curated nearest-neighbour join against the embedded CORNERS block: accept the closest
// corners.json entry only when within min(2.5% lap, 40% of gap to second-nearest) — calibrated on
// Daryl's Suzuka stint 12 (clear matches ≤93 m; Hairpin/110R-boundary and Dunlop/Degner-1
// clusters sit in genuine ambiguity and correctly fall back to the coarse section name).
function curatedCorner(track,pos){const list=(typeof CORNERS!=='undefined')?CORNERS[trackKey(track)]:null;if(!list||list.length<2)return null;let e1=null,d1=2,d2=2;for(const e of list){const p=e.lap_percentage/100;let d=Math.abs(p-pos);d=Math.min(d,1-d);if(d<d1){d2=d1;d1=d;e1=e;}else if(d<d2)d2=d;}return d1<=Math.min(0.025,0.4*d2)?e1:null;}
function zoneNameOf(pos,zones,track){const c=curatedCorner(track,pos);return c?c.name:cornerName(pos,zones);}
function zoneRef(pos,zones,num,track){const n=zoneNameOf(pos,zones,track);return n?`${n} @${(pos*100).toFixed(1)}%`:`Zone ${num}`;}

// Full start-to-finish laps only (mirrors get_segs): keyed by Session Lap Count value.
function getSegs(chans,freq){
  const lc=chans.get('Session Lap Count'); if(!lc)return {};
  const laps=lc.vals, n=laps.length, bounds=[0];
  for(let i=1;i<n;i++)if(laps[i]!==laps[i-1])bounds.push(i);
  bounds.push(n);
  const segs={};
  const posn=chans.get('Car Pos Norm');
  for(let i=0;i<bounds.length-1;i++){
    let a=bounds[i],b=bounds[i+1];
    // Drop leading pre-wrap samples: on mixed-rate files (step-interpolated Car
    // Pos Norm) the first grid sample(s) of a lap can still hold the previous
    // lap's ~1.0 value because the counter increments between pos samples.
    if(posn&&b-a>2){while(a<b-1&&posn.vals[a]>0.5)a++;}
    if((b-a)/freq>60)segs[Math.round(laps[a])]=[a,b];
  }
  return segs;
}

// Braking events within sample range [a,b) — mirrors braking_events in compare_laps.py.
function brakingEvents(chans,a,b,freq){
  const need=['Brake Pos','Ground Speed','CG Accel Longitudinal','Car Pos Norm','Throttle Pos','Steering Angle'];
  for(const c of need)if(!chans.has(c))return [];
  const B=chans.get('Brake Pos').vals.subarray(a,b),
        S=chans.get('Ground Speed').vals.subarray(a,b),
        L=chans.get('CG Accel Longitudinal').vals.subarray(a,b),
        P=chans.get('Car Pos Norm').vals.subarray(a,b),
        T=chans.get('Throttle Pos').vals.subarray(a,b),
        ST=chans.get('Steering Angle').vals.subarray(a,b),
        SF=chans.get('Tire Slip Angle FL'),SRF=chans.get('Tire Slip Angle FR'),
        SRL=chans.get('Tire Slip Angle RL'),SRR=chans.get('Tire Slip Angle RR');
  const n=b-a, events=[], wOnset=Math.max(1,Math.round(0.3*freq));
  let i=0;
  while(i<n){
    if(B[i]>=15){
      let j=i; while(j<n&&B[j]>=15)j++;
      let kEnd=j; while(kEnd<n&&B[kEnd]>=5)kEnd++;
      if(j-i>=4){ // >= 0.2 s of braking
        const e=kEnd;
        let coast=null;
        for(let k=e;k<Math.min(n,e+8*freq);k++){
          if(T[k]>15&&B[k]<5){let dp=P[k]-P[e]; if(dp<-0.5)dp+=1; coast=[(k-e)/freq,dp]; break;}
        }
        let thrOn=null,tIdx=null;
        for(let k=e;k<Math.min(n,e+8*freq);k++){
          if(B[k]<10&&T[k]>80){thrOn=[S[k],P[k],ST[k]]; tIdx=k; break;}
        }
        let thr50=null;
        for(let k=e;k<Math.min(n,e+8*freq);k++){if(T[k]>=50&&B[k]<5){thr50=(k-e)/freq;break;}} // s from brake-off to >=50% throttle
        const i2=Math.min(i+wOnset,kEnd);
        const onset=i2>i?((B[i2]-B[i])/((i2-i)/freq)):0; // %/s over first ~300 ms
        let btin=null;
        for(let t=i;t<kEnd;t++){if(Math.abs(ST[t])>15){btin=B[t];break;}}
        let minG=Infinity,peakB=0; for(let t=i;t<kEnd;t++){if(L[t]<minG)minG=L[t];if(B[t]>peakB)peakB=B[t];}
        const hi=tIdx!==null?tIdx:kEnd;let vm=Infinity,vmAt=null,slip=null;
        for(let t=i;t<hi&&t<n;t++){if(S[t]<vm){vm=S[t];vmAt=t;}
          if(SF&&SRF&&SRL&&SRR){if(!slip)slip=[0,0,0,0];const a1=Math.abs(SF.vals[a+t]),a2=Math.abs(SRF.vals[a+t]),a3=Math.abs(SRL.vals[a+t]),a4=Math.abs(SRR.vals[a+t]);
            if(a1>slip[0])slip[0]=a1;if(a2>slip[1])slip[1]=a2;if(a3>slip[2])slip[2]=a3;if(a4>slip[3])slip[3]=a4;}} // v-min + peak |slip| window: onset -> throttle-on
        events.push({pos:P[i],entry:S[Math.max(0,i-2)],decel:-minG,dur:(kEnd-i)/freq,thrOn,coast,onset,btin,vmin:vm,vminPos:(vmAt!=null)?P[vmAt]:null,vmAt:vmAt,thr50,slip,i:i,peakB:peakB}); // i = onset sample (rel. to a), peakB = max Brake Pos % during the event; vminPos/vmAt = normalized lap pos / raw index of v-min (apex point)
      }
      i=kEnd;
    }else i++;
  }
  return events;
}
// Cluster per-lap events into corners — mirrors cluster in compare_laps.py.
function cluster(events){
  const corners=[];
  for(const ev of [...events].sort((x,y)=>x.pos-y.pos)){
    if(corners.length&&Math.abs(ev.pos-corners[corners.length-1]._sp/corners[corners.length-1].n)<0.025){
      const c=corners[corners.length-1];
      c.n++;c._sp+=ev.pos;c._se+=ev.entry;c._sd+=ev.decel;c._st+=ev.dur;
    }else{
      corners.push({n:1,_sp:ev.pos,_se:ev.entry,_sd:ev.decel,_st:ev.dur});
    }
    const c=corners[corners.length-1];
    if(ev.thrOn){c._tn=(c._tn||0)+1;c._tse=(c._tse||0)+ev.thrOn[0];c._tsp=(c._tsp||0)+ev.thrOn[1];c._tsr=(c._tsr||0)+ev.thrOn[2];}
    if(ev.coast){c._cn=(c._cn||0)+1;c._ct=(c._ct||0)+ev.coast[0];c._cd=(c._cd||0)+ev.coast[1];}
    if(ev.thr50!=null){c._t5n=(c._t5n||0)+1;c._t5s=(c._t5s||0)+ev.thr50;}
    if(ev.slip)for(let j=0;j<4;j++){const kk=['_sfl','_sfr','_srl','_srr'][j];c[kk]=Math.max(c[kk]||0,ev.slip[j]);} // peak, not average
    if(ev.btin!=null){c._bn=(c._bn||0)+1;c._bs=(c._bs||0)+ev.btin;}
    c._vm=(c._vm||0)+ev.vmin;
    c._on=(c._on||0)+ev.onset;
  }
  // full field set mirrors compare_laps.cluster: thr_on (speed,pos,steer), coast (s,m), brk_turnin
  return corners.map(c=>{
    const row={pos:c._sp/c.n,entry:c._se/c.n,decel:c._sd/c.n,dur:c._st/c.n,n:c.n,onset:(c._on||0)/c.n,vmin:c._vm/c.n};
    row.thrOn=c._tn?[c._tse/c._tn,c._tsp/c._tn,c._tsr/c._tn]:null;
    row.coast=c._cn?[c._ct/c._cn,c._cd/c._cn]:null;
    row.thr50=c._t5n?c._t5s/c._t5n:null;
    row.slip=(c._sfl!=null)?[c._sfl,c._sfr,c._srl,c._srr]:null;
    row.btin=c._bn?c._bs/c._bn:null;
    return row;
  });
}

// Apex (v-min) points of a lap's braking events, negated into the map frame.
// cc = corner context {chans,a,b,freq}; returns [{x,y,pos,v}] (pos = normalized lap pos of onset).
function apexPointsFor(cc){
  if(cc&&cc.preset)return cc.pkgLap.apex.slice(); // precomputed v-min apex points from the embedded package
  if(!cc||!cc.chans)return[];
  const CX=cc.chans.get('Car Coord X'),CY=cc.chans.get('Car Coord Y');if(!CX||!CY)return[];
  const evs=brakingEvents(cc.chans,cc.a,cc.b,(cc.freq||20));
  const out=[];
  for(const ev of evs){if(ev.vmAt==null)continue;out.push({x:Math.round(-CX.vals[cc.a+ev.vmAt]*100)/100,y:Math.round(-CY.vals[cc.a+ev.vmAt]*100)/100,pos:ev.pos,v:ev.vmin});}
  return out;
}
// Same, resolved from a report + lap index via the session's segment table (single-session map).
function apexPointsForLap(r,lapIdx){
  if(lapIdx==null||!r||!r.laps||!r.laps[lapIdx])return null;
  const f=state.files[state.currentFileIdx];if(!f||!f.parsed||!f.parsed.chans)return null;
  const chans=f.parsed.chans;
  const freq=(r&&r.freq)||20.0;
  const segs=getSegs(chans,freq);
  const keys=Object.keys(segs).map(Number).sort((a,b)=>a-b);
  const keyIdx=keys.indexOf(r.laps[lapIdx].lap);
  if(keyIdx<0)return null;
  const [a,b]=segs[keys[keyIdx]];
  const pts=apexPointsFor({chans,a,b,freq});
  return pts.length?pts:null;
}
// Track ribbon from user-dropped boundary CSVs: dark asphalt fill + crisp edge + faint dashed
// centerline. Shared by the single-session map and the cross-session pedal map.
function drawTrackRibbon(c,X,Y,L,R){
  if(!L||!R||!L.length||!R.length)return;
  const poly=()=>{c.beginPath();let st=false;
    for(let i=0;i<L.length;i++){const p=L[i];if(!isFinite(p[0])||!isFinite(p[1]))continue;const x=X(p[0]),y=Y(p[1]);st?c.lineTo(x,y):c.moveTo(x,y);st=true;}
    for(let i=R.length-1;i>=0;i--){const p=R[i];if(!isFinite(p[0])||!isFinite(p[1]))continue;c.lineTo(X(p[0]),Y(p[1]));}
    c.closePath();};
  c.save();c.lineJoin='round';c.lineCap='round';
  poly();c.fillStyle='rgba(27,34,44,0.92)';c.fill();          // asphalt surface
  poly();c.strokeStyle='rgba(130,190,255,0.75)';c.lineWidth=2.5;c.stroke(); // crisp edge
  c.setLineDash([7,11]);c.strokeStyle='rgba(230,237,243,0.16)';c.lineWidth=1.5; // faint centerline
  c.beginPath();let st=false;const m=Math.min(L.length,R.length);
  for(let i=0;i<m;i++){if(!isFinite(L[i][0])||!isFinite(R[i][0]))continue;const x=(X(L[i][0])+X(R[i][0]))/2,y=(Y(L[i][1])+Y(R[i][1]))/2;st?c.lineTo(x,y):c.moveTo(x,y);st=true;}
  c.stroke();c.setLineDash([]);c.restore();
}
