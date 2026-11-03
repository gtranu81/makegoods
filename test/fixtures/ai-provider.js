// Test-only provider: no request can reach the paid AI service.
import {appendFileSync,existsSync,readFileSync} from 'node:fs';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
globalThis.fetch=async(url,options)=>{
 if(!String(url).startsWith('https://api.openai.com/'))throw Error('Unexpected test network destination');
 const multipart=options.body instanceof FormData;
 const payload=multipart?Object.fromEntries([...options.body].map(([key,value])=>[key,typeof value==='string'?value:{size:value.size,type:value.type}])):JSON.parse(options.body);
 const context=String(url).includes('/chat/')?JSON.parse(payload.messages[1].content):null;
 appendFileSync(process.env.TEST_AI_LOG,JSON.stringify({url,payload,purpose:context?.purpose})+'\n');
 if(String(url).includes('/images/'))return existsSync(process.env.TEST_AI_FAIL)?new Response('{}',{status:503}):Response.json({data:[{b64_json:png}]});
 if(context?.purpose==='growth_analysis'){
  const bad=process.env.TEST_GROWTH_BAD&&existsSync(process.env.TEST_GROWTH_BAD)?readFileSync(process.env.TEST_GROWTH_BAD,'utf8'):null;
  const policy=globalThis.growthPolicy;
  const report=context.kind==='summary'?policy.summaryObservation(context.history):policy.observation(context.current,context.history);
  if(context.kind==='request'){
   report.growth='실제 입력한 문장을 비교한 관찰입니다.';
   report.teacherNarrative='교사용 비공개 관찰 세부 사항';
   for(const a of report.areas)if(context.comparison.areas.find(x=>x.key===a.key)?.comparable)a.evidence.push(policy.quote(context.comparison.previous));
   if(context.comparison.previous?.final&&context.current.final){
    report.resultChange='작성한 요청이 결과 설명에서 어떻게 언급되었는지 확인해 보세요.';
    report.resultEvidence=[context.comparison.previous,context.current].map(r=>({requestId:r.id,candidateId:r.final.candidates[0].id,quote:r.final.candidates[0].content.slice(0,120)}));
   }
  }
  if(bad){if(context.kind==='summary')report.examples[0].after.quote='실제 입력에 없는 문장';else report.areas[0].evidence[0].quote='실제 입력에 없는 문장';}
  return Response.json({choices:[{message:{content:JSON.stringify(report)}}]});
 }

 const result={candidates:[1,2,3].map(id=>({title:`${context.activity} ${id}`,summary:'학생 의뢰를 반영한 제안',content:`학생의 요청: ${context.answers.map(a=>a.answer).join(' / ')}\n\n| 구분 | 제안 |\n| --- | --- |\n| 특징 | 제주 오름 |`})),assessment:{score:18,strengths:['자신의 생각을 구체적으로 적었어요.'],improvements:['모형을 만들어 살펴보세요.'],safety:'사실과 제안을 구분해요.'}};
 return Response.json({choices:[{message:{content:JSON.stringify(result)}}]});
};
