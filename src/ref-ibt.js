/* ================= .ibt binary parsing — faithful port of analyze_ibt.py ================= */
// iRacing .ibt: header ints, then 144-byte var headers, then fixed-size records.
function ibtStr(dv, off, len){ // latin-1 decode, strip trailing NULs (mirrors parse_ibt)
  const b=new Uint8Array(len);
  for(let i=0;i<len;i++)b[i]=dv.getUint8(off+i);
  return new TextDecoder('latin1').decode(b).replace(/\x00+$/,'');
}
function ibtSessionInfo(dv, off, len){ // utf-8 with cp1252 fallback (mirrors parse_ibt)
  const b=new Uint8Array(len);
  for(let i=0;i<len;i++)b[i]=dv.getUint8(off+i);
  let end=len; while(end>0&&b[end-1]===0)end--;
  try{return new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(0,end));}
  catch(_){return new TextDecoder('windows-1252').decode(b.subarray(0,end));}
}
function parseIbt(ab){
  const dv=new DataView(ab);
  if(dv.byteLength<56)throw new Error('file too small to be an .ibt');
  const version=dv.getInt32(0,true), status=dv.getInt32(4,true), tickRate=dv.getInt32(8,true);
  const siLen=dv.getInt32(16,true), siOff=dv.getInt32(20,true);
  const numVars=dv.getInt32(24,true), varHdrOff=dv.getInt32(28,true), bufLen=dv.getInt32(36,true);
  const dataStart=dv.getInt32(52,true);
  if(!(numVars>0&&bufLen>0&&dataStart>=0))throw new Error('bad .ibt header');
  const nRec=Math.floor((dv.byteLength-dataStart)/bufLen);
  const sessionInfo=ibtSessionInfo(dv,siOff,siLen);
  const meta={version,status,tick_rate:tickRate,n_records:nRec,session_info:sessionInfo};
  const chans=new Map();
  for(let i=0;i<numVars;i++){
    const base=varHdrOff+i*144;
    const vtype=dv.getInt32(base,true), off=dv.getInt32(base+4,true), count=dv.getInt32(base+8,true);
    const name=ibtStr(dv,base+16,32), unit=ibtStr(dv,base+112,32);
    if(!name)continue;
    const vals=new Float64Array(nRec);
    for(let r=0;r<nRec;r++){
      const p=dataStart+r*bufLen+off; let v;
      // vtype is an index into ['c','?','i','I','f','d'] (same as analyze_ibt.VAR_TYPE_MAP)
      switch(vtype){
        case 0:v=dv.getInt8(p);break;          // 'c' int8
        case 1:v=dv.getUint8(p);break;         // '?' uint8
        case 2:v=dv.getInt32(p,true);break;   // 'i' int32
        case 3:v=dv.getUint32(p,true);break;  // 'I' uint32
        case 4:v=dv.getFloat32(p,true);break; // 'f' float32
        case 5:v=dv.getFloat64(p,true);break; // 'd' float64
        default:throw new Error('unknown var type code '+vtype+' in channel '+name);
      }
      vals[r]=v; // count>1 channels keep the first element, like Python unpack [0]
    }
    chans.set(name,{unit,count,vals});
  }
  return {meta,chans};
}


/* ---- .ibt analysis — faithful port of analyze_ibt.analyze() ---- */
function yamlGet(text,key){ // mirrors _yaml_get in analyze_ibt.py
  for(const line of String(text).split('\n')){
    const m=line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if(m&&m[1]===key){const v=m[2].trim();return (v.startsWith('"')||v.startsWith("'"))?v.slice(1,-1):v;}
  }
  return null;
}
function ibtNum(text,key){ // mirrors _num: float() with except -> None
  const v=yamlGet(text,key); if(v==null)return null;
  const s=String(v).trim(); if(!s)return null;
  const x=Number(s); return isFinite(x)?x:null;
}
function median64(a){ // mirrors np.median (even length = mean of the two middle values)
  const s=Float64Array.from(a).sort();
  if(!s.length)return 0;
  return s.length%2?s[s.length>>1]:(s[s.length/2-1]+s[s.length/2])/2;
}
function convSameMean(x,w){ // mirrors np.convolve(x, ones(w)/w, mode='same') — divide by w at edges too
  const N=x.length,o=(w-1)>>1,out=new Float64Array(N);
  for(let i=0;i<N;i++){
    const lo=Math.max(0,i+o-w+1),hi=Math.min(N-1,i+o);let s=0;
    for(let k=lo;k<=hi;k++)s+=x[k];
    out[i]=s/w;
  }
  return out;
}
function rms(x){if(!x.length)return 0;let s=0;for(const v of x)s+=v*v;return Math.sqrt(s/x.length);}

// Parse result {meta,chans:Map<name,{unit,vals:Float64Array}>} -> analysis dict (same keys as Python `a`).
function analyzeIbt(meta,chans){
  const get=n=>{const c=chans.get(n);if(!c)throw new Error('missing channel in .ibt: '+n);return c.vals;};
  const t=get('SessionTime'), n=t.length, spanS=(t[n-1]-t[0])||1e-6;
  const lap=get('Lap'),pct=get('LapDistPct'),spd=get('Speed'),rpm=get('RPM'),gear=get('Gear'),
        thr=get('Throttle'),brk=get('Brake'),steer=get('SteeringWheelAngle'),
        lat=get('Lat'),lon=get('Lon'),alt=get('Alt'),fuel=get('FuelLevelPct'),
        surf=get('PlayerTrackSurface'),ontrack=get('IsOnTrackCar'),inc=get('PlayerIncidents');
  const a={meta,span_s:spanS,n,t,spd,thr,brk,gear,rpm,pct,surf,pct_first:pct[0]*100,pct_last:pct[n-1]*100};
  // session context from the embedded YAML (mirrors analyze_ibt.analyze)
  const si=meta.session_info;
  a.track_name=yamlGet(si,'TrackName')||'';
  a.track_display=yamlGet(si,'TrackDisplayName')||a.track_name||'unknown track';
  a.config=yamlGet(si,'TrackConfigName')||'';
  const tl=ibtNum(si,'TrackLength');a.track_len_m=(tl!=null)?tl*1000:null;
  a.num_turns=ibtNum(si,'TrackNumTurns');
  a.session_type=yamlGet(si,'SessionType')||'';
  a.surface_temp=yamlGet(si,'TrackSurfaceTemp');a.air_temp=yamlGet(si,'TrackAirTemp');
  a.humidity=yamlGet(si,'TrackRelativeHumidity');a.wind=yamlGet(si,'WindSpeed');
  // moving phase + top speed
  let i0=-1,i1=-1;for(let i=0;i<n;i++){if(spd[i]>5){if(i0<0)i0=i;i1=i;}}
  a.run_i0=i0;a.run_i1=i1;
  if(i0>=0){let top=-Infinity,ti=i0;for(let i=i0;i<=i1;i++)if(spd[i]>top){top=spd[i];ti=i;}
    a.top_speed_kmh=top*3.6;a.pct_top=pct[ti]*100;}
  else{a.top_speed_kmh=null;a.pct_top=null;}
  // off-track detection (moving + surface != on-track)
  let offI=null;for(let i=0;i<n;i++){if(spd[i]>5&&surf[i]===0){offI=i;break;}}
  a.offtrack_i=offI;let onAgain=null;
  if(offI!=null)for(let i=offI+1;i<n;i++)if(spd[i]>5&&surf[i]!==0){onAgain=i;break;}
  a.ontrack_again_i=onAgain;
  // incident spikes (rising edges, merged when <1 s apart, max value kept)
  const raw=[];
  for(let i=1;i<n;i++){
    if(inc[i]!==0&&inc[i-1]===0){let j=i,mx=0;while(j<n&&inc[j]!==0){if(inc[j]>mx)mx=inc[j];j++;}raw.push([t[i],mx]);}
  }
  const merged=[];
  for(const [tt,v] of raw){
    if(merged.length&&tt-merged[merged.length-1][0]<1.0)merged[merged.length-1][1]=Math.max(merged[merged.length-1][1],v);
    else merged.push([tt,v]);
  }
  a.incident_spikes=merged;
  // GPS -> local equirectangular metres, heading, turn rate (mirrors analyze_ibt.analyze)
  let lat0=0,lon0=0;for(let i=0;i<n;i++){lat0+=lat[i];lon0+=lon[i];}lat0/=n;lon0/=n;
  const kx=Math.cos(lat0*Math.PI/180)*111320,ky=110574;
  const x=new Float64Array(n),y=new Float64Array(n);
  for(let i=0;i<n;i++){x[i]=(lon[i]-lon0)*kx;y[i]=(lat[i]-lat0)*ky;}
  a.map_x=x;a.map_y=y; // stored for the track map (mirrors analyze_ibt.a['map_x']/a['map_y'])
  const dt=new Float64Array(n-1);for(let i=0;i<n-1;i++)dt[i]=Math.max(t[i+1]-t[i],1e-6);
  const h=new Float64Array(n);
  for(let i=1;i<n;i++)h[i]=Math.atan2(y[i]-y[i-1],x[i]-x[i-1]);
  // np.unwrap: keep the cumulative angle continuous
  for(let i=1;i<n;i++){let v=h[i];while(v-h[i-1]>Math.PI)v-=2*Math.PI;while(v-h[i-1]<-Math.PI)v+=2*Math.PI;h[i]=v;}
  const tr=new Float64Array(n);for(let i=1;i<n;i++)tr[i]=(h[i]-h[i-1])*180/Math.PI/dt[i-1];
  const w=Math.max(3,Math.round(0.3*meta.tick_rate));
  const trS=convSameMean(tr,w);
  // corner/heading events (on-track samples only; per-sample cap rejects GPS glitches)
  const validEnd=(a.offtrack_i!=null)?a.offtrack_i:n;
  const segs=[];let inC=false,c0=0;
  for(let i=0;i<validEnd;i++){
    const hot=Math.abs(trS[i])>8.0&&Math.abs(trS[i])<900.0&&spd[i]>15.0;
    if(hot&&!inC){inC=true;c0=i;}
    else if(!hot&&inC){inC=false;segs.push([c0,i-1]);}
  }
  if(inC)segs.push([c0,validEnd-1]);
  a.corners=[];
  for(const [s,e] of segs){
    let dhead=0;for(let k=s;k<=e;k++)dhead+=trS[k]*dt[k];
    const dur=t[e]-t[s];
    if(Math.abs(dhead)>=15.0&&dur>=0.2)
      a.corners.push([pct[s]*100,pct[e]*100,spd[s]*3.6,dhead,dhead<0?'left':'right']);
  }
  // smoothness over the on-track moving phase (exclude off-track stretch)
  const s0=a.run_i0,s1=a.run_i1;
  let ote=(a.offtrack_i!=null&&a.offtrack_i>s0)?a.offtrack_i:s1+1;
  const m=ote-s0;
  const thrS=new Float64Array(m),tS=new Float64Array(m),steerS=new Float64Array(m),vS=new Float64Array(m);
  for(let i=0;i<m;i++){thrS[i]=thr[s0+i]*100;tS[i]=t[s0+i];steerS[i]=steer[s0+i];vS[i]=spd[s0+i];}
  const dThr=new Float64Array(Math.max(0,m-1)),dSteer=new Float64Array(Math.max(0,m-1)),decel=new Float64Array(Math.max(0,m-1));
  for(let i=0;i<m-1;i++){const dd=Math.max(tS[i+1]-tS[i],1e-6);dThr[i]=(thrS[i+1]-thrS[i])/dd;dSteer[i]=(steerS[i+1]-steerS[i])/dd;decel[i]=-(vS[i+1]-vS[i])/dd;}
  const jerk=new Float64Array(Math.max(0,m-2));
  for(let i=0;i<m-2;i++)jerk[i]=(dThr[i+1]-dThr[i])/Math.max(tS[i+2]-tS[i+1],1e-6);
  let maxDecel=0;for(const v of decel)if(v>maxDecel)maxDecel=v;
  a.smooth={thr_rate_rms:rms(dThr),thr_jerk_rms:rms(jerk),steer_rate_rms:rms(dSteer),max_decel:maxDecel};
  // laps present in the window (first sample per lap value, ordered by appearance)
  const firstT=new Map();for(let i=0;i<n;i++)if(!firstT.has(lap[i]))firstT.set(lap[i],t[i]);
  const order=[...firstT.keys()],dtMed=median64(dt);
  a.laps=[];
  for(let j=0;j<order.length;j++){const L2=order[j];a.laps.push([L2,(j+1<order.length?firstT.get(order[j+1]):t[n-1]+dtMed)-firstT.get(L2)]);}
  // optional session-delta channels (present in most .ibt builds) — mirrors analyze_ibt.analyze
  a.LapBestLapTime=chans.has('LapBestLapTime')?get('LapBestLapTime')[0]:null;
  a.LapLastLapTime=chans.has('LapLastLapTime')?get('LapLastLapTime')[0]:null;
  if(chans.has('LapDeltaToSessionBestLap'))a.LapDeltaToSessionBestLap=get('LapDeltaToSessionBestLap');
  if(chans.has('LapDeltaToOptimalLap'))a.LapDeltaToOptimalLap=get('LapDeltaToOptimalLap');
  // downsampleed series for charts (~240 pts) — mirrors analyze_ibt.analyze chart dict
  const step=Math.max(1,Math.floor(n/240));
  a.chart={t:[],spd_kmh:[],pct:[]};
  for(let i=0;i<n;i+=step){a.chart.t.push(t[i]);a.chart.spd_kmh.push(spd[i]*3.6);a.chart.pct.push(pct[i]*100);}
  if(a.LapDeltaToSessionBestLap){const db=a.LapDeltaToSessionBestLap;a.chart.delta_best=[];for(let i=0;i<n;i+=step)a.chart.delta_best.push(db[i]);}
  return a;
}


/* ---- .ibt digest — faithful port of analyze_ibt.build_digest() ---- */
// analysis dict (from analyzeIbt) + parse channels -> {meta, lines:[{k,v}], sections:[[h,[rows]]]}
const chansThr=a=>a.thr;
const chansGear=a=>a.gear;
const chansRpm=a=>a.rpm;
function buildIbtDigest(a,chans){
  const meta=a.meta, L=[];
  const push=(k,v)=>L.push({k,v});
  // session context from the embedded YAML
  push('track',a.track_display);
  if(a.config)push('config',a.config);
  if(a.num_turns!=null)push('turns',String(a.num_turns));
  if(a.session_type)push('session',a.session_type);
  const env=[];
  if(a.surface_temp!=null)env.push('surface '+a.surface_temp+'°C');
  if(a.air_temp!=null)env.push('air '+a.air_temp+'°C');
  if(a.humidity!=null)env.push('RH '+a.humidity+'%');
  if(a.wind!=null)env.push('wind '+a.wind);
  if(env.length)push('environment',env.join(', '));
  // window + top speed
  push('window',fmtT(a.t[0])+' → '+fmtT(a.t[a.n-1])+' ('+a.span_s.toFixed(1)+' s, '+meta.tick_rate+' Hz, '+meta.n_records.toLocaleString()+' records)');
  if(a.top_speed_kmh!=null)push('top speed',a.top_speed_kmh.toFixed(1)+' km/h at lap '+(a.pct_top/100).toFixed(2));
  // off-track + incidents (mirrors build_digest)
  const off=a.offtrack_i;
  if(off!=null){
    let msg='off track from '+fmtT(a.t[off]);
    if(a.ontrack_again_i!=null)msg+=' → back on track at '+fmtT(a.t[a.ontrack_again_i]);
    push('off-track',msg);
  } else push('off-track','none detected');
  const inc=a.incident_spikes;
  if(inc.length){
    let msg=inc.map(([tt,v])=>fmtT(tt)+' (code '+v+')').join(', ');
    if(off!=null&&a.ontrack_again_i==null)msg+=' — consistent with the off-track stretch';
    push('incidents',msg);
  } else push('incidents','none');
  // laps present in this window
  const laps=a.laps;
  if(laps.length){
    let msg='lap '+laps[0][0]+' ('+laps[0][1].toFixed(2)+' s';
    for(const [L2,d] of laps.slice(1))msg+=', lap '+L2+' ('+d.toFixed(2)+' s)';
    push('laps in window',msg+')');
  } else push('laps in window','single lap segment (no lap boundary inside the window)');
  // session-delta channels, if present
  const best=a.LapBestLapTime,last=a.LapLastLapTime;
  if(best!=null&&last!=null){
    let msg='best '+fmtT(best)+' / last '+fmtT(last);
    if(Math.abs(best-last)>0.05)msg+=' (Δ '+(last-best).toFixed(2)+' s)';
    push('session delta',msg);
  }
  // smoothness over the on-track moving phase
  const sm=a.smooth;
  push('smoothness','throttle rate RMS '+sm.thr_rate_rms.toFixed(1)+' %/s · jerk RMS '+sm.thr_jerk_rms.toFixed(0)+' %/s² · steering rate RMS '+sm.steer_rate_rms.toFixed(1)+' °/s · peak decel '+sm.max_decel.toFixed(2)+' m/s²');
  // heading-change events (corners) — same thresholds as analyze_ibt.analyze
  const corners=a.corners;
  if(corners.length){
    let msg=corners.map(([p0,p1,v,dh,dir])=>
      'lap '+(p0/100).toFixed(2)+'→'+(p1/100).toFixed(2)+': '+Math.abs(dh).toFixed(0)+'° '+dir+' @ entry '+v.toFixed(0)+' km/h').join(' · ');
    push('heading events',msg);
  } else push('heading events','none above threshold');
  // sections: speed / throttle+brake / gear+rpm (mirrors build_digest)
  const t=a.t,spd=a.spd,thr=chansThr(a),brk=a.brk,gear=chansGear(a),rpm=chansRpm(a);
  const rows=[];
  for(let i=0;i<a.n;i+=10){
    rows.push([fmtT(t[i]),(spd[i]*3.6).toFixed(1),(thr[i]*100).toFixed(0),(brk[i]*100).toFixed(0),String(gear[i]),rpm[i].toFixed(0)]);
  }
  const sections=[['speed / throttle / brake (every 10th sample) — km/h, %, %',rows]];
  return {meta:{...meta,track:a.track_display},lines:L,sections};
}
// Flatten the digest object into plain text for state.digest / LLM context.
function buildIbtDigestText(a,chans){
  const d=buildIbtDigest(a,chans),L=[];
  L.push(`SRPH .ibt digest - ${d.meta.track}`);
  for(const {k,v} of d.lines)L.push(`${k}: ${v}`);
  for(const [hdr,rows] of d.sections){
    L.push(hdr+':');
    for(const row of rows)L.push('  '+row.join('\t'));
  }
  return L.join('\n');
}


