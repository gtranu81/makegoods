import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const brandAssets=Object.fromEntries([['robot','jeju-robot.png'],['company','jiwon-logo.png']].map(([key,name])=>[key,'data:image/png;base64,'+readFileSync(new URL('../public/assets/'+name,import.meta.url)).toString('base64')]));
const activities=readFileSync(new URL('../public/activities.js',import.meta.url),'utf8');
const growth=readFileSync(new URL('../public/growth-policy.js',import.meta.url),'utf8');
const sketchInput=readFileSync(new URL('../public/sketch-input.js',import.meta.url),'utf8');
const runtime=readFileSync(new URL('../demo/runtime.js',import.meta.url),'utf8');
const controls=`
async function switchDemo(role){document.querySelectorAll('.demo-switch').forEach(b=>b.disabled=true);try{await window.jejuDemoLogin(role);await load();state.page='home';state.detail=null;state.parent=null;state.filter={};render();window.scrollTo(0,0);}catch(e){toast(e.message);}finally{document.querySelectorAll('.demo-switch').forEach(b=>b.disabled=false);}}
document.querySelector('#demo-student').onclick=()=>switchDemo('student');
document.querySelector('#demo-teacher').onclick=()=>switchDemo('teacher');
document.querySelector('#demo-reset').onclick=async()=>{if(confirm('체험판의 모든 의뢰서와 모둠을 지우고 처음부터 시작할까요?')){window.jejuDemoReset();await switchDemo('student');}};
switchDemo('student');`;
const html=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>당신의 창업을 응원합니다 — 바로 체험하기</title><style>${css}
.demo-bar{background:#163e33;color:white;padding:13px 22px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.demo-bar p{color:#d7e3d1;font-size:11px;margin-top:3px}.demo-bar button{padding:9px 13px;border-radius:7px;background:#e4edc5;color:#244b36;font-weight:650}.demo-bar .row{flex-wrap:wrap}.demo-bar small{font-size:11px;color:#dbe5d4}@media print{.demo-bar{display:none}}.sidebar{top:0}.demo-bar strong{font-size:13px}
</style></head><body><header class="demo-bar"><div><strong>설치 없이 바로 체험하기 · 오프라인 체험판</strong><p>가상 계정과 예시 결과로 동작합니다. 실제 개인정보·비밀번호를 입력하지 마세요. 기록은 이 브라우저에만 저장됩니다.</p></div><div class="row"><button class="demo-switch" id="demo-student">① 학생 체험</button><button class="demo-switch" id="demo-teacher">② 교사 체험</button><button id="demo-reset">처음부터</button></div><small>학생으로 의뢰하기 → 교사로 후보 작성·선택·전송 → 학생으로 결과 확인 · AI 키 불필요</small></header><div id="app"><div class="loading">체험판을 준비하고 있어요…</div></div><div id="toast" role="status" aria-live="polite"></div><script>globalThis.jejuBrandAssets=${JSON.stringify(brandAssets)};\n${activities}\n${growth}\n${sketchInput}\n${runtime}\n${app.replace(/boot\(\);\s*$/,'')}\n${controls}</script></body></html>`;
mkdirSync(new URL('../dist/',import.meta.url),{recursive:true});writeFileSync(new URL('../dist/jeju-startup-demo.html',import.meta.url),html);console.log('Built dist/jeju-startup-demo.html');
