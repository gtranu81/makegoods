import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

const dir=mkdtempSync(join(tmpdir(),'jeju-test-'));
let child,base,cookieTeacher,cookieStudent,cookieOther,studentId,requestId;
async function start(){
 child=spawn(process.execPath,['--use-env-proxy','server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DB_PATH:join(dir,'test.sqlite'),AI_API_KEY:'',NODE_ENV:'test',SETUP_TOKEN:'',APP_ORIGIN:'',RENDER_EXTERNAL_URL:'https://jeju-test.onrender.com'},stdio:['ignore','pipe','pipe']});
 const port=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Startup timed out')),10000);child.stdout.on('data',chunk=>{const m=chunk.toString().match(/port (\d+)/);if(m){clearTimeout(timeout);resolve(m[1]);}});child.on('error',reject);});base=`http://127.0.0.1:${port}`;
}
async function stop(){child.kill('SIGTERM');await once(child,'exit');}
async function call(path,method='GET',body,cookie,extra={}){const res=await fetch(base+'/api'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...extra},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
const request={type:'market',title:'제주 바다 파우치 수출 조사',answers:{goods:'재활용 원단으로 만든 제주 해녀 파우치',country:'일본',audience:'환경에 관심 있는 청소년',purpose:'사용자에게 적합한지 알아보고 싶어요',details:'파란색 파우치의 활용 장소와 소비자 인터뷰 질문을 알려주세요.',format:'확인할 사항과 질문을 표로 정리해 주세요'},safetyConfirmed:true};
before(start);
after(async()=>{await stop();rmSync(dir,{recursive:true,force:true});});
test('first teacher setup, secure login, and student creation',async()=>{
 assert.equal((await call('/bootstrap')).data.needsSetup,true);
 assert.equal((await call('/bootstrap','POST',{name:'제주 선생님',username:'teacher',password:'teacher-strong-pass'})).status,200);
 assert.equal((await call('/bootstrap','POST',{name:'다른 교사',username:'another',password:'teacher-strong-pass'})).status,409);
 assert.equal((await call('/login','POST',{username:'teacher',password:'wrong'})).status,401);
 const login=await call('/login','POST',{username:'teacher',password:'teacher-strong-pass'},null,{Origin:'https://jeju-test.onrender.com'});assert.equal(login.status,200);cookieTeacher=login.cookie;assert.match(cookieTeacher,/^session=/);
 for(const [username,name] of [['group01','바다 1모둠'],['group02','오름 2모둠']]){const r=await call('/users','POST',{username,name,password:'student-strong-pass'},cookieTeacher);assert.equal(r.status,200);if(username==='group01')studentId=r.data.id;}
 cookieStudent=(await call('/login','POST',{username:'group01',password:'student-strong-pass'})).cookie;
 cookieOther=(await call('/login','POST',{username:'group02',password:'student-strong-pass'})).cookie;
 assert.equal((await call('/users','GET',null,cookieStudent)).status,403);
 assert.equal((await call('/me','GET',null,cookieStudent)).data.user.balance,3);
});
test('request validation, role separation, coin charge and isolation',async()=>{
 assert.equal((await call('/requests','POST',{...request,safetyConfirmed:false},cookieStudent)).status,400);
 assert.equal((await call('/me','GET',null,cookieStudent)).data.user.balance,3);
 assert.equal((await call('/requests','POST',request,cookieTeacher)).status,403);
 const submitted=await call('/requests','POST',request,cookieStudent);assert.equal(submitted.status,200);requestId=submitted.data.id;
 assert.equal((await call('/me','GET',null,cookieStudent)).data.user.balance,2);
 assert.equal((await call('/requests','GET',null,cookieOther)).data.requests.length,0);
 assert.equal((await call('/requests','GET',null,cookieStudent)).data.requests[0].candidates,undefined);
});
test('teacher generates three drafts; unreleased output is hidden; release requires review',async()=>{
 assert.equal((await call(`/requests/${requestId}/generate`,'POST',{},cookieStudent)).status,403);
 const generated=await call(`/requests/${requestId}/generate`,'POST',{},cookieTeacher);assert.equal(generated.status,200);assert.equal(generated.data.source,'demo');
 const teacherDraft=(await call('/requests','GET',null,cookieTeacher)).data.requests[0];assert.equal(teacherDraft.candidates.length,3);assert.ok(teacherDraft.assessment.improvements.length);
 const studentDraft=(await call('/requests','GET',null,cookieStudent)).data.requests[0];assert.equal(studentDraft.candidates,undefined);assert.equal(studentDraft.assessment,undefined);
 assert.equal((await call(`/requests/${requestId}/release`,'POST',{selected:[1]},cookieTeacher)).status,400);
 assert.equal((await call(`/requests/${requestId}/release`,'POST',{selected:[],reviewConfirmed:true},cookieTeacher)).status,400);
 teacherDraft.candidates[0].title='선생님이 수정한 제안';
 const result=await call(`/requests/${requestId}/release`,'POST',{selected:[1,3],candidates:teacherDraft.candidates,assessment:teacherDraft.assessment,teacherNote:'좋은 시작이에요. 실제 자료를 확인해 보세요.',reviewConfirmed:true},cookieTeacher);assert.equal(result.status,200);
 const studentResult=(await call('/requests','GET',null,cookieStudent)).data.requests[0];assert.equal(studentResult.candidates.length,2);assert.equal(studentResult.candidates[0].title,'선생님이 수정한 제안');assert.equal(studentResult.status,'released');assert.ok(studentResult.assessment);
 assert.equal((await call(`/requests/${requestId}/generate`,'POST',{},cookieTeacher)).status,409);
});
test('follow-ups linked to owned released requests and concurrent spending cannot overdraw',async()=>{
 assert.equal((await call('/requests','POST',{...request,parentId:requestId},cookieOther)).status,400);
 assert.equal((await call('/requests','POST',{...request,type:'revision',parentId:requestId},cookieStudent)).status,200);
 assert.equal((await call('/me','GET',null,cookieStudent)).data.user.balance,1);
 const results=await Promise.all([call('/requests','POST',request,cookieStudent),call('/requests','POST',request,cookieStudent)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal((await call('/me','GET',null,cookieStudent)).data.user.balance,0);
 assert.ok((await call('/requests','GET',null,cookieStudent)).data.requests.some(r=>r.parentId===requestId));
});
test('coin settings, atomic rejection, daily reset and period balance semantics',async()=>{
 assert.equal((await call(`/users/${studentId}`,'PATCH',{adjustment:-1},cookieTeacher)).status,400);
 assert.equal((await call(`/users/${studentId}`,'PATCH',{periodLimit:8},cookieTeacher)).status,200);
 assert.equal((await call(`/users/${studentId}`,'PATCH',{adjustment:2,reason:'추가 활동'},cookieTeacher)).status,200);
 assert.equal((await call('/me','GET',null,cookieStudent)).data.user.balance,10);
 const db=new DatabaseSync(join(dir,'test.sqlite'));db.prepare("UPDATE users SET coin_day='2000-01-01' WHERE id=?").run(studentId);
 assert.equal((await call('/me','GET',null,cookieStudent)).data.user.balance,10);
 assert.equal((await call(`/users/${studentId}`,'PATCH',{periodLimit:null,dailyLimit:4},cookieTeacher)).status,200);
 await call('/requests','POST',request,cookieStudent);assert.equal((await call('/me','GET',null,cookieStudent)).data.user.balance,3);
 db.prepare("UPDATE users SET coin_day='2000-01-01' WHERE id=?").run(studentId);db.close();
 assert.equal((await call('/me','GET',null,cookieStudent)).data.user.balance,4);
 assert.ok((await call('/ledger','GET',null,cookieStudent)).data.entries.some(l=>l.reason==='하루 코인 초기화'));
});
test('design images require teacher generation and are private until selected and released',async()=>{
 const submitted=await call('/requests','POST',{...request,type:'design'},cookieStudent);assert.equal(submitted.status,200);const id=submitted.data.id;
 assert.equal((await call(`/requests/${id}/images/1`,'POST',{},cookieStudent)).status,403);
 await call(`/requests/${id}/generate`,'POST',{},cookieTeacher);
 assert.equal((await call(`/requests/${id}/images/1`,'POST',{},cookieTeacher)).status,400);
 const file=join(dir,'fixture.png');writeFileSync(file,Buffer.from('89504e470d0a1a0a','hex'));const db=new DatabaseSync(join(dir,'test.sqlite'));db.prepare('INSERT INTO images VALUES(?,?,?)').run(id,1,file);db.prepare('INSERT INTO images VALUES(?,?,?)').run(id,2,file);db.close();
 const getImage=(cookie,candidate)=>fetch(base+`/api/requests/${id}/images/${candidate}`,{headers:{Cookie:cookie}});
 assert.equal((await getImage(cookieTeacher,1)).status,200);
 assert.equal((await getImage(cookieStudent,1)).status,404);
 assert.equal((await getImage(cookieOther,1)).status,404);
 await call(`/requests/${id}/release`,'POST',{selected:[1],teacherNote:'시안 검토 완료',reviewConfirmed:true},cookieTeacher);
 const visible=await getImage(cookieStudent,1);assert.equal(visible.status,200);assert.equal(visible.headers.get('content-type'),'image/png');
 assert.equal((await getImage(cookieStudent,2)).status,404);
 const output=(await call('/requests','GET',null,cookieStudent)).data.requests.find(r=>r.id===id);assert.equal(output.candidates[0].imageUrl,`/api/requests/${id}/images/1`);
});
test('teacher can deliver a custom design with a private uploaded image, without AI generation',async()=>{
 const id=(await call('/requests','POST',{...request,type:'design'},cookieOther)).data.id;
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
 const payload={manual:{title:'직접 만든 제주 시안',summary:'교사가 준비한 디자인',content:'제주 바다 문양과 파란색을 사용해요.',image},reviewConfirmed:true};
 const fullSizeImage='data:image/png;base64,'+Buffer.concat([Buffer.from(image.split(',')[1],'base64'),Buffer.alloc(5*1024*1024-Buffer.from(image.split(',')[1],'base64').length)]).toString('base64');
 payload.manual.image=fullSizeImage;
 const balance=(await call('/me','GET',null,cookieOther)).data.user.balance;
 assert.equal((await call(`/requests/${id}/release`,'POST',payload,cookieOther)).status,403);
 assert.equal((await call(`/requests/${id}/release`,'POST',{...payload,reviewConfirmed:false},cookieTeacher)).status,400);
 assert.equal((await call(`/requests/${id}/release`,'POST',{...payload,manual:{...payload.manual,image:'data:image/png;base64,YmFk'}},cookieTeacher)).status,400);
 assert.equal((await call(`/requests/${id}/release`,'POST',{...payload,manual:{...payload.manual,content:''}},cookieTeacher)).status,400);
 assert.equal((await call(`/requests/${id}/release`,'POST',{...payload,manual:{...payload.manual,image:'data:image/png;base64,'+Buffer.alloc(5*1024*1024+1).toString('base64')}},cookieTeacher)).status,413);
 const url=base+`/api/requests/${id}/images/4`;
 assert.equal((await fetch(url,{headers:{Cookie:cookieOther}})).status,404);
 assert.equal((await call(`/requests/${id}/release`,'POST',payload,cookieTeacher)).status,200);
 const result=(await call('/requests','GET',null,cookieOther)).data.requests.find(r=>r.id===id);
 assert.equal(result.source,'teacher');assert.equal(result.assessment,null);assert.equal(result.candidates.length,1);assert.equal(result.candidates[0].title,payload.manual.title);assert.equal(result.candidates[0].imageUrl,`/api/requests/${id}/images/4`);
 const visible=await fetch(url,{headers:{Cookie:cookieOther}});assert.equal(visible.status,200);assert.equal(visible.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await visible.arrayBuffer()),Buffer.from(fullSizeImage.split(',')[1],'base64'));
 assert.equal((await fetch(url,{headers:{Cookie:cookieStudent}})).status,404);
 assert.equal((await call(`/requests/${id}/release`,'POST',payload,cookieTeacher)).status,409);
 assert.equal((await call('/me','GET',null,cookieOther)).data.user.balance,balance);
 const second=(await call('/requests','POST',{...request,type:'design'},cookieOther)).data.id;
 await call(`/requests/${second}/generate`,'POST',{},cookieTeacher);
 assert.equal((await call(`/requests/${second}/release`,'POST',{...payload,manual:{...payload.manual,image:null}},cookieTeacher)).status,200);
 const secondResult=(await call('/requests','GET',null,cookieOther)).data.requests.find(r=>r.id===second);
 assert.deepEqual(secondResult.candidates.map(c=>c.id),[4]);assert.equal(secondResult.candidates[0].imageUrl,null);
 await stop();await start();assert.equal((await fetch(base+`/api/requests/${id}/images/4`,{headers:{Cookie:cookieOther}})).status,200);
});
test('without an AI key, growth records remain factual observations and private until teacher review',async()=>{
 let teacherView;
 for(let i=0;i<100;i++){teacherView=(await call('/growth?userId='+studentId,'GET',null,cookieTeacher)).data;if(teacherView.records.every(r=>!['pending','running'].includes(r.status)))break;await new Promise(r=>setTimeout(r,20));}
 assert.ok(teacherView.records.length>0);assert.ok(teacherView.records.every(r=>r.source==='observation'));
 const record=teacherView.records.find(r=>r.kind==='request');assert.match(record.report.teacherNarrative,/AI 미연결/);
 const studentView=(await call('/growth','GET',null,cookieStudent)).data;assert.ok(studentView.records.every(r=>r.report===null));assert.equal(studentView.events,undefined);
 assert.equal((await call('/growth/'+record.id,'PATCH',{version:record.version,report:{next:'다음에는 사용할 사람을 한 가지 예로 설명해 보세요.'},approve:true,reviewConfirmed:true},cookieTeacher)).status,200);
 const visible=(await call('/growth','GET',null,cookieStudent)).data.records.find(r=>r.id===record.id);assert.equal(visible.report.next,'다음에는 사용할 사람을 한 가지 예로 설명해 보세요.');assert.equal(visible.report.teacherNarrative,undefined);
});
test('session security, account disabling, password reset and persistence across restart',async()=>{
 assert.equal((await call('/requests','POST',request,cookieStudent,{Origin:'https://untrusted.example'})).status,403);
 const me=(await call('/me','GET',null,cookieTeacher)).data.user;assert.equal(me.hash,undefined);assert.equal(me.salt,undefined);
 assert.equal((await call(`/users/${studentId}`,'PATCH',{active:false},cookieTeacher)).status,200);
 assert.equal((await call('/me','GET',null,cookieStudent)).status,401);
 assert.equal((await call('/login','POST',{username:'group01',password:'student-strong-pass'})).status,401);
 await call(`/users/${studentId}`,'PATCH',{active:true,password:'new-student-pass'},cookieTeacher);
 assert.equal((await call('/login','POST',{username:'group01',password:'student-strong-pass'})).status,401);
 const login=await call('/login','POST',{username:'group01',password:'new-student-pass'});cookieStudent=login.cookie;assert.equal(login.status,200);
 const count=(await call('/requests','GET',null,cookieStudent)).data.requests.length;
 await stop();await start();assert.equal((await call('/requests','GET',null,cookieStudent)).data.requests.length,count);
 assert.equal((await call('/logout','POST',{},cookieStudent)).status,200);assert.equal((await call('/me','GET',null,cookieStudent)).status,401);
});
