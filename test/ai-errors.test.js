import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AiServiceError,providerError,aiDiagnostic} from '../ai-errors.js';
for(const [status,code,expected] of [[401,'invalid_api_key',/AI_API_KEY/],[429,'insufficient_quota',/Billing/],[429,'rate_limit_exceeded',/호출 한도/],[403,'permission_denied',/모델의 사용/],[404,'model_not_found',/AI_MODEL/],[400,'unsupported_parameter',/요청 설정/],[503,null,/일시적인 문제/]])test(`AI HTTP ${status} ${code} shows a specific action without provider text`,async()=>{
 const secret='do-not-display-test-key',student='학생의 비공개 원문';
 const error=await providerError(Response.json({error:{code,message:`Invalid credential ${secret}: ${student}`}},{status,headers:{'x-request-id':'req_test-123'}}),{stage:'text',model:'gpt-4.1-mini'});
 const diagnostic=aiDiagnostic(error);assert.match(diagnostic.message,expected);assert.match(diagnostic.message,new RegExp('HTTP '+status));assert.equal(diagnostic.log.requestId,'req_test-123');assert.ok(!JSON.stringify(diagnostic).includes(secret));assert.ok(!JSON.stringify(diagnostic).includes(student));
});
test('truncation and schema failures explicitly distinguish successful API access from invalid output',()=>{
 for(const kind of ['truncated','invalid_response'])assert.match(aiDiagnostic(new AiServiceError(kind)).message,/API에는 연결됐지만/);
 assert.match(aiDiagnostic(Object.assign(Error('untrusted message'),{name:'TimeoutError'})).message,/대기 시간/);
 assert.match(aiDiagnostic(TypeError('untrusted message')).message,/접속하지 못/);
});
test('unrecognized diagnostic metadata is omitted and the image model has its own guidance',async()=>{
 const error=await providerError(Response.json({error:{code:'secret: not-a-code',message:'private provider body'}},{status:404,headers:{'x-request-id':'private data here'}}),{stage:'image',model:'model with invalid characters'});
 const diagnostic=aiDiagnostic(error);assert.match(diagnostic.message,/AI_IMAGE_MODEL/);assert.equal(diagnostic.log.code,null);assert.equal(diagnostic.log.requestId,null);assert.equal(diagnostic.log.model,null);assert.ok(!JSON.stringify(diagnostic).includes('private'));
});
