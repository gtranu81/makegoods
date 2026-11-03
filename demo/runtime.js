// Offline demonstration only. Accounts and records are simulated in this browser.
(() => {
 const key='jeju-startup-offline-demo-v1';
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());
 const timestamp=()=>new Date().toISOString();
 const fresh=()=>({users:[{id:1,username:'teacher',password:'DemoTeacher2026',name:'체험 선생님',role:'teacher',active:true,dailyLimit:3,periodLimit:null,balance:3,coinDay:today()},{id:2,username:'group01',password:'DemoStudent2026',name:'바다 1모둠',role:'student',active:true,dailyLimit:3,periodLimit:null,balance:3,coinDay:today()}],requests:[],ledger:[]});
 let data;try{data=JSON.parse(localStorage.getItem(key))||fresh();}catch{data=fresh();}
 let current=null;
 const save=()=>{try{localStorage.setItem(key,JSON.stringify(data));}catch{/* Some file browsers disable localStorage. Keep the current session usable. */}};
 const visibleUser=u=>{const {password,...safe}=u;return safe;};
 const error=(s,m)=>{const e=new Error(m);e.status=s;throw e;};
 const requireTeacher=()=>{if(current?.role!=='teacher')error(403,'선생님 체험으로 전환해 주세요.');};
 const addLedger=(id,delta,reason)=>data.ledger.unshift({id:data.ledger.length+1,user_id:id,name:data.users.find(u=>u.id===id)?.name,delta,reason,created_at:timestamp()});
 function refresh(){data.users.forEach(u=>{if(u.role==='student'&&u.periodLimit===null&&u.coinDay!==today()){addLedger(u.id,u.dailyLimit-u.balance,'하루 코인 초기화');u.balance=u.dailyLimit;u.coinDay=today();}});}
 function view(r){const copy=structuredClone(r);if(current.role!=='teacher'){if(r.status!=='released'){delete copy.candidates;delete copy.assessment;delete copy.teacherNote;delete copy.source;}else copy.candidates=copy.candidates.filter(c=>copy.selected.includes(c.id));delete copy.selected;}return copy;}
 window.fetch=async(input,options={})=>{
  try{
   const path=String(input).replace(/^\/api/,'');const method=options.method||'GET',b=JSON.parse(options.body||'{}');refresh();let out;
   if(path==='/bootstrap')out={needsSetup:false};
   else if(path==='/login'){
    current=data.users.find(u=>u.username===b.username&&u.password===b.password&&u.active);
    if(!current)error(401,'체험 계정의 아이디 또는 비밀번호를 확인해 주세요.');out={user:visibleUser(current)};
   }else if(path==='/health')out={ok:true};
   else{
    if(!current||!current.active)error(401,'상단의 학생 체험 또는 교사 체험을 눌러 주세요.');
    if(path==='/me')out={user:visibleUser(current),aiEnabled:false,projectName:'당신의 창업을 응원합니다 — 오프라인 체험판'};
    else if(path==='/logout'){current=null;out={ok:true};}
    else if(path==='/password'){
     if(b.currentPassword!==current.password)error(400,'현재 체험 비밀번호를 확인해 주세요.');if(b.password.length<10)error(400,'10자 이상으로 입력해 주세요.');current.password=b.password;out={ok:true};
    }else if(path==='/users'){
     requireTeacher();
     if(method==='GET')out={users:data.users.filter(u=>u.role==='student').map(visibleUser)};
     else{if(data.users.some(u=>u.username===b.username))error(409,'이미 사용 중인 아이디입니다.');if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(b.username)||b.password.length<10)error(400,'아이디는 영문·숫자 3자 이상, 비밀번호는 10자 이상으로 설정하세요.');const u={id:Math.max(...data.users.map(u=>u.id))+1,username:b.username,password:b.password,name:b.name,role:'student',active:true,dailyLimit:b.dailyLimit??3,periodLimit:null,balance:b.dailyLimit??3,coinDay:today()};data.users.push(u);out={id:u.id};}
    }else if(/^\/users\/\d+$/.test(path)){
     requireTeacher();const u=data.users.find(u=>u.id===Number(path.split('/')[2])&&u.role==='student');if(!u)error(404,'모둠을 찾을 수 없습니다.');
     const copy={...u};
     if(b.password){if(b.password.length<10)error(400,'비밀번호는 10자 이상입니다.');copy.password=b.password;}
     if(b.dailyLimit!==undefined){if(!Number.isInteger(b.dailyLimit)||b.dailyLimit<0||b.dailyLimit>100)error(400,'하루 코인은 0~100개입니다.');copy.dailyLimit=b.dailyLimit;}
     if(b.active!==undefined)copy.active=b.active;
     if(b.periodLimit!==undefined){if(b.periodLimit!==null&&(!Number.isInteger(b.periodLimit)||b.periodLimit<0||b.periodLimit>10000))error(400,'기간 코인은 0~10000개입니다.');copy.periodLimit=b.periodLimit;copy.balance=b.periodLimit??copy.dailyLimit;copy.coinDay=today();}
     const before=copy.balance;
     if(b.adjustment!==undefined){if(!Number.isInteger(b.adjustment)||Math.abs(b.adjustment)>10000||copy.balance+b.adjustment<0)error(400,'조정할 코인 수를 확인해 주세요.');copy.balance+=b.adjustment;}
     if(b.periodLimit!==undefined)addLedger(u.id,before-u.balance,'코인 운영 방식 변경');
     if(b.adjustment)addLedger(u.id,b.adjustment,b.reason||'교사 코인 조정');Object.assign(u,copy);out={ok:true};
    }else if(path==='/ledger')out={entries:data.ledger.filter(l=>current.role==='teacher'||l.user_id===current.id)};
    else if(path==='/requests'&&method==='GET')out={requests:data.requests.filter(r=>current.role==='teacher'||r.userId===current.id).map(view)};
    else if(path==='/requests'&&method==='POST'){
     if(current.role!=='student')error(403,'학생 체험에서 의뢰해 주세요.');if(current.balance<1)error(400,'코인이 부족해요. 교사 체험에서 코인을 추가해 주세요.');
     if(!b.safetyConfirmed)error(400,'안전 확인이 필요합니다.');
     if(!['idea','market','design','revision','marketing'].includes(b.type)||!b.title?.trim()||['goods','country','audience','purpose','details','format'].some(k=>!b.answers?.[k]?.trim()))error(400,'모든 내용을 적어 주세요.');
     if(b.parentId&&!data.requests.some(r=>r.id===b.parentId&&r.userId===current.id&&r.status==='released'))error(400,'전달된 결과에 추가 요청해 주세요.');
     const r={id:Math.max(0,...data.requests.map(r=>r.id))+1,userId:current.id,groupName:current.name,parentId:b.parentId||null,type:b.type,title:b.title,answers:b.answers,status:'pending',createdAt:timestamp(),releasedAt:null};data.requests.unshift(r);current.balance--;addLedger(current.id,-1,`의뢰 #${r.id} 제출`);out={id:r.id};
    }else{
     const match=path.match(/^\/requests\/(\d+)\/(generate|release)$/);if(!match)error(404,'오프라인 체험에서 지원하지 않는 기능입니다.');requireTeacher();const r=data.requests.find(r=>r.id===Number(match[1]));if(!r)error(404,'의뢰서를 찾을 수 없습니다.');if(r.status==='released')error(409,'이미 전송했습니다.');
     if(match[2]==='generate'){
      const a=r.answers;const kinds={idea:['제주의 이야기를 담아요','쓰임새를 더해요','작은 세트로 시작해요'],market:['생활과 문화를 알아봐요','기후와 사용 장면을 살펴봐요','소비자에게 직접 물어봐요'],design:['바다를 닮은 디자인','현무암의 질감을 담은 디자인','제주 이야기가 있는 포장'],revision:['핵심 매력을 남겨요','사용하기 편하게 바꿔요','친구들의 의견을 반영해요'],marketing:['짧은 문구로 마음을 전해요','상품의 사용 장면을 보여줘요','제주의 이야기를 들려줘요']};
      r.candidates=kinds[r.type].map((title,i)=>({id:i+1,title,summary:`${a.goods}를 ${a.country}의 ${a.audience}에게 소개하는 체험용 예시입니다.`,content:`1. 아이디어의 출발점\n${a.purpose}\n\n2. 함께 해 볼 일\n${['제주의 자연·문화 요소 중 하나를 정하고, 굿즈와 연결되는 이야기를 직접 써 보세요. 재료와 크기도 구체적으로 정해 보세요.','누가 언제 어디에서 사용할지 그려 보세요. 친구 3명에게 의견을 묻고 개선할 점을 기록해 보세요.','상품 이름, 포장 방법, 짧은 소개 문구를 만들어 보세요. 기존 캐릭터나 상표를 그대로 사용하지 않아요.'][i]}\n\n3. 다음 단계\n${a.country}의 모든 사람이 같은 취향이라고 생각하지 않아요. 실제 자료와 사용자 의견으로 확인해 보세요.\n\n※ AI가 생성한 분석이 아닌, 오프라인 체험용 예시입니다. 실제 가격·시장·규정은 확인하지 않았습니다.${r.type==='design'?'\n디자인 설명 예시: 바다의 파랑, 현무암의 회색, 직접 만든 단순한 문양을 조합해 보세요. 실제 이미지 파일은 이 오프라인 체험판에서 생성되지 않습니다.':''}`}));
      r.assessment={score:Math.min(20,8+Math.floor(a.details.length/30)),strengths:['굿즈와 수출 대상국을 정했어요.','원하는 결과 형식을 설명했어요.'],improvements:['색상·크기·재료·분량 같은 조건을 더 구체적으로 적어 보세요.','확인된 사실과 더 조사해야 할 내용을 구분해 보세요.'],safety:'체험용 평가 예시입니다. 실제 학생 평가로 사용하지 마세요. 개인정보·저작권·문화 표현과 사실 확인이 필요합니다.'};r.source='demo';r.status='review';out={ok:true,source:'demo'};
     }else if(b.manual){
      if(r.type!=='design'||!b.reviewConfirmed)error(400,'디자인 내용과 검토 확인을 확인해 주세요.');
      for(const [key,max] of [['title',100],['summary',500],['content',7000]])if(typeof b.manual[key]!=='string'||!b.manual[key].trim()||b.manual[key].length>max)error(400,'제목·요약·내용을 길이 제한에 맞게 입력해 주세요.');
      if(b.manual.image&&(!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(b.manual.image)||atob(b.manual.image.split(',')[1]).length>5*1024*1024))error(400,'이미지 형식과 크기를 확인해 주세요.');
      Object.assign(r,{candidates:[{id:4,title:b.manual.title,summary:b.manual.summary,content:b.manual.content,imageUrl:b.manual.image||null}],assessment:null,source:'teacher',selected:[4],teacherNote:b.teacherNote||'선생님이 직접 작성한 디자인입니다.',status:'released',releasedAt:timestamp()});out={ok:true};
     }else{
      if(r.status!=='review'||!b.reviewConfirmed||!Array.isArray(b.selected)||!b.selected.length||b.selected.some(x=>![1,2,3].includes(x)))error(400,'후보를 선택하고 검토 확인을 해 주세요.');
      Object.assign(r,{candidates:b.candidates||r.candidates,assessment:b.assessment||r.assessment,selected:b.selected,teacherNote:b.teacherNote,status:'released',releasedAt:timestamp()});out={ok:true};
     }
    }
   }
   save();return new Response(JSON.stringify(out),{status:200,headers:{'Content-Type':'application/json'}});
  }catch(e){return new Response(JSON.stringify({error:e.message}),{status:e.status||400,headers:{'Content-Type':'application/json'}});}
 };
 window.jejuDemoReset=()=>{data=fresh();current=null;save();};
 window.jejuDemoLogin=async role=>{
  const u=data.users.find(u=>u.role===role);if(!u)return;await fetch('/api/login',{method:'POST',body:JSON.stringify({username:u.username,password:u.password})});
 };
})();
