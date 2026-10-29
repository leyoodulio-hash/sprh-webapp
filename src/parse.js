
'use strict';
// Simple $ shorthand for document.getElementById
function $(id){return document.getElementById(id);}
const $all=(sel)=>document.querySelectorAll(sel);
/* ================= .ld binary parsing — faithful port of parse_telemetry_ld.py ================= */
// [type, size] parts; little-endian. HEAD total = 1762 bytes, CHAN record = 124 bytes.
const HEAD_PARTS=[['u32',4],['pad',4],['u32',4],['u32',4],['pad',20],['u32',4],['pad',24],
  ['u16',2],['u16',2],['u16',2],['u32',4],['str',8],['u16',2],['u16',2],['u32',4],['pad',4],
  ['str',16],['pad',16],['str',16],['pad',16],['str',64],['str',64],['pad',64],['str',64],
  ['pad',64],['pad',1024],['u32',4],['pad',66],['str',64],['pad',126]];
const CHAN_PARTS=[['u32',4],['u32',4],['u32',4],['u32',4],['u16',2],
  ['u16',2],['u16',2],['u16',2],['i16',2],['i16',2],['i16',2],['i16',2],
  ['str',32],['str',8],['str',12],['pad',40]];

function partsSize(parts){return parts.reduce((s,p)=>s+p[1],0);}
const HEAD_SIZE=partsSize(HEAD_PARTS), CHAN_SIZE=partsSize(CHAN_PARTS);

function readStr(dv, off, len){
  const out=[];
  for(let i=0;i<len;i++){const b=dv.getUint8(off+i); if(b===0)break; out.push(b);}
  return new TextDecoder('latin1').decode(new Uint8Array(out)).replace(/\s+$/,'');
}

function f16(v){ // IEEE 754 half -> float
  const sign=(v&0x8000)?-1:1, exp=(v>>>10)&0x1F, frac=v&0x3FF;
  if(exp===0) return sign*frac*Math.pow(2,-14); // subnormal: 2^(1-bias) = 2^(-14)
  if(exp===31) return frac?NaN:sign*Infinity;
  return sign*Math.pow(2,exp-15)*(1+frac/1024);
}

function mapDtype(dtypeA, dtype){ // mirrors _map_dtype in parse_telemetry_ld.py
  if(dtypeA===7) return dtype===2?'f16':dtype===4?'f32':null;
  if(dtypeA===0||dtypeA===3||dtypeA===5) return dtype===2?'i16':dtype===4?'i32':null;
  if(dtypeA===8&&dtype===8) return 'f64';
  return null;
}

function median(a){const s=[...a].sort((x,y)=>x-y);return s.length?s[s.length>>1]:0;}

// Parse a .ld ArrayBuffer. Returns {meta, chans: Map<name,{unit,freq,vals:Float32Array}>}.
function parseLd(ab){
  const dv=new DataView(ab);
  const F=[]; let off=0;
  for(const [t,s] of HEAD_PARTS){
    if(t==='pad'){off+=s;continue;}
    if(t==='u16')F.push(dv.getUint16(off,true));
    else if(t==='u32')F.push(dv.getUint32(off,true));
    else F.push(readStr(dv,off,s));
    off+=s;
  }
  const [marker,metaPtr,dataPtr,eventPtr,h1,h2,h3,serial,devtype,ver,unk,nChanns,
        date,time_,driver,vehicleid,venue,prolog,comment]=F;
  if(marker!==0x40) throw new Error('not a MoTeC .ld file (bad header marker)');

  const meta={driver,car:vehicleid,track:venue,date,time:time_,comment,n_channs:nChanns};
  const chans=new Map();
  let cur=metaPtr, guard=0;
  while(cur&&guard++<1000){
    const C=[]; let o2=cur;
    for(const [t,s] of CHAN_PARTS){
      if(t==='pad'){o2+=s;continue;}
      if(t==='u32')C.push(dv.getUint32(o2,true));
      else if(t==='i16')C.push(dv.getInt16(o2,true));
      else if(t==='u16')C.push(dv.getUint16(o2,true));
      else C.push(readStr(dv,o2,s));
      o2+=s;
    }
    const [prev,nxt,dptr,nData,res,dtypeA,dtype,freq,shift,mul,scale,dec,name,,unit]=C;
    const dt=mapDtype(dtypeA,dtype);
    if(dt&&nData>0){
      const vals=new Float32Array(nData);
      for(let i=0;i<nData;i++){
        let r;
        if(dt==='i16')r=dv.getInt16(dptr+i*2,true);
        else if(dt==='i32')r=dv.getInt32(dptr+i*4,true);
        else if(dt==='f32')r=dv.getFloat32(dptr+i*4,true);
        else if(dt==='f64')r=dv.getFloat64(dptr+i*8,true);
        else r=f16(dv.getUint16(dptr+i*2,true));
        vals[i]=((scale?r/scale:r)*Math.pow(10,-dec)+shift)*mul; // same formula as Python _load
      }
      chans.set(name,{unit,freq,vals}); // last block wins - mirrors parse_all_channels dict comprehension
    }
    cur=nxt;
  }
  // Resample every channel onto one common grid at the fastest rate present (port of
  // _resample_to_common_grid in parse_telemetry_ld.py): step interpolation for counter
  // channels, linear otherwise. Without this, mixed-rate files (e.g. Car Pos Norm @10 Hz
  // with speed @30 Hz) index out of range downstream and zone positions come out NaN.
  {
    // Car Pos Norm is step-interpolated too: it wraps 1.0 -> 0.0 at S/F, and linear
    // interpolation smears that wrap into a ramp, corrupting pos-based analysis.
    const STEP=new Set(['Session Lap Count','Lap Number','Gear','Car Pos Norm']);
    let fMax=0,dur=0;
    for(const c of chans.values()){
      if(c.freq>fMax)fMax=c.freq;
      if(c.freq&&c.vals.length/c.freq>dur)dur=c.vals.length/c.freq;
    }
    const nOut=Math.round(dur*fMax);
    for(const [cname,c] of chans){ // key = channel name (value objects carry no .name)
      const n=c.vals.length,f=c.freq;
      if(!f||n===nOut)continue;
      const out=new Float32Array(nOut);
      if(STEP.has(cname)){
        // step: last sample with source time <= t (np.searchsorted side='right' - 1, clipped)
        for(let i=0;i<nOut;i++){
          let j=Math.floor((i/fMax)*f+1e-9);
          if(j<0)j=0;else if(j>n-1)j=n-1;
          out[i]=c.vals[j];
        }
      } else {
        // linear (np.interp: clamps at both ends)
        for(let i=0;i<nOut;i++){
          const x=(i/fMax)*f;
          if(x>=n-1){out[i]=c.vals[n-1];continue;}
          const j=Math.floor(x),fr=x-j;
          out[i]=c.vals[j]*(1-fr)+c.vals[j+1]*fr;
        }
      }
      c.vals=out;c.freq=fMax;
    }
  }
  meta.freq_hz=median([...chans.values()].map(c=>c.freq).filter(f=>f>0));
  // Normalize MoTeC layout variants (mirrors _normalize_channel_names in parse_telemetry_ld.py):
  // some ACC builds log 'Lap Number' instead of 'Session Lap Count'.
  if(!chans.has('Session Lap Count')&&chans.has('Lap Number')){
    const src=chans.get('Lap Number');
    chans.set('Session Lap Count',{unit:src.unit,freq:src.freq,vals:src.vals}); // shared read-only vals
  }
  return {meta,chans};
}

/* ================= analysis — ports of compare_laps.py logic ================= */
// Zone tables keyed by normalized track name (mirrors TRACK_ZONES in compare_laps.py).
