import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consultingResponseFormat,parseConsultingResponse,validateConsultingResult} from '../consulting-result.js';
import {aiDiagnostic} from '../ai-errors.js';
const proposal={title:'제주 오름 피크닉 가방',summary:'가족이 쓰는 가방 겸 돗자리',content:'가방 기능을 유지하고 초록색 오름을 넣어요.'};
const result=()=>({candidates:{first:{...proposal},second:{...proposal,title:'두 번째 디자인'},third:{...proposal,title:'세 번째 디자인'}},assessment:{score:18,strengths:['대상과 용도를 설명했어요.'],improvements:['크기를 한 가지 예로 설명해 보세요.'],safety:'저작권과 실제 사용 가능성을 확인해요.'}});
const response=(value)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
test('Structured Outputs requires exactly three named proposals, all fields and an integer score',()=>{
 assert.equal(consultingResponseFormat.type,'json_schema');assert.equal(consultingResponseFormat.json_schema.strict,true);
 const schema=consultingResponseFormat.json_schema.schema;assert.deepEqual(schema.properties.candidates.required,['first','second','third']);assert.equal(schema.properties.candidates.additionalProperties,false);
 for(const slot of schema.properties.candidates.required){const c=schema.properties.candidates.properties[slot];assert.deepEqual(c.required,['title','summary','content']);assert.equal(c.additionalProperties,false);}
 assert.deepEqual(schema.properties.assessment.required,['score','strengths','improvements','safety']);assert.deepEqual(schema.properties.assessment.properties.score.enum,Array.from({length:21},(_,i)=>i));
});
test('structured proposals become the existing ordered three-candidate array without changing their content',()=>{
 const parsed=parseConsultingResponse(response(result()));assert.deepEqual(parsed.candidates.map(c=>c.id),[1,2,3]);assert.equal(parsed.candidates[0].content,proposal.content);assert.equal(parsed.candidates[2].title,'세 번째 디자인');assert.equal(parsed.assessment.score,18);
});
test('valid legacy arrays still work; missing proposals are rejected instead of fabricated',()=>{
 const valid=result();valid.candidates=Object.values(valid.candidates);assert.equal(validateConsultingResult(valid).candidates.length,3);
 valid.candidates=[proposal];assert.throws(()=>validateConsultingResult(valid),e=>e.field==='candidates');
});
test('missing assessments and wrong scores reproduce the format failure with safe field diagnostics',()=>{
 const noAssessment=result();delete noAssessment.assessment;assert.throws(()=>parseConsultingResponse(response(noAssessment)),e=>e.field==='assessment');
 for(const score of ['18',18.5,21,-1,true]){const invalid=result();invalid.assessment.score=score;assert.throws(()=>parseConsultingResponse(response(invalid)),e=>e.field==='assessment.score');}
 const invalid=result();invalid.candidates.first.summary='private text '.repeat(60);let error;try{parseConsultingResponse(response(invalid),{model:'gpt-4.1-mini',requestId:'req_example'});}catch(e){error=e;}const diagnostic=aiDiagnostic(error);assert.equal(diagnostic.log.field,'candidates.0.summary');assert.equal(diagnostic.log.requestId,'req_example');assert.ok(!JSON.stringify(diagnostic).includes('private text'));
});
test('invalid envelopes and non-JSON model text do not become fake successful results',()=>{
 for(const data of [{},{choices:[]},{choices:[{message:{content:null}}]},{choices:[{message:{content:'```json\n{}\n```'}}]}])assert.throws(()=>parseConsultingResponse(data),e=>e.kind==='invalid_response');
});
test('truncation and explicit refusals are distinguished from schema errors',()=>{
 assert.throws(()=>parseConsultingResponse({choices:[{finish_reason:'length',message:{content:'{'}}]}),e=>e.kind==='truncated');
 assert.throws(()=>parseConsultingResponse({choices:[{finish_reason:'stop',message:{refusal:'private refusal details',content:null}}]}),e=>e.kind==='refusal'&&!JSON.stringify(aiDiagnostic(e)).includes('private refusal details'));
});
test('field bounds protect the existing review UI without silently shortening AI content',()=>{
 for(const [field,max] of [['title',100],['summary',500],['content',7000]]){const valid=result();valid.candidates.first[field]='가'.repeat(max);assert.equal(parseConsultingResponse(response(valid)).candidates[0][field].length,max);valid.candidates.first[field]+='가';assert.throws(()=>parseConsultingResponse(response(valid)),e=>e.field==='candidates.0.'+field);}
 const invalid=result();invalid.assessment.strengths=[];assert.throws(()=>parseConsultingResponse(response(invalid)),e=>e.field==='assessment.strengths');
});
