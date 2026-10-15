export const officeTimezone='Etc/GMT-9';
export const statuses=['coding','analysis','testing','approval','idle','completed','failed','disconnected'] as const;
export type Status=typeof statuses[number];
export const statusLabels:Record<Status,string>={coding:'코딩',analysis:'분석',testing:'테스트',approval:'승인 대기',idle:'휴식',completed:'완료',failed:'실패',disconnected:'연결 끊김'};
export interface Agent {id:number;name:string;team:string;project:string;palette:number;seat:string;status:Status;task:string;since:number;startedAt?:number;source:'mock'}
export interface OfficeEvent {eventId:string;agentId:number;type:'spawn'|'status'|'remove';status?:Status;task?:string;at:number;source:'mock'}
export const roster:Agent[]=[
  {id:1,name:'Claude Code',team:'개발팀',project:'Orbit Platform',palette:0,seat:'dev-1',status:'coding',task:'워크스페이스 API 구현',since:0,source:'mock'},
  {id:2,name:'DeepSeek Dev',team:'개발팀',project:'Orbit Platform',palette:1,seat:'dev-2',status:'testing',task:'회귀 테스트 실행',since:0,source:'mock'},
  {id:3,name:'DeepSeek Analyst',team:'분석팀',project:'Signal Lab',palette:2,seat:'analyst',status:'analysis',task:'사용자 흐름 분석',since:0,source:'mock'},
  {id:4,name:'Hermes',team:'연구팀',project:'Signal Lab',palette:3,seat:'research',status:'analysis',task:'검색 전략 연구',since:0,source:'mock'},
  {id:5,name:'OpenCode',team:'운영팀',project:'Orbit Platform',palette:4,seat:'ops',status:'approval',task:'릴리스 승인 요청',since:0,source:'mock'},
  {id:6,name:'Nova',team:'운영팀',project:'Studio Kit',palette:5,seat:'other',status:'idle',task:'다음 업무를 기다리는 중',since:0,source:'mock'},
];
export function reduceAgents(agents:Agent[],event:OfficeEvent):Agent[]{
  if(event.source!=='mock') return agents;
  if(event.type==='remove')return agents.filter(a=>a.id!==event.agentId);
  const seed=roster.find(a=>a.id===event.agentId);if(!seed)return agents;
  if(event.type==='spawn')return agents.some(a=>a.id===seed.id)?agents:[...agents,{...seed,since:event.at,startedAt:event.at}];
  return agents.map(a=>a.id===event.agentId?{...a,status:event.status??a.status,task:event.task??a.task,since:event.at}:a);
}
export function todayCompleted(events:OfficeEvent[],now:number){
  const day=new Date(now).toLocaleDateString('en-CA',{timeZone:officeTimezone});
  return new Set(events.filter(e=>e.type==='status'&&e.status==='completed'&&new Date(e.at).toLocaleDateString('en-CA',{timeZone:officeTimezone})===day).map(e=>e.eventId)).size;
}
