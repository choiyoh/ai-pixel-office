import {useEffect,useRef,useState} from 'react';
import {OfficeState} from '../../vendor/pixel-agents/webview-ui/src/office/engine/officeState';
import {OfficeCanvas,type CanvasActor} from '../Canvas';
import {ModeSwitch} from '../ModeSwitch';
import {createOffice} from '../engine';
import {officeTimezone} from '../model';
import {LiveAnimationScheduler} from './animation-scheduler';
import {useLiveOffice} from './useLiveOffice';
import {canvasLiveActor,liveSeatKey,syncLiveActor} from './engine-adapter';
import {freshness,liveLabels,type LiveActor} from './store';
const time=(at:string|null|undefined)=>at?new Date(at).toLocaleTimeString('ko-KR',{hour12:false,timeZone:officeTimezone}):'없음';
export function LiveOffice({active,onMode}:{active:boolean;onMode:(mode:'mock'|'live')=>void}){
 const {snapshot,connection,resync}=useLiveOffice(active);
 const [office,setOffice]=useState<OfficeState|null>(null),[error,setError]=useState(false),[selected,setSelected]=useState(0),[zoom,setZoom]=useState(1),[now,setNow]=useState(Date.now()),[filter,setFilter]=useState('all'),[notice,setNotice]=useState('');
 const scheduler=useRef(new LiveAnimationScheduler());
 const [foreground,setForeground]=useState(()=>!document.hidden);
 useEffect(()=>{const update=()=>{scheduler.current.suspend();setForeground(!document.hidden);};document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update);},[]);
 const lastResync=useRef(-1);
 const previous=useRef(new Map<string,LiveActor>()),signatures=useRef(new Map<string,string>()),retiring=useRef(new Map<number,CanvasActor>());
 const sceneScope=useRef<string|null>(null);
 const offline=connection==='offline';
 useEffect(()=>{if(!active||office)return;let cancelled=false;createOffice().then(o=>{if(!cancelled)setOffice(o);}).catch(()=>{if(!cancelled)setError(true);});return()=>{cancelled=true;};},[active,office]);
 useEffect(()=>{if(!active)return;const timer=setInterval(()=>setNow(Date.now()),50);return()=>clearInterval(timer);},[active]);
 useEffect(()=>{
  if(!active||!office)return;
  const scope=snapshot?`${snapshot.source}:${snapshot.installationInstanceId}`:null;
  if(scope&&sceneScope.current&&scope!==sceneScope.current){
   previous.current.clear();signatures.current.clear();retiring.current.clear();sceneScope.current=scope;setSelected(0);setFilter('all');setOffice(new OfficeState(office.getLayout()));return;
  }
  if(scope)sceneScope.current=scope;
  if(snapshot&&lastResync.current!==resync){scheduler.current.baseline(snapshot);lastResync.current=resync;}
  if(snapshot)scheduler.current.observe(snapshot,now,!offline&&foreground);else scheduler.current.clear();
  const actors=snapshot?.actors??[],ids=new Set(actors.map(a=>a.actorId));
  for(const [key,a] of previous.current)if(!ids.has(key)){
   office.setAgentActive(a.renderId,false);office.setAgentTool(a.renderId,null);office.removeAgent(a.renderId);retiring.current.set(a.renderId,{id:a.renderId,name:a.name,status:'neutral',retiring:true});signatures.current.delete(key);
  }
  for(const a of actors){
   const visual=scheduler.current.visual(a,now,!offline&&foreground);
   const signature=[a.generation,a.lastEventAt,a.status,a.kind,freshness(a,now,offline),visual].join(':');
   if(signatures.current.get(a.actorId)!==signature||!office.characters.has(a.renderId)){syncLiveActor(office,a,now,offline,visual);signatures.current.set(a.actorId,signature);}
  }
  for(const [id] of retiring.current)if(!office.characters.has(id))retiring.current.delete(id);
  previous.current=new Map(actors.map(a=>[a.actorId,a]));
 },[active,office,snapshot,now,offline,foreground,resync]);
 if(!active)return null;
 const actors=snapshot?.actors??[],visible=actors.filter(a=>filter==='all'||a.actorId===filter);
 const current=visible.find(a=>a.renderId===selected),isFresh=(a:LiveActor)=>freshness(a,now,offline)==='fresh';
 const justRemoved=[...previous.current.values()].filter(a=>!actors.some(next=>next.actorId===a.actorId)).map(a=>({id:a.renderId,name:a.name,status:'neutral' as const,retiring:true}));
 const renderActors=[...new Map([...retiring.current.values(),...justRemoved,...visible.map(a=>canvasLiveActor(a,now,offline))].map(a=>[a.id,a])).values()];
 const move=(seat:string)=>{
  if(!office||!current||office.seats.get(seat)?.assigned)return;
  office.reassignSeat(current.renderId,seat);
  try{const key=liveSeatKey(current.installationInstanceId),saved=JSON.parse(localStorage.getItem(key)??'{}');saved[current.actorId]=seat;localStorage.setItem(key,JSON.stringify(saved));setNotice('Live 좌석을 별도로 저장했습니다.');}catch{setNotice('좌석 저장 실패 · 관찰 상태는 유지됩니다.');}
 };
 const connectionLabel=connection==='unprepared'?'연결 준비 필요':offline?'서버 연결 끊김':connection==='checking'?'수집기 확인 중':'Claude 로컬 수신 준비';
 return <div className="app-shell live-office" data-testid="live-office">
  <aside className="rail"><div className="brand-mark">o<span>✦</span></div><div className="rail-icon active">▦</div><div className="rail-bottom">LIVE<br/><span>01</span></div></aside>
  <div className="workspace">
   <header><div><div className="eyebrow">A SMALL OFFICE. OBSERVED EVENTS.</div><h1>Orbit Works <span>AI 개발회사</span></h1></div><div className="header-right"><ModeSwitch mode="live" onMode={onMode}/><span className="date">LIVE OFFICE · 실환경 미검증</span></div></header>
   <section className="connection-panel" aria-label="Live 수집 상태"><div className="connection-summary"><strong data-testid="live-connection">● {connectionLabel}</strong><span>{snapshot?.source==='fixture'?'TEST FIXTURE · 합성 수집 경로':'LIVE TRANSPORT'} / 실환경 미검증</span><span data-testid="live-last-event">최근 이벤트: {time(snapshot?.lastEventAt)}</span></div><p>인증된 Claude 최상위 세션 관측만 표시합니다. 업무 성공·완료는 판정하지 않습니다. 연결 장애는 세션 종료를 뜻하지 않습니다.</p></section>
   <section className="overview"><div className="intro"><span className="live-dot"/> LIVE OFFICE <small>관찰된 세션만 함께하는 사무실</small></div><div className="metric"><b data-testid="live-count">{actors.length}</b><span>관찰 세션</span></div><div className="metric"><b data-testid="live-working">{actors.filter(a=>isFresh(a)&&a.status==='working').length}</b><span>도구 실행 관찰</span></div><div className="metric"><b data-testid="live-approval">{actors.filter(a=>isFresh(a)&&a.status==='approval').length}</b><span>승인 요청</span></div></section>
   <main><section className="office-panel"><div className="panel-toolbar"><div><span className="eyebrow">THE OBSERVED FLOOR</span><h2>Claude 세션 사무실 <span>1F</span></h2></div><div className="filters"><label>세션 필터<select aria-label="Live 세션 필터" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">모든 세션</option>{actors.map(a=><option key={a.actorId} value={a.actorId}>{a.name}</option>)}</select></label></div></div>
    <div className="canvas-wrap">{office?<OfficeCanvas office={office} agents={renderActors} selected={current?.renderId??0} zoom={zoom} onSelect={setSelected} onMove={move}/>:<p className="loading">{error?'에셋을 확인하세요.':'관찰 사무실을 준비하고 있어요…'}</p>}{actors.length===0&&<div className="live-empty" data-testid="live-empty"><b>{connection==='unprepared'?'연결 준비 필요':'관찰된 Claude 세션이 없습니다'}</b><span>SessionStart 수신 전에는 캐릭터를 만들지 않습니다.</span></div>}<div className="floor-tag">ORBIT CAMPUS <span>● {snapshot?.source==='fixture'?'TEST FIXTURE':'LIVE / 미검증'}</span></div><div className="zoom-controls"><button aria-label="축소" onClick={()=>setZoom(v=>Math.max(.65,v-.1))}>−</button><span>{Math.round(zoom*100)}%</span><button aria-label="확대" onClick={()=>setZoom(v=>Math.min(1.6,v+.1))}>+</button></div></div>
    <div className="floor-footer"><span>관측 신선도: fresh / stale / offline</span><span>최근 관측 동작 재생 · 업무 완료 집계 미지원</span></div>
    <section className="team-strip" id="team">{visible.map(a=><button key={a.actorId} className={`agent-card ${selected===a.renderId?'selected':''}`} data-testid={`live-agent-${a.renderId}`} onClick={()=>setSelected(a.renderId)}><span className="portrait" style={{backgroundImage:`url(/characters/char_${a.palette}.png)`}}/><span><strong>{a.name}</strong><small>{liveLabels[a.status]}</small><small>{freshness(a,now,offline)}</small></span></button>)}</section>
   </section><aside className="detail-panel"><div className="panel-heading"><span>LIVE SESSION INSPECTOR</span><span>↗</span></div>{current?<><div className="agent-hero"><div className="large-portrait" style={{backgroundImage:`url(/characters/char_${current.palette}.png)`}}/><span className="source-chip">{current.source==='fixture'?'TEST FIXTURE':'LIVE / 미검증'}</span><h2>{current.name}</h2><p>Claude Code · 프로젝트 미분류</p></div><div className="detail-content" data-testid="live-inspector"><div className="state-pill">● {liveLabels[current.status]}</div><div className="detail-row"><span>Provider</span><b>claude</b></div><div className="detail-row"><span>안전한 별칭</span><b>{current.name}</b></div><div className="detail-row"><span>실행 환경</span><b>{current.environment}</b></div><div className="detail-row"><span>마지막 확인 도구</span><b>{current.lastTool??'미확인'}</b></div><div className="detail-row"><span>관찰 시작</span><b>{time(current.observedAt)}</b></div><div className="detail-row"><span>최근 수신</span><b>{time(current.lastEventAt)}</b></div><div className="detail-row"><span>연결 / freshness</span><b>{offline?'offline':freshness(current,now)} · {connection==='ready'?'수신기 응답':'응답 미확인'}</b></div><label className="move-label">Live 좌석으로 이동<select aria-label="Live 좌석 이동" value="" onChange={e=>move(e.target.value)}><option value="" disabled>빈 좌석 선택</option>{office&&[...office.seats.values()].map(s=><option key={s.uid} disabled={s.assigned}>{s.uid}</option>)}</select></label><p className="mock-note">{current.source==='fixture'?'합성 이벤트로 검증 중입니다.':'Live transport · 실제 Claude 실행 미검증'}<br/>도구 이벤트가 업무 성공이나 완료를 뜻하지 않습니다.</p></div></>:<div className="empty-state">관찰된 캐릭터를 선택하세요.<br/>실제 작업명과 프로젝트는 추정하지 않습니다.</div>}</aside></main>
   <section className="timeline"><div className="timeline-head"><div><span className="eyebrow">OBSERVATION LOG</span><h2>최근 수신 이벤트 <span>{snapshot?.source==='fixture'?'TEST FIXTURE':'LIVE / 미검증'}</span></h2></div><small>서버 수신 순서 · 완료 집계 미지원</small></div><div className="event-list" data-testid="live-timeline">{(snapshot?.timeline??[]).filter(e=>filter==='all'||e.actorId===filter).map(e=><div className="event-row" key={e.revision}><time>{time(e.at)}</time><strong>{actors.find(a=>a.actorId===e.actorId)?.name??'종료 세션'}</strong><span>{e.kind} · {liveLabels[e.status]}</span></div>)}</div></section>
   <footer><span>ORBIT WORKS / 관찰된 이벤트, 함께하는 공간.</span><span role="status">{notice||'실환경 검증은 P2-A.3에서 별도로 진행합니다.'}</span></footer>
  </div>
 </div>;
}
