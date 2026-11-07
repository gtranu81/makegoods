import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('offline demo accepts all eight activities, preserves revisions, validates ownership and restores saved records',async()=>{
 const saved=new Map();
 const create=()=>{
  const context=vm.createContext({Response,structuredClone,atob,btoa,console,localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)}});context.window=context;
  for(const path of ['../public/activities.js','../public/growth-policy.js','../public/sketch-input.js','../demo/runtime.js'])vm.runInContext(readFileSync(new URL(path,import.meta.url),'utf8'),context);
  return context;
 };
 let context=create();
 const call=async(path,method='GET',body)=>{const response=await context.fetch('/api'+path,{method,body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};};
 await context.jejuDemoLogin('teacher');assert.equal((await call('/users/2','PATCH',{periodLimit:100})).status,200);
 const activities=context.consultingActivities;let designId;
 for(const code of Object.keys(activities)){
  await context.jejuDemoLogin('student');
  const payload={type:activities[code].type,activity:code,answers:{q1:'가방으로 쓰는 피크닉 돗자리',q2:'제주 오름과 초록색',q3:'가방 기능 유지'},safetyConfirmed:true,...(code==='D1'?{parentId:designId}:{})};
  const submitted=await call('/requests','POST',payload);assert.equal(submitted.status,200);const id=submitted.data.id;
  await context.jejuDemoLogin('teacher');assert.equal((await call(`/requests/${id}/generate`,'POST',{})).status,200);
  const draft=(await call('/requests')).data.requests.find(r=>r.id===id);assert.equal(draft.source,'demo');assert.equal(draft.candidates.length,3);assert.ok(draft.candidates.every(c=>!c.imageUrl&&!c.content.includes('undefined')));
  if(code==='D1'){assert.equal(draft.outputType,'design');assert.match(draft.candidates[0].content,/이전 결과/);}
  assert.equal((await call(`/requests/${id}/release`,'POST',{selected:[1],reviewConfirmed:true,teacherNote:'검토 완료'})).status,200);
  if(code==='C1')designId=id;
 }
 await context.jejuDemoLogin('student');
 const before=(await call('/me')).data.user.balance;
 assert.equal((await call('/requests','POST',{type:'revision',activity:'D1',answers:{q1:'색',q2:'밝게',q3:'가방'},safetyConfirmed:true})).status,400);
 assert.equal((await call('/me')).data.user.balance,before);
 const hidden=(await call('/growth')).data;assert.ok(hidden.records.every(r=>r.report===null));assert.equal(hidden.events,undefined);
 await context.jejuDemoLogin('teacher');const growth=(await call('/growth?userId=2')).data;const summary=growth.records.find(r=>r.kind==='summary');assert.equal(summary.source,'observation');assert.ok(growth.events.some(e=>e.kind==='ai_draft'));assert.ok(growth.events.some(e=>e.kind==='teacher_final'));
 assert.equal((await call('/growth/'+summary.id,'PATCH',{version:summary.version,report:{changes:'교사가 확인한 모둠의 변화'},approve:true,reviewConfirmed:true})).status,200);
 context=create();await context.jejuDemoLogin('student');const visible=(await call('/growth')).data.records.find(r=>r.kind==='summary');assert.equal(visible.report.changes,'교사가 확인한 모둠의 변화');assert.equal(visible.report.teacherNarrative,undefined);
 const records=(await call('/requests')).data.requests;
 assert.equal(records.length,8);assert.ok(records.every(r=>r.candidates.length===1));assert.equal(records.find(r=>r.answers.activity==='D1').outputType,'design');
});

test('offline student drawings survive review and restore, without claiming real AI vision',async()=>{
 const saved=new Map(),images=JSON.parse(readFileSync(new URL('./fixtures/sketch-images.json',import.meta.url),'utf8'));
 const create=()=>{const context=vm.createContext({Response,structuredClone,atob,btoa,console,localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)}});context.window=context;for(const path of ['../public/activities.js','../public/growth-policy.js','../public/sketch-input.js','../demo/runtime.js'])vm.runInContext(readFileSync(new URL(path,import.meta.url),'utf8'),context);return context;};
 let c=create();const call=async(path,method='GET',body)=>{const response=await c.fetch('/api'+path,{method,body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};};
 await c.jejuDemoLogin('student');const payload={type:'design',activity:'C1',answers:{q1:'가방 겸 돗자리',q2:'초록 오름',q3:'기능 유지'},sketch:images.png,safetyConfirmed:true};
 const id=(await call('/requests','POST',payload)).data.id;assert.equal((await call('/requests')).data.requests[0].sketch.imageUrl,images.png);
 const coins=(await call('/me')).data.user.balance;assert.equal((await call('/requests','POST',{...payload,sketch:'data:image/png;base64,YmFk'})).status,400);assert.equal((await call('/me')).data.user.balance,coins);
 await c.jejuDemoLogin('teacher');await call(`/requests/${id}/generate`,'POST',{});const draft=(await call('/requests')).data.requests[0];assert.ok(draft.candidates[0].content.includes('실제 AI 분석과 이미지 생성을 하지 않습니다'));
 await call(`/requests/${id}/release`,'POST',{selected:[1],reviewConfirmed:true});const events=(await call('/growth?userId=2')).data.events;assert.equal(events.find(e=>e.kind==='submitted').data.sketch.imageUrl,images.png);
 c=create();await c.jejuDemoLogin('student');assert.equal((await call('/requests')).data.requests[0].sketch.imageUrl,images.png);assert.equal((await call('/growth')).data.history[0].sketch.imageUrl,images.png);
 const revision=await call('/requests','POST',{...payload,type:'revision',activity:'D1',parentId:id,sketch:null});assert.equal(revision.status,200);assert.equal((await call('/requests')).data.requests[0].sketch.requestId,id);
});
