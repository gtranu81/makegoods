import {AiServiceError} from './ai-errors.js';
const string=(description)=>({type:'string',description});
const candidate={type:'object',additionalProperties:false,required:['title','summary','content'],properties:{title:string('후보 제목. 공백이 아닌 1~100자.'),summary:string('후보 요약. 공백이 아닌 1~500자.'),content:string('활동에 필요한 결과물과 학생 요청 반영 내용을 포함한 제안. 공백이 아닌 1~7000자.')}};
// Fixed required slots enforce exactly three proposals without relying on array-size
// keywords that differ between models. The browser still receives a normal array.
export const consultingResponseFormat={type:'json_schema',json_schema:{name:'consulting_result',strict:true,schema:{type:'object',additionalProperties:false,required:['candidates','assessment'],properties:{
 candidates:{type:'object',additionalProperties:false,required:['first','second','third'],properties:{first:candidate,second:candidate,third:candidate}},
 assessment:{type:'object',additionalProperties:false,required:['score','strengths','improvements','safety'],properties:{score:{type:'integer',enum:Array.from({length:21},(_,i)=>i),description:'의뢰서 피드백 점수. 0~20의 정수.'},strengths:{type:'array',items:string('잘한 점 한 가지. 1~500자.'),description:'빈 배열이 아닌 1~5개의 잘한 점.'},improvements:{type:'array',items:string('다음에 보완할 점 한 가지. 1~500자.'),description:'빈 배열이 아닌 1~5개의 보완할 점.'},safety:string('개인정보·저작권·문화 표현·사실 확인 사항. 1~1000자.')}}
}}}};
export function validateConsultingResult(value,context={}){
 const invalid=field=>{throw new AiServiceError('invalid_response',{...context,stage:'text',field});};
 const text=(v,field,max)=>{if(typeof v!=='string'||!v.trim()||v.trim().length>max)invalid(field);return v.trim();};
 const list=(v,field)=>{if(!Array.isArray(v)||!v.length||v.length>5)invalid(field);return v.map((entry,i)=>text(entry,field+'.'+i,500));};
 if(!value||typeof value!=='object')invalid('response.content');
 let proposals=value.candidates;
 if(proposals&&!Array.isArray(proposals)&&typeof proposals==='object'){
  if(Object.keys(proposals).length!==3||!['first','second','third'].every(key=>Object.hasOwn(proposals,key)))invalid('candidates');
  proposals=['first','second','third'].map(key=>proposals[key]);
 }
 if(!Array.isArray(proposals)||proposals.length!==3)invalid('candidates');
 const candidates=proposals.map((c,i)=>({id:i+1,title:text(c?.title,`candidates.${i}.title`,100),summary:text(c?.summary,`candidates.${i}.summary`,500),content:text(c?.content,`candidates.${i}.content`,7000)}));
 const a=value.assessment;if(!a||typeof a!=='object')invalid('assessment');
 if(!Number.isInteger(a.score)||a.score<0||a.score>20)invalid('assessment.score');
 return {candidates,assessment:{score:a.score,strengths:list(a.strengths,'assessment.strengths'),improvements:list(a.improvements,'assessment.improvements'),safety:text(a.safety,'assessment.safety',1000)}};
}
export function parseConsultingResponse(data,context={}){
 const choice=data?.choices?.[0];
 if(!choice)throw new AiServiceError('invalid_response',{...context,stage:'text',field:'response.choices'});
 if(choice.finish_reason==='length')throw new AiServiceError('truncated',{...context,stage:'text'});
 if(choice.finish_reason==='content_filter'||choice.message?.refusal)throw new AiServiceError('refusal',{...context,stage:'text'});
 if(typeof choice.message?.content!=='string')throw new AiServiceError('invalid_response',{...context,stage:'text',field:'response.content'});
 let value;try{value=JSON.parse(choice.message.content);}catch{throw new AiServiceError('invalid_response',{...context,stage:'text',field:'response.content'});}
 return validateConsultingResult(value,context);
}
