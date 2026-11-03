// Test-only provider: no request can reach the paid AI service.
import {appendFileSync,existsSync} from 'node:fs';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
globalThis.fetch=async(url,options)=>{
 if(!String(url).startsWith('https://api.openai.com/'))throw Error('Unexpected test network destination');
 const multipart=options.body instanceof FormData;
 const payload=multipart?Object.fromEntries([...options.body].map(([key,value])=>[key,typeof value==='string'?value:{size:value.size,type:value.type}])):JSON.parse(options.body);
 appendFileSync(process.env.TEST_AI_LOG,JSON.stringify({url,payload})+'\n');
 if(String(url).includes('/images/'))return existsSync(process.env.TEST_AI_FAIL)?new Response('{}',{status:503}):Response.json({data:[{b64_json:png}]});
 const context=JSON.parse(payload.messages[1].content);
 const result={candidates:[1,2,3].map(id=>({title:`${context.activity} ${id}`,summary:'학생 의뢰를 반영한 제안',content:`학생의 요청: ${context.answers.map(a=>a.answer).join(' / ')}\n\n| 구분 | 제안 |\n| --- | --- |\n| 특징 | 제주 오름 |`})),assessment:{score:18,strengths:['자신의 생각을 구체적으로 적었어요.'],improvements:['모형을 만들어 살펴보세요.'],safety:'사실과 제안을 구분해요.'}};
 return Response.json({choices:[{message:{content:JSON.stringify(result)}}]});
};
