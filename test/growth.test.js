import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import vm from 'node:vm';
const dir=mkdtempSync(join(tmpdir(),'jeju-growth-')),log=join(dir,'ai.jsonl'),bad=join(dir,'bad-growth');
let child,base,teacher,student,other,userId,otherId,firstId,secondId,approvedId,approvedVersion;
async function start(){
 child=spawn(process.execPath,['--import','./test/fixtures/ai-provider.js','server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DB_PATH:join(dir,'app.sqlite'),NODE_ENV:'test',SETUP_TOKEN:'',APP_ORIGIN:'',RENDER_EXTERNAL_URL:'',AI_API_KEY:'test-only-not-a-real-key',TEST_AI_LOG:log,TEST_AI_FAIL:join(dir,'fail-image'),TEST_GROWTH_BAD:bad},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',d=>{stderr+=d;});
 const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server startup timeout '+stderr)),15000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+' '+stderr));});child.stdout.on('data',chunk=>{const match=chunk.toString().match(/port (\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});});base='http://127.0.0.1:'+port;
}
async function stop(){if(child?.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}}
async function call(path,method='GET',body,cookie=teacher){const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',Cookie:cookie||''},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
const form=(activity='A1',extra={})=>({type:{A1:'idea',B1:'market',C1:'design',D1:'revision'}[activity],activity,answers:{q1:'  제주 느낌이 나는 가방을 만들고 싶어요.  ',q2:'제주의 오름을 넣어요.',q3:'가족이 쓰면 좋겠어요.'},safetyConfirmed:true,...extra});
async function growth(cookie=teacher,id=userId){return (await call('/growth'+(cookie===teacher?'?userId='+id:''),'GET',null,cookie)).data;}
async function settled(id=userId){for(let i=0;i<150;i++){const d=await growth(teacher,id);if(d.records.every(r=>!['pending','running'].includes(r.status)))return d;await new Promise(r=>setTimeout(r,30));}throw Error('Growth analysis did not complete');}
async function approve(row,report={}){return call('/growth/'+row.id,'PATCH',{version:row.version,report,approve:true,reviewConfirmed:true});}
before(async()=>{
 await start();await call('/bootstrap','POST',{name:'성장 지도 교사',username:'teacher',password:'teacher-password'},'');teacher=(await call('/login','POST',{username:'teacher',password:'teacher-password'},'')).cookie;
 userId=(await call('/users','POST',{name:'바다 모둠',username:'group01',password:'student-password',dailyLimit:100})).data.id;
 otherId=(await call('/users','POST',{name:'오름 모둠',username:'group02',password:'student-password',dailyLimit:100})).data.id;
 student=(await call('/login','POST',{username:'group01',password:'student-password'},'')).cookie;other=(await call('/login','POST',{username:'group02',password:'student-password'},'')).cookie;
});
after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
test('empty growth history and access checks do not expose another group',async()=>{
 assert.equal((await call('/growth?userId='+userId,'GET',null,'')).status,401);
 assert.equal((await call('/growth?userId='+otherId,'GET',null,student)).status,403);
 assert.equal((await call('/growth?userId=99999')).status,404);
 const own=await growth(student);assert.deepEqual(own.history,[]);assert.deepEqual(own.records,[]);assert.equal(own.events,undefined);
});
test('first request is an evidence-based starting point, never a growth claim, and AI drafts require teacher approval',async()=>{
 firstId=(await call('/requests','POST',form(),student)).data.id;
 await call(`/requests/${firstId}/generate`,'POST',{});await call(`/requests/${firstId}/generate`,'POST',{});
 const draft=(await call('/requests')).data.requests.find(r=>r.id===firstId);draft.candidates[0].title='교사가 다듬은 최종 가방';
 assert.equal((await call(`/requests/${firstId}/release`,'POST',{selected:[1],candidates:draft.candidates,assessment:draft.assessment,reviewConfirmed:true})).status,200);
 const data=await settled(),record=data.records.find(r=>r.requestId===firstId),summary=data.records.find(r=>r.kind==='summary');
 assert.equal(record.source,'ai');assert.equal(record.status,'review');assert.match(record.report.growth,/아직/);assert.match(record.report.resultChange,/확인하지 못/);assert.match(summary.report.strongest,/아직/);
 assert.deepEqual(record.report.areas.map(a=>a.key),['purpose','specificity','context']);
 assert.equal(data.history[0].answers.q1,form().answers.q1);
 assert.equal((await growth(student)).records.find(r=>r.id===record.id).report,null);
 assert.equal((await call('/growth/'+record.id,'PATCH',{version:record.version,approve:true},student)).status,403);
 assert.equal((await call('/growth/'+record.id,'PATCH',{version:record.version,approve:true})).status,400);
 assert.equal((await approve(record,{now:'교사가 확인한 이번 의뢰의 특징',teacherNarrative:'교사 전용 민감한 지도 메모'})).status,200);
 const visible=(await growth(student)).records.find(r=>r.id===record.id);assert.equal(visible.report.now,'교사가 확인한 이번 의뢰의 특징');assert.equal(visible.report.teacherNarrative,undefined);assert.equal(visible.report.teacherGuidance,undefined);assert.equal(visible.revisions,undefined);
 approvedId=record.id;approvedVersion=(await growth()).records.find(r=>r.id===record.id).version;
});
test('original AI drafts and teacher-approved final results survive independently',async()=>{
 const data=await growth(),events=data.events.filter(e=>e.requestId===firstId);
 const drafts=events.filter(e=>e.kind==='ai_draft');assert.equal(drafts.length,2);assert.notEqual(drafts[0].data.candidates[0].title,'교사가 다듬은 최종 가방');
 assert.equal(events.find(e=>e.kind==='teacher_final').data.candidates[0].title,'교사가 다듬은 최종 가방');assert.equal(events.find(e=>e.kind==='submitted').data.answers.q1,form().answers.q1);
 const studentData=await growth(student);assert.equal(studentData.events,undefined);assert.equal(studentData.history[0].aiDraft,undefined);assert.equal(studentData.history[0].final.candidates.length,1);
});
test('same-activity comparisons use exact quotes and compare result effects only after both final results exist',async()=>{
 secondId=(await call('/requests','POST',form('A1',{answers:{q1:'프랑스 가족이 피크닉할 때 가방과 돗자리로 쓰게 만들고 싶어요.',q2:'제주의 오름과 초록색을 넣어요.',q3:'가족이 쉽게 접고 가지고 다니면 좋겠어요.'}}),student)).data.id;
 let data=await settled(),record=data.records.find(r=>r.requestId===secondId);assert.equal(record.comparisonId,firstId);assert.match(record.report.resultChange,/확인하지 못/);
 for(const area of record.report.areas){assert.ok(area.evidence.some(e=>e.requestId===firstId));assert.ok(area.evidence.some(e=>e.requestId===secondId));for(const e of area.evidence)assert.ok(data.history.find(r=>r.id===e.requestId).answers[e.field].includes(e.quote));}
 await call(`/requests/${secondId}/generate`,'POST',{});await call(`/requests/${secondId}/release`,'POST',{selected:[1],reviewConfirmed:true});data=await settled();record=data.records.find(r=>r.requestId===secondId);
 assert.ok(record.report.resultEvidence.length>=2);
 for(const e of record.report.resultEvidence){const candidate=data.history.find(r=>r.id===e.requestId).final.candidates.find(c=>c.id===e.candidateId);assert.ok(`${candidate.title}\n${candidate.summary}\n${candidate.content}`.includes(e.quote));}
 assert.equal((await growth(student)).records.find(r=>r.requestId===secondId).report,null);
});
test('cross-activity comparisons use only common areas and explicit revisions take priority',async()=>{
 const b=(await call('/requests','POST',form('B1'),student)).data.id;
 let data=await settled(),record=data.records.find(r=>r.requestId===b);assert.equal(record.comparisonId,secondId);assert.deepEqual(record.report.areas.map(a=>a.key),['purpose','specificity','context']);
 const d=(await call('/requests','POST',form('D1',{parentId:firstId,answers:{q1:'색을 바꾸고 싶어요.',q2:'밝은 초록색으로 바꿔요.',q3:'오름과 가방 기능은 그대로 두세요.'}}),student)).data.id;
 data=await settled();record=data.records.find(r=>r.requestId===d);assert.equal(record.comparisonId,firstId);assert.deepEqual(record.report.areas.map(a=>a.key),['purpose','specificity','constraints','improvement']);
 for(const a of record.report.areas.filter(a=>['constraints','improvement'].includes(a.key)))assert.ok(a.evidence.every(e=>e.requestId===d));
 const c=(await call('/requests','POST',form(),student)).data.id;data=await settled();record=data.records.find(r=>r.requestId===c);assert.equal(record.comparisonId,secondId);
});
test('identical answers never imply growth or a causal result improvement',async()=>{
 const data=await growth(),last=data.history.filter(r=>r.activity==='A1').at(-1);
 const id=(await call('/requests','POST',form('A1',{answers:last.answers}),student)).data.id;
 await call(`/requests/${id}/generate`,'POST',{});await call(`/requests/${id}/release`,'POST',{selected:[1],reviewConfirmed:true});
 const record=(await settled()).records.find(r=>r.requestId===id);assert.match(record.report.growth,/같은 내용/);assert.match(record.report.resultChange,/확인하지 못/);assert.deepEqual(record.report.resultEvidence,[]);
});
test('malformed AI evidence is rejected; retries and teacher edits keep revisions and reject stale writes',async()=>{
 writeFileSync(bad,'quote');const id=(await call('/requests','POST',form('B1'),student)).data.id;
 let data=await settled(),record=data.records.find(r=>r.requestId===id);assert.equal(record.status,'error');assert.ok(record.error);assert.equal((await growth(student)).records.find(r=>r.requestId===id).report,null);
 rmSync(bad);assert.equal((await call('/growth/'+record.id+'/retry','POST',{})).status,200);data=await settled();record=data.records.find(r=>r.id===record.id);assert.equal(record.status,'review');
 assert.equal((await approve(record,{growth:'교사가 원문을 확인해 정리한 변화입니다.'})).status,200);
 assert.equal((await approve(record,{growth:'오래된 화면의 덮어쓰기'})).status,409);
 const edited=(await growth()).records.find(r=>r.id===record.id);assert.ok(edited.revisions.some(r=>r.action==='approved'));assert.equal(edited.report.growth,'교사가 원문을 확인해 정리한 변화입니다.');
 assert.equal((await call('/growth/'+record.id+'/retry','POST',{},other)).status,403);
});
test('historical AI images remain teacher-only after regeneration, and brand assets are served correctly',async()=>{
 for(const path of ['/assets/jeju-robot.png','/assets/jiwon-logo.png']){const response=await fetch(base+path);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');}
 const id=(await call('/requests','POST',form('C1'),student)).data.id;
 assert.equal((await call(`/requests/${id}/generate`,'POST',{})).status,200);
 const event=(await growth()).events.find(e=>e.requestId===id&&e.kind==='ai_image');assert.ok(event);assert.equal(event.data.images[0].path,undefined);
 const image=event.data.images[0].imageUrl,original=await fetch(base+image,{headers:{Cookie:teacher}});assert.equal(original.status,200);const bytes=Buffer.from(await original.arrayBuffer());
 assert.equal((await fetch(base+image,{headers:{Cookie:student}})).status,403);
 assert.equal((await call(`/requests/${id}/generate`,'POST',{})).status,200);
 const preserved=await fetch(base+image,{headers:{Cookie:teacher}});assert.equal(preserved.status,200);assert.deepEqual(Buffer.from(await preserved.arrayBuffer()),bytes);
});
test('summary uses the complete ordered history, publishes only on review, and keeps evidence across restart',async()=>{
 let data=await settled();let summary=data.records.find(r=>r.kind==='summary');if(summary.status==='error'){await call('/growth/'+summary.id+'/retry','POST',{});data=await settled();summary=data.records.find(r=>r.kind==='summary');}assert.equal(summary.status,'review');assert.ok(summary.report.examples.length);assert.equal((await growth(student)).records.find(r=>r.kind==='summary').report,null);
 const logged=readFileSync(log,'utf8').trim().split('\n').map(JSON.parse).filter(x=>x.purpose==='growth_analysis').map(x=>JSON.parse(x.payload.messages[1].content));
 assert.ok(logged.some(c=>c.kind==='summary'&&c.history.length===data.history.length));
 assert.equal((await approve(summary,{teacherNarrative:'전체 의뢰 과정과 실제 사례를 검토한 교사용 종합 기록'})).status,200);
 await stop();await start();data=await settled();const restored=data.records.find(r=>r.kind==='summary');assert.equal(restored.status,'approved');assert.equal(restored.report.teacherNarrative,'전체 의뢰 과정과 실제 사례를 검토한 교사용 종합 기록');
 const studentData=await growth(student);assert.equal(studentData.records.find(r=>r.kind==='summary').report.teacherNarrative,undefined);assert.equal(data.records.find(r=>r.id===approvedId).version,approvedVersion);assert.equal(data.events.filter(e=>e.requestId===firstId&&e.kind==='ai_draft').length,2);
});
test('teacher and student growth views render narratives and escape user text',()=>{
 const context=vm.createContext({console});for(const path of ['../public/activities.js','../public/growth-policy.js'])vm.runInContext(readFileSync(new URL(path,import.meta.url),'utf8'),context);vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/boot\(\);\s*$/,''),context);
 context.data={history:[{id:1,sequence:1,activity:'A1',answers:form().answers,createdAt:new Date().toISOString()}]};context.record={id:1,kind:'request',requestId:1,status:'approved',source:'ai',version:'v1',report:{before:'이전 없음',now:'<script>alert(1)</script>',growth:'현재 특징',resultChange:'확인 불가',next:'조건 한 가지 적기',teacherNarrative:'교사 전용',teacherGuidance:'지도 내용',areas:[]}};
 vm.runInContext("state.user={id:2,role:'student'}",context);const studentHTML=vm.runInContext('growthReportCard(record,data)',context);assert.match(studentHTML,/처음에는/);assert.match(studentHTML,/&lt;script&gt;/);assert.ok(!studentHTML.includes('data-growth-review'));assert.ok(!studentHTML.includes('교사 전용'));
 vm.runInContext("state.user={id:1,role:'teacher'}",context);assert.match(vm.runInContext('growthReportCard(record,data)',context),/data-growth-review/);
});
