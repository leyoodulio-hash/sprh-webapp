
/* ================= UI wiring (browser only) ================= */
// T-25: the legacy single big if-block was split so every part is a self-contained program
// (external <script src> files under file://). Only load-time side effects stay guarded;
// declarations are top-level so later scripts see them as globals.
if(typeof document!=='undefined'){
console.log('[srph] script loaded OK, version 2026-10-14');
window.onerror=function(msg,src,line,col){const rb=document.getElementById('reportBody');if(rb&&rb.textContent.indexOf('Parsing')<0)rb.innerHTML='<p style="color:#f88">JS Error: '+msg.replace(/</g,'&lt;')+'</p><pre class="hint">'+(line?src+':'+line+' col '+col:'')+'</pre>';};
}
// ($ shorthand = the top-level function in parse.js, visible to every part; the legacy
// block-scoped const re-declaration here was removed in T-25 — it shadowed that global.)
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
// Shared copy-to-clipboard ("Copy digest" buttons in the report renderers). Clipboard API
// first (works on file:// — it is a secure context), select+execCommand fallback.
function copyText(t){
  const btn=$('btnCopyDigest');
  const flash=m=>{if(!btn)return;btn.textContent=m;if(m!=='Copy digest')setTimeout(()=>{if(btn.isConnected)btn.textContent='Copy digest';},1500);};
  const fallback=()=>{const p=$('digestPre');if(!p)return flash('Copy failed');
    try{const r=document.createRange();r.selectNodeContents(p);const s=getSelection();s.removeAllRanges();s.addRange(r);
      const ok=document.execCommand('copy');s.removeAllRanges();flash(ok?'Copied ✓':'Copy failed');}catch(e){flash('Copy failed');}};
  if(typeof navigator!=='undefined'&&navigator.clipboard&&navigator.clipboard.writeText)
    navigator.clipboard.writeText(t).then(()=>flash('Copied ✓'),fallback);
  else fallback();
}
/* ---- Copyable digest: self-contained briefing for pasting into ANY LLM chat (free session, no API key) ---- */
// The in-app chat prompt frames state.digest itself; the copyable section goes further so an
// external LLM can coach from the paste alone: what the data is, which mode it is in
// (A/B comparison vs single-session laps), then the measured data. A/B text reuses
// crossReviewPrompt() verbatim — its pre-canned request doubles as the analysis task.
function buildCopyBriefing(){
  const L=[];
  L.push('SRPH AI COACH - TELEMETRY DIGEST (copied from the in-browser coaching web app)');
  L.push('What this is: racing telemetry parsed in-browser from Assetto Corsa Competizione MoTeC .ld files (or iRacing .ibt). Every value below is MEASURED, not estimated. Units: speeds km/h, deceleration G or m/s^2, times s, fuel L, slip angles deg, steering deg. "Zone N @x.x%" = a braking zone at x.x% of lap distance; named zones use the track\'s official corner names.');
  let cross=null;
  if(typeof crossSel!=='undefined'&&crossSel&&crossSel.ref&&crossSel.chal){try{cross=crossReviewPrompt(crossSel.ref,crossSel.chal);}catch(e){cross=null;}}
  if(cross){
    L.push('MODE: A/B comparison - telemetry data for TWO laps is provided below (A = challenge lap to be coached, B = reference lap for delta context).');
    L.push('');
    L.push(cross);
  } else {
    const f=state.files[state.currentFileIdx];
    if(f&&f.format==='ibt')L.push('MODE: single iRacing .ibt run segment - one continuous segment (not full laps) is provided for analysis; no reference lap.');
    else L.push('MODE: single session - laps from one session file are provided for analysis; no reference lap.');
    L.push('');
    L.push(state.digest||'(no telemetry loaded)');
  }
  return L.join('\n');
}
function fillDigestSection(){
  const dp=$('digestPre');if(!dp)return;
  dp.textContent=buildCopyBriefing();
  // _digestWired: the button survives renderCross() re-renders — wire it only once.
  const cd=$('btnCopyDigest');
  if(cd&&!cd._digestWired){cd._digestWired=true;cd.addEventListener('click',()=>copyText(dp.textContent));}
}


/* ---- LLM config (localStorage) ---- */
function getCfg(){return{baseUrl:$('cfgBase').value.trim(),apiKey:$('cfgKey').value.trim(),model:$('cfgModel').value.trim()||'gpt-4o-mini'}};
function loadCfg(){try{const c=JSON.parse(localStorage.getItem('srph_llm_cfg')||'null');if(c){$('cfgBase').value=c.baseUrl;$('cfgKey').value=c.apiKey;$('cfgModel').value=c.model;}}catch(e){}}
function llmStatus(msg,cls){const el=$('llmStatus');el.textContent=msg;el.className='status '+(cls||'dim');}
async function testLlm(){
  const cfg=getCfg();
  if(!cfg.baseUrl)return llmStatus('Enter a base URL first.','err');
  const url=cfg.baseUrl.replace(/\/+$/,'')+'/models';
  try{
    let res;
    try{res=await fetch(url,{headers:{Authorization:'Bearer '+cfg.apiKey}});}
    catch(e){
      // Distinguish CORS-blocked from unreachable: a no-cors ping resolves only if the server is reachable.
      let reachable=false;
      try{await fetch(url,{mode:'no-cors'});reachable=true;}catch(_){}
      throw new Error(reachable?'endpoint is reachable but blocked by browser CORS. Fix on the server (add Access-Control-Allow-Origin + OPTIONS handling), or run "node cors_proxy.js '+cfg.baseUrl+'" locally and set Base URL to http://localhost:8787/v1':'endpoint unreachable (check URL / network)');
    }
    if(!res.ok)throw new Error(res.status+' '+(await res.text()).slice(0,200));
    const raw=await res.text();let data;try{data=JSON.parse(raw);}catch(_){throw new Error('HTTP '+res.status+' but response is not JSON. Body: '+raw.slice(0,160));}
    const list=Array.isArray(data)?data:(data&&Array.isArray(data.data))?data.data:(data&&Array.isArray(data.models))?data.models:null;
    if(!list)throw new Error('HTTP '+res.status+' OK but no model list in response - check Base URL (OpenAI-compatible roots usually end in /v1). Body: '+raw.slice(0,160));
    const ids=list.map(m=>typeof m==='string'?m:(m&&m.id||m.name)).filter(Boolean).sort();
    const box=$('llmModels');
    if(ids.length){
      box.innerHTML=ids.map(id=>'<span class="model-chip" data-id="'+esc(id)+'">'+esc(id)+'</span>').join('');
      box.hidden=false;
      llmStatus('Connected - '+ids.length+' model(s). Click one to fill the Model field.','ok');
    }else{box.hidden=true;box.innerHTML='';llmStatus('Connected - endpoint reachable, but no model ids in response.','ok');}
  }catch(e){llmStatus('Connection failed: '+e.message,'err');}
}

/* ---- known track x car combos (seeded + discovered from uploads) ---- */
function normTrack(t){t=(t||'').toLowerCase();return t.startsWith('rt_')?t.slice(3):t;}
function displayTrack(t){const n=normTrack(t);return n?n[0].toUpperCase()+n.slice(1).replace(/_/g,' '):(t||'?');}
function seedCombos(){
  // No seeded data - every track/car/driver comes from the user's own uploads.
  const seeds=[];
  for(const s of seeds){
    const key=normTrack(s.track)+'|'+s.car;
    if(!state.combos.has(key))state.combos.set(key,{track:displayTrack(s.track),car:s.car,drivers:new Set(s.drivers),files:[],seeded:true});
  }
}
function upsertCombo(meta,fileName,fileIdx){
  const key=normTrack(meta.track)+'|'+meta.car;
  let c=state.combos.get(key);
  if(!c){c={track:displayTrack(meta.track),car:meta.car,drivers:new Set(),files:[],seeded:false};state.combos.set(key,c);}
  if(meta.driver)c.drivers.add(meta.driver);
  c.files.push({name:fileName,idx:fileIdx});
}
function renderCombos(){
  const list=$('comboList');list.innerHTML='';
  const combos=[...state.combos.entries()].sort((a,b)=>a[1].track.localeCompare(b[1].track));
  if(!combos.length){list.innerHTML='<div class="hint">no telemetry loaded yet - upload a .ld or .ibt file to get started</div>';return;}
  for(const [key,c] of combos){
    const div=document.createElement('div');
    const active=c.files.some(f=>f.idx===state.currentFileIdx);
    div.className='combo'+(active?' active':'');
    let html=`<div class="t">${esc(c.track)}${c.seeded?'<span class="badge seed">seeded</span>':''}</div>`;
    html+=`<div class="c">car: ${esc(c.car)}</div>`;
    if(c.drivers.size)html+=`<div class="c">driver(s): ${[...c.drivers].map(esc).join(', ')}</div>`;
    for(const f of c.files){
      const on=f.idx===state.currentFileIdx;
      html+=`<button type="button" data-fidx="${f.idx}" style="margin-top:6px;width:auto;padding:4px 8px;font-size:12px${on?';background:#2b6cb0':''}">${esc(f.name)}</button>`;
    }
    if(!c.files.length)html+=`<div class="hint">no file loaded yet - upload a telemetry file</div>`;
    div.innerHTML=html;
    list.appendChild(div);
  }
  for(const b of list.querySelectorAll('button[data-fidx]'))b.addEventListener('click',()=>loadFile(+b.dataset.fidx));
}
/* ---- uploads ---- */
function showLoadError(name,e){
  const el=$('reportBody');if(!el)return;
  el.innerHTML='<div class="hint" style="color:#ff9b9b">Could not load '+esc(name)+': '+(e&&e.message?e.message:String(e))+'</div>';
}
async function addTelemetryFile(file){
  const isIbt=/\.ibt$/i.test(file.name);
  let parsed,analysis=null;
  // Show progress in report area so user can see where it gets stuck
  
  try{
    if(isIbt){parsed=parseIbt(await file.arrayBuffer());analysis=analyzeIbt(parsed.meta,parsed.chans);}
    else parsed=parseLd(await file.arrayBuffer());
  }catch(e){showLoadError(file.name,e);return;}
  const idx=state.files.length;
  state.files.push({name:file.name,size:file.size,parsed,format:isIbt?'ibt':'ld',analysis});
  if(isIbt)upsertCombo({track:analysis.track_name||'unknown',car:'iRacing',driver:null},file.name,idx);
  else{
    upsertCombo(parsed.meta,file.name,idx);
    const refs=refLapEntriesFor(parsed.meta.track); // match-on-upload preload of curated reference laps for this track
    if(refs.length)state.files.push(...refs);
  }
  renderLoadedFiles();renderCombos();loadFile(idx);renderCross();
  if(!isIbt)await loadPresetBounds(parsed.meta.track);
}
function buildComparison(meta,chans,freq,lapA,lapB){
  const r=state.report;
  const a=r.laps[lapA];
  const b=r.laps[lapB];
  if(!a||!b)return;
  const delta_s=a.dur-b.dur;
  const delta_top=a.topSpeed_kmh-b.topSpeed_kmh;
  const delta_lat=a.max_latG-b.max_latG;
  const delta_brk=a.max_brakeG-b.max_brakeG;
  const delta_fuel=a.fuel_used_l-b.fuel_used_l;
  return {lapA:lapA,lapB:lapB,delta_s,delta_top,delta_lat,delta_brk,delta_fuel,a_label:"L"+a.lap,b_label:"L"+b.lap};
}
async function addSetupFile(file){
  state.setup={name:file.name,text:await file.text()};
  renderLoadedFiles();
}
function parseBoundaryCsv(text){
  const pts=[];
  for(const line of text.split(/\r\n|\r|\n/)){
    const t=line.trim();if(!t)continue;
    const nums=t.split(',').map(s=>parseFloat(s));
    if(!(nums.length>=3))continue;
    const x=nums[0],z=nums[2];
    if(!isFinite(x)||!isFinite(z))continue;
    const last=pts[pts.length-1];
    if(last&&Math.abs(last[0]-x)<1e-6&&Math.abs(last[1]-z)<1e-6)continue;
    pts.push([x,z]);
  }
  return pts;
}
/* ---- preset track assets: bundled PRESET_BOUNDS + HTTP tracks/<code>/<layout>/side_l|side_r.csv ---- */
const PRESET_BASE='tracks'; // relative to served app root; file:// or missing dir => silently skipped
