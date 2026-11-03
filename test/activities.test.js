import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import vm from 'node:vm';
import '../public/activities.js';
const activities=globalThis.consultingActivities,dir=mkdtempSync(join(tmpdir(),'jeju-activities-'));
const log=join(dir,'provider.jsonl'),failure=join(dir,'fail-image');
let child,base,teacher,student,other,designId;
async function call(path,method='GET',body,cookie=teacher){const response=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie||''},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
const payload=(code,extra={})=>({type:activities[code].type,activity:code,answers:Object.fromEntries(activities[code].questions.map(([,example],i)=>['q'+(i+1),example])),safetyConfirmed:true,...extra});
const logs=()=>readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
before(async()=>{
 child=spawn(process.execPath,['--import','./test/fixtures/ai-provider.js','server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DB_PATH:join(dir,'app.sqlite'),NODE_ENV:'test',SETUP_TOKEN:'',APP_ORIGIN:'',RENDER_EXTERNAL_URL:'',AI_API_KEY:'test-only-not-a-real-key',TEST_AI_LOG:log,TEST_AI_FAIL:failure},stdio:['ignore','pipe','pipe']});
 const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timed out')),10000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code));});child.stdout.on('data',chunk=>{const match=chunk.toString().match(/port (\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});});base='http://127.0.0.1:'+port;
 await call('/bootstrap','POST',{name:'테스트 교사',username:'teacher',password:'test-password-123'},'');
 teacher=(await call('/login','POST',{username:'teacher',password:'test-password-123'},'')).cookie;
 for(const username of ['group01','group02'])await call('/users','POST',{name:username,username,password:'student-password',dailyLimit:100});
 student=(await call('/login','POST',{username:'group01',password:'student-password'},'')).cookie;
 other=(await call('/login','POST',{username:'group02',password:'student-password'},'')).cookie;
});
after(async()=>{if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}rmSync(dir,{recursive:true,force:true});});
test('all eight activity forms have three questions, visible examples and matching output guidance',()=>{
 const context=vm.createContext({console});
 vm.runInContext(readFileSync(new URL('../public/activities.js',import.meta.url),'utf8'),context);
 vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/boot\(\);\s*$/,''),context);
 vm.runInContext("state.user={id:1,role:'student',balance:10};state.requests=[{id:7,type:'design',outputType:'design',title:'전달받은 시안',status:'released',releasedAt:new Date().toISOString(),candidates:[]},{id:8,title:'미공개',status:'review'}]",context);
 for(const [code,activity] of Object.entries(activities)){
  context.code=code;context.type=activity.type;const html=vm.runInContext('state.formType=type;state.activity=code;newRequest()',context);
  assert.equal((html.match(/<textarea name="q/g)||[]).length,3);
  for(const [question,example] of activity.questions){assert.ok(html.includes(question));assert.ok(html.includes('예: '+example));}
  assert.ok(html.includes('컨설팅 의뢰하기'));assert.ok(!/name="(goods|country|purpose|format|title)"/.test(html));
  if(code==='D1'){assert.ok(html.includes('value="7"'));assert.ok(!html.includes('value="8"'));}
 }
 context.tableText='| 항목 | 내용 |\n| --- | --- |\n| 제주 | <script>alert(1)</script> |';
 const formatted=vm.runInContext('resultContent(tableText)',context);assert.match(formatted,/<table>/);assert.ok(!formatted.includes('<script>'));assert.match(formatted,/&lt;script&gt;/);
 const legacy={id:9,type:'market',title:'이전 기록',answers:{goods:'기존 굿즈',country:'일본',audience:'가족',purpose:'조사',details:'사용자 조사',format:'표'}};
 context.legacy=legacy;assert.match(vm.runInContext('answers(legacy)',context),/기존 굿즈/);
});
test('new activity validation rejects missing answers, mismatched fields and invalid revision parents without charging coins',async()=>{
 const balance=(await call('/me','GET',null,student)).data.user.balance;
 for(const invalid of [payload('A1',{type:'market'}),payload('A1',{answers:{q1:'굿즈',q2:'제주'}}),payload('D1'),payload('D1',{parentId:99999}),payload('A1',{parentId:1}),payload('A1',{activity:'invalid'})])assert.equal((await call('/requests','POST',invalid,student)).status,400);
 assert.equal((await call('/me','GET',null,student)).data.user.balance,balance);
});
test('seven initial activities send only the three answers and correct activity requirements to AI; designs include private images',async()=>{
 for(const code of ['A1','A2','B1','B2','C1','E1','E2']){
  const created=await call('/requests','POST',payload(code),student);assert.equal(created.status,200);const id=created.data.id;
  assert.equal((await call(`/requests/${id}/generate`,'POST',{})).status,200);
  const row=(await call('/requests')).data.requests.find(r=>r.id===id);assert.equal(row.answers.activity,code);assert.equal(row.candidates.length,3);
  assert.equal((await call('/requests','GET',null,student)).data.requests.find(r=>r.id===id).candidates,undefined);
  const message=logs().filter(x=>x.url.endsWith('/chat/completions')).at(-1).payload.messages;
  const context=JSON.parse(message[1].content);assert.equal(context.activityCode,code);assert.deepEqual(context.requiredOutputs,activities[code].outputs);assert.deepEqual(context.answers.map(x=>x.answer),Object.values(payload(code).answers));assert.equal(context.previousResult,null);
  assert.match(message[0].content,/확인된 사실/);assert.match(message[0].content,/초등학교 4학년/);assert.match(message[0].content,/미입력 조건은 확정하지/);
  if(code==='C1'){
   designId=id;assert.ok(row.candidates.every(c=>c.imageUrl));
   const image=await fetch(base+row.candidates[0].imageUrl,{headers:{Cookie:student}});assert.equal(image.status,404);
   const requests=logs().filter(x=>x.url.endsWith('/images/generations'));assert.equal(requests.length,3);assert.ok(requests[0].payload.prompt.includes(payload(code).answers.q3));
  }
  assert.equal((await call(`/requests/${id}/release`,'POST',{selected:[1],reviewConfirmed:true})).status,200);
 }
 const result=(await call('/requests','GET',null,student)).data.requests.find(r=>r.id===designId);const response=await fetch(base+result.candidates[0].imageUrl,{headers:{Cookie:student}});assert.equal(response.status,200);
});
test('D1 uses only owned, released results and edits the previous image; repeated revisions retain the design output type',async()=>{
 assert.equal((await call('/requests','POST',payload('D1',{parentId:designId}),other)).status,400);
 let parentId=designId;
 for(let i=0;i<2;i++){
  const created=await call('/requests','POST',payload('D1',{parentId}),student);assert.equal(created.status,200);const id=created.data.id;
  assert.equal((await call(`/requests/${id}/generate`,'POST',{})).status,200);
  const context=JSON.parse(logs().filter(x=>x.url.endsWith('/chat/completions')).at(-1).payload.messages[1].content);
  assert.equal(context.previousResult.id,parentId);assert.deepEqual(context.previousResult.candidates.map(c=>c.id),[1]);assert.equal(context.outputType,'design');assert.equal(context.answers[2].answer,payload('D1').answers.q3);
  const edits=logs().filter(x=>x.url.endsWith('/images/edits'));assert.equal(edits.length,(i+1)*3);assert.ok(edits.at(-1).payload.image.size>0);
  const row=(await call('/requests')).data.requests.find(r=>r.id===id);assert.equal(row.outputType,'design');assert.ok(row.candidates.every(c=>c.imageUrl));
  assert.equal((await call(`/requests/${id}/release`,'POST',{selected:[1],reviewConfirmed:true})).status,200);parentId=id;
 }
});
test('text result revisions preserve the original consulting kind and never request images',async()=>{
 const parent=(await call('/requests','GET',null,student)).data.requests.find(r=>r.answers.activity==='B2');
 const imagesBefore=logs().filter(x=>x.url.includes('/images/')).length;
 const id=(await call('/requests','POST',payload('D1',{parentId:parent.id}),student)).data.id;
 assert.equal((await call(`/requests/${id}/generate`,'POST',{})).status,200);
 const context=JSON.parse(logs().filter(x=>x.url.endsWith('/chat/completions')).at(-1).payload.messages[1].content);
 assert.equal(context.outputType,'market');assert.equal(context.previousResult.activity,'B2');assert.equal(logs().filter(x=>x.url.includes('/images/')).length,imagesBefore);
 assert.equal((await call(`/requests/${id}/release`,'POST',{selected:[1],reviewConfirmed:true})).status,200);
});
test('image failures keep reviewable text, block image-less AI releases, and allow teacher retries',async()=>{
 writeFileSync(failure,'fail');
 const id=(await call('/requests','POST',payload('C1'),student)).data.id;
 assert.equal((await call(`/requests/${id}/generate`,'POST',{})).status,502);
 const row=(await call('/requests')).data.requests.find(r=>r.id===id);assert.equal(row.status,'review');assert.equal(row.candidates.length,3);
 assert.equal((await call(`/requests/${id}/release`,'POST',{selected:[1],reviewConfirmed:true})).status,400);
 rmSync(failure);assert.equal((await call(`/requests/${id}/images/1`,'POST',{})).status,200);
 assert.equal((await call(`/requests/${id}/release`,'POST',{selected:[1],reviewConfirmed:true})).status,200);
});
