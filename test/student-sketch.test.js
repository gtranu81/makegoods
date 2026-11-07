import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import vm from 'node:vm';
import '../public/sketch-input.js';
const samples=JSON.parse(readFileSync(new URL('./fixtures/sketch-images.json',import.meta.url),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=data=>Buffer.from(data.split(',')[1],'base64');
function sizedPng(size){const source=bytes(samples.png),count=size-source.length-12,chunk=Buffer.alloc(count+12);chunk.writeUInt32BE(count);chunk.write('tEXt',4,'ascii');chunk.write('pad\0',8,'ascii');chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);return 'data:image/png;base64,'+Buffer.concat([source.subarray(0,-12),chunk,source.subarray(-12)]).toString('base64');}
const dir=mkdtempSync('/tmp/jeju-student-sketch-'),log=join(dir,'provider.jsonl');let child,base,teacher,student,other,studentId,designId;
async function start(){child=spawn(process.execPath,['--import','./test/fixtures/ai-provider.js','server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DB_PATH:join(dir,'test.sqlite'),NODE_ENV:'test',APP_ORIGIN:'',RENDER_EXTERNAL_URL:'',SETUP_TOKEN:'',AI_API_KEY:'test-only-key',TEST_AI_LOG:log,TEST_AI_FAIL:join(dir,'unused'),TEST_GROWTH_BAD:''},stdio:['ignore','pipe','pipe']});const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout')),15000);child.once('error',reject);child.stdout.on('data',d=>{const m=d.toString().match(/port (\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});base='http://127.0.0.1:'+port;}
async function stop(){if(child?.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
async function call(path,method='GET',body,cookie=teacher){const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie||''},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
const payload=(sketch=samples.png)=>({type:'design',activity:'C1',answers:{q1:'프랑스 가족을 위한 가방 겸용 피크닉 돗자리',q2:'학생 그림의 초록색 제주 오름과 파란 바다',q3:'가방 기능과 오름 모양은 그대로 두세요.'},sketch,safetyConfirmed:true});
const logged=()=>readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
before(async()=>{await start();await call('/bootstrap','POST',{name:'교사',username:'teacher',password:'teacher-password'},'');teacher=(await call('/login','POST',{username:'teacher',password:'teacher-password'},'')).cookie;for(const username of ['group01','group02']){const result=await call('/users','POST',{name:username,username,password:'student-password',dailyLimit:100});if(username==='group01')studentId=result.data.id;}student=(await call('/login','POST',{username:'group01',password:'student-password'},'')).cookie;other=(await call('/login','POST',{username:'group02',password:'student-password'},'')).cookie;});
after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
test('PNG/JPEG/WebP fixtures validate, and malformed images and disguised SVG are rejected',()=>{
 for(const [type,data] of Object.entries(samples)){const decoded=globalThis.studentSketchInput.decode(data);assert.equal(decoded.mime,'image/'+type);assert.deepEqual(Buffer.from(decoded.bytes),bytes(data));}
 for(const data of ['data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,YmFk','data:image/jpeg;base64,'+bytes(samples.png).toString('base64'),'',{},'data:image/png;base64,a'])assert.throws(()=>globalThis.studentSketchInput.decode(data),e=>e.status===400);
});
test('the exact 5MB boundary is accepted and 5MB plus one byte is rejected',async()=>{
 const image=sizedPng(5*1024*1024);assert.equal(globalThis.studentSketchInput.decode(image).size,5*1024*1024);
 assert.equal((await call('/requests','POST',payload(image),student)).status,200);
 const balance=(await call('/me','GET',null,student)).data.user.balance;
 assert.equal((await call('/requests','POST',payload(sizedPng(5*1024*1024+1)),student)).status,413);
 assert.equal((await call('/me','GET',null,student)).data.user.balance,balance);
});
test('invalid uploads, non-design activities and another group revision cannot charge coins',async()=>{
 const before=(await call('/me','GET',null,student)).data.user.balance;
 for(const input of [payload('data:image/png;base64,YmFk'),{...payload(),type:'idea',activity:'A1'},{...payload(),type:'revision',activity:'D1',parentId:99999}])assert.equal((await call('/requests','POST',input,student)).status,400);
 assert.equal((await call('/me','GET',null,student)).data.user.balance,before);
});
test('original drawings are visible to their owner and teacher before release, but not other groups or anonymous visitors',async()=>{
 designId=(await call('/requests','POST',payload(),student)).data.id;
 for(const cookie of [teacher,student]){const r=await fetch(base+`/api/requests/${designId}/sketch`,{headers:{Cookie:cookie}});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/png');assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes(samples.png));}
 assert.equal((await fetch(base+`/api/requests/${designId}/sketch`,{headers:{Cookie:other}})).status,404);
 assert.equal((await fetch(base+`/api/requests/${designId}/sketch`)).status,401);
 const row=(await call('/requests','GET',null,student)).data.requests.find(r=>r.id===designId);assert.equal(row.sketch.imageUrl,`/api/requests/${designId}/sketch`);assert.equal(row.sketch.sha256,sha(bytes(samples.png)));assert.equal(row.candidates,undefined);
 assert.equal((await call(`/requests/${designId}/sketch`,'POST',{sketch:samples.jpeg},student)).status,404);
});
test('AI receives the actual drawing with the three answers; image editing uses the original bytes',async()=>{
 assert.equal((await call(`/requests/${designId}/generate`,'POST',{})).status,200);
 const request=logged().filter(r=>r.url.endsWith('/chat/completions')&&r.purpose!=='growth_analysis').at(-1).payload;
 assert.ok(Array.isArray(request.messages[1].content));assert.equal(request.messages[1].content.find(c=>c.type==='image_url').image_url.url,samples.png);
 const context=JSON.parse(request.messages[1].content.find(c=>c.type==='text').text);assert.equal(context.studentSketch.sourceRequestId,designId);assert.equal(context.answers[2].answer,payload().answers.q3);
 for(const phrase of ['그림의 좋은 점','구체적인 디자인 조언','원본에서 유지할 핵심 특징'])assert.ok(request.messages[0].content.includes(phrase));
 const edits=logged().filter(r=>r.url.endsWith('/images/edits'));assert.equal(edits.length,3);for(const edit of edits){assert.equal(edit.payload.image.sha256,sha(bytes(samples.png)));assert.equal(edit.payload.image.type,'image/png');}
 const row=(await call('/requests')).data.requests.find(r=>r.id===designId);assert.ok(row.candidates.every(c=>c.imageUrl&&c.content.includes('디자인 조언')));
 assert.equal((await call('/requests','GET',null,student)).data.requests.find(r=>r.id===designId).candidates,undefined);
 for(const entry of logged().filter(r=>r.purpose==='growth_analysis'))assert.ok(!JSON.stringify(entry.payload).includes(samples.png));
});
test('regeneration keeps the original; growth history shows the original and only teacher-approved output',async()=>{
 assert.equal((await call(`/requests/${designId}/generate`,'POST',{})).status,200);
 const original=await fetch(base+`/api/requests/${designId}/sketch`,{headers:{Cookie:student}});assert.equal(sha(Buffer.from(await original.arrayBuffer())),sha(bytes(samples.png)));
 assert.equal((await call(`/requests/${designId}/release`,'POST',{selected:[1],reviewConfirmed:true})).status,200);
 const history=(await call('/growth','GET',null,student)).data.history.find(r=>r.id===designId);assert.equal(history.sketch.imageUrl,`/api/requests/${designId}/sketch`);assert.deepEqual(history.final.candidates.map(c=>c.id),[1]);assert.ok(history.final.candidates[0].imageUrl);
 const growth=(await call('/growth?userId='+studentId)).data;assert.equal(growth.events.find(e=>e.requestId===designId&&e.kind==='submitted').data.sketch.sha256,sha(bytes(samples.png)));assert.equal(growth.events.find(e=>e.requestId===designId&&e.kind==='teacher_final').data.sketch.sha256,sha(bytes(samples.png)));
});
test('design revisions inherit the immutable original, or use a newly uploaded student drawing with the earlier final design',async()=>{
 const revision={...payload(null),type:'revision',activity:'D1',parentId:designId};
 const inherited=(await call('/requests','POST',revision,student)).data.id;assert.equal((await call(`/requests/${inherited}/generate`,'POST',{})).status,200);
 let last=logged().filter(r=>r.url.endsWith('/images/edits')).at(-1);assert.equal(last.payload['image[]'][0].sha256,sha(bytes(samples.png)));assert.equal(last.payload['image[]'].length,2);
 const inheritedRow=(await call('/requests')).data.requests.find(r=>r.id===inherited);assert.equal(inheritedRow.sketch.requestId,designId);
 const updated=(await call('/requests','POST',{...revision,sketch:samples.webp},student)).data.id;assert.equal((await call(`/requests/${updated}/generate`,'POST',{})).status,200);
 last=logged().filter(r=>r.url.endsWith('/images/edits')).at(-1);assert.equal(last.payload['image[]'][0].sha256,sha(bytes(samples.webp)));assert.equal(last.payload['image[]'][0].type,'image/webp');
 const original=await fetch(base+`/api/requests/${designId}/sketch`,{headers:{Cookie:student}});assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes(samples.png));
 assert.equal((await call('/requests','POST',revision,other)).status,400);
});
test('JPEG originals survive restart with the same private image and original request reference',async()=>{
 const id=(await call('/requests','POST',payload(samples.jpeg),student)).data.id;await stop();await start();
 const r=await fetch(base+`/api/requests/${id}/sketch`,{headers:{Cookie:student}});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/jpeg');assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes(samples.jpeg));
 const row=(await call('/requests','GET',null,student)).data.requests.find(r=>r.id===id);assert.equal(row.sketch.requestId,id);assert.equal((await call('/growth','GET',null,student)).data.events,undefined);
});
test('design upload controls and original figures appear in student, teacher and growth views with existing question counts',()=>{
 const context=vm.createContext({console});for(const path of ['../public/activities.js','../public/growth-policy.js','../public/sketch-input.js'])vm.runInContext(readFileSync(new URL(path,import.meta.url),'utf8'),context);vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/boot\(\);\s*$/,''),context);
 vm.runInContext("state.user={role:'student',balance:10};state.formType='design';state.activity='C1';",context);let html=vm.runInContext('newRequest()',context);assert.match(html,/student-sketch-file/);assert.match(html,/5MB/);assert.equal((html.match(/<textarea name="q/g)||[]).length,3);
 context.record={id:42,type:'design',answers:{activity:'C1',q1:'가방',q2:'오름',q3:'기능 유지'},sketch:{requestId:42,imageUrl:'/api/requests/42/sketch'}};assert.match(vm.runInContext('answers(record)',context),/학생이 그린 원본 디자인/);assert.match(vm.runInContext('answers(record)',context),/\/api\/requests\/42\/sketch/);
 vm.runInContext("state.formType='idea';state.activity='A1';",context);html=vm.runInContext('newRequest()',context);assert.ok(!html.includes('student-sketch-file'));
});
