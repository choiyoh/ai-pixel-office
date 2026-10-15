import {useEffect,useState} from 'react';
import {officeTimezone} from './model';
type Connection={mode:string;environment:string;platform:string;arch:string;connection:string;source:string;lastEventAt:string|null;realMacVerified:false};
type Session={sessionKey:string;name:string;source:string;status:string;lastEventAt:string};
const labels:Record<string,string>={observed:'세션 시작 관찰',working:'도구 실행 중',approval:'승인 요청', 'waiting-input':'입력 대기','turn-ended':'턴 종료 (업무 성공 미확정)','session-ended':'세션 종료','between-tools':'도구 종료 · 다음 상태 미확인','tool-failed':'도구 실패',unknown:'상태 미확인'};
export function ConnectionPanel(){
 const [connection,setConnection]=useState<Connection|null>(null),[sessions,setSessions]=useState<Session[]>([]),[offline,setOffline]=useState(false);
 useEffect(()=>{
  if(import.meta.env.DEV)return;
  const controller=new AbortController();let disposed=false;
  const refresh=async()=>{
   try{
    const responses=await Promise.all([fetch('/api/connection',{signal:controller.signal}),fetch('/api/events',{signal:controller.signal})]);
    if(responses.some(r=>!r.ok))throw Error('connection unavailable');
    const [info,data]=await Promise.all(responses.map(r=>r.json()));
    if(!disposed){setConnection(info);setSessions(data.sessions);setOffline(false);}
   }catch{if(!disposed)setOffline(true);}
  };
  void refresh();const timer=setInterval(()=>void refresh(),2500);
  return()=>{disposed=true;clearInterval(timer);controller.abort();};
 },[]);
 const last=connection?.lastEventAt;
 return <section className="connection-panel" aria-label="실행 환경 및 연결 상태">
  <div className="connection-summary"><strong>{offline?'● 서버 연결 끊김':connection?.mode==='claude-local'?'● Claude 로컬 수신 준비':'● MOCK 개발 모드'}</strong><span data-testid="execution-environment">{import.meta.env.DEV?'Vite · Mock':connection?`${connection.environment} · ${connection.platform}/${connection.arch}`:'서버 확인 중'}</span><span data-testid="last-event">최근 수집 이벤트: {last?new Date(last).toLocaleTimeString('ko-KR',{hour12:false,timeZone:officeTimezone}):'없음'}</span></div>
  <p>사무실 캔버스는 Mock입니다. {connection?.source==='fixture'?'아래 수집 결과도 합성 통합 테스트입니다. ':''}{connection?.mode==='claude-local'?'로컬 수신기는 준비되었으며 실제 OS·Claude 연동은 아직 미검증입니다.':'각 OS와 WSL의 localhost·설정은 별도 실행 환경입니다.'}</p>
  {sessions.length>0&&<div className="collected-sessions"><h3>별도 수집 채널 · {connection?.source==='fixture'?'TEST FIXTURE':'LIVE TRANSPORT / 실환경 미검증'}</h3>{sessions.map(s=><div key={s.sessionKey}><b>{s.name}</b><span>{labels[s.status]??'상태 미확인'}</span><time>{new Date(s.lastEventAt).toLocaleTimeString('ko-KR',{hour12:false,timeZone:officeTimezone})}</time></div>)}</div>}
 </section>;
}
