import {roster,type OfficeEvent} from './model';
export const scenario:Array<{delay:number;agentId:number;status:NonNullable<OfficeEvent['status']>;task:string}>=[
 {delay:1000,agentId:1,status:'coding',task:'인증 API 구현'},
 {delay:2500,agentId:3,status:'analysis',task:'사용자 리서치 문서 검토'},
 {delay:4000,agentId:2,status:'testing',task:'QA 공간에서 회귀 테스트'},
 {delay:6000,agentId:5,status:'approval',task:'배포 계획 승인 대기'},
 {delay:8000,agentId:6,status:'idle',task:'커피 브레이크'},
 {delay:10500,agentId:1,status:'completed',task:'인증 API Mock 작업 완료'},
 {delay:13000,agentId:2,status:'failed',task:'Mock 테스트 실패 · 재시도 필요'},
 {delay:15500,agentId:4,status:'disconnected',task:'Mock 연결 종료 · 상태 미확인'},
];
export function initialEvents(now:number):OfficeEvent[]{return roster.map(a=>({eventId:`spawn-${a.id}-${now}`,agentId:a.id,type:'spawn',at:now,source:'mock'}));}
export function playScenario(send:(e:OfficeEvent)=>void,onDone:()=>void){
 const run=crypto.randomUUID();
 const timers=scenario.map((step,i)=>setTimeout(()=>send({eventId:`${run}-${i}`,agentId:step.agentId,type:'status',status:step.status,task:step.task,at:Date.now(),source:'mock'}),step.delay));
 timers.push(setTimeout(onDone,16000));
 return()=>timers.forEach(clearTimeout);
}
