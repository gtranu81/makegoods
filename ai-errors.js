// Never expose provider error messages: they can repeat credentials or student input.
const safe=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,100}$/.test(value)?value:null;
const allowedCodes=new Set(['invalid_api_key','insufficient_quota','billing_hard_limit_reached','rate_limit_exceeded','model_not_found','permission_denied','unsupported_parameter','unsupported_value','invalid_request_error','context_length_exceeded','content_policy_violation']);
export class AiServiceError extends Error{
 constructor(kind,{status=null,code=null,requestId=null,stage='text',model=null}={}){super(kind);this.name='AiServiceError';this.kind=kind;this.providerStatus=status;this.providerCode=allowedCodes.has(code)?code:null;this.requestId=safe(requestId);this.stage=stage;this.model=safe(model);}
}
export async function providerError(response,context){let body;try{body=await response.json();}catch{}return new AiServiceError('provider',{...context,status:response.status,code:body?.error?.code||body?.error?.type,requestId:response.headers.get('x-request-id')});}
export function aiDiagnostic(error,context={}){
 const e=error instanceof AiServiceError?error:new AiServiceError(['TimeoutError','AbortError'].includes(error?.name)?'timeout':error?.name==='TypeError'?'network':'unknown',context);
 const code=e.providerCode,status=e.providerStatus;
 let guidance;
 if(status===401)guidance='OpenAI API 키 인증에 실패했습니다. Render의 AI_API_KEY를 유효한 키로 설정하고 저장·재배포해 주세요.';
 else if(code==='insufficient_quota'||code==='billing_hard_limit_reached')guidance='OpenAI API 사용 가능 잔액 또는 결제 한도가 부족합니다. OpenAI API 플랫폼의 Billing과 프로젝트 사용 한도를 확인해 주세요. ChatGPT 구독과 API 결제는 별개입니다.';
 else if(status===429)guidance='OpenAI API 호출 한도에 걸렸습니다. 잠시 기다린 뒤 한 번만 다시 시도하고 프로젝트의 Limits를 확인해 주세요. 성장 분석도 API 호출을 사용합니다.';
 else if(status===403)guidance='OpenAI 프로젝트에서 이 모델의 사용이 허용되지 않았습니다. 프로젝트 권한과 모델 접근 권한을 확인해 주세요. 이미지 모델은 조직 인증이 필요할 수 있습니다.';
 else if(status===404||code==='model_not_found')guidance=`AI 모델을 찾을 수 없거나 접근할 수 없습니다. Render의 ${e.stage==='image'?'AI_IMAGE_MODEL':'AI_MODEL'} 설정과 OpenAI 프로젝트의 모델 권한을 확인해 주세요.`;
 else if(code==='context_length_exceeded')guidance='OpenAI 모델의 입력 한도를 초과했습니다. 의뢰 조건을 간결하게 정리하거나 AI_MODEL의 입력 한도를 확인해 주세요.';
 else if(code==='content_policy_violation')guidance='OpenAI에서 요청을 처리하지 않았습니다. 의뢰 내용에 개인정보나 부적절한 내용이 없는지 교사가 확인해 주세요.';
 else if(status===400)guidance='OpenAI가 요청 설정을 받아들이지 않았습니다. AI_MODEL 또는 AI_IMAGE_MODEL이 이 앱의 API 방식과 옵션을 지원하는지 확인해 주세요.';
 else if(status>=500)guidance='OpenAI API에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
 else if(e.kind==='timeout')guidance='AI 응답 대기 시간을 초과했습니다. 잠시 후 다시 시도해 주세요. API가 이미 처리한 요청에는 비용이 발생했을 수 있습니다.';
 else if(e.kind==='network')guidance='서버에서 OpenAI API에 접속하지 못했습니다. Render 로그에서 네트워크·인증서·프록시 설정을 확인해 주세요.';
 else if(e.kind==='truncated')guidance='API에는 연결됐지만 AI 응답이 중간에 잘렸습니다. 의뢰 조건을 간결하게 정리해 다시 시도해 주세요.';
 else if(e.kind==='invalid_response')guidance='API에는 연결됐지만 AI 응답이 필요한 후보·평가 형식과 맞지 않았습니다. 다시 시도해 주세요. 반복되면 모델 설정과 응답 형식을 점검해야 합니다.';
 else guidance='AI 호출 중 처리 오류가 발생했습니다. Render 로그의 AI 진단 항목을 확인해 주세요.';
 const label={text:'텍스트 후보',image:'디자인 이미지',growth:'성장 분석'}[e.stage]||'AI';
 const detail=[status?'HTTP '+status:null,code].filter(Boolean).join(', ');
 return {message:`${label}: ${guidance}${detail?' ('+detail+')':''}`,log:{stage:e.stage,kind:e.kind,status,code,model:e.model,requestId:e.requestId}};
}
