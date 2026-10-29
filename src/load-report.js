
function presetEmbeddedFor(dir){ // bundled data for a resolved dir (works under file://)
  const key=String(dir||'').replace(PRESET_BASE+'/','');
  return (typeof PRESET_BOUNDS!=='undefined'&&PRESET_BOUNDS[key])?PRESET_BOUNDS[key]:null;
}
function presetEmbeddedKeyByCode(code){ // layout-less meta: unique bundled key under this code, no fetch needed
  const ks=Object.keys(PRESET_BOUNDS).filter(k=>k===code||k.indexOf(code+'/')===0);
  return ks.length===1?ks[0]:null;
}
function presetDirsFor(track){
  const parts=String(track||'').split('-');
  if(parts.length>=2)return[`${PRESET_BASE}/${parts[0]}/${parts.slice(1).join('/')}`];
  return[]; // no layout segment -> manifest lookup below
}
async function presetDirFromManifest(code){
  try{
    const r=await fetch(`${PRESET_BASE}/manifest.json`);if(!r.ok)return null;
    const m=await r.json();const arr=m&&m[code];
    return(arr&&arr.length)?`${PRESET_BASE}/${code}/${arr[0]}`:null; // first entry = default layout, deterministic
  }catch(e){return null;}
}
async function loadPresetBounds(track){
  let dir=null;
  const d=presetDirsFor(track);if(d.length)dir=d[0];
  else{const code=String(track||'').split('-')[0];
    if(code){const ek=presetEmbeddedKeyByCode(code);if(ek)dir=PRESET_BASE+'/'+ek;else dir=await presetDirFromManifest(code);}}
  if(!dir)return false;
  if(state.bounds&&state.bounds.src==='preset:'+dir)return true; // already loaded for this track
  const emb=presetEmbeddedFor(dir);
  if(emb){ // bundled data (works under file://) - both sides present by construction, no pair fetch needed
    state.bounds={left:emb.l,right:emb.r,src:'preset:'+dir};
    renderLoadedFiles();
    const rep=state.report;if(rep&&typeof drawTrackMapSel==='function')drawTrackMapSel(rep,-1);
    return true;
  }
  let L=null,R=null;
  try{
    const [rl,rr]=await Promise.all([fetch(dir+'/side_l.csv'),fetch(dir+'/side_r.csv')]);
    if(rl.ok&&rr.ok){L=parseBoundaryCsv(await rl.text());R=parseBoundaryCsv(await rr.text());}
  }catch(e){/* no preset available (file://, 404) - manual drop still works */}
  if(!L||!R||L.length<2||R.length<2)return false; // PAIR RULE: apply both sides together or neither
  state.bounds={left:L,right:R,src:'preset:'+dir};
  renderLoadedFiles();
  const r=state.report;if(r&&typeof drawTrackMapSel==='function')drawTrackMapSel(r,-1);
  return true;
}
async function addBoundaryFile(side,file){
  try{
    const text=await file.text();
    const pts=parseBoundaryCsv(text);
    state.bounds=state.bounds||{};
    if(String(state.bounds.src||'').startsWith('preset:'))state.bounds={left:null,right:null}; // manual drop = start fresh, never mix sources
    state.bounds[side]=pts;
    renderLoadedFiles();
    const r=state.report;
    if(r&&typeof drawTrackMapSel==='function')drawTrackMapSel(r,-1);
  }catch(e){showLoadError(file.name,e);}
}
function renderLoadedFiles(){
  const el=$('loadedFiles');el.innerHTML='';
  for(const f of state.files){
    const m=f.parsed.meta;
    const d=document.createElement('div');d.className='filechip';
    let sub;
    if(f.format==='ibt')sub=`${(f.size/1024).toFixed(0)} KB - ${esc(f.analysis.track_display||'?')} (iRacing .ibt)`;
    else sub=`${(f.size/1024).toFixed(0)} KB - ${esc(m.track)}/${esc(m.car)}`;
    d.innerHTML=`<span>${esc(f.name)}</span><span class="meta">${sub}</span>`;
    el.appendChild(d);
  }
  if(state.setup){
    const d=document.createElement('div');d.className='filechip';
    d.innerHTML=`<span>${esc(state.setup.name)}</span><span class="meta">setup - ${state.setup.text.length} chars</span>`;
    el.appendChild(d);
  }
  if(state.bounds){
    const bsrc=String(state.bounds.src||'');
    for(const side of ['left','right']){
      const pts=state.bounds[side];
      if(!pts||pts.length<2)continue;
      const d=document.createElement('div');d.className='filechip';
      d.innerHTML=`<span>track boundary ${esc(side)}</span><span class="meta">${pts.length} pts${bsrc.startsWith('preset:')?' - preset':''}</span>`;
      el.appendChild(d);
    }
  }
}

/* ---- analysis levels (L1 driver / L2 setup) ---- */
// Mechanical channels required by setup_scan_prototype.py (SETUP_RESEARCH.md §3).
const MECH_CHANNELS=['Tire Slip Angle FL','Tire Slip Angle FR','Tire Slip Angle RL','Tire Slip Angle RR',
  'Tire Slip Ratio RL','Tire Slip Ratio RR',
  'Wheel Angular Speed FL','Wheel Angular Speed FR','Wheel Angular Speed RL','Wheel Angular Speed RR',
  'Suspension Travel FL','Suspension Travel FR','Suspension Travel RL','Suspension Travel RR',
  'Max Sus Travel FL','Max Sus Travel FR','Max Sus Travel RL','Max Sus Travel RR',
  'Tire Temp Core FL','Tire Temp Core FR','Tire Temp Core RL','Tire Temp Core RR',
  'Tire Pressure FL','Tire Pressure FR','Tire Pressure RL','Tire Pressure RR',
  'ABS Active','TC Active'];
function mechChannelsPresent(){
  const f=state.currentFileIdx>=0?state.files[state.currentFileIdx]:null;
  if(!f||f.format!=='ld')return[];
  return MECH_CHANNELS.filter(n=>f.parsed.chans.has(n));
}
// Names of the mechanical channels missing from the current .ld file (null = not an .ld file).
// Surfaced in the report so a silently-skipped setup scan says WHY (diagnoses dropped-channel parses).
function missingMechChannels(){
  const f=state.currentFileIdx>=0?state.files[state.currentFileIdx]:null;
  if(!f||f.format!=='ld')return null;
  return MECH_CHANNELS.filter(n=>!(f.parsed&&f.parsed.chans&&f.parsed.chans.has(n)));
}
function levelPill(tag,label,st,tip){
  const suffix=st==='locked'?' &#128274;':(st==='beta'?' (beta)':'');
  return '<span class="level-pill '+st+'"'+(tip?' title="'+esc(tip)+'"':'')+'><b>'+tag+'</b> '+label+suffix+'</span>';
}
function renderLevels(){
  const bar=$('levelBar');if(!bar)return;
  const f=state.currentFileIdx>=0?state.files[state.currentFileIdx]:null;
  let l1='locked',l2='locked';
  let tipL1='',tipL2='Load a telemetry file (.ld or .ibt) to unlock analysis levels.';
  if(f){
    l1='active';
    if(f.format==='ld'){
      const mech=mechChannelsPresent();
      if(mech.length===MECH_CHANNELS.length){
        l2='beta';
        tipL2='All '+MECH_CHANNELS.length+' mechanical channels present (tire slip angle/ratio, suspension travel, tire temp/pressure, wheel speeds). Setup scan is a beta prototype with PROVISIONAL thresholds - treat flags as candidates to verify, not verdicts.';
      }else{
        const missing=MECH_CHANNELS.filter(n=>!f.parsed.chans.has(n));
        tipL2='Missing '+missing.length+' of '+MECH_CHANNELS.length+' mechanical channels (e.g. '+missing.slice(0,3).join(', ')+(missing.length>3?' …':'')+') - L2 needs ACC .ld telemetry with those logged.';
      }
    }else{
      tipL2='iRacing .ibt files do not log mechanical channels (suspension travel, tire slip angle/temp/pressure) - setup diagnosis requires ACC .ld telemetry.';
    }
  }
  bar.innerHTML=levelPill('L1','Driver focus',l1,tipL1)+levelPill('L2','Setup diagnosis',l2,tipL2);
}

/* ---- driver stage classification from laps-in-session (strict thresholds) ---- */
// Coaching-stage read derived from clean laps available in the loaded session.
// Strict thresholds (coaching reference): <5 clean laps = insufficient,
// 5-9 laps = baseline consistency, >=10 laps = deep telemetry unlocked.
// Driver-skill reads live under the app's L1 (driver focus) axis; L2 stays setup-only.
function classifyDriver(lapCount){
  const laps=lapCount||0;
  if(laps<5)return{assigned:false,sub:'Foundation',note:'Too few laps (<5 clean) - keep driving! Complete at least 5 clean laps to unlock consistency scoring (L1).'};
  if(laps<10)return{assigned:true,sub:'Baseline consistency',note:'Session has enough laps for a baseline consistency read (L1).'};
  return{assigned:true,sub:'Deep telemetry unlocked',note:'Session has enough laps for deep technique reads (L1). Cross-check vs a reference lap before claiming pace deltas.'};
}

/* ---- report rendering ---- */
function loadFile(idx){
  const f=state.files[idx];if(!f)return;
  state.currentFileIdx=idx;
  state.report=null; // a failed load must not leave the previous file's report behind
  try{
    if(f.format==='ibt'){
      state.report=null;
      state.digest=buildIbtDigestText(f.analysis,f.parsed.chans);
      renderIbtReport(f.analysis);renderCombos();
    }else{
      const {meta,chans}=f.parsed;
      state.report=buildReport(meta,chans,meta.freq_hz);
      state.digest=buildDigest(state.report);
      renderReport();renderCombos();
    }
  }catch(e){showLoadError(f.name,e);}
  renderLevels(); // L1/L2 status for the newly loaded file
  // Driver stage classification from laps available in this session (strict thresholds)
  const lapCount=(state.report&&state.report.laps)?state.report.laps.length:((f.analysis&&f.analysis.laps)?f.analysis.laps.length:0);
  state.level=classifyDriver(lapCount);
  const cle=$('coachLevel');if(cle)cle.textContent='Driver stage: '+state.level.sub+' - '+state.level.note;
// Merged Compare (chunk 4, 2026-10-27): the legacy in-file select panel is gone - a report with >1 lap
// auto-fills the unified A/B slots and renders the comparison into #crossSummary.
// Defaults mirror the old panel: A = best lap, B = second-to-last lap (fall back to index 0 if that IS the best).
  if(state.report&&state.report.laps.length>1){
    const r=state.report;
    let bi=r.laps.length-2;if(bi===r.bestIdx)bi=0;
    crossSel={ref:{fileIdx:idx,lapIdx:r.bestIdx},chal:{fileIdx:idx,lapIdx:bi}};
    renderCross();
    runCrossComparison(crossSel.ref,crossSel.chal);
  }
}
function renderReport(){
  const r=state.report,m=r.meta,body=$('reportBody');
  let html=`<div style="font-size:13px;color:#eaf1f9"><b>${esc(normTrack(m.track))}</b> &middot; ${esc(m.car)} &middot; ${esc(m.driver)}</div>`;
  html+=`<div class="hint">${esc(m.date)} ${esc(m.time)}${m.comment?' - '+esc(m.comment):''} - ${r.freq} Hz, ${m.n_channs} channels</div>`;
  if(!r.laps.length){body.innerHTML=html+'<p class="dim">No full laps found in this file.</p>';return;}
  // --- merged "Driver inputs & car positioning" section (2026-10-24): four separate line graphs
  // (speed / throttle / brake / steering) + track map, ONE lap selector, per-lap view only —
  // no "All laps"; replaces the old combined Input Overlay canvas and the standalone Speed Trace
  // section (speed is now the first graph). ---
  {
    const f=state.files[state.currentFileIdx];
    if(f&&f.format==='ld'){
      html+='<div style="margin-top:14px"><h2 style="margin-bottom:6px">Driver inputs &amp; car positioning<span class="lvbadge">L1</span></h2>';
      html+='<select id="ovlLapSel" style="margin-bottom:8px">'+r.laps.map((l,i)=>'<option value="'+i+'"'+(i===r.bestIdx?' selected':'')+'>'+esc('L'+l.lap)+(i===r.bestIdx?' (best)':'')+'</option>').join('')+'</select>';
      const sig=[['spd','Speed by lap position (km/h)'],['thr','Throttle by lap position (0–100%)'],['brk','Brake by lap position (0–100%)'],['steer','Steering by lap position (degrees, signed)']];
      for(const [k,lab] of sig){
        html+='<div'+(k!=='spd'?' style="margin-top:10px"':'')+'><b style="font-size:12px;color:#eaf1f9">'+lab+'</b>';
        html+='<canvas id="'+OVL_CHART_IDS[k]+'" width="700" height="180" style="width:100%;max-width:700px;background:#0d1117;border:1px solid #21262d;border-radius:8px;display:block;margin-top:4px"></canvas></div>';
      }
      html+='<div class="ovl-legend"><span>● B braking onset</span><span>▼ brake at turn-in (&gt;5%)</span><span>◁▷ coast after release (≥0.4 s)</span><span>⌄ throttle hesitation (drop ≥30 pts / 0.5 s, &gt;60 km/h)</span><span>≈ steering wobble under braking (&gt;4 corrections)</span></div>';
      html+='<div style="margin-top:14px"><b style="font-size:12px;color:#eaf1f9">Track map — car positioning</b>';
      html+='<canvas id="trkMap" width="700" height="500" style="width:100%;max-width:700px;background:#0d1117;border:1px solid #21262d;border-radius:8px;cursor:pointer;display:block;margin-top:4px"></canvas>';
      html+='<div id="trkTip" style="display:none;position:absolute;background:#1c2128;color:#e6edf3;padding:4px 8px;border-radius:5px;font-size:12px;pointer-events:none;z-index:10"></div>';
      html+='<div id="trkCorners" class="cbtns" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px"></div></div>';
      html+='<p class="hint" style="margin-top:6px">Hover for exact values at any point of the lap and the nearest measured flag. Thresholds cited from compare_laps.py / setup_scan_prototype.py (SKILLS.md, Skill 8).</p></div>';
      html+='<div id="ovlTip" style="display:none;position:fixed;background:#1c2128;color:#e6edf3;padding:4px 8px;border-radius:5px;font-size:12px;pointer-events:none;z-index:99;white-space:pre-line"></div>';
    }
  }
  html+='<table><tr><th>lap</th><th>time</th><th>top speed</th><th>max lat G</th><th>max brake G</th><th>fuel used</th></tr>';
  r.laps.forEach((l,i)=>{html+=`<tr${i===r.bestIdx?' class="best"':''}><td>L${l.lap}${i===r.bestIdx?' (best)':''}</td><td>${fmtLap(l.dur)}</td><td>${isFinite(l.topSpeed)?l.topSpeed.toFixed(1):'-'}</td><td>${l.maxLatG>0.5?l.maxLatG.toFixed(2):'-'}</td><td>${l.maxBrakeG>0.5?l.maxBrakeG.toFixed(2):'-'}</td><td>${l.fuelUsed!=null?l.fuelUsed.toFixed(2)+' l':'-'}</td></tr>`;});
  html+='</table>';
  // --- lap comparison moved to the unified Compare section (chunk 4, 2026-10-27): A/B slots auto-prefill on load ---
  if(r.bestZones.length){
    html+=`<h2 style="margin-top:14px">Best-lap braking zones (lap ${r.laps[r.bestIdx].lap})${r.zones?'':' - no named zone table for this track'}<span class="lvbadge">L1</span></h2>`;
    html+='<table><tr><th>zone</th><th>pos</th><th>entry</th><th>decel</th><th>duration</th></tr>';
    for(const z of r.bestZones)html+=`<tr><td>${esc(z.ref)}</td><td>${(z.pos*100).toFixed(1)}%</td><td>${z.entry.toFixed(1)} km/h</td><td>${z.decel.toFixed(2)} G</td><td>${z.dur.toFixed(2)} s</td></tr>`;
    html+='</table>';
  }
  if(r.matrix.rows.length){
    html+='<h2 style="margin-top:14px">Entry speed by zone (km/h)<span class="lvbadge">L1</span></h2><table><tr><th>zone</th>'+r.matrix.cols.map(k=>`<th>L${k}</th>`).join('')+'</tr>';
    for(const row of r.matrix.rows)html+=`<tr><td>${esc(row.ref)}</td>`+row.cells.map(c=>`<td>${c==null?'-':c.toFixed(1)}</td>`).join('')+'</tr>';
    html+='</table>';
  }
  // --- L2 setup scan (beta) - only when all mechanical channels are present in this file ---
  if(mechChannelsPresent().length===MECH_CHANNELS.length && r.setupScan){
    html+='<h2 style="margin-top:14px">Setup scan<span class="lvbadge l2">L2 &middot; beta</span></h2>';
    html+='<p class="hint">PROVISIONAL thresholds (setup_scan_prototype.py, SETUP_RESEARCH.md &sect;3/4) - flags are <b>candidates to verify</b>, not verdicts. All five matrix rows wired: tire sec-4a, steady-state understeer, exit oversteer, braking instability, bottoming - plus ABS/TC activations (context only).</p>';
    html+='<table><tr><th>lap</th><th>core temp end &deg;C [FL FR RL RR] (F&minus;R)</th><th>&Delta; over stint &deg;C</th><th>pressure outside 26.8&ndash;27.2 psi window</th><th>F&minus;R slip diff in steady corners (flag &gt;1.0&deg;)</th><th>exit oversteer: counter-steer events (flag &ge;2) / rear slip max % / throttle hesitations</th><th>braking: max steer reversals / events (flag &gt;4) + wheel-speed gap rad/s (rear lock if &gt;5 with ABS)</th><th>bottoming: travel p95 [FL FR RL RR] / vert G straight (flag p95 &ge;0.90 or &ge;3.0 G)</th><th>ABS % / events &middot; TC % / events (context)</th></tr>';
    for(const s of r.setupScan.laps){
      const part=s.dur_s<r.setupScan.min_lap_s?' <span class="hint">(partial - flags not classified)</span>':'';
      const sgn=v=>(v>=0?'+':'')+v.toFixed(1);
      html+=`<tr><td>L${s.lap}${part}</td>`+
        `<td>${s.tire_core_end_C.map(v=>v.toFixed(1)).join(' / ')} <span class="hint">(${sgn(s.tire_F_minus_R_C)})</span></td>`+
        `<td>[${s.tire_stint_delta_C.map(sgn).join(' ')}]</td>`+
        `<td>${s.pressure_outside_window.length?s.pressure_outside_window.join(' '):'in window'}</td>`+
        `<td>${s.steady_segments==null?'-':(s.us_max_f_r_diff_deg==null?'no steady segs':s.us_max_f_r_diff_deg.toFixed(2)+'&deg;'+(s.understeer_candidate?' <b>FLAG</b>':''))}</td>`+
        `<td>${s.countersteer_events==null?'-':s.countersteer_events+' cs &middot; '+(s.rear_slip_ratio_max_pct==null?'-':s.rear_slip_ratio_max_pct)+'% slip &middot; '+s.throttle_hesitation_events+' hes'+(s.exit_oversteer_candidate?' <b>FLAG</b>':'')}</td>`+
        `<td>${s.braking_events==null?'-':(s.max_brake_steering_reversals+' rev / '+s.braking_events+' evts'+(s.peak_decel_wheel_speed_gap_rad_s!=null?' &middot; '+s.peak_decel_wheel_speed_gap_rad_s+'&nbsp;rad/s':'')+((s.max_brake_steering_reversals>4||s.rear_lock_candidate)?' <b>FLAG</b>':''))}</td>`+
        `<td>${s.bottoming_travel_p95_by_wheel?Object.values(s.bottoming_travel_p95_by_wheel).map(v=>v.toFixed(2)).join(' / '):'-'}${s.max_vert_g_straight!=null?' / '+s.max_vert_g_straight+'&nbsp;G':''}${s.bottoming_candidate?' <b>FLAG</b>':''}</td>`+
        `<td>${(s.abs_active_pct==null&&s.tc_active_pct==null)?'-':(s.abs_active_pct==null?'-':s.abs_active_pct)+'% / '+(s.abs_events==null?'-':s.abs_events)+' &middot; '+(s.tc_active_pct==null?'-':s.tc_active_pct)+'% / '+(s.tc_events==null?'-':s.tc_events)}</td></tr>`;
    }
    html+='</table>';
  } else {
    const miss=missingMechChannels();
    if(miss)html+='<p class="hint" style="margin-top:14px">Setup scan unavailable - '+(miss.length?'missing channel(s): '+esc(miss.join(', ')):'mechanical channels present but scan not built')+'</p>';
  }
  html+='<details><summary>Copyable text digest (sent to the LLM)</summary><pre class="digest" id="digestPre"></pre>'+
        '<button type="button" id="btnCopyDigest" style="margin-top:8px">Copy digest</button></details>';
  body.innerHTML=html;
  // Self-contained briefing (header + mode line + measured data, incl. A/B reference-lap
  // telemetry when a comparison is selected) — pasteable into any external LLM session.
  // Filled here because innerHTML above resets it; renderCross() keeps it in sync with A/B changes.
  fillDigestSection();
  
  
  // --- merged section drawing (canvas must exist after innerHTML above) — per-lap view,
  // default best lap, charts + track map always in sync (2026-10-24) ---
  if(r.outline&&r.cornerPts){drawTrackMapSel(r,r.bestIdx);}
  const ovl=$('ovlLapSel');
  if(ovl){
    renderSingleCharts(r.bestIdx);
    wireSingleChartsHover();
    ovl.addEventListener('change',e=>{const rr=state.report;if(!rr)return;renderSingleCharts(+e.target.value);if(rr.outline&&rr.cornerPts)drawTrackMapSel(rr,+e.target.value);});
  }
}
// Palette for the all-laps overlay (one color per lap, cycling).
const MAP_COLORS=['#5fd08a','#4fc3f7','#ffb86c','#ff5c39','#c678dd','#e6edf3','#7ee787','#f2cc60'];
// Wheel-zoom + drag-pan + dblclick-reset for track-map canvases.
// Pedal-aware driver line for one lap (report-lap index) of the current file: decimated points
// [x, y, brake%, throttle%, steer deg, speed km/h] on a uniform grid. Consumed by the single-session
// track map so its racing line can be stroked per segment with color blended toward the dominant pedal.
function pedalLineForLap(r,lapIdx){
  const f=state.files[state.currentFileIdx];if(!f||!f.parsed||!f.parsed.chans)return null;
  const chans=f.parsed.chans;
  const CX=chans.get('Car Coord X'),CY=chans.get('Car Coord Y');
  const Bk=chans.get('Brake Pos'),Th=chans.get('Throttle Pos'),ST=chans.get('Steering Angle'),SP=chans.get('Ground Speed')||chans.get('Speed');
  if(!CX||!CY||!Bk||!Th||!ST||!SP)return null;
  // per-wheel tire slip angle (deg, absolute) — optional channels; tooltip shows them when present
  const SF=chans.get('Tire Slip Angle FL'),SRF=chans.get('Tire Slip Angle FR'),SRL=chans.get('Tire Slip Angle RL'),SRR=chans.get('Tire Slip Angle RR');
  const hasSlip=SF&&SRF&&SRL&&SRR;
  const freq=(r&&r.freq)||20.0;
  const segs=getSegs(chans,freq);
  const keys=Object.keys(segs).map(Number).sort((a,b)=>a-b);
  const keyIdx=keys.indexOf(r.laps[lapIdx].lap);
  if(keyIdx<0)return null;
  const [a,b]=segs[keys[keyIdx]];
  const X=CX.vals.subarray(a,b),Y=CY.vals.subarray(a,b);
  const step=Math.max(1,Math.floor(X.length/700));
  const pts=[];
  // negate -> map frame (north-up track orientation), identical to trackOutline / getTrackOutlineForLap braking markers
  for(let i=0;i<X.length;i+=step)pts.push({x:Math.round(-X[i]*100)/100,y:Math.round(-Y[i]*100)/100,brake:Bk.vals[a+i],throttle:Th.vals[a+i],steer:ST.vals[a+i],speed:SP.vals[a+i],
    sfl:hasSlip?Math.abs(SF.vals[a+i]):undefined,sfr:hasSlip?Math.abs(SRF.vals[a+i]):undefined,srl:hasSlip?Math.abs(SRL.vals[a+i]):undefined,srr:hasSlip?Math.abs(SRR.vals[a+i]):undefined});
  if(pts.length<2)return null;
  pts.__tot=(pts.length-1)*step/freq;
  return pts;
}
// The draw function must set on every render: cv.__base={ox,oy,s} (identity fit) and cv.__redraw=()=>draw().
// Zoom state lives in cv.__zoom={k,ax,ay}: screenX = ax+(wx-x0)*s*k, screenY = ay+(y1-wy)*s*k.
// wireZoomPan moved to the core section (above drawPedalLines) so the cross-session map can zoom too.
// Draw the track map for a dropdown selection: -1 = whole session (all laps overlaid), otherwise one lap's driven line.
function drawTrackMapSel(r,selVal){
  const cv=$('trkMap');if(cv)cv.__zoom=null; // fresh fit per lap selection -> start at identity zoom
  if(selVal===-1){
    const multi=[];
    for(let i=0;i<r.laps.length;i++){const o=getTrackOutlineForLap(i);if(o&&o.outline)multi.push({label:'L'+r.laps[i].lap,pts:o.outline});}
    drawTrackMap(r,null,multi);
  }else{
    const o=getTrackOutlineForLap(selVal);
    drawTrackMap(r,(o&&o.outline)||[],undefined,selVal);
  }
}
// Draw the track outline + corner markers on canvas (port of compare_laps.py JS_BODY).
// Single mode: `outline` is an array of [x,y] points (defaults to best lap's driven path).
// Multi mode: pass `multi` = [{label,pts},...] to overlay every lap of the session in its own color.
