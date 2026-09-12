'use strict';
const BUILD='v14';
const $=s=>document.querySelector(s);
const TAGS=['Observation','Issue','Action','Safety'];
const NOTE_KEYS=['note','tag','area','sheet','owner','due','itemId'];
const STORES=['visits','photos','meta','projects'];
let db,stream,track,visit=null,pending=null,projects=[],allVisits=[],selectedProject=null;
let area='',recent=[],count=0,busy=false,cur=null,lastId=null,undoTimer=null,reviewing=false;
let nativeZoom=null,zoom=1,maxZoom=5,captureTask=Promise.resolve(),readyBlob=null,readyName='',detailUrl=null;
let urls=[],itemUrls=[],editingItem=null,itemsFromStart=false;
const svr=n=>'SVR '+String(n).padStart(3,'0');
const dateInput=ts=>{const d=new Date(ts);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const fmt=ts=>new Date(ts).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
function showError(e){console.error(e);alert((e&&e.message?e.message:String(e))+' Please try again.');}
let actionQueue=Promise.resolve();
function safe(fn){return (...args)=>{const task=actionQueue.then(()=>fn(...args));actionQueue=task.catch(showError);return actionQueue;};}
function on(id,fn){$(id).onclick=safe(fn);}
function clone(x){return structuredClone(x);}
function stored(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function remember(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
function openDB(){return new Promise((resolve,reject)=>{
 const req=indexedDB.open('rdg-sitevisit',4);
 req.onupgradeneeded=()=>{
  const d=req.result,tx=req.transaction;
  for(const name of STORES){if(!d.objectStoreNames.contains(name))d.createObjectStore(name,{keyPath:'id',autoIncrement:name!=='meta'});}
  const photos=tx.objectStore('photos');
  if(!photos.indexNames.contains('visitId'))photos.createIndex('visitId','visitId');
  const visits=tx.objectStore('visits');
  if(!visits.indexNames.contains('projectId'))visits.createIndex('projectId','projectId');
 };
 req.onsuccess=()=>{const d=req.result;d.onversionchange=()=>{d.close();alert('An app update is ready. Close and reopen this app.');};resolve(d);};
 req.onerror=()=>reject(req.error);req.onblocked=()=>alert('Close other tabs of Site Visit, then reopen this page.');
});}
function transaction(names,mode,work){return new Promise((resolve,reject)=>{
 const tx=db.transaction(names,mode);let result;
 tx.oncomplete=()=>resolve(typeof result==='function'?result():result);
 tx.onerror=()=>reject(tx.error||new Error('Could not save data.'));
 tx.onabort=()=>reject(tx.error||new Error('The save was interrupted.'));
 try{result=work(tx);}catch(e){tx.abort();reject(e);}
});}
function read(name,key,index){return transaction([name],'readonly',tx=>{
 const s=index?tx.objectStore(name).index(index):tx.objectStore(name);
 const q=key===undefined?s.getAll():s.get(key);return ()=>q.result;
});}
function getMany(name,index,key){return transaction([name],'readonly',tx=>{const q=tx.objectStore(name).index(index).getAll(key);return ()=>q.result;});}
function put(name,r){return transaction([name],'readwrite',tx=>{const q=tx.objectStore(name).put(r);return ()=>q.result;});}
const allV=()=>read('visits'),oneP=id=>read('photos',id),oneM=id=>read('meta',id),putV=v=>put('visits',v);
function joinMeta(pr,mr){const out={id:pr.id,visitId:pr.visitId,ts:pr.ts,blob:pr.blob};NOTE_KEYS.forEach(k=>out[k]=mr&&Object.prototype.hasOwnProperty.call(mr,k)?mr[k]:(pr[k]||''));return out;}
async function photosFor(id){const ps=await getMany('photos','visitId',id);return transaction(['meta'],'readonly',tx=>{
 const requests=ps.map(p=>tx.objectStore('meta').get(p.id));
 return ()=>ps.map((p,i)=>joinMeta(p,requests[i].result)).sort((a,b)=>a.ts-b.ts);
});}
const visitPhotos=()=>visit?photosFor(visit.id):Promise.resolve([]);
function countFor(id){return transaction(['photos'],'readonly',tx=>{const q=tx.objectStore('photos').index('visitId').count(id);return ()=>q.result;});}
function savePhoto(vid,ts,blob,shotArea){return transaction(['photos','meta'],'readwrite',tx=>{
 const q=tx.objectStore('photos').add({visitId:vid,ts,blob});
 q.onsuccess=()=>tx.objectStore('meta').add({id:q.result,note:'',tag:'',area:shotArea,sheet:'',owner:'',due:'',itemId:''});
 return ()=>q.result;
});}
function editable(){if(!visit||visit.closed)throw new Error('This visit is complete. Its report history is read only.');}
async function persistVisit(next){await putV(next);if(visit&&visit.id===next.id)visit=next;readyBlob=null;}
async function deletePhoto(id){editable();const next=clone(visit);
 if(next.items.some(i=>i.photoId===id))throw new Error('This photo is the original evidence for a tracked item. Keep it with the item history.');
 next.items.forEach(i=>i.followupPhotoIds=(i.followupPhotoIds||[]).filter(p=>p!==id));
 await transaction(['photos','meta','visits'],'readwrite',tx=>{tx.objectStore('photos').delete(id);tx.objectStore('meta').delete(id);tx.objectStore('visits').put(next);});visit=next;readyBlob=null;
}
function dueValue(value,ts){if(value==='One week'||value==='Two weeks'){const d=new Date(ts);d.setDate(d.getDate()+(value==='One week'?7:14));return dateInput(d);}return value||'';}
function newItem(v,data={}){v.itemSeq=(v.itemSeq||0)+1;return {id:'item:'+v.id+':'+v.itemSeq,ref:String(v.num).padStart(3,'0')+'.'+String(v.itemSeq).padStart(2,'0'),originVisitId:v.id,firstVisitNum:v.num,firstNoted:v.date,note:'',owner:'',due:'',area:'',status:'New',update:'',photoId:null,followupPhotoIds:[],...data};}
async function migrate(){
 const vs=(await allV()).sort((a,b)=>a.id-b.id),ps=await read('projects');
 if(vs.every(v=>v.schema===9))return;
 const grouped=new Map(ps.map(p=>[p.key,p]));let nextProject=Math.max(0,...ps.map(p=>p.id))+1;
 for(const v of vs){if(v.schema===9)continue;
  const key=(v.projNum?'number:'+v.projNum.trim().toLowerCase():'name:'+(v.project||'Unassigned project').trim().toLowerCase());
  if(!grouped.has(key))grouped.set(key,{id:nextProject++,key,name:v.project||'Unassigned project',number:v.projNum||''});
  v.projectId=grouped.get(key).id;v.items=[];v.itemSeq=0;
  for(const r of await photosFor(v.id))if(r.tag==='Issue'||r.tag==='Action')v.items.push(newItem(v,{photoId:r.id,note:r.note,owner:r.owner,due:dueValue(r.due,v.date),area:r.area,firstNoted:r.ts}));
  v.closed=!!(v.closed||v.exported);if(v.closed)v.legacyReportItems=clone(v.items);v.schema=9;
 }
 // Preserve all previous report numbers. Only future numbers become project specific.
 for(const p of grouped.values()){
  const pv=vs.filter(v=>v.projectId===p.id).sort((a,b)=>a.id-b.id);let carried=[];
  for(const v of pv){const own=v.items.filter(i=>i.originVisitId===v.id);v.items=[...carried.filter(i=>i.status!=='Closed').map(i=>({...clone(i),status:'Not reviewed',update:''})),...own];carried=v.items;}
  const active=pv.filter(v=>!v.closed);active.slice(0,-1).forEach(v=>{v.closed=true;v.migrationNote='Earlier unfinished visit preserved as complete during upgrade.';});
 }
 await transaction(['projects','visits'],'readwrite',tx=>{grouped.forEach(p=>tx.objectStore('projects').put(p));vs.forEach(v=>tx.objectStore('visits').put(v));});
}
function currentProject(){return projects.find(p=>p.id===selectedProject);}
async function loadState(){
 projects=(await read('projects')).sort((a,b)=>a.name.localeCompare(b.name));allVisits=(await allV()).sort((a,b)=>a.id-b.id);
 if(!projects.some(p=>p.id===selectedProject))selectedProject=projects.some(p=>p.id===stored('selectedProject',null))?stored('selectedProject',null):projects[0]?.id||null;
 pending=allVisits.filter(v=>v.projectId===selectedProject&&!v.closed).pop()||null;
 remember('selectedProject',selectedProject);await paintStart();await paintCleanupNotice();
}
async function paintStart(){
 const select=$('#projectSelect');select.replaceChildren();
 if(!projects.length)select.add(new Option('Add your first project',''));
 projects.forEach(p=>select.add(new Option(p.name+(p.number?' · '+p.number:''),p.id)));
 select.value=selectedProject==null?'':String(selectedProject);
 $('#selectedProjectName').textContent=currentProject()?.name||'No project selected';
 const pv=allVisits.filter(v=>v.projectId===selectedProject),nextNum=Math.max(0,...pv.map(v=>v.num))+1;
 $('#sDate').textContent=new Date().toLocaleDateString();$('#sBuild').textContent='Build '+BUILD;
 $('#sState').textContent=pending?svr(pending.num)+' is in progress.':projects.length?'Next visit: '+svr(nextNum):'Create a project to start your first visit.';
 $('#resumeBtn').style.display=pending?'block':'none';$('#resumeBtn').textContent=pending?'Resume '+svr(pending.num)+' ('+await countFor(pending.id)+' photos)':'';
 $('#startBtn').style.display=pending?'none':'block';$('#startBtn').textContent='Start new visit';
 $('#sNum').textContent=pending?svr(pending.num)+' in progress':'Next '+svr(nextNum);
 const past=pv.filter(v=>v.closed).sort((a,b)=>b.id-a.id);$('#pastWrap').style.display=past.length?'block':'none';$('#pastList').replaceChildren();
 for(const v of past){const b=document.createElement('button');b.className='prow';const a=document.createElement('span');a.className='pn';a.textContent=svr(v.num);const d=document.createElement('span');d.className='pd';d.textContent=(v.localPhotosRemovedAt?'Photos removed · ':'')+new Date(v.date).toLocaleDateString()+' · '+(v.items||[]).filter(i=>i.status!=='Closed').length+' open items';b.append(a,d);b.onclick=safe(()=>openPast(v));$('#pastList').append(b);}
}
on('#addProject',async()=>{const name=prompt('Project name');if(!name?.trim())return;const number=prompt('Project number (optional)');if(number===null)return;
 const key=number.trim()?'number:'+number.trim().toLowerCase():'name:'+name.trim().toLowerCase();
 const exists=projects.find(p=>p.key===key);if(exists){selectedProject=exists.id;await loadState();return;}
 selectedProject=await put('projects',{name:name.trim(),number:number.trim(),key});await loadState();});
on('#editProject',async()=>{const p=currentProject();if(!p)return;const name=prompt('Project name',p.name);if(!name?.trim())return;const number=prompt('Project number',p.number);if(number===null)return;const key=number.trim()?'number:'+number.trim().toLowerCase():'name:'+name.trim().toLowerCase();if(projects.some(x=>x.id!==p.id&&x.key===key))throw new Error('That project already exists.');await put('projects',{...p,name:name.trim(),number:number.trim(),key});await loadState();});
$('#projectSelect').onchange=safe(async()=>{selectedProject=Number($('#projectSelect').value);await loadState();});
async function newVisit(){const p=currentProject();if(!p)return $('#addProject').click();
 const pv=(await allV()).filter(v=>v.projectId===p.id).sort((a,b)=>a.id-b.id);
 if(pv.some(v=>!v.closed))throw new Error('Resume and complete the existing visit before starting another for this project.');
 const prev=pv.at(-1),v={schema:9,projectId:p.id,num:Math.max(0,...pv.map(v=>v.num))+1,date:Date.now(),started:Date.now(),project:p.name,projNum:p.number,attendees:'',preparedBy:prev?.preparedBy||stored('preparedBy',''),weather:'',temp:'',closed:false,exported:false,itemSeq:0,items:(prev?.items||[]).filter(i=>i.status!=='Closed').map(i=>({...clone(i),status:'Not reviewed',update:''}))};
 v.id=await putV(v);await enterCapture(v);if(v.items.length)await openItems(true);
}
on('#startBtn',async()=>{if(busy)return;$('#startBtn').disabled=true;try{await newVisit();}finally{$('#startBtn').disabled=false;}});
on('#resumeBtn',()=>enterCapture(pending));
function saveAreas(){if(visit)remember('areas:'+visit.projectId,{area,recent});}
async function enterCapture(v){visit=clone(v);reviewing=false;const a=stored('areas:'+v.projectId,{area:'',recent:[]});area=a.area;recent=a.recent;lastId=null;$('#undo').classList.remove('show');$('#start').classList.add('hide');await refreshCount();paintProj();paintArea();fetchWeather(v.id);startCam();}
async function openPast(v){visit=clone(v);reviewing=true;$('#start').classList.add('hide');paintProj();await openGal();}
function stopCamera(){cameraRequest++;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;track=null;}
async function backToStart(){await captureTask;stopCamera();visit=null;reviewing=false;readyBlob=null;lastId=null;
 document.querySelectorAll('.sheet,.areasheet,.scrim').forEach(e=>e.classList.remove('open'));$('#busyWrap').classList.remove('show');$('#undo').classList.remove('show');releaseUrls();await loadState();$('#start').classList.remove('hide');}
function paintProj(){if(visit)$('#projBtn').textContent=svr(visit.num);}
on('#pauseBtn',e=>{e.stopPropagation();return backToStart();});on('#finishBtn',e=>{e.stopPropagation();return openGal();});
function fetchWeather(vid){const epoch=dataEpoch;if(!navigator.geolocation||visit.weather)return;navigator.geolocation.getCurrentPosition(async pos=>{try{
 const url='https://api.open-meteo.com/v1/forecast?latitude='+pos.coords.latitude+'&longitude='+pos.coords.longitude+'&current=temperature_2m,weather_code&temperature_unit=fahrenheit';
 const response=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)return;const j=await response.json();if(epoch!==dataEpoch)return;
 // Fetch only updates the original visit, and never a completed or manually edited record.
 await transaction(['visits'],'readwrite',tx=>{const s=tx.objectStore('visits'),q=s.get(vid);q.onsuccess=()=>{const v=q.result;if(!v||v.closed||v.weather)return;v.weather=wmo(j.current.weather_code);v.temp=Math.round(j.current.temperature_2m)+' F';s.put(v);if(visit?.id===vid){visit.weather=v.weather;visit.temp=v.temp;}};});
 }catch{}},()=>{},{timeout:8000,maximumAge:900000});}
function wmo(c){return ({0:'Clear',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Fog',48:'Fog',51:'Light drizzle',53:'Drizzle',55:'Heavy drizzle',61:'Light rain',63:'Rain',65:'Heavy rain',71:'Light snow',73:'Snow',75:'Heavy snow',80:'Rain showers',81:'Rain showers',82:'Heavy showers',95:'Thunderstorm',96:'Thunderstorm',99:'Thunderstorm'})[c]||'Weather code '+c;}
/* ---------- camera ---------- */
let cameraRequest = 0;
async function startCam(){
  if($('#cloudSheet').classList.contains('open'))return;
  const request = ++cameraRequest;
  try{
    if(stream) stream.getTracks().forEach(t=>t.stop());
    const acquired = await navigator.mediaDevices.getUserMedia({
      video:{ facingMode:{ideal:"environment"}, width:{ideal:3840}, height:{ideal:2160} }, audio:false });
    if(request !== cameraRequest || !visit || reviewing || !$("#start").classList.contains("hide")){ acquired.getTracks().forEach(t=>t.stop()); return; }
    stream = acquired; track = stream.getVideoTracks()[0];
    const v = $("#cam");
    v.srcObject = stream;
    await v.play().catch(()=>{});
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    nativeZoom = (caps.zoom && caps.zoom.max > caps.zoom.min) ? caps.zoom : null;
    maxZoom = nativeZoom ? Math.min(caps.zoom.max, 8) : 5;
    zoom = 1; buildZoomRow(); applyZoom();
    $("#stall").classList.remove("show");
  }catch(err){
    $("#stall").textContent = "Camera blocked. Tap to try again.";
    $("#stall").classList.add("show");
  }
}
setInterval(() => {
  if(document.hidden) return;
  if(!visit || reviewing || !$("#start").classList.contains("hide")) return;
  if(document.querySelector(".sheet.open")) return;
  const v = $("#cam");
  const dead = !stream || !track || track.readyState !== "live" || v.paused || v.readyState < 2;
  if(dead){ v.play().catch(()=>{}); $("#stall").textContent = "Camera stalled. Tap to restart."; $("#stall").classList.add("show"); }
  else $("#stall").classList.remove("show");
}, 1500);
$("#stall").onclick = e => { e.stopPropagation(); startCam(); };
document.addEventListener("visibilitychange", () => {
  if(document.hidden || !visit || reviewing) return;
  $("#cam").play().catch(()=>{});
  if(!stream || !track || track.readyState !== "live") startCam();
});

/* ---------- zoom ---------- */
function applyZoom(){
  zoom = Math.max(1, Math.min(maxZoom, zoom));
  if(nativeZoom && track){
    const val = Math.max(nativeZoom.min, Math.min(nativeZoom.max, zoom));
    track.applyConstraints({ advanced:[{ zoom: val }] }).catch(()=>{});
    $("#cam").style.transform = "scale(1)";
  } else {
    $("#cam").style.transform = "scale(" + zoom + ")";
  }
  document.querySelectorAll(".zchip").forEach(c =>
    c.classList.toggle("on", Math.abs(parseFloat(c.dataset.z) - zoom) < 0.06));
}
function buildZoomRow(){
  const row = $("#zoomRow"); row.innerHTML = "";
  [1,2,3].filter(z => z <= maxZoom).forEach(z => {
    const b = document.createElement("button");
    b.className = "zchip"; b.dataset.z = z; b.textContent = z + "x";
    b.onclick = e => { e.stopPropagation(); zoom = z; applyZoom(); };
    row.appendChild(b);
  });
}
let pinchStart = 0, zoomStart = 1;
const wrap = $("#camwrap");
const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
wrap.addEventListener("touchstart", e => { if(e.touches.length===2){ pinchStart=dist(e.touches); zoomStart=zoom; } }, {passive:true});
wrap.addEventListener("touchmove",  e => { if(e.touches.length===2 && pinchStart){ zoom = zoomStart*(dist(e.touches)/pinchStart); applyZoom(); } }, {passive:true});
wrap.addEventListener("touchend",   () => { pinchStart = 0; }, {passive:true});

/* ---------- capture ---------- */
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d");
// Preserve the available camera-frame resolution; do not upscale.
const PHOTO_QUALITY = 0.92;
function shoot(){
  const v = $("#cam");
  if(busy || !v.videoWidth || !visit || reviewing || visit.closed) return;
  if($("#areaSheet").classList.contains("open")) return;
  const vid = visit.id, shotArea = area, ts = Date.now();
  busy = true;
  $("#shutter").classList.add("busy");
  $("#flash").classList.add("on");
  requestAnimationFrame(()=>$("#flash").classList.remove("on"));
  captureTask = (async()=>{
    try {
      const crop = nativeZoom ? 1 : zoom;
      const sw = v.videoWidth / crop, sh = v.videoHeight / crop;
      canvas.width = Math.max(1, Math.round(sw)); canvas.height = Math.max(1, Math.round(sh));
      ctx.drawImage(v, (v.videoWidth-sw)/2, (v.videoHeight-sh)/2, sw, sh, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",PHOTO_QUALITY));
      if(!blob || !blob.size) throw new Error("The camera did not return a photo. Please take it again.");
      lastId = await savePhoto(vid, ts, blob, shotArea);
      if(visit && visit.id===vid){ await refreshCount(); showUndo(); }
    } catch(e){ showError(e); }
    finally { busy=false; $("#shutter").classList.remove("busy"); }
  })();
}
wrap.addEventListener("click", e => { if(e.target.id === "cam" || e.target.id === "camwrap") shoot(); });
$("#shutter").addEventListener("click", e => { e.stopPropagation(); shoot(); });

function showUndo(){
  const u = $("#undo"); u.classList.add("show");
  clearTimeout(undoTimer);
  undoTimer = setTimeout(()=>u.classList.remove("show"), 6000);
}
$("#undo").onclick = safe(async e => {
  e.stopPropagation();
  if(lastId == null) return;
  await deletePhoto(lastId); lastId = null;
  await refreshCount();
  $("#undo").classList.remove("show");
});
async function refreshCount(){
  const recs = await visitPhotos();
  count = recs.length; paintCount();
  if(recs.length) setThumb(recs[recs.length-1].blob);
  else { $("#thumb").style.backgroundImage=""; $("#thumb").classList.add("empty"); }
}
let thumbUrl = null;
function setThumb(blob){
  if(thumbUrl) URL.revokeObjectURL(thumbUrl);
  thumbUrl = URL.createObjectURL(blob);
  const t = $("#thumb");
  t.style.backgroundImage = "url(" + thumbUrl + ")";
  t.classList.remove("empty");
}
function paintCount(){
  const t = $("#thumb");
  let b = t.querySelector(".badge");
  if(!b){ b = document.createElement("span"); b.className="badge"; t.appendChild(b); }
  b.textContent = count; b.style.display = count ? "grid" : "none";
}

/* ---------- area ---------- */
function openArea(){
  $("#areaInput").value = area; drawRecent();
  $("#areaSheet").classList.add("open"); $("#scrim").classList.add("open");
  setTimeout(()=>$("#areaInput").focus(), 260);
}
function closeArea(save){
  if(save){
    area = $("#areaInput").value.trim();
    saveAreas();
    if(area && recent.indexOf(area) === -1){
      recent.unshift(area); recent = recent.slice(0,8);
      saveAreas();
    }
    paintArea();
  }
  $("#areaInput").blur();
  $("#areaSheet").classList.remove("open"); $("#scrim").classList.remove("open");
  $("#cam").play().catch(()=>{});
}
function drawRecent(){
  const r = $("#areaRecent"); r.innerHTML = "";
  recent.forEach(a => {
    const b = document.createElement("button");
    b.className = "tag" + (a === area ? " on" : "");
    b.textContent = a;
    b.onclick = () => { $("#areaInput").value = a; closeArea(true); };
    r.appendChild(b);
  });
}
function paintArea(){ $("#areaBtn").textContent = area || "Set area"; }
$("#areaBtn").onclick = e => { e.stopPropagation(); openArea(); };
$("#areaDone").onclick = () => closeArea(true);
$("#scrim").onclick = () => closeArea(true);
$("#areaInput").addEventListener("keydown", e => { if(e.key === "Enter") closeArea(true); });

/* Visit details and photo review */
on('#projBtn',e=>{e.stopPropagation();openVisitInfo();});
function openVisitInfo(){if(!visit)return;
 for(const [id,key] of [['vProject','project'],['vNum','projNum'],['vAtt','attendees'],['vBy','preparedBy'],['vWx','weather'],['vTemp','temp']]){$('#'+id).value=visit[key]||'';$('#'+id).disabled=!!visit.closed||id==='vProject'||id==='vNum';}
 $('#vDate').value=dateInput(visit.date);$('#vDate').disabled=!!visit.closed;
 $('#vAuto').textContent=svr(visit.num)+(visit.closed?' · Complete. Report history is read only.':' · Photo times are recorded automatically.');$('#visSave').hidden=!!visit.closed;$('#vis').classList.add('open');}
on('#visClose',()=>$('#vis').classList.remove('open'));
on('#visSave',async()=>{editable();if(!$('#vDate').value)throw new Error('Enter the visit date.');const next=clone(visit);next.date=new Date($('#vDate').value+'T12:00:00').getTime();for(const [id,key] of [['vAtt','attendees'],['vBy','preparedBy'],['vWx','weather'],['vTemp','temp']])next[key]=$('#'+id).value.trim();await persistVisit(next);remember('preparedBy',visit.preparedBy);$('#vis').classList.remove('open');});
on('#vPause',backToStart);
function releaseUrls(){urls.forEach(URL.revokeObjectURL);urls=[];itemUrls.forEach(URL.revokeObjectURL);itemUrls=[];if(detailUrl){URL.revokeObjectURL(detailUrl);detailUrl=null;}if(thumbUrl){URL.revokeObjectURL(thumbUrl);thumbUrl=null;}}
async function openGal(){await captureTask;const recs=await visitPhotos();urls.forEach(URL.revokeObjectURL);urls=[];$('#grid').replaceChildren();
 $('#galEmpty').style.display=recs.length?'none':'block';$('#galEmpty').textContent='No photos yet. You can still record items and export a report.';
 $('#galTitle').textContent=svr(visit.num)+' · '+recs.length+' photos';$('#galClose').textContent=reviewing?'Start':'Camera';
 for(const id of ['#galBack','#galPause','#galEnd'])$(id).style.display=reviewing?'none':'block';$('#galToStart').style.display=reviewing?'block':'none';
 $('#galBuild').disabled=false;$('#galExport').disabled=false;$('#galItems').textContent=(visit.closed?'View items':'Review items')+' ('+visit.items.filter(i=>i.status!=='Closed').length+' open)';
 recs.forEach((r,i)=>{if(!r.blob?.size){const row=document.createElement('p');row.className='auto';row.textContent='Observation '+String(i+1).padStart(3,'0')+' · Photo removed from phone. Open the saved cloud photo or restore the project recovery file.';$('#grid').append(row);return;}const u=URL.createObjectURL(r.blob);urls.push(u);const c=document.createElement('button');c.className='cell'+(r.note||r.tag?' noted':'');c.style.backgroundImage='url('+u+')';c.setAttribute('aria-label','Observation '+(i+1));const n=document.createElement('span');n.className='n';n.textContent=String(i+1).padStart(3,'0');const t=document.createElement('span');t.className='t';t.textContent=fmt(r.ts);c.append(n,t);c.onclick=safe(()=>openDet(r.id,i+1));$('#grid').append(c);});$('#gal').classList.add('open');}
on('#thumb',e=>{e.stopPropagation();return openGal();});
on('#galClose',()=>reviewing?backToStart():$('#gal').classList.remove('open'));
on('#galBack',()=>$('#gal').classList.remove('open'));on('#galPause',backToStart);on('#galToStart',backToStart);on('#galInfo',openVisitInfo);on('#galItems',()=>openItems(false));
async function completeVisit(){editable();await captureTask;
 if(!confirm('Complete '+svr(visit.num)+'? Its photos, notes and item statuses will become read only. You can export it again at any time.'))return;
 const next=clone(visit);next.closed=true;next.completedAt=Date.now();await persistVisit(next);await backToStart();}
on('#galEnd',completeVisit);on('#doneComplete',completeVisit);
async function openDet(id,n){const pr=await oneP(id);cur=joinMeta(pr,await oneM(id));if(detailUrl)URL.revokeObjectURL(detailUrl);detailUrl=URL.createObjectURL(cur.blob);$('#detImg').src=detailUrl;
 $('#detTitle').textContent='Observation '+String(n).padStart(3,'0');$('#detMeta').textContent=new Date(cur.ts).toLocaleString();
 for(const [id,key] of [['detNote','note'],['detArea','area'],['detSheet','sheet'],['detOwner','owner']]){$('#'+id).value=cur[key]||'';$('#'+id).disabled=!!visit.closed;}
 const item=visit.items.find(i=>i.id===cur.itemId||i.photoId===cur.id);cur.itemId=item?.id||'';if(item?.photoId===cur.id){cur.note=item.note;cur.owner=item.owner;cur.due=item.due;cur.area=item.area;$('#detNote').value=cur.note;$('#detOwner').value=cur.owner;$('#detArea').value=cur.area;}cur.original=JSON.stringify([cur.note,cur.area,cur.sheet,cur.owner,cur.tag,cur.due,cur.itemId]);
 $('#detDue').value=/^\d{4}-\d{2}-\d{2}$/.test(cur.due)?cur.due:'';$('#detDue').disabled=!!visit.closed;
 drawTags(cur.tag);drawDue(cur.due);$('#detSave').hidden=!!visit.closed;$('#detDel').hidden=!!visit.closed;$('#det').classList.add('open');}
function drawTags(active){$('#tagRow').replaceChildren();TAGS.forEach(t=>{const b=document.createElement('button');b.className='tag'+(t===active?' on':'');b.textContent=t;b.disabled=!!visit.closed;b.onclick=()=>{cur.tag=cur.tag===t?'':t;drawTags(cur.tag);};$('#tagRow').append(b);});$('#actionBits').style.display=(['Issue','Action','Safety'].includes(active))?'block':'none';}
function drawDue(active){$('#dueRow').replaceChildren();['Next visit','One week','Two weeks','Clear'].forEach(d=>{const b=document.createElement('button');b.className='tag'+((d==='Clear'?!active:dueValue(d,visit.date)===active)?' on':'');b.textContent=d;b.disabled=!!visit.closed;b.onclick=()=>{cur.due=d==='Clear'?'':dueValue(d,visit.date);$('#detDue').value=/^\d{4}-\d{2}-\d{2}$/.test(cur.due)?cur.due:'';drawDue(cur.due);};$('#dueRow').append(b);});}
$('#detDue').onchange=()=>{cur.due=$('#detDue').value;drawDue(cur.due);};
on('#detClose',()=>{const current=JSON.stringify([$('#detNote').value,$('#detArea').value,$('#detSheet').value,$('#detOwner').value,cur.tag,cur.due,cur.itemId||'']);if(!visit.closed&&current!==cur.original&&!confirm('Leave without saving these changes?'))return;$('#det').classList.remove('open');});
on('#detSave',async()=>{editable();const next=clone(visit),m={id:cur.id,note:$('#detNote').value.trim(),tag:cur.tag||'',area:$('#detArea').value.trim(),sheet:$('#detSheet').value.trim(),owner:$('#detOwner').value.trim(),due:cur.due||'',itemId:cur.itemId||''};
 const origin=next.items.find(i=>i.photoId===cur.id);
 if(origin&&!['Issue','Action','Safety'].includes(m.tag))throw new Error('This photo has a tracked item. Keep its Issue, Action or Safety tag and close the item from Review items when resolved.');
 next.items.forEach(i=>i.followupPhotoIds=(i.followupPhotoIds||[]).filter(id=>id!==cur.id));
 let item=origin||next.items.find(i=>i.id===m.itemId);
 if(!item&&['Issue','Action','Safety'].includes(m.tag)){item=newItem(next,{photoId:cur.id,firstNoted:cur.ts});next.items.push(item);}
 if(item){m.itemId=item.id;if(item.photoId===cur.id){Object.assign(item,{note:m.note,owner:m.owner,due:m.due,area:m.area,tag:m.tag});}else if(!item.followupPhotoIds.includes(cur.id))item.followupPhotoIds.push(cur.id);}
 await transaction(['meta','visits'],'readwrite',tx=>{tx.objectStore('meta').put(m);tx.objectStore('visits').put(next);});visit=next;readyBlob=null;
 if(m.area){area=m.area;recent=[area,...recent.filter(a=>a!==area)].slice(0,8);saveAreas();paintArea();}$('#det').classList.remove('open');await openGal();});
on('#detDel',async()=>{if(!confirm('Delete this photo? This cannot be undone.'))return;await deletePhoto(cur.id);await refreshCount();$('#det').classList.remove('open');await openGal();});
/* Items are copied into each visit. Completed visits never read later statuses. */
async function openItems(fromStart){await captureTask;itemsFromStart=fromStart;await paintItems();$('#itemsSheet').classList.add('open');}
async function paintItems(){itemUrls.forEach(URL.revokeObjectURL);itemUrls=[];$('#itemsTitle').textContent=svr(visit.num)+' items';$('#itemsList').replaceChildren();$('#addItem').hidden=!!visit.closed;$('#itemsContinue').textContent=itemsFromStart?'Continue to camera':'Back to report';
 if(!visit.items.length){const p=document.createElement('p');p.textContent='No tracked items yet. Tag a photo Issue, Action or Safety, or add an item below.';$('#itemsList').append(p);}
 for(const item of [...visit.items].sort((a,b)=>Number(b.tag==='Safety')-Number(a.tag==='Safety'))){const card=document.createElement('article');card.className='itemcard'+(item.tag==='Safety'?' safety':'');const title=document.createElement('h3');title.textContent=(item.tag==='Safety'?'SAFETY · ':'')+item.ref+' · '+item.status;card.append(title);
 if(item.photoId){const pr=await oneP(item.photoId);if(pr?.blob){const im=document.createElement('img');im.alt='Original photo for item '+item.ref;im.src=URL.createObjectURL(pr.blob);itemUrls.push(im.src);card.append(im);}}
 for(const txt of [item.note||'Photo item with no description',item.area,[item.owner?'Owner: '+item.owner:'',item.due?'Due: '+item.due:''].filter(Boolean).join(' · '),'First noted '+svr(item.firstVisitNum)+' · '+new Date(item.firstNoted).toLocaleDateString(),item.update?'This visit: '+item.update:''])if(txt){const p=document.createElement('p');p.textContent=txt;card.append(p);}
 const chips=document.createElement('div');chips.className='chips';if(!visit.closed){for(const status of ['Still open','Closed']){const b=document.createElement('button');b.className='tag'+(item.status===status?' on':'');b.textContent=status;b.onclick=safe(async()=>{const next=clone(visit),it=next.items.find(i=>i.id===item.id);it.status=status;it.closedAt=status==='Closed'?Date.now():null;await persistVisit(next);await paintItems();});chips.append(b);}const edit=document.createElement('button');edit.className='btn';edit.textContent='Details / update';edit.onclick=()=>openItemEditor(item.id);chips.append(edit);}card.append(chips);$('#itemsList').append(card);}
}
async function closeItems(){ $('#itemsSheet').classList.remove('open');if(!itemsFromStart)await openGal();}
on('#itemsClose',closeItems);on('#itemsContinue',closeItems);
function openItemEditor(id){editingItem=id;const i=visit.items.find(i=>i.id===id)||{};for(const [field,key] of [['itemNote','note'],['itemOwner','owner'],['itemDue','due'],['itemArea','area'],['itemUpdate','update']])$('#'+field).value=i[key]||'';$('#itemEditor').classList.add('open');}
on('#addItem',()=>openItemEditor(null));on('#itemCancel',()=>$('#itemEditor').classList.remove('open'));
on('#itemSave',async()=>{editable();const note=$('#itemNote').value.trim();if(!note)throw new Error('Enter a short description for this item.');const next=clone(visit);let item=next.items.find(i=>i.id===editingItem);if(!item){item=newItem(next);next.items.push(item);}Object.assign(item,{note,owner:$('#itemOwner').value.trim(),due:$('#itemDue').value,area:$('#itemArea').value.trim(),update:$('#itemUpdate').value.trim()});await persistVisit(next);$('#itemEditor').classList.remove('open');await paintItems();});
/* Exporting leaves the visit open. Completion is a separate, explicit action. */
function busyFail(msg){$('#busyText').textContent=msg;$('#busyClose').style.display='block';}
on('#busyClose',()=>$('#busyWrap').classList.remove('show'));
async function buildReport(){await captureTask;
 const unreviewed=visit.items.filter(i=>i.status==='Not reviewed').length;
 if(!visit.closed&&unreviewed&&!confirm(unreviewed+' item(s) have not been reviewed. Export with that status shown? Choose Cancel to review them.')){await openItems(false);return;}
 $('#busyText').textContent='Building report';$('#busyClose').style.display='none';$('#busyWrap').classList.add('show');
 try{const recs=await visitPhotos();if(recs.some(r=>!r.blob?.size))throw new Error('Some photos are no longer on this phone. Use the report saved in your cloud or restore the project recovery file first.');
 const snapshot=clone(visit);readyBlob=await window.SVReport.buildReport(snapshot,recs);readyName=window.SVReport.reportFileName(snapshot);
 $('#doneName').textContent=readyName;$('#doneNote').textContent='Save or share the file. Complete the visit when you are finished editing.';$('#doneComplete').hidden=!!visit.closed;$('#done').classList.add('open');$('#busyWrap').classList.remove('show');
 }catch(e){busyFail('Could not build the report. '+e.message);}}
on('#galBuild',buildReport);on('#galExport',buildReport);
function download(blob,name){const a=document.createElement('a');const url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},30000);}
on('#doneSave',()=>{if(readyBlob){download(readyBlob,readyName);$('#doneNote').textContent='Download requested. Confirm the file is saved before completing the visit.';}});
on('#doneShare',async()=>{if(!readyBlob)return;const file=new File([readyBlob],readyName,{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
 try{if(navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:readyName});$('#doneNote').textContent='File shared. Complete the visit when you are finished.';}else{download(readyBlob,readyName);$('#doneNote').textContent='Download requested. Confirm the file is saved before completing the visit.';}}catch(e){if(e.name!=='AbortError')throw e;}});
on('#doneClose',()=>$('#done').classList.remove('open'));on('#doneStart',backToStart);
/* Portable backup. Restore validates first, then replaces all stores in one transaction. */
function blobData(blob){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});}
async function exportBackup(){
 $('#backup').disabled=true;$('#backup').textContent='Preparing backup';
 try{const snapshot=await transaction(STORES,'readonly',tx=>{const qs=STORES.map(n=>tx.objectStore(n).getAll());return ()=>Object.fromEntries(STORES.map((n,i)=>[n,qs[i].result]));});
 for(const p of snapshot.photos){if(p.blob?.size){p.data=await blobData(p.blob);delete p.archived;}else if(p.archived===true){p.data=null;}else throw new Error('A saved photo is unreadable.');delete p.blob;}
 download(new Blob([JSON.stringify({format:'rdg-sitevisit-backup',version:2,createdAt:new Date().toISOString(),data:snapshot})],{type:'application/json'}),'RDG-Site-Visit-Backup-'+dateInput(Date.now())+'.json');
 alert('Backup download requested. Keep the saved JSON file somewhere you can find it. It contains all project records and photos still on this phone. Previously removed photos remain in your earlier cloud files.');
 }finally{$('#backup').disabled=false;$('#backup').textContent='Save all app data';}}
function validateBackup(raw){
 if(raw?.format!=='rdg-sitevisit-backup'||![1,2].includes(raw.version)||!raw.data)throw new Error('This is not a supported Site Visit backup.');
 const d=raw.data,maps={};
 for(const n of STORES){if(!Array.isArray(d[n]))throw new Error('Backup is missing '+n+'.');maps[n]=new Map();for(const r of d[n]){if(!r||!Number.isSafeInteger(r.id)||r.id<1||maps[n].has(r.id))throw new Error('Invalid or duplicate record in '+n+'.');maps[n].set(r.id,r);}}
 const str=(v)=>typeof v==='string';const validDate=v=>Number.isFinite(v)&&v>0;
 const keys=new Set();for(const p of d.projects){if(!str(p.name)||!p.name.trim()||!str(p.number)||!str(p.key)||keys.has(p.key))throw new Error('Invalid or duplicate project.');keys.add(p.key);}
 const nums=new Set(),active=new Set();
 for(const v of d.visits){if(v.schema!==9||!maps.projects.has(v.projectId)||!Number.isInteger(v.num)||v.num<1||!validDate(v.date)||!Array.isArray(v.items)||!Number.isInteger(v.itemSeq)||v.itemSeq<0||typeof v.closed!=='boolean')throw new Error('Invalid visit in backup.');
 for(const k of ['project','projNum','attendees','preparedBy','weather','temp'])if(!str(v[k]))throw new Error('Invalid visit details.');
 const n=v.projectId+':'+v.num;if(nums.has(n))throw new Error('Duplicate visit number.');nums.add(n);
 if(!v.closed){if(active.has(v.projectId))throw new Error('More than one unfinished visit for a project.');active.add(v.projectId);}
 if(v.legacyReportItems!=null&&!Array.isArray(v.legacyReportItems))throw new Error('Invalid legacy report history.');
 for(const itemList of [v.items,...(v.legacyReportItems?[v.legacyReportItems]:[])]){const ids=new Set();for(const it of itemList){const origin=maps.visits.get(it.originVisitId);if(!str(it.id)||ids.has(it.id)||!str(it.ref)||!origin||origin.projectId!==v.projectId||!validDate(it.firstNoted)||!['New','Still open','Not reviewed','Closed'].includes(it.status))throw new Error('Invalid item history.');ids.add(it.id);
 for(const k of ['note','owner','due','area','update'])if(!str(it[k]))throw new Error('Invalid item details.');
 if(!Array.isArray(it.followupPhotoIds))throw new Error('Invalid item photos.');
 for(const id of [it.photoId,...it.followupPhotoIds].filter(id=>id!=null)){const photo=maps.photos.get(id);if(!photo||maps.visits.get(photo.visitId)?.projectId!==v.projectId)throw new Error('An item references a missing photo or another project.');}
 }}}
 for(const m of d.meta){if(!maps.photos.has(m.id))throw new Error('Photo notes reference a missing photo.');for(const k of NOTE_KEYS)if(m[k]!=null&&!str(m[k]))throw new Error('Invalid photo notes.');}
 for(const p of d.photos){if(raw.version===2&&p.archived===true&&p.data===null){if(!maps.visits.has(p.visitId)||!validDate(p.ts))throw new Error('Invalid archived photo.');delete p.blob;continue;}if(!maps.visits.has(p.visitId)||!validDate(p.ts)||!str(p.data)||!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(p.data))throw new Error('Invalid photo in backup.');const [header,encoded]=p.data.split(',');let bytes;try{bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));}catch{throw new Error('A photo is damaged in the backup.');}if(!bytes.length)throw new Error('Backup contains an empty photo.');p.blob=new Blob([bytes],{type:header.slice(5,header.indexOf(';'))});delete p.data;delete p.archived;}
 return d;
}
let dataEpoch=0;
on('#backup',exportBackup);on('#restore',()=>$('#restoreFile').click());
$('#restoreFile').onchange=safe(async()=>{const file=$('#restoreFile').files[0];$('#restoreFile').value='';if(!file)return;
 const d=validateBackup(JSON.parse(await file.text()));
 if(!confirm('Restore '+d.projects.length+' projects, '+d.visits.length+' visits and '+d.photos.length+' photos? This replaces all data currently in this app. Cancel and back up first if you need to keep the current data.'))return;
 for(const p of d.photos){if(p.blob&&!await measure(p.blob))throw new Error('A photo in the backup cannot be opened. No saved data was changed.');}
 dataEpoch++;await transaction(STORES,'readwrite',tx=>{for(const n of STORES){const s=tx.objectStore(n);s.clear();d[n].forEach(r=>s.put(r));}});
 selectedProject=null;await loadState();alert('Backup restored.');});
let registration=null;
on('#checkUpdate',async()=>{if(!registration){$('#updateNote').textContent='Updates are available when the app is hosted online.';return;}await registration.update();if(registration.waiting){if(confirm('Install the available update and reload? Saved projects and photos will remain.'))registration.waiting.postMessage('ACTIVATE');}else $('#updateNote').textContent='Update check requested. If a new version is found, it will appear here shortly.';});
async function setupUpdates(){if(!('serviceWorker'in navigator))return;
 registration=await navigator.serviceWorker.register('sw.js',{updateViaCache:'none'});
 function ready(){if(registration.waiting)$('#updateNote').textContent='An update is ready. Tap Check for update to install.';}
 ready();registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',ready));
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!visit)location.reload();else $('#updateNote').textContent='Update installed. Return to Start and reopen the app to load it.';});
}
wireCloudUI();
async function init(){try{db=await openDB();await migrate();await loadState();paintArea();setupUpdates().catch(()=>{});}catch(e){$('#sState').textContent='Could not open saved projects. '+e.message;showError(e);}}
// One editor tab prevents competing visit numbers and conflicting photo or item edits.
if(navigator.locks){navigator.locks.request('rdg-sitevisit-editor',{ifAvailable:true},async lock=>{if(!lock){$('#sState').textContent='Site Visit is already open in another tab or window. Close that window, then reload this one.';document.querySelectorAll('button').forEach(b=>b.disabled=true);return;}await init();await new Promise(()=>{});});}else init();
