function drawComparisonCharts(speedA,speedB,lapAIdx,lapBIdx,cv,labelA,labelB,minV){
  cv=cv||$('cmpSpeedChart');labelA=labelA||'Lap A';labelB=labelB||'Lap B';if(!cv)return;
  const c=cv.getContext('2d'),W=cv.width,H=cv.height;
  const padL=46,padR=10,padT=14,padB=30,plotH=H-padT-padB;
  // minV (default 0) lets signed channels like steering angle plot below the axis; with all
  // non-negative data lo stays 0 and this is byte-identical to the original speed-chart math.
  let maxV=0,minD=minV==null?0:minV;
  speedA.forEach(p=>{if(isFinite(p[1])){if(p[1]>maxV)maxV=p[1];if(p[1]<minD)minD=p[1];}});
  speedB.forEach(p=>{if(isFinite(p[1])){if(p[1]>maxV)maxV=p[1];if(p[1]<minD)minD=p[1];}});
  const lo=Math.floor(minD/50)*50,hi=(Math.ceil(maxV/50)*50)||50;
  if(hi<=lo)hi=lo+50; // flat/degenerate data: keep a defined range
  const yOf=v=>H-padB-((v-lo)/(hi-lo))*plotH;
  c.clearRect(0,0,W,H);c.font='11px Segoe UI';
  for(let v=lo;v<=hi;v+=50){const y=yOf(v);c.strokeStyle='#21262d';c.beginPath();c.moveTo(padL,y);c.lineTo(W-padR,y);c.stroke();c.fillStyle='#8b949e';c.fillText(String(v),10,y+4);}
  for(let p=0;p<=10;p+=2){const x=padL+(p/10)*(W-padL-padR);c.strokeStyle='#21262d';c.beginPath();c.moveTo(x,padT);c.lineTo(x,H-padB);c.stroke();c.fillStyle='#8b949e';c.fillText((p*10)+'%',x-10,H-padB+18);}
  // lap A (green)
  c.strokeStyle='#5fd08a';c.lineWidth=1.8;c.beginPath();let started=false;
  speedA.forEach(pt=>{if(!isFinite(pt[0])||!isFinite(pt[1]))return;const x=padL+pt[0]*(W-padL-padR)/100,y=yOf(pt[1]);started?c.lineTo(x,y):c.moveTo(x,y);started=true;});
  c.stroke();
  // lap B (orange)
  c.strokeStyle='#ffb86c';c.lineWidth=1.8;c.beginPath();started=false;
  speedB.forEach(pt=>{if(!isFinite(pt[0])||!isFinite(pt[1]))return;const x=padL+pt[0]*(W-padL-padR)/100,y=yOf(pt[1]);started?c.lineTo(x,y):c.moveTo(x,y);started=true;});
  c.stroke();
  // legend
  c.fillStyle='#5fd08a';c.fillRect(padL+4,H-padT-14,12,4);
  c.fillStyle='#eaf1f9';c.font='11px Segoe UI';c.fillText(labelA,padL+20,H-padT-11);
  c.fillStyle='#ffb86c';c.fillRect(padL+70,H-padT-14,12,4);
  c.fillStyle='#eaf1f9';c.fillText(labelB,padL+94,H-padT-11);
}
function drawComparisonDeltaChart(speedA,speedB,lapAIdx,lapBIdx,cv,caption){
  cv=cv||$('cmpDeltaChart');caption=caption||'Green = Lap B faster · Red = Lap A faster';if(!cv)return;
  const c=cv.getContext('2d'),W=cv.width,H=cv.height;
  const padL=46,padR=10,padT=14,padB=30;
  const maxDelta=20,plotH=H-padT-padB;
  const yOf=v=>Math.max(padT,Math.min(H-padB,H-padB-((v+maxDelta)/(2*maxDelta))*plotH));
  c.clearRect(0,0,W,H);c.font='11px Segoe UI';
  // grid (positive delta = up)
  for(let v=-maxDelta;v<=maxDelta;v+=10){const y=yOf(v);
    c.strokeStyle='#21262d';c.beginPath();c.moveTo(padL,y);c.lineTo(W-padR,y);c.stroke();
    c.fillStyle='#8b949e';c.fillText(String(v),10,y+4);}
  for(let p=0;p<=10;p+=2){const x=padL+(p/10)*(W-padL-padR);c.strokeStyle='#21262d';c.beginPath();c.moveTo(x,padT);c.lineTo(x,H-padB);c.stroke();
    c.fillStyle='#8b949e';c.fillText((p*10)+'%',x-10,H-padB+18);}
  // delta line — plots B − A (speed terms: positive up = B faster); green = B faster, red = A slower
  const n=Math.min(speedA.length,speedB.length);
  let prev=null;
  for(let i=0;i<n;i++){
    if(!isFinite(speedA[i][1])||!isFinite(speedB[i][1])){prev=null;continue;}
    const delta=speedB[i][1]-speedA[i][1]; // B − A
    const x=padL+speedA[i][0]*(W-padL-padR)/100,y=yOf(delta);
    if(prev){c.strokeStyle=delta>=0?'#5fd08a':'#ff5c39';c.lineWidth=1.6;c.beginPath();c.moveTo(prev[0],prev[1]);c.lineTo(x,y);c.stroke();}
    prev=[x,y];
  }
  c.fillStyle='#8b949e';c.font='11px Segoe UI';c.textAlign='right';
  c.fillText(caption,W-padR,padT+10);
}
// Brake + throttle overlay for two laps on the common lap-position grid (pedalTraceFor output).
// Brake is stroked per segment with alpha AND line width proportional to application, so the line
// fades and thins as the pedal eases off; throttle is a translucent fill. Solid = A, dashed = B.
function drawPedalChart(pedalA,pedalB,cv,labelA,labelB){
  cv=cv||$('cmpPedalChart');labelA=labelA||'Lap A';labelB=labelB||'Lap B';if(!cv||!pedalA||!pedalB)return;
  const c=cv.getContext('2d'),W=cv.width,H=cv.height;
  const padL=46,padR=10,padT=14,padB=30,plotH=H-padT-padB;
  const X=p=>padL+(p/100)*(W-padL-padR),Y=v=>H-padB-(v/100)*plotH;
  c.clearRect(0,0,W,H);c.font='11px Segoe UI';c.setLineDash([]);
  for(let v=0;v<=100;v+=25){const y=Y(v);c.strokeStyle='#21262d';c.beginPath();c.moveTo(padL,y);c.lineTo(W-padR,y);c.stroke();c.fillStyle='#8b949e';c.fillText(String(v)+'%',10,y+4);}
  for(let p=0;p<=100;p+=20){const x=X(p);c.strokeStyle='#21262d';c.beginPath();c.moveTo(x,padT);c.lineTo(x,H-padB);c.stroke();c.fillStyle='#8b949e';c.fillText(p+'%',x-10,H-padB+18);}
  const fill=(th,color)=>{if(!th.length)return;c.setLineDash([]);c.beginPath();let st=false;
    th.forEach(pt=>{const x=X(pt[0]),y=Y(pt[1]);st?c.lineTo(x,y):c.moveTo(x,y);st=true;});
    c.lineTo(X(th[th.length-1][0]),Y(0));c.lineTo(X(th[0][0]),Y(0));c.closePath();c.fillStyle=color;c.fill();};
  fill(pedalA.th,'rgba(95,208,138,0.20)');fill(pedalB.th,'rgba(255,184,108,0.16)'); // fills first so brake lines sit on top
  const strokeTop=(th,color,dash)=>{c.setLineDash(dash);c.strokeStyle=color;c.lineWidth=1;
    c.beginPath();let st=false;th.forEach(pt=>{const x=X(pt[0]),y=Y(pt[1]);st?c.lineTo(x,y):c.moveTo(x,y);st=true;});c.stroke();c.setLineDash([]);};
  strokeTop(pedalA.th,'#5fd08a',[]);strokeTop(pedalB.th,'#ffb86c',[5,4]);
  const drawBr=(br,dash)=>{let prev=null,psx=0,psy=0;c.setLineDash(dash);
    br.forEach(pt=>{const x=X(pt[0]),y=Y(pt[1]);
      if(prev){const v=(pt[1]+prev[1])/2; // fade/thin from the segment's average application (data values, not screen coords)
        c.strokeStyle='rgba(255,92,57,'+(0.18+0.82*v/100).toFixed(3)+')';c.lineWidth=1.2+2.4*(v/100);
        c.beginPath();c.moveTo(psx,psy);c.lineTo(x,y);c.stroke();}
      prev=pt;psx=x;psy=y;});
    c.setLineDash([]);};
  drawBr(pedalA.br,[]);drawBr(pedalB.br,[5,4]);
  c.fillStyle='#8b949e';c.textAlign='right';
  c.fillText(labelA+' \u2013 brake (solid) / '+labelB+' (dashed): line fades & thins as application drops',W-padR,padT+10);
  c.fillText('fills: throttle '+labelA+' green / '+labelB+' orange',W-padR,padT+24);
  c.textAlign='left';
}

// Cross-session track-delta map: per-point speed delta on the shared 401 grid, colored on the
// A lap's outline. Green = B faster / Red = A faster.
// Fixes a latent alignment issue of the legacy in-file map, where the ~700-pt resampled outline was
// indexed against per-raw-sample speed traces (colors came from ~3× earlier in the lap than drawn).
function drawCrossDeltaMap(outline,speedA,speedB){
  const cv=$('cmpTrackMap');if(!cv)return;
  const c=cv.getContext('2d'),W=cv.width,H=cv.height,pad=30;
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9,okCount=0;
  outline.forEach(p=>{if(!isFinite(p[0])||!isFinite(p[1]))return;x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);okCount++;});
  if(okCount<2){cv.__base=null;cv.__redraw=null;return;} // no usable coords -> also disable stale zoom/pan from a previous render
  const sc=Math.min((W-2*pad)/(x1-x0),(H-2*pad)/(y1-y0));
  const ox=(W-(x1-x0)*sc)/2,oy=(H-(y1-y0)*sc)/2;
  const n=Math.min(outline.length,speedA.length,speedB.length); // all three on the same 401 grid
  cv.__zoom=null; // each comparison is a fresh view -> start at identity zoom
  function draw(){
    const Z=cv.__zoom||{k:1,ax:ox,ay:oy};cv.__zoom=Z;const S=sc*Z.k;
    const X=wx=>Z.ax+(wx-x0)*S,Y=wy=>Z.ay+(y1-wy)*S; // world->screen incl. user zoom/pan
    cv.__base={ox,oy,s:sc};cv.__redraw=draw;
    c.clearRect(0,0,W,H);c.lineJoin='round';c.lineCap='round';
    for(let i=0;i<n-1;i++){
      const pa=outline[i],pb=outline[i+1];
      if(!isFinite(pa[0])||!isFinite(pa[1])||!isFinite(pb[0])||!isFinite(pb[1]))continue;
      const delta=speedB[i][1]-speedA[i][1]; // positive = B faster
      c.strokeStyle=delta>=0?'#5fd08a':'#ff5c39';
      c.lineWidth=4;
      c.beginPath();c.moveTo(X(pa[0]),Y(pb[1]));c.lineTo(X(pb[0]),Y(pb[1]));c.stroke();
    }
    const sp=outline[0];
    if(isFinite(sp[0])&&isFinite(sp[1])){c.fillStyle='#e6edf3';c.fillRect(X(sp[0])-4,Y(sp[1])-4,8,8);}
    c.fillStyle='#5fd08a';c.font='12px Segoe UI';c.fillText('Green = B faster',10,18);
    c.fillStyle='#ff5c39';c.fillText('Red = A faster',10,34);
    c.fillStyle='#8b949e';c.font='11px Segoe UI';
    c.fillText('scroll = zoom · drag = pan · dblclick = reset',10,H-12);
  }
  wireZoomPan(cv); // wheel-zoom / drag-pan / dblclick-reset (idempotent)
  draw();
}

/* ---- .ibt report rendering (mirrors analyze_ibt.print_debrief) ---- */
function renderIbtReport(a){
  const body=$('reportBody');
  let html=`<div style="font-size:13px;color:#eaf1f9"><b>${esc(a.track_display)}</b> &middot; iRacing .ibt${a.config?' &middot; '+esc(a.config):''}</div>`;
  const env=[];
  if(a.session_type)env.push('session: '+esc(String(a.session_type)));
  if(a.surface_temp!=null)env.push('surface '+esc(String(a.surface_temp)));
  if(a.air_temp!=null)env.push('air '+esc(String(a.air_temp)));
  if(a.humidity!=null)env.push('RH '+esc(String(a.humidity))+'%');
  if(a.wind!=null)env.push('wind '+esc(String(a.wind)));
  html+=`<div class="hint">${env.join(' &middot; ')||'no session metadata'} - ${a.meta.tick_rate} Hz, ${a.n.toLocaleString()} records</div>`;
  // data window + laps present
  html+='<h2 style="margin-top:14px">Data window<span class="lvbadge">L1</span></h2>';
  html+=`<p class="hint">${fmtT(a.t[0])} &rarr; ${fmtT(a.t[a.n-1])} (${a.span_s.toFixed(1)} s) - lap coverage ${a.pct_first.toFixed(1)}% &rarr; ${a.pct_last.toFixed(1)}%`+
    (a.track_len_m!=null?` of a ${(a.track_len_m/1000).toFixed(2)} km track (${a.num_turns??'?'} turns)`:'')+'</p>';
  if(a.laps.length){
    html+='<table><tr><th>lap</th><th>time (in-window)</th></tr>';
    for(const [L,tt] of a.laps)html+=`<tr><td>L${L}</td><td>${fmtT(tt)}</td></tr>`;
    html+='</table>';
  }
  if(a.top_speed_kmh!=null)html+=`<p class="hint">top speed: ${a.top_speed_kmh.toFixed(1)} km/h at ${(a.pct_top/100).toFixed(2)} of lap</p>`;
  // off-track excursion + sim incident flags
  if(a.offtrack_i!=null){
    const oi=a.offtrack_i;
    html+='<h2 style="margin-top:14px">Off-track excursion<span class="lvbadge">L1</span></h2>'+
      `<p>left track at ${fmtT(a.t[oi])} (${(a.pct[oi]*100).toFixed(1)}% of lap) at ${(a.spd[oi]*3.6).toFixed(0)} km/h, brake input ${(a.brk[oi]*100).toFixed(0)}%</p>`;
    if(a.ontrack_again_i!=null)html+=`<p class="hint">back on track at ${fmtT(a.t[a.ontrack_again_i])}</p>`;
  }
  if(a.incident_spikes.length){
    html+='<h2 style="margin-top:14px">Sim incident flags<span class="lvbadge">L1</span></h2><ul>';
    for(const [tt,v] of a.incident_spikes)html+=`<li>t=${fmtT(tt)} (code ${v})</li>`;
    html+='</ul>';
  }
  // heading-change events (corners)
  html+='<h2 style="margin-top:14px">Heading-change events (&vert;turn rate&vert; &gt; 8 deg/s while &gt; 54 km/h)<span class="lvbadge">L1</span></h2>';
  if(a.corners.length){
    html+='<table><tr><th>lap position</th><th>entry speed</th><th>heading change</th></tr>';
    for(const [p0,p1,v,dh,dir] of a.corners)html+=`<tr><td>${p0.toFixed(1)}% &rarr; ${p1.toFixed(1)}%</td><td>~${v.toFixed(0)} km/h</td><td>${dh>=0?'+':''}${dh.toFixed(0)}&deg; (${dir})</td></tr>`;
    html+='</table>';
  } else html+='<p class="hint">none - the run covered essentially straight track</p>';
  // smoothness metrics
  const sm=a.smooth;
  html+='<h2 style="margin-top:14px">Smoothness (on-track moving phase)<span class="lvbadge">L1</span></h2>'+
    '<table><tr><th>metric</th><th>value</th></tr>'+
    `<tr><td>throttle rate RMS</td><td>${sm.thr_rate_rms.toFixed(1)} %/s</td></tr>`+
    `<tr><td>jerk RMS</td><td>${sm.thr_jerk_rms.toFixed(0)} %/s&sup2;</td></tr>`+
    `<tr><td>steering rate RMS</td><td>${sm.steer_rate_rms.toFixed(1)} deg/s</td></tr>`+
    `<tr><td>peak decel</td><td>${sm.max_decel.toFixed(2)} m/s&sup2;</td></tr></table>`;
  // --- track map + charts (port of analyze_ibt.build_html SVGs) ---
  if(a.map_x&&a.chart){
    html+='<h2 style="margin-top:14px">Track map (colored by speed)<span class="lvbadge">L1</span></h2>'
      +'<canvas id="ibtMap" width="760" height="520" style="width:100%;max-width:760px;background:#0d1117;border:1px solid #21262d;border-radius:8px"></canvas>';
    html+='<h2 style="margin-top:14px">Speed trace<span class="lvbadge">L1</span></h2>'
      +'<canvas id="ibtSpdChart" width="760" height="240" style="width:100%;max-width:760px;background:#0d1117;border:1px solid #21262d;border-radius:8px"></canvas>';
    if(a.chart.delta_best)html+='<h2 style="margin-top:14px">Delta to session best lap<span class="lvbadge">L1</span></h2>'
      +'<canvas id="ibtDeltaChart" width="760" height="240" style="width:100%;max-width:760px;background:#0d1117;border:1px solid #21262d;border-radius:8px"></canvas>';
  }
  // copyable digest (same pattern as renderReport)
  html+='<details><summary>Copyable text digest (sent to the LLM)</summary><pre class="digest" id="digestPre"></pre>'+
        '<button type="button" id="btnCopyDigest" style="margin-top:8px">Copy digest</button></details>';
  body.innerHTML=html;
  // Self-contained briefing (header + mode line + measured data) — pasteable into any
  // external LLM session. Filled here because innerHTML above resets it.
  fillDigestSection();
  
  
  // --- draw track map + charts (port of analyze_ibt.build_html SVGs) ---
  if(a.map_x&&a.chart){
    drawIbtTrackMap(a);
    const spdSeries=a.chart.pct.map((p,i)=>[p,a.chart.spd_kmh[i]]);
    let shade=null;
    if(a.offtrack_i!=null){const endPct=a.pct[a.ontrack_again_i!=null?a.ontrack_again_i:a.run_i1]*100;shade=[[a.pct[a.offtrack_i]*100,endPct,'rgba(255,82,82,.15)']];}
    drawIbtLineChart('ibtSpdChart',spdSeries,'Speed vs lap position','km/h',40.0,0,Math.max(a.top_speed_kmh||60,60),shade);
    if(a.chart.delta_best){const dSeries=a.chart.pct.map((p,i)=>[p,a.chart.delta_best[i]]);drawIbtLineChart('ibtDeltaChart',dSeries,'Running delta vs session best','s',40.0,0,null,null);}
  }
}
// speed_color port: yellow (slow) -> red (fast), u = v_kmh / vmax clamped to [0,1]
function ibtSpeedColor(vKmh,vmax){
  const u=Math.min(1.0,vKmh/Math.max(vmax,1e-6));let r,g,b;
  if(u<0.5){r=Math.round(255*u*2);g=Math.round(255*(u*2));b=230;}
  else{r=255;g=Math.round(255*(1-(u-0.5)*2));b=60;}
  return 'rgb('+r+','+g+','+b+')';
}
// Draw the GPS track colored by speed, with start/stop/off-track markers (port of analyze_ibt.svg_track_map).
function drawIbtTrackMap(a){
  const cv=$('ibtMap');if(!cv)return;
  const c=cv.getContext('2d'),W=cv.width,H=cv.height,pad=40;
  let xmin=1e9,xmax=-1e9,ymin=1e9,ymax=-1e9,ok=false;
  for(let i=0;i<a.n;i++){if(!isFinite(a.map_x[i])||!isFinite(a.map_y[i]))continue;xmin=Math.min(xmin,a.map_x[i]);xmax=Math.max(xmax,a.map_x[i]);ymin=Math.min(ymin,a.map_y[i]);ymax=Math.max(ymax,a.map_y[i]);ok=true;}
  if(!ok)return; // no usable GPS data — leave canvas blank rather than drawing garbage
  const s=Math.min((W-2*pad)/Math.max(xmax-xmin,1e-6),(H-2*pad)/Math.max(ymax-ymin,1e-6));
  const px=xi=>pad+(xi-xmin)*s;
  const py=yi=>H-pad-(yi-ymin)*s;
  c.clearRect(0,0,W,H);c.lineCap='round';
  let vmax=a.top_speed_kmh;if(vmax==null){let m=0;for(let i=0;i<a.n;i++)if(a.spd[i]>m)m=a.spd[i];vmax=m*3.6;}
  const step=Math.max(1,Math.floor(a.n/900)); // ~900 segments, mirrors svg_track_map
  for(let i=0;i+step<a.n;i+=step){
    c.strokeStyle=ibtSpeedColor(a.spd[i]*3.6,vmax);
    c.lineWidth=3;
    c.beginPath();c.moveTo(px(a.map_x[i]),py(a.map_y[i]));c.lineTo(px(a.map_x[i+step]),py(a.map_y[i+step]));c.stroke();
  }
  if(isFinite(a.map_x[0])&&isFinite(a.map_y[0])){ // start marker (port of svg_track_map)
    c.fillStyle='#4fc3f7';c.beginPath();c.arc(px(a.map_x[0]),py(a.map_y[0]),7,0,6.29);c.fill();
    c.fillStyle='#9fd8ff';c.font='12px Segoe UI';c.textAlign='left';c.fillText('start (stopped)',px(a.map_x[0])+10,py(a.map_y[0])-8);
  }
  if(isFinite(a.map_x[a.n-1])&&isFinite(a.map_y[a.n-1])){ // stop marker (port of svg_track_map)
    c.fillStyle='#b0bec5';c.beginPath();c.arc(px(a.map_x[a.n-1]),py(a.map_y[a.n-1]),7,0,6.29);c.fill();
    c.fillStyle='#cfd8dc';c.font='12px Segoe UI';c.textAlign='left';c.fillText('stop',px(a.map_x[a.n-1])+10,py(a.map_y[a.n-1])-8);
  }
  if(a.offtrack_i!=null&&isFinite(a.map_x[a.offtrack_i])&&isFinite(a.map_y[a.offtrack_i])){ // off-track marker ring (port of svg_track_map)
    c.strokeStyle='#ff5252';c.lineWidth=3;c.beginPath();c.arc(px(a.map_x[a.offtrack_i]),py(a.map_y[a.offtrack_i]),9,0,6.29);c.stroke();
    c.fillStyle='#ff8a80';c.font='12px Segoe UI';c.textAlign='left';c.fillText('off track @ '+(a.spd[a.offtrack_i]*3.6).toFixed(0)+' km/h',px(a.map_x[a.offtrack_i])+12,py(a.map_y[a.offtrack_i])+4);
  }
  c.strokeStyle='#e0e0e0';c.lineWidth=2;c.beginPath();c.moveTo(W-40,50);c.lineTo(W-40,20);c.stroke(); // north arrow (port of svg_track_map)
  c.fillStyle='#e0e0e0';c.font='11px Segoe UI';c.textAlign='left';c.fillText('N',W-46,14);
  c.lineWidth=3;c.beginPath();c.moveTo(30,H-25);c.lineTo(30+100*s,H-25);c.stroke(); // scale bar (port of svg_track_map)
  c.fillText('100 m',30,H-32);
}
// Generic line chart on canvas (port of analyze_ibt.svg_line_chart). series: [[x,y],...]; shade: [[x0,x1,color],...]
function drawIbtLineChart(cvId,series,title,ylabel,xmax,ymin,ymax,shade){
  const cv=$(cvId);if(!cv)return;
  const c=cv.getContext('2d'),W=cv.width,H=cv.height;
  const padL=52,padR=16,padT=18,padB=30;
  let xs=[],ys=[];series.forEach(pt=>{xs.push(pt[0]);ys.push(pt[1]);});
  if(!xs.length)return;
  let x0v=Math.min.apply(null,xs),x1v=(xmax!=null?xmax:Math.max.apply(null,xs));
  let y0v=(ymin!=null?ymin:Math.min.apply(null,ys)),y1v=(ymax!=null?ymax:Math.max.apply(null,ys));
  if(x1v-x0v<1e-9)x1v=x0v+1;
  if(y1v-y0v<1e-9)y1v=y0v+1;
  const px=v=>padL+(v-x0v)/(x1v-x0v)*(W-padL-padR);
  const py=v=>H-padB-(v-y0v)/(y1v-y0v)*(H-padT-padB);
  c.clearRect(0,0,W,H);c.font='11px Segoe UI';
  (shade||[]).forEach(([sx0,sx1,col])=>{c.fillStyle=col;c.fillRect(px(sx0),padT,Math.max(px(sx1)-px(sx0),0),H-padT-padB);});
  for(let k=0;k<5;k++){
    const gx=x0v+(x1v-x0v)*k/4,gy=y0v+(y1v-y0v)*k/4;
    c.strokeStyle='#2a3138';c.beginPath();c.moveTo(px(gx),padT);c.lineTo(px(gx),H-padB);c.stroke();
    c.beginPath();c.moveTo(padL,py(gy));c.lineTo(W-padR,py(gy));c.stroke();
    c.fillStyle='#8b98a5';c.textAlign='center';c.fillText(String(Math.round(gx)),px(gx),H-10);
    c.fillStyle='#8b8b98';c.textAlign='right';c.fillText(String(Math.round(gy)),padL-6,py(gy)+4);
  }
  c.strokeStyle='#4fc3f7';c.lineWidth=2;c.beginPath();
  let started=false;
  series.forEach(pt=>{if(!isFinite(pt[0])||!isFinite(pt[1]))return;const X=px(pt[0]),Y=py(pt[1]);started?c.lineTo(X,Y):c.moveTo(X,Y);started=true;});
  c.stroke();
  c.textAlign='left';c.fillStyle='#cfd8dc';c.font='13px Segoe UI';c.fillText(title,padL,padT-5);
  c.font='11px Segoe UI';c.textAlign='right';c.fillStyle='#8b98a5';c.fillText('% of lap',W-padR,H-10);
  c.textAlign='left';c.fillStyle='#8b98a5';c.fillText(ylabel,14,padT+2);
}

/* ---- coach chat (browser-side LLM call) ---- */
