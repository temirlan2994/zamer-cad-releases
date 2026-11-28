import { validateReviewSnapshot, makeReviewResponse } from '../core/concept-review.js';
import { loadSharedReview, sendSharedReviewResponse } from '../core/review-sharing.js';
import { estimateConceptBudget } from '../core/concept-budget.js';
import { buildHouseMesh, terrainHeightFn } from '../core/mesh3d.js';
import { walkWorld, walkPickFaces, walkSpawnAt } from '../core/walk3d.js';
import { createWalkController } from './walk3d.js';
import { createSceneGL, sceneBuffers, drawSceneGL, W } from './scene-gl.js';
import { cameraBasis, projectPoint, screenRay, rayFace, pickBoxes, pickObject, pickFaces } from '../core/pick3d.js';
import { initializeFirebase, firebaseSignInGoogle } from './firebase.js';

const el = (id) => document.getElementById(id), canvas = el('reviewCanvas'), status = el('reviewStatus');
const form = el('reviewResponseForm');
let snapshot, project, shareId = null, firebase = null, faces = [], prepared = [], world, selectedPoint = null, selectedTarget = null;
let gl = null, ctx = null, walk = null, previousCamera = null, placing = false, drag = null, queued = false, loading = 0;
const cam = { target: { x: 0, y: 0, z: 1500 }, yaw: -2.2, pitch: .65, dist: 25000, eyeDist: 25000, projection: 'perspective' };
const setStatus = (message, error = false) => { status.textContent = message; status.dataset.state = error ? 'error' : 'ready'; };

function repaint() {
  if (queued) return; queued = true;
  requestAnimationFrame((now) => {
    queued = false; walk?.frame(now);
    if (!faces.length) return;
    const rect = canvas.getBoundingClientRect(), ratio = Math.min(2, devicePixelRatio || 1);
    const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
    const w = Math.round(width*ratio), h = Math.round(height*ratio);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    if (gl) drawSceneGL(gl, cam, width, height);
    else {
      ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,width,height); ctx.fillStyle = '#e5edf3'; ctx.fillRect(0,0,width,height);
      const basis = cameraBasis(cam, width, height);
      const list = faces.map((face) => ({ face, points: face.pts.map((p) => projectPoint(cam,width,height,p)), depth: face.pts.reduce((sum,p) => { const q=W(p);return sum+((q.x-basis.eye.x)*basis.f.x+(q.y-basis.eye.y)*basis.f.y+(q.z-basis.eye.z)*basis.f.z)/face.pts.length; },0) })).sort((a,b) => b.depth-a.depth);
      for (const entry of list) {
        if (entry.points.some((p) => !p)) continue;
        ctx.beginPath(); entry.points.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y)); ctx.closePath(); ctx.globalAlpha = entry.face.alpha ?? 1; ctx.fillStyle = entry.face.color || '#aaa'; ctx.fill(); ctx.strokeStyle = '#6b7277'; ctx.lineWidth = .5; ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (selectedPoint) {
      const p = projectPoint(cam,width,height,selectedPoint); el('reviewPin').hidden = !p;
      if (p) { el('reviewPin').style.left = `${p.x}px`; el('reviewPin').style.top = `${p.y}px`; }
    }
  });
}

function upload() {
  if (!gl) return;
  if (gl.buffers) for (const buffer of Object.values(gl.buffers)) gl.gl.deleteBuffer(buffer.buf);
  gl.buffers = sceneBuffers(gl.gl, faces);
}

function rebuild() {
  const level = el('reviewLevel').value;
  if (level !== 'all') project.activeLevel = level;
  faces = buildHouseMesh(project, { roof: el('reviewRoof').checked, site: true, landscape: true, furniture: true, masses: true, levels: level === 'all' ? 'all' : 'only' });
  prepared = walkPickFaces(faces); upload(); repaint();
}

function fit() {
  if (!faces.length) return;
  const lo={x:Infinity,y:Infinity,z:Infinity},hi={x:-Infinity,y:-Infinity,z:-Infinity};
  for (const face of faces) if (['wall','roof','floor','slab'].includes(face.kind)) for (const point of face.pts) {
    for (const axis of ['x','y','z']) { lo[axis]=Math.min(lo[axis],point[axis]);hi[axis]=Math.max(hi[axis],point[axis]); }
  }
  if (!Number.isFinite(lo.x)) return;
  cam.target={x:(lo.x+hi.x)/2,y:-(lo.y+hi.y)/2,z:(lo.z+hi.z)/2};cam.dist=cam.eyeDist=Math.max(5000,Math.max(hi.x-lo.x,hi.y-lo.y,hi.z-lo.z)*1.9);repaint();
}

function exitWalk() {
  walk?.stop(); if (previousCamera) Object.assign(cam,previousCamera); previousCamera=null;
  document.querySelector('.review-feedback').inert=false;
  el('reviewModelHint').textContent='Тяните для вращения · Колесо — масштаб';repaint();
}

function getRay(event) {
  const rect=canvas.getBoundingClientRect();return screenRay(cam,rect.width,rect.height,event.clientX-rect.left,event.clientY-rect.top);
}

async function showSnapshot(raw) {
  const current=++loading, checked=await validateReviewSnapshot(raw);
  if(current!==loading)return;
  exitWalk();snapshot=checked.snapshot;project=checked.project;selectedPoint=null;selectedTarget=null;
  el('reviewTitle').textContent=snapshot.name;el('reviewVariant').textContent=snapshot.variantName;
  el('reviewCreatedAt').textContent=`Снимок от ${new Date(snapshot.createdAt).toLocaleString('ru-RU')}`;el('reviewDigest').textContent=snapshot.digest;
  const levelSelect=el('reviewLevel');levelSelect.replaceChildren(new Option('Все этажи','all'));
  for(const level of project.levels)levelSelect.add(new Option(level.name,level.id));
  el('reviewWorkspace').hidden=false;
  const estimate=estimateConceptBudget(project),fmt=(n)=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(n);
  el('reviewBudget').textContent=estimate.pricedCount ? `${estimate.complete?'Бюджет':'Известные позиции бюджета'}: ${fmt(estimate.subtotal)} ${estimate.config.currency}. Диапазон: ${fmt(estimate.low)}–${fmt(estimate.high)}. ${estimate.complete?'':'Оценка неполная.'}` : 'Стоимость пока не оценена: расценки не заданы.';
  if(!walk){
    gl=createSceneGL(canvas);if(!gl)ctx=canvas.getContext('2d');
    walk=createWalkController({canvas,cam,repaint,exit:exitWalk});
  }
  const physics=buildHouseMesh(project,{roof:true,site:true,landscape:true,furniture:true,masses:true});
  world=walkWorld(physics,terrainHeightFn(project)||(()=>0));rebuild();fit();
  el('reviewSend').textContent=shareId?'Отправить решение':'Скачать ответ JSON';
  el('reviewSignIn').hidden=!shareId;
  el('reviewDownloadResponse').hidden=!shareId;
  setStatus(shareId?'Снимок проверен. Просмотр доступен по ссылке до её отзыва или истечения срока.':'Снимок проверен. Ответ можно скачать и передать автору проекта.');
}

canvas.addEventListener('pointerdown',(event)=>{
  if(walk?.active)return;drag={x:event.clientX,y:event.clientY,moved:false};canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove',(event)=>{
  if(!drag||walk?.active||walk?.choosing||placing)return;
  const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
  if(Math.abs(dx)+Math.abs(dy)>2)drag.moved=true;
  cam.yaw-=dx*.008;cam.pitch=Math.max(.05,Math.min(1.5,cam.pitch+dy*.006));drag.x=event.clientX;drag.y=event.clientY;repaint();
});
canvas.addEventListener('pointerup',(event)=>{
  if(!drag||walk?.active)return;const moved=drag.moved;drag=null;if(moved)return;
  const ray=getRay(event);
  if(walk?.choosing){const start=walkSpawnAt(world,prepared,ray,cam.yaw);if(!start){setStatus('Выберите свободную поверхность земли, пола или лестницы',true);return;}walk.start(world,start);document.querySelector('.review-feedback').inert=true;return;}
  if(!placing)return;
  let best=null;for(const face of prepared){const t=rayFace(ray,face);if(t!=null&&(!best||t<best.t))best={t,face};}
  if(!best){setStatus('Выберите видимую поверхность модели',true);return;}
  selectedPoint={x:ray.o.x+ray.d.x*best.t,y:ray.o.y+ray.d.y*best.t,z:ray.o.z+ray.d.z*best.t};
  const pick=pickObject({...pickBoxes(project),faces:pickFaces(faces)},ray);selectedTarget=pick?.id?{id:pick.id,type:pick.type,levelId:pick.levelId}:null;
  el('reviewPointDescription').textContent=`Место: ${Math.round(selectedPoint.x)}, ${Math.round(selectedPoint.y)}, ${Math.round(selectedPoint.z)} мм`;
  placing=false;el('reviewPlacePin').setAttribute('aria-pressed','false');setStatus('Место замечания отмечено. Введите комментарий.');repaint();
});
canvas.addEventListener('pointercancel',()=>{drag=null;});
canvas.addEventListener('wheel',(event)=>{event.preventDefault();if(walk?.active)return;cam.dist=cam.eyeDist=Math.max(2000,Math.min(400000,cam.eyeDist*Math.exp(event.deltaY*.001)));repaint();},{passive:false});
el('reviewFit').addEventListener('click',()=>{exitWalk();fit();});
el('reviewLevel').addEventListener('change',()=>{exitWalk();rebuild();});
el('reviewRoof').addEventListener('change',()=>{exitWalk();rebuild();});
el('v3Walk').addEventListener('click',()=>{if(walk.active||walk.choosing){exitWalk();return;}placing=false;previousCamera=structuredClone(cam);walk.choose();el('reviewModelHint').textContent='Нажмите на свободную поверхность, где хотите начать прогулку';});
el('reviewPlacePin').addEventListener('click',()=>{exitWalk();placing=!placing;el('reviewPlacePin').setAttribute('aria-pressed',String(placing));el('reviewModelHint').textContent=placing?'Нажмите на поверхность для замечания':'Тяните для вращения · Колесо — масштаб';});
el('reviewClearPin').addEventListener('click',()=>{selectedPoint=null;selectedTarget=null;el('reviewPin').hidden=true;el('reviewPointDescription').textContent='Место не указано';});
new ResizeObserver(repaint).observe(canvas);

function responseFromForm() {
  if(!form.reportValidity())return null;
  const data=new FormData(form);
  if(data.get('action')==='approve'&&!data.has('confirm'))throw new Error('Подтвердите решение по этому снимку');
  return makeReviewResponse(snapshot,{author:data.get('author'),action:data.get('action'),message:data.get('message'),point:selectedPoint,target:selectedTarget});
}
function downloadResponse(response) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(response,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=`${snapshot.id}-${response.id}.response.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  setStatus('Ответ сохранён файлом. Передайте его автору проекта для загрузки в журнал согласования.');
}
form.addEventListener('submit',async(event)=>{
  event.preventDefault();try{const response=responseFromForm();if(!response)return;
    if(!shareId){downloadResponse(response);return;}
    firebase ||= await initializeFirebase();
    if(!firebase?.user){setStatus('Войдите через Google для отправки либо скачайте ответ файлом',true);return;}
    el('reviewSend').disabled=true;await sendSharedReviewResponse(firebase.db,shareId,response,firebase.user);setStatus('Решение отправлено владельцу снимка.');
  }catch(error){setStatus(error.message,true);}finally{el('reviewSend').disabled=false;}
});
el('reviewDownloadResponse').addEventListener('click',()=>{try{const response=responseFromForm();if(response)downloadResponse(response);}catch(error){setStatus(error.message,true);}});
el('reviewSignIn').addEventListener('click',async()=>{try{const user=await firebaseSignInGoogle();form.elements.author.value ||= user.name||user.email||'';firebase=await initializeFirebase();setStatus('Вы вошли. Теперь можно отправить решение.');}catch(error){setStatus(error.message,true);}});
el('reviewOpenFile').addEventListener('click',()=>{
  const input=document.createElement('input');input.type='file';input.accept='.json';input.addEventListener('change',async()=>{
    try{const file=input.files?.[0];if(!file)return;if(file.size>50*1024*1024)throw new Error('Файл превышает 50 МиБ');const raw=JSON.parse(await file.text());shareId=null;await showSnapshot(raw);}catch(error){setStatus(error.message,true);}
  },{once:true});input.click();
});

(async()=>{
  try{
    const embedded=el('reviewSnapshot');
    if(embedded){await showSnapshot(JSON.parse(embedded.textContent));return;}
    const id=new URLSearchParams(location.hash.slice(1)).get('review');
    if(!id){setStatus('Откройте ссылку согласования или файл снимка JSON');return;}
    firebase=await initializeFirebase();if(!firebase)throw new Error('Облако не настроено. Можно открыть снимок JSON.');
    const loaded=await loadSharedReview(firebase.db,id);shareId=id;await showSnapshot(loaded.snapshot);
  }catch(error){setStatus(String(error.code||'').includes('permission-denied')?'Ссылка недоступна, отозвана или срок её действия истёк':error.message,true);}
})();
