'use strict';
// Manual file handoff only. A successful share is never treated as cloud verification.
let cloudSession = null;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
function fileStem(value) {
  return String(value || 'Project').normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').slice(0, 90) || 'Project';
}
function visitStem(v) { return fileStem(v.projNum || v.project) + '_SVR-' + String(v.num).padStart(3, '0') + '_' + dateInput(v.date); }
function photoFilename(v, r, index) { return visitStem(v) + '_Obs-' + String(index + 1).padStart(3, '0') + (r.blob?.type === 'image/png' ? '.png' : r.blob?.type === 'image/webp' ? '.webp' : '.jpg'); }
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
async function dataSnapshot(projectId) {
  const data = await transaction(STORES, 'readonly', tx => {
    const qs = STORES.map(n => tx.objectStore(n).getAll());
    return () => Object.fromEntries(STORES.map((n, i) => [n, qs[i].result]));
  });
  data.projects = data.projects.filter(p => p.id === projectId);
  data.visits = data.visits.filter(v => v.projectId === projectId);
  const ids = new Set(data.visits.map(v => v.id));
  data.photos = data.photos.filter(p => ids.has(p.visitId));
  const photos = new Set(data.photos.map(p => p.id));
  data.meta = data.meta.filter(m => photos.has(m.id));
  return data;
}
async function projectRecoveryFile(data, stamp) {
  for (const p of data.photos) {
    if (p.blob?.size) { p.data = await blobData(p.blob); delete p.archived; }
    else if (p.archived === true) p.data = null;
    else throw new Error('A photo is unreadable. Recovery file was not created.');
    delete p.blob;
  }
  const name = fileStem(data.projects[0].number || data.projects[0].name) + '_Project-Recovery_' + stamp + '.json';
  return new File([JSON.stringify({format: 'rdg-sitevisit-project', version: 2, createdAt: new Date().toISOString(), data})], name, {type:'application/json'});
}
function saveFileButton(files, label, status) {
  const button = document.createElement('button'); button.className = 'ghost'; button.textContent = label;
  // Call share directly from the tap. Preparing files inside the handler can lose iOS user activation.
  button.onclick = () => {
    if (button.disabled) return;
    try {
      if (navigator.canShare?.({files})) {
        button.disabled = true;
        navigator.share({files}).then(() => {
          status.textContent = 'Files handed to the selected app. Check your destination and upload status in Files; this app cannot verify cloud storage.';
        }).catch(e => { if (e.name !== 'AbortError') status.textContent = 'Sharing failed: ' + e.message + '. Use Download ZIP below.'; })
          .finally(() => { button.disabled = false; });
      } else if (files.length === 1) {
        download(files[0], files[0].name);
        status.textContent = 'Download requested. Move the file from Downloads to your cloud folder and check it there.';
      } else status.textContent = 'This browser cannot share this batch. Save the files individually below.';
    } catch (e) { button.disabled = false; status.textContent = 'Could not share: ' + e.message + '. Use Download ZIP below.'; }
  };
  return button;
}
async function openCloud() {
  await captureTask; stopCamera();
  if (!visit) return;
  cloudSession = null; $('#cloudFiles').replaceChildren(); $('#cloudChecked').disabled = true;
  $('#cloudConfirmed').textContent = ''; $('#cloudTitle').textContent = visit.project + ' · ' + svr(visit.num);
  $('#cloudStatus').textContent = 'Preparing files on this phone…'; $('#cloudSheet').classList.add('open');
  try {
    const snapshot = await dataSnapshot(visit.projectId);
    const v = snapshot.visits.find(v => v.id === visit.id);
    if (!v) throw new Error('This visit is no longer available.');
    const meta = new Map(snapshot.meta.map(m => [m.id, m]));
    const photos = snapshot.photos.filter(p => p.visitId === v.id).sort((a,b) => a.ts-b.ts).map(p => joinMeta(p, meta.get(p.id)));
    const missing = photos.filter(p => !p.blob?.size).length;
    if(missing)throw new Error('This visit has photos removed from the phone. Use its saved ZIP or restore the project recovery file before creating another complete archive.');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const report = missing ? null : new File([await window.SVReport.buildReport(clone(v), photos)], visitStem(v) + '_Report.docx', {type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
    const imageFiles = photos.flatMap((p, i) => p.blob?.size ? [new File([p.blob], photoFilename(v, p, i), {type:p.blob.type})] : []);
    const lines = [['Filename','Observation','Photo time','Area','Sheet / room','Tag','Note','Owner','Due','On this phone'], ...photos.map((p,i) => [photoFilename(v,p,i),i+1,new Date(p.ts).toISOString(),p.area,p.sheet,p.tag,p.note,p.owner,p.due,p.blob?.size?'Yes':'Removed'])];
    const index = new File(['\uFEFF'+lines.map(row=>row.map(csvCell).join(',')).join('\r\n')], visitStem(v)+'_Photo-Index.csv', {type:'text/csv'});
    // This copy holds only the selected project, including history required by recurring items.
    const recovery = await projectRecoveryFile(snapshot, stamp);
    const folder = 'SVR-' + String(v.num).padStart(3, '0');
    $('#cloudStatus').textContent = 'Packing the complete visit ZIP…';
    const archive = await makeVisitZip(visitArchiveEntries(folder, report, imageFiles, index, recovery), folder + '.zip');
    const card = document.createElement('article'); card.className = 'itemcard';
    const heading = document.createElement('h3'); heading.textContent = archive.name + ' · ' + (archive.size / 1048576).toFixed(1) + ' MB';
    const contents = document.createElement('p'); contents.textContent = 'Includes Report, Photos (' + imageFiles.length + '), Photo-Index and Recovery folders.';
    const save = saveFileButton([archive], 'Save ZIP to Cloud', $('#cloudStatus')); save.className = 'primary';
    const fallback = document.createElement('button'); fallback.className = 'ghost'; fallback.textContent = 'Download ZIP';
    fallback.onclick = () => { download(archive, archive.name); $('#cloudStatus').textContent = 'Download requested. Move the ZIP to your project folder in iCloud Drive and check the upload finishes.'; };
    card.append(heading, contents, save, fallback); $('#cloudFiles').append(card);
    cloudSession = {visitId:v.id, preparedAt:Date.now(), missing:0, closed:v.closed};
    $('#cloudChecked').disabled = !v.closed;
    $('#cloudStatus').textContent = (v.closed ? 'Ready. ' : 'Draft visit: complete it and save again for final records. ') + 'Save this ZIP in your project folder. Extract it to open the SVR folder. Keep earlier recovery files if photos were previously removed from this project.';

  } catch(e) { $('#cloudStatus').textContent = 'Could not prepare files: '+e.message; }
}
function protectedPhotoIds(visits) {
  const latest = new Map();
  for (const v of visits) if (!latest.has(v.projectId) || latest.get(v.projectId).id < v.id) latest.set(v.projectId,v);
  const protectedIds = new Set();
  for (const v of latest.values()) for (const item of v.items || []) if(item.status !== 'Closed')
    for (const id of [item.photoId,...(item.followupPhotoIds||[])]) if(id != null) protectedIds.add(id);
  return protectedIds;
}
function cleanupPlan(visits, photos, now=Date.now()) {
  const protectedIds = protectedPhotoIds(visits);
  return visits.filter(v=>v.closed && now-(v.completedAt||v.date)>=RETENTION_MS).map(v=>{
    const available = photos.filter(p=>p.visitId===v.id && p.blob?.size);
    return {visit:v, removable:available.filter(p=>!protectedIds.has(p.id)), retained:available.filter(p=>protectedIds.has(p.id))};
  }).filter(row=>row.removable.length);
}
async function storagePlan() { return cleanupPlan(await allV(), await read('photos')); }
async function paintCleanupNotice() {
  const plan=await storagePlan(); $('#cleanupNotice').hidden=!plan.length;
  $('#cleanupCount').textContent=plan.length+' completed visit(s) are over 30 days old. Review their photo storage when you are ready.';
}
async function openCleanup() {
  const list=$('#cleanupList');list.replaceChildren(); const plan=await storagePlan();
  if(!plan.length){const p=document.createElement('p');p.textContent='No removable photos in completed visits older than 30 days. Photos supporting open items are kept.';list.append(p);}
  for(const row of plan){
    const card=document.createElement('article');card.className='itemcard';const h=document.createElement('h3');h.textContent=row.visit.project+' · '+svr(row.visit.num);
    const p=document.createElement('p');const bytes=row.removable.reduce((n,p)=>n+p.blob.size,0);
    p.textContent=row.removable.length+' photos · '+(bytes/1048576).toFixed(1)+' MB removable. '+row.retained.length+' photos retained for open items.';
    const note=document.createElement('p');note.className='auto';note.textContent=row.visit.cloudCheckedAt?'You confirmed cloud files on '+new Date(row.visit.cloudCheckedAt).toLocaleDateString()+'.':'Cloud files have not been confirmed in this app.';
    const save=document.createElement('button');save.className='ghost';save.textContent='Save / review files first';save.onclick=safe(async()=>{$('#cleanupSheet').classList.remove('open');await openPast(row.visit);await openCloud();});
    const remove=document.createElement('button');remove.className='danger';remove.textContent='Remove local photos';remove.onclick=safe(async()=>{
      if(!confirm('Remove local photos for '+row.visit.project+' · '+svr(row.visit.num)+'?\n\nOnly continue if you checked that the report, individual photos and project recovery file are safely stored in your cloud or server. The app cannot verify this. Open-item evidence and visit history will stay.'))return;
      await removeLocalPhotos(row.visit.id); await loadState();await openCleanup();
    });card.append(h,p,note,save,remove);list.append(card);
  }$('#cleanupSheet').classList.add('open');
}
async function removeLocalPhotos(visitId) {
  // Recompute dependencies inside the same transaction as removal.
  return transaction(['visits','photos'],'readwrite',tx=>{
    const vs=tx.objectStore('visits').getAll(), ps=tx.objectStore('photos').getAll(); let loaded=0;
    const ready=()=>{if(++loaded!==2)return;const row=cleanupPlan(vs.result,ps.result).find(r=>r.visit.id===visitId);if(!row)return;
      for(const photo of row.removable){const next={...photo,archived:true,removedAt:Date.now()};delete next.blob;tx.objectStore('photos').put(next);}
      tx.objectStore('visits').put({...row.visit,localPhotosRemovedAt:Date.now()});
    };vs.onsuccess=ready;ps.onsuccess=ready;
  });
}
function remapProjectCopy(data, existing) {
  const source=data.projects[0], old=existing.projects.find(p=>p.key===source.key);
  const nextId=name=>existing[name].reduce((n,r)=>Math.max(n,r.id),0)+1;
  const projectId=old?.id||nextId('projects');let vi=nextId('visits'),pi=nextId('photos');
  const vmap=new Map([...data.visits].sort((a,b)=>a.id-b.id).map(v=>[v.id,vi++]));
  const pmap=new Map(data.photos.map(p=>[p.id,pi++])),items=new Map();
  const mapItems=list=>(list||[]).map(i=>{
    if(!items.has(i.id))items.set(i.id,'restored:'+vmap.get(i.originVisitId)+':'+items.size);
    return {...i,id:items.get(i.id),originVisitId:vmap.get(i.originVisitId),photoId:i.photoId==null?null:pmap.get(i.photoId),followupPhotoIds:i.followupPhotoIds.map(id=>pmap.get(id))};
  });
  const visits=data.visits.map(v=>{
    const r={...v,id:vmap.get(v.id),projectId,items:mapItems(v.items)};
    if(v.legacyReportItems)r.legacyReportItems=mapItems(v.legacyReportItems);
    delete r.cloudCheckedAt;return r;
  });
  return {oldProjectId:old?.id,projects:[{...source,id:projectId}],visits,
    photos:data.photos.map(p=>({...p,id:pmap.get(p.id),visitId:vmap.get(p.visitId)})),
    meta:data.meta.map(m=>({...m,id:pmap.get(m.id),itemId:items.get(m.itemId)||''}))};
}
async function restoreProjectFile(file) {
  const raw=JSON.parse(await file.text());
  if(raw.format!=='rdg-sitevisit-project'||raw.version!==2||raw.data?.projects?.length!==1)throw new Error('Choose a project recovery file created by Save to Cloud. For an older full backup, use Restore backup under STORAGE.');
  const data=validateBackup({...raw,format:'rdg-sitevisit-backup'});
  for(const p of data.photos)if(p.blob&&!await measure(p.blob))throw new Error('A recovery photo cannot be opened. No data was changed.');
  const source=data.projects[0],current=(await read('projects')).find(p=>p.key===source.key);
  if(!confirm('Open recovery file for '+source.name+'?\n\n'+(current?'This replaces this project’s current visits, including newer work, with the saved snapshot. Save current work first.':'This adds the saved project to this device.')+' Other projects stay unchanged.'))return;
  dataEpoch++;let restoredProjectId;
  await transaction(STORES,'readwrite',tx=>{
    const qs=STORES.map(n=>tx.objectStore(n).getAll());let count=0;
    qs.forEach(q=>{q.onsuccess=()=>{if(++count!==STORES.length)return;
      try { const existing=Object.fromEntries(STORES.map((n,i)=>[n,qs[i].result]));const mapped=remapProjectCopy(data,existing);
      if(mapped.oldProjectId){const ids=new Set(existing.visits.filter(v=>v.projectId===mapped.oldProjectId).map(v=>v.id));
        existing.photos.filter(p=>ids.has(p.visitId)).forEach(p=>{tx.objectStore('photos').delete(p.id);tx.objectStore('meta').delete(p.id);});
        ids.forEach(id=>tx.objectStore('visits').delete(id));
      }
      for(const n of STORES)mapped[n].forEach(r=>tx.objectStore(n).put(r));restoredProjectId=mapped.projects[0].id;
      } catch(e) { tx.abort(); }
    };});
  });selectedProject=restoredProjectId;await loadState();alert('Project recovery file opened. Other projects were kept.');
}
function wireCloudUI() {
  on('#galCloud',openCloud);on('#doneCloud',openCloud);
  on('#cloudClose',()=>{$('#cloudSheet').classList.remove('open');$('#cloudFiles').replaceChildren();cloudSession=null;if(visit&&!visit.closed)startCam();});
  on('#cloudChecked',async()=>{
    if(!cloudSession||cloudSession.missing||!cloudSession.closed)return;
    if(!confirm('Have you checked that the report, photos and project recovery file are saved in your cloud, with no upload pending? This records your confirmation only.'))return;
    const v=await read('visits',cloudSession.visitId);if(!v)return;v.cloudCheckedAt=Date.now();await putV(v);if(visit?.id===v.id)visit=v;
    $('#cloudConfirmed').textContent='Confirmed by you on '+new Date(v.cloudCheckedAt).toLocaleString()+'. Nothing was removed from this phone.';
  });
  on('#reviewCleanup',openCleanup);on('#manageStorage',openCleanup);on('#cleanupClose',()=>$('#cleanupSheet').classList.remove('open'));
  on('#restoreProject',()=>$('#projectFile').click());$('#projectFile').onchange=safe(async()=>{const file=$('#projectFile').files[0];$('#projectFile').value='';if(file)await restoreProjectFile(file);});
}
