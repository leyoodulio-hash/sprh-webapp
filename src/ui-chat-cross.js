function systemPrompt(){
  const isIbt=!state.report&&!!state.digest;
  let p=isIbt?'You are SRPH AI Coach, a driver-coaching assistant analyzing an iRacing .ibt telemetry file.'
             :'You are SRPH AI Coach, a driver-coaching assistant for Assetto Corsa Competizione telemetry.';
  p+=' Be direct and specific about driving technique (braking points, entry speeds, throttle application, line, consistency), citing the numbers from the digest when you make a point.';
  if(isIbt)p+=' The .ibt digest covers one continuous run segment (not full laps) - coach only on what is measurable in it: acceleration, off-track excursions, incident flags, heading-change events and smoothness metrics.';
  else p+=' Refer to braking zones by corner name in prose (e.g., Spoon, Degner hairpin); if a zone has no name, use its Zone N label. At the end of each section where you discuss a zone row from the digest tables, put one tag [map:<exact ref>] on its own line using that row\'s exact table label including its @x.x% part (e.g. [map:Spoon Curve @68.0%]). The UI consumes these tags to attach a track-map image - never mention or explain the tags in prose.';
  if(!isIbt)p+=' When you discuss pedal or steering technique for a specific lap, put one tag [overlay:<lap number>] on its own line (e.g. [overlay:12]) using that lap\'s number from the digest. The UI consumes these tags to attach an input-overlay chart of speed/throttle/brake/steering with measured technique flags - never mention or explain the tags in prose.';
  p+=' Car-setup statements must be framed as hypotheses or candidates to test under comparable conditions - never guaranteed fixes without controlled A/B evidence.';
  p+=' When helpful, end your answer with 2-3 short follow-up questions the driver would ask next - one per line, each starting with "\u2192 " (arrow + space), specific to what you just measured. The UI renders those lines as clickable chips - never mention or explain them in prose.';
  p+=' Fuel scale anchor: 1 L of fuel \u2248 0.75 kg; on a ~1000 kg car a few liters of load difference is worth far less than 0.1 s of lap time - always disclose the fuel delta as a confound, but never attribute seconds of it to weight.';
  p+=' Tire-pressure / grip anchor: on race slicks higher pressure = smaller contact patch = LESS grip - never recommend raising tire pressure to gain grip; if a side is low on grip, point at balance/alignment/wing candidates or tire-temperature management instead.';
  if(!isIbt)p+=' The digest may include per-lap setup-scan segments (tire temps/pressures, steady-state understeer, exit oversteer, braking instability, bottoming, ABS/TC activations) with PROVISIONAL candidate flags - treat them as measured symptoms to verify; if no such section is present, the file lacks the mechanical channels.';
  if(state.digest)p+='\n\nTELEMETRY DIGEST (parsed in-browser):\n'+state.digest;
  if(state.setup)p+=`\n\nCAR SETUP FILE (${state.setup.name}):\n`+state.setup.text.slice(0,4000);
  return p;
}
/* ---- per-zone track-map snippets for chat answers ---- */
function escHtml(s){return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
// Resolve a zone mention (exact ref, or fuzzy name like "Degner hairpin") to a matrix row index.
function findZoneRow(q){
  const r=state.report;if(!r||!r.matrix.rows.length)return -1;
  const norm=s=>String(s).toLowerCase().replace(/\s+/g,' ').trim();
  let query=norm(q);if(!query)return -1;
  for(let i=0;i<r.matrix.rows.length;i++)if(norm(r.matrix.rows[i].ref)===query)return i; // exact ref match
  const ordM=query.match(/\b(first|second|third|fourth)\b/);
  const base=query.replace(/@[\d.]+%/,'').replace(/\b(first|second|third|fourth)\b/g,' ').replace(/\b(entry|part)\b/g,' ').trim();
  if(!base)return -1;
  const toks=base.split(/[^a-z0-9&]+/).filter(t=>t.length>2);
  let bestScore=0.5,tied=[]; // require >50% of query tokens to appear in the row name
  for(let i=0;i<r.matrix.rows.length;i++){
    const rn=norm(r.matrix.rows[i].ref).replace(/@[\d.]+%/,'');
    let hit=0;for(const t of toks)if(rn.includes(t))hit++;
    const score=toks.length?hit/toks.length:0;
    if(score>bestScore){bestScore=score;tied=[i];}
    else if(score===bestScore&&score>0.5)tied.push(i);
  }
  if(!tied.length)return -1;
  // ordinal qualifier picks among same-name clusters ("second part" -> 2nd cluster)
  if(ordM&&tied.length>1){const ord={first:0,second:1,third:2,fourth:3}[ordM[1]];if(tied[ord]!=null)return tied[ord];}
  return tied[0];
}
// True when row i's zone name is mentioned in free text (row->text direction, >=60% token overlap).
function zoneMentioned(i,text){
  const r=state.report;if(!r)return false;
  const norm=s=>String(s).toLowerCase().replace(/\s+/g,' ').trim();
  const t=norm(text);
  const rn=norm(r.matrix.rows[i].ref).replace(/@[\d.]+%/,'');
  const toks=rn.split(/[^a-z0-9&]+/).filter(x=>x.length>2);
  if(!toks.length)return false;
  let hit=0;for(const x of toks)if(t.includes(x))hit++;
  return hit/toks.length>=0.6;
}
// Zoomed track-map snippet centered on zone row i (PNG data URL), or null.
function zoneMapDataUrl(i){
  const r=state.report;if(!r||!r.outline||!r.cornerPts||i<0||i>=r.cornerPts.length)return null;
  const [tx,ty]=r.cornerPts[i];if(!isFinite(tx)||!isFinite(ty))return null;
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
  for(const p of r.outline){if(!isFinite(p[0])||!isFinite(p[1]))continue;x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);}
  if((x1-x0)<1e-6||(y1-y0)<1e-6)return null;
  const W=340,H=250;
  // view window: ±20% of full track extent around the corner, clamped inside bounds
  const hw=(x1-x0)*0.2,hh=(y1-y0)*0.2;
  const cx=Math.min(Math.max(tx,x0+hw),x1-hw),cy=Math.min(Math.max(ty,y0+hh),y1-hh);
  const S=Math.min(W/(2*hw),H/(2*hh)); // px per meter (window fills the canvas)
  const X=wx=>W/2+(wx-cx)*S,Y=wy=>H/2-(wy-cy)*S;
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;
  const c=cv.getContext('2d');
  c.fillStyle='#10151c';c.fillRect(0,0,W,H);
  c.lineJoin='round';c.lineCap='round';
  c.strokeStyle='#5a6b7d';c.lineWidth=4;c.beginPath();let st=false;
  for(const p of r.outline){if(!isFinite(p[0])||!isFinite(p[1]))continue;const x=X(p[0]),y=Y(p[1]);st?c.lineTo(x,y):c.moveTo(x,y);st=true;}
  c.closePath();c.stroke();
  const sp=r.outline[0]; // start/finish tick if inside the window
  if(sp&&isFinite(sp[0])&&isFinite(sp[1])){const x=X(sp[0]),y=Y(sp[1]);if(x>-8&&x<W+8&&y>-8&&y<H+8){c.fillStyle='#e6edf3';c.fillRect(x-4,y-4,8,8);}}
  const mx=X(tx),my=Y(ty); // braking-onset marker: green circle + "B"
  c.beginPath();c.arc(mx,my,10,0,6.29);c.fillStyle='#2ecc71';c.fill();
  c.strokeStyle='#fff';c.lineWidth=2;c.stroke();
  c.fillStyle='#fff';c.font='bold 12px Segoe UI';c.textAlign='center';c.textBaseline='middle';c.fillText('B',mx,my+0.5);
  const label=String(r.matrix.rows[i].ref).replace(/@[\d.]+%/,''); // zone name above marker
  c.font='12px Segoe UI';c.textBaseline='bottom';
  let ly=my-14;if(ly<16)ly=my+28; // flip below the marker when near the top edge
  const tw=c.measureText(label).width;
  c.fillStyle='rgba(16,21,28,.75)';c.fillRect(W/2-tw/2-5,ly-13,tw+10,16);
  c.fillStyle='#e6edf3';c.fillText(label,W/2,ly+2);
  return cv.toDataURL('image/png');
}
// Render an assistant message: [map:<ref>] tags become inline track-map images;
// if the model omitted tags but named zones, append a "Zones referenced" strip.
// Pull "\u2192 " follow-up lines out of an assistant reply -> {body,fups:[...]}. Pure (headless-testable).
function extractFollowups(text){
  const fups=[],keep=[];
  for(const ln of String(text).split('\n')){const t=ln.trim();t.startsWith('\u2192')?fups.push(t.replace(/^\u2192\s*/,'').trim()):keep.push(ln);}
  return {body:keep.join('\n').replace(/\n+$/,''),fups};
}
function renderAssistant(text){
  const {body,fups}=extractFollowups(text);
  const d=document.createElement('div');d.className='msg assistant';
  let html='',last=0,m,found=false,re=/\[(map|overlay):\s*([^\]\n]+)\s*\]/g;
  while((m=re.exec(body))){
    html+=escHtml(text.slice(last,m.index));
    if(m[1]==='map'){
      const idx=findZoneRow(m[2]);
      if(idx>=0){const url=zoneMapDataUrl(idx);if(url)html+='<img class="chat-map" src="'+url+'" alt="track map: '+escHtml(state.report.matrix.rows[idx].ref)+'">';}
    }else{
      const lapNum=parseInt(m[2],10);
      if(isFinite(lapNum)){const url=overlayDataUrl(lapNum);if(url)html+='<img class="chat-overlay" src="'+url+'" alt="input overlay: lap '+lapNum+'">';}
    }
    last=re.lastIndex;found=true;
  }
  html+=escHtml(body.slice(last));
  if(!found&&state.report&&state.report.matrix.rows.length){
    const imgs=[];
    for(let i=0;i<state.report.matrix.rows.length;i++){
      if(imgs.length>=8)break;
      if(zoneMentioned(i,text)){const url=zoneMapDataUrl(i);if(url)imgs.push('<img class="chat-map" src="'+url+'" alt="track map: '+escHtml(state.report.matrix.rows[i].ref)+'">');}
    }
    if(imgs.length)html+='<div class="map-strip"><span>Zones referenced:</span>'+imgs.join('')+'</div>';
  }
  if(fups.length)html+='<div class="fup-chips">'+fups.map(q=>'<button type="button" class="fup-chip">\u2192 '+escHtml(q)+'</button>').join('')+'</div>';
  d.innerHTML=html;
  d.querySelectorAll('.fup-chip').forEach((b,i)=>b.addEventListener('click',()=>sendChat(fups[i])));
  $('chatLog').appendChild(d);
  $('chatLog').scrollTop=$('chatLog').scrollHeight;
}
function addMsg(role,text){
  const d=document.createElement('div');d.className='msg '+role;
  d.textContent=text;
  $('chatLog').appendChild(d);
  $('chatLog').scrollTop=$('chatLog').scrollHeight;
}
async function sendChat(overrideText){
  const text=(overrideText!=null?overrideText:$('chatInput').value).trim();
  if(!text)return;
  if(overrideText==null)$('chatInput').value='';
  addMsg('user',text);state.chat.push({role:'user',content:text});
  const cfg=getCfg();
  if(!cfg.baseUrl||!cfg.apiKey){addMsg('error','Set the LLM base URL and API key first.');return;}
  $('chatStatus').textContent='Contacting model\u2026';
  try{
    const res=await fetch(cfg.baseUrl.replace(/\/+$/,'')+'/chat/completions',{method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+cfg.apiKey},
      body:JSON.stringify({model:cfg.model,messages:[{role:'system',content:systemPrompt()},...state.chat.slice(-20)]})});
    if(!res.ok)throw new Error(res.status+' '+(await res.text()).slice(0,300));
    const data=await res.json();
    const content=(data.choices&&data.choices[0]&&data.choices[0].message)?data.choices[0].message.content:'(empty response)';
    renderAssistant(content);state.chat.push({role:'assistant',content:String(content).replace(/\[(?:map|overlay):[^\]\n]+\]/g,'').trim()});
  }catch(e){addMsg('error','LLM request failed: '+e.message);}
  $('chatStatus').textContent='';
}


/* ---- cross-session lap comparison (T-7): UI wiring + report rendering ---- */
// Compare one lap from any loaded .ld session against a lap from another (or the same) session,
// selected by drag-and-drop into the A / B slots. Browser mirror of Skill 2
// (compare_laps.py). Delta convention: B − A (the B lap plays 'A' in compare_laps.py;
// positive = challenge slower). The analysis functions live in the core section above so they
// can be tested headlessly against compare_laps.py.
function shortName(n){n=n||'?';return n.length>34?n.slice(0,31)+'\u2026':n;}
let crossSel={ref:null,chal:null}; // {fileIdx,lapIdx} per slot
function renderCross(){
  const slots=$('crossSlots'),pool=$('crossPool');if(!slots||!pool)return;
  // drop slots
  slots.innerHTML='';
  ['ref','chal'].forEach(role=>{
    const sel=crossSel[role];const d=document.createElement('div');d.className='xslot'+(sel?' filled':'');d.dataset.role=role;
    let inner;
    const rec=sel?lapRecord(sel.fileIdx,sel.lapIdx):null;
    if(rec){inner='<b>'+(role==='ref'?'A':'B')+'</b><span class="xs-lap">L'+rec.lap+' \u00b7 '+fmtLap(rec.dur)+'</span><span class="xs-file">'+esc(shortName(state.files[sel.fileIdx].name))+'</span>';}
    else inner='<b>'+(role==='ref'?'A':'B')+'</b><span class="xs-empty">drag a lap here</span>';
    d.innerHTML=inner;
    d.addEventListener('dragover',e=>{e.preventDefault();d.classList.add('over');});
    d.addEventListener('dragleave',()=>d.classList.remove('over'));
    d.addEventListener('drop',e=>{e.preventDefault();d.classList.remove('over');let data=null;try{data=JSON.parse(e.dataTransfer.getData('text/plain'));}catch(_){}if(data)assignCross(role,data);});
    slots.appendChild(d);
  });
  // lap pool (draggable chips, grouped per .ld session)
  pool.innerHTML='';
  let any=false;
  state.files.forEach((f,fi)=>{
    if(f.format!=='ld')return;const s=ldSession(fi);if(!s)return;any=true;
    const g=document.createElement('div');g.className='xgroup';
    g.innerHTML='<span class="xg-title">'+esc(shortName(f.name))+'</span>';
    s.report.laps.forEach((l,li)=>{
      const chip=document.createElement('div');chip.className='lapchip';chip.draggable=true;
      chip.dataset.fi=fi;chip.dataset.li=li;
      chip.innerHTML='<b>L'+l.lap+'</b> '+fmtLap(l.dur);
      chip.addEventListener('dragstart',e=>{e.dataTransfer.setData('text/plain',JSON.stringify({fileIdx:fi,lapIdx:li}));e.dataTransfer.effectAllowed='copy';});
      g.appendChild(chip);
    });
    pool.appendChild(g);
  });
  if(!any)pool.innerHTML='<p class="dim">Load at least one .ld telemetry session to compare laps across sessions.</p>';
  // keep selection valid (e.g. after a file was removed); re-render once if it went stale
  // only validate slots that are actually filled - an empty slot is not "stale"
  const okSel=sel=>!!(sel&&state.files[sel.fileIdx]&&state.files[sel.fileIdx].format==='ld'&&lapRecord(sel.fileIdx,sel.lapIdx));
  if((crossSel.ref&&!okSel(crossSel.ref))||(crossSel.chal&&!okSel(crossSel.chal))){crossSel={ref:null,chal:null};$('crossSummary').innerHTML='';renderCross();return;}
  // keep the copyable digest briefing in sync with A/B selection changes (idempotent)
  fillDigestSection();
}
function assignCross(role,data){
  const {fileIdx,lapIdx}=data;
  if(!state.files[fileIdx]||state.files[fileIdx].format!=='ld')return;
  const other=role==='ref'?'chal':'ref';
  if(crossSel[other]&&crossSel[other].fileIdx===fileIdx&&crossSel[other].lapIdx===lapIdx){alert('Both slots must hold different laps.');return;}
  crossSel[role]={fileIdx,lapIdx};
  renderCross();
  if(crossSel.ref&&crossSel.chal)runCrossComparison(crossSel.ref,crossSel.chal);
}
function runCrossComparison(refSel,chalSel){
  const A=lapRecord(refSel.fileIdx,refSel.lapIdx),B=lapRecord(chalSel.fileIdx,chalSel.lapIdx);
  if(!A||!B)return;
  // delta convention everywhere: B − A (positive = B slower / lost time; green = B faster).
  const ds=B.dur-A.dur;
  // name goes OUTSIDE the parens: shortName() truncation can cut a filename mid-parenthesis
  // (e.g. "(reflap01)" -> "(refla…)") and the closing paren then visually attaches to it).
  let html='<div class="'+(ds>0?'err':'ok')+'"><b>A</b> L'+A.lap+' \u00b7 '+fmtLap(A.dur)+' \u2014 '+esc(shortName(state.files[A.fileIdx].name))+' &nbsp;vs&nbsp; <b>B</b> L'+B.lap+' \u00b7 '+fmtLap(B.dur)+' \u2014 '+esc(shortName(state.files[B.fileIdx].name))+'</div>';
  html+='<div class="'+(ds>0?'err':'ok')+'" style="margin-top:4px">delta (chal \u2212 ref): '+(ds>0?'+':'')+ds.toFixed(3)+' s \u2014 <b>'+(ds>0?'challenge slower':(ds<0?'challenge faster':'equal'))+'</b></div>';
  // fuel disclosure - cross-session deltas are confounded by car weight
  if(A.startFuel!=null&&B.startFuel!=null){
    const fd=A.startFuel-B.startFuel;
    html+='<div class="hint" style="margin-top:6px">Start-of-lap fuel \u2014 A '+A.startFuel.toFixed(2)+' L \u00b7 B '+B.startFuel.toFixed(2)+' L (\u0394 '+(fd>=0?'+':'')+fd.toFixed(2)+' L)';
    if(Math.abs(fd)>=0.5)html+=' \u2014 <b>different fuel loads: part of the time delta is likely car weight, not driving</b>';
    html+='.</div>';
  }
  const cR=cornersFor(A.fileIdx,A.lapIdx),cC=cornersFor(B.fileIdx,B.lapIdx); // clustered braking corners per lap
  html+='<table style="margin-top:8px"><tr><th>metric</th><th>A (L'+A.lap+')</th><th>B (L'+B.lap+')</th><th>delta (B\u2212A)</th></tr>';
  const row=(label,va,vb,unit,dec)=>{const d=vb-va;return '<tr><td>'+label+'</td><td>'+(isFinite(va)?va.toFixed(dec):'-')+' '+unit+'</td><td>'+(isFinite(vb)?vb.toFixed(dec):'-')+' '+unit+'</td><td class="'+(d>0?'err':'ok')+'">'+(d>0?'+':'')+d.toFixed(dec)+' '+unit+'</td></tr>';};
  html+=row('time',A.dur,B.dur,'s',3);
  html+=row('top speed',A.topSpeed,B.topSpeed,'km/h',1);
  html+=row('max lat G',A.maxLatG,B.maxLatG,'G',2);
  html+=row('max brake G',A.maxBrakeG,B.maxBrakeG,'G',2);
  if(A.fuelUsed!=null&&B.fuelUsed!=null)html+=row('fuel used',A.fuelUsed,B.fuelUsed,'l',2);
  if(cR&&cC){
    const sR=smoothOf(cR),sC=smoothOf(cC);
    html+=row('throttle jerk RMS',sR.thr_jerk,sC.thr_jerk,'%/s\u00b2',0);
    html+=row('brake rate max',sR.brk_rate_max,sC.brk_rate_max,'%/s',0);
    html+=row('steer RMS',sR.stw_rms,sC.stw_rms,'deg/s',1);
    html+=row('steering corrections',sR.corr,sC.corr,'',0);
  }
  html+='</table>';
  // speed trace overlay by lap position (both traces on the same 401-point pos grid so the delta chart aligns)
  const sA=speedTraceFor(A.fileIdx,A.lapIdx),sB=speedTraceFor(B.fileIdx,B.lapIdx);
  if(sA&&sB){
    html+='<div style="margin-top:12px"><h3 style="margin-bottom:6px">Speed by lap position (0\u2013100%)</h3>';
    html+='<canvas id="cmpSpeedChart" width="700" height="180" style="width:100%;max-width:700px;background:#0d1117;border:1px solid #21262d;border-radius:8px"></canvas></div>';
    html+='<div style="margin-top:10px"><h3 style="margin-bottom:6px">Delta speed (B \u2212 A)</h3>';
    html+='<canvas id="cmpDeltaChart" width="700" height="120" style="width:100%;max-width:700px;background:#0d1117;border:1px solid #21262d;border-radius:8px"></canvas></div>';
  }
  // driver inputs overlay by lap position — same 401-point pos grid and the same green/orange
  // line style as the speed chart above (drawComparisonCharts, Ref = A / green, Chal = B / orange)
  const tA=pedalTraceFor(A.fileIdx,A.lapIdx),tB=pedalTraceFor(B.fileIdx,B.lapIdx);
  if(tA&&tB){
    html+='<div style="margin-top:12px"><h3 style="margin-bottom:6px">Input Overlay \u2014 driver inputs</h3>';
    html+='<p class="hint" style="margin:2px 0 8px">same lap-position grid as the speed chart \u00b7 green = A \u00b7 orange = B</p>';
    html+='<div><b style="font-size:12px;color:#eaf1f9">Throttle by lap position (0\u2013100%)</b>';
    html+='<canvas id="cmpThrChart" width="700" height="180" style="width:100%;max-width:700px;background:#0d1117;border:1px solid #21262d;border-radius:8px;display:block;margin-top:4px"></canvas></div>';
    html+='<div style="margin-top:10px"><b style="font-size:12px;color:#eaf1f9">Brake by lap position (0\u2013100%)</b>';
    html+='<canvas id="cmpBrkChart" width="700" height="180" style="width:100%;max-width:700px;background:#0d1117;border:1px solid #21262d;border-radius:8px;display:block;margin-top:4px"></canvas></div>';
    html+='<div style="margin-top:10px"><b style="font-size:12px;color:#eaf1f9">Steering by lap position (degrees, signed)</b>';
    html+='<canvas id="cmpStwChart" width="700" height="180" style="width:100%;max-width:700px;background:#0d1117;border:1px solid #21262d;border-radius:8px;display:block;margin-top:4px"></canvas></div>';
  }
  // zone matching + racing line — only meaningful when both files are the same track (Skill 2 refuses cross-track)
  let oT=null; // track-delta map outline, set in the same-track branch below
  const mA=state.files[A.fileIdx].parsed.meta,mB=state.files[B.fileIdx].parsed.meta;
  const ntr=t=>{t=(t||'').toLowerCase().trim();if(t.startsWith('rt_'))t=t.slice(3);return t.split('-')[0];};
  if(ntr(mA.track)!==ntr(mB.track)){
    html+='<p class="hint" style="margin-top:8px">Tracks differ ('+esc(mA.track||'?')+' vs '+esc(mB.track||'?')+') \u2014 zone matching and racing-line comparison are not available across tracks (Skill 2 refuses cross-track comparisons).</p>';
  } else if(cR&&cC){
    const zones=zonesFor(mB.track); // same track -> either file's table works; use the challenge file's like compare_laps uses metaA
    const {pairs,ua,ub}=matchZones(cC.corners,cR.corners); // A = challenge (delta convention)
    const lapLenM=lapLengthM(B.fileIdx,B.lapIdx)||0;
    const rows=buildRows(pairs,lapLenM,zones,rankCorners(cC.corners),mB.track);
    html+='<ul class="hint" style="margin-top:10px;padding-left:20px;line-height:1.7">'+makeSummary(B.lap,A.lap,B.dur,A.dur,isFinite(B.startFuel)?B.startFuel:0,isFinite(A.startFuel)?A.startFuel:0,rows).map(p=>'<li>'+esc(p)+'</li>').join('')+'</ul>';
    html+='<div style="margin-top:8px"><h3 style="margin-bottom:6px">Braking zones \u2014 delta = B \u2212 A</h3>';
    html+='<table><tr><th>zone</th><th>point</th><th>entry km/h (R / C)</th><th>decel G (R / C)</th><th>dur s (R / C)</th></tr>';
    rows.forEach(r=>{
      const cell=(va,vb,d,dec)=>'<td>'+vb.toFixed(dec)+' / '+va.toFixed(dec)+' <span class="'+(d>0?'err':'ok')+'">'+(d>0?'+':'')+d.toFixed(dec)+')</span></td>';
      html+='<tr style="'+(r.key?'background:#1c2128;':'')+'"><td>'+(r.key?'<b>':'')+esc(r.label)+(r.key?'</b>':'')+'</td><td>'+r.tag+(Math.abs(r.dpos)>=0.1?' ('+(r.dpos>=0?'+':'')+r.dpos.toFixed(1)+' m)':'')+'</td>';
      html+=cell(r.entryA,r.entryB,r.dEntry,1)+cell(r.decelA,r.decelB,r.dDecel,2)+cell(r.durA,r.durB,r.dDur,2);
      html+='</tr>';
      const dz=decomposeZone(r);
      if(dz.causes.length){
        html+='<tr><td></td><td colspan="4">'+dz.causes.map(c=>'<span style="display:inline-block;background:#21262d;border:1px solid #30363d;border-radius:8px;padding:1px 7px;margin:1px 4px 1px 0;font-size:11px;cursor:help" title="'+esc(makeTip(r))+'">'+esc(c.name)+(isFinite(c.delta)?' '+(c.delta>=0?'+':'')+c.delta.toFixed(1)+' '+c.unit:'')+'</span>').join(' ')+'</td></tr>';
      }
    });
    html+='</table><p class="hint">cells show A / B (delta) \u00b7 bold rows = key differences at Skill 2 thresholds \u00b7 hover a cause chip for the full diagnosis</p></div>';
    const leaks=rankLeaks(rows);
    if(leaks.length){
      html+='<div style="margin-top:10px"><b>Top zone time deltas</b> (+ = B lost):<br>'+leaks.map(l=>'<span style="display:inline-block;background:#21262d;border:1px solid #30363d;border-radius:8px;padding:1px 7px;margin:1px 4px 1px 0;font-size:11px;cursor:help" title="'+esc(l.causes.map(c=>c.name+': '+(c.delta>=0?'+':'')+c.delta.toFixed(1)+c.unit).join(' \u00b7 '))+'">'+esc(l.corner_label)+' <b>'+(l.time_total_s>=0?'+':'')+l.time_total_s.toFixed(2)+' s</b></span>').join(' ')+'</div>';
    }
    if(ua.length||ub.length){
      const rC=rankCorners(cC.corners),rR=rankCorners(cR.corners);
      html+='<p class="hint" style="margin-top:8px">Unmatched braking events \u2014 only in B: '+(ua.map(a=>esc(zoneRef(a.pos,zones,rC.get(a)||0,mB.track))+' (entry '+a.entry.toFixed(1)+' km/h)').join(', ')||'none')+' \u00b7 only in A: '+(ub.map(b=>esc(zoneRef(b.pos,zones,rR.get(b)||0,mB.track))+' (entry '+b.entry.toFixed(1)+' km/h)').join(', ')||'none')+'</p>';
    }
    // track-delta map — per-point speed delta on the shared 401 grid (preset-aware: precomputed line_grid + traces.speed for embedded reference laps)
    const oA=outlineFor(A.fileIdx,A.lapIdx),oB=outlineFor(B.fileIdx,B.lapIdx);
    if(oA&&oB){
      oT=oA;
      html+='<div style="margin-top:12px"><h3 style="margin-bottom:6px">Track delta map — per-point speed</h3>';
      html+='<canvas id="cmpTrackMap" width="700" height="500" style="width:100%;max-width:700px;background:#0d1117;border:1px solid #21262d;border-radius:8px"></canvas>';
      html+='<p class="hint">Green = B faster · Red = A faster · scroll = zoom · drag = pan · dblclick = reset</p></div>';
    }
    const lo=lineOffsetOf(cR,cC); // preset-aware: precomputed line_grid for embedded reference laps
    html+='<div style="margin-top:12px"><h3 style="margin-bottom:6px">Racing line (pedal-colored \u00b7 bright = 100% application)</h3>';
    html+='<canvas id="cmpPedalLineMap" width="700" height="500" style="width:100%;max-width:700px;background:#0d1117;border:1px solid #21262d;border-radius:8px"></canvas>';
    html+='<p class="hint">A: green = throttle \u2192 red = brake \u00b7 B: blue = throttle \u2192 purple = brake \u00b7 line fades &amp; thins as input drops \u00b7 where red/purple starts = where braking is applied<br>Line offset (B vs A): mean abs '+lo.meanAbs.toFixed(2)+' m \u00b7 max '+lo.max.toFixed(2)+' m at '+(lo.maxPos*100).toFixed(1)+'% of lap</p>';
    html+='<div style="margin-top:8px;max-width:700px"><label for="cmpLapSlider" style="font-size:12px;color:#8b949e">Race clock \u2014 A laps 0\u2192100% of its own lap time, B dot follows the same elapsed time: <span id="cmpSliderPct">0</span>%<input id="cmpLapSlider" type="range" min="0" max="100" step="0.5" value="0" style="width:640px;vertical-align:middle;margin-left:8px"></label></div>';
    html+='<div id="cmpSliderRead" class="hint" style="margin-top:6px;font-size:12px;line-height:1.6"></div>';
    html+='</div>';
  }
  // setup details (cross-section feature): formatted Ref vs Chal setup lines, challenge value in parens
  const slines=crossSetupLines(refSel,chalSel);
  if(slines.length){
    html+='<div style="margin-top:12px"><h3 style="margin-bottom:6px">Setup</h3><ul class="hint" style="margin:0;padding-left:18px;line-height:1.8">'+slines.map(l=>'<li>'+esc(l)+'</li>').join('')+'</ul><p class="hint">Setup values from the attached car-setup file(s); the value in (parens) = B lap. Flags are candidates to verify, not verdicts.</p></div>';
  }
  $('crossSummary').innerHTML=html;
  if(sA&&sB){drawComparisonCharts(sA,sB,A.lap,B.lap,$('cmpSpeedChart'),'A','B');drawComparisonDeltaChart(sA,sB,A.lap,B.lap,$('cmpDeltaChart'),'Green = B faster \u00b7 Red = A faster');}
  if(tA&&tB){drawComparisonCharts(tA.th,tB.th,A.lap,B.lap,$('cmpThrChart'),'A','B');drawComparisonCharts(tA.br,tB.br,A.lap,B.lap,$('cmpBrkChart'),'A','B');}
  const stA=steerTraceFor(A.fileIdx,A.lapIdx),stB=steerTraceFor(B.fileIdx,B.lapIdx);
  if(stA&&stB){let lo=0;stA.forEach(p=>{if(p[1]<lo)lo=p[1];});stB.forEach(p=>{if(p[1]<lo)lo=p[1];});
    drawComparisonCharts(stA,stB,A.lap,B.lap,$('cmpStwChart'),'A','B',Math.floor(lo/50)*50);}
  if(oT){drawCrossDeltaMap(oT,sA,sB);}
  drawPedalLines(cR,cC);
  // Lap-position slider: scrub the A lap 0-100%, A/B dots show both cars' position,
  // readout shows same-fraction telemetry (updateXcmpSliderRead lives in core).
  const sl=$('cmpLapSlider'),pcv=$('cmpPedalLineMap');
  if(sl&&pcv){sl.addEventListener('input',()=>{pcv.__sliderPct=+sl.value;updateXcmpSliderRead();if(pcv.__redraw)pcv.__redraw();});}
}

/* ---- event wiring + init ---- */
function wireDrop(drop,input,handler){
  drop.addEventListener('click',()=>input.click());
  input.addEventListener('change',()=>{if(input.files[0])handler(input.files[0]);input.value='';});
  ['dragover','drop'].forEach(ev=>drop.addEventListener(ev,e=>e.preventDefault()));
  drop.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)handler(f);});
}


// T-25: load-time wiring + init calls guarded as a self-contained block (the legacy big
// if-block was dissolved so every part parses standalone for external <script src> mode).
if(typeof document!=='undefined'){
$('btnSaveCfg').addEventListener('click',()=>{localStorage.setItem('srph_llm_cfg',JSON.stringify(getCfg()));llmStatus('Saved to this browser.','ok');});
$('btnTestLlm').addEventListener('click',testLlm);
$('llmModels').addEventListener('click',e=>{const c=e.target.closest('.model-chip');if(c){$('cfgModel').value=c.dataset.id;llmStatus('Selected '+c.dataset.id+' - press Save to keep it.','ok');}});
wireDrop($('telemetryDrop'),$('telemetryInput'),addTelemetryFile);
wireDrop($('setupDrop'),$('setupInput'),addSetupFile);
wireDrop($('leftDrop'),$('leftInput'),f=>addBoundaryFile('left',f));
wireDrop($('rightDrop'),$('rightInput'),f=>addBoundaryFile('right',f));

$('btnSend').addEventListener('click',sendChat);
$('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}});


// preset coach buttons; the cross-session review preset (data-xreview) builds its prompt from the
// filled A/B slots instead of the single-session digest
function presetClick(e){ // wired via addEventListener → receives the event, not the button
  const b=e.currentTarget||e.target;
  if(b.hasAttribute('data-xreview')){
    const xv=b.dataset.xreview;
    // 'health' = Level 5 car-health A/B review; data-hrow picks the canned request (default umbrella)
    const p=(xv==='grip')?crossGripPrompt(crossSel.ref,crossSel.chal)
           :(xv==='health')?crossHealthPrompt(crossSel.ref,crossSel.chal,b.dataset.hrow||'all')
           :crossReviewPrompt(crossSel.ref,crossSel.chal);
    if(!p){addMsg('error','Fill both A and B slots first.');return;}
    sendChat(p);return;
  }
  if(!state.digest){addMsg('error','Load a telemetry file (.ld or .ibt) first - the preset questions coach your actual session data.');return;}
  $('chatInput').value=b.dataset.prompt;sendChat();
}
document.querySelectorAll('.preset').forEach(b=>b.addEventListener('click',presetClick));


// Curated reference laps hydrate on track match in addTelemetryFile (refLapEntriesFor) — not at init.
loadCfg();seedCombos();renderCombos();renderLevels();renderCross();
} // end browser-only block



