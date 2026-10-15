import {useCallback,useEffect,useRef,useState} from 'react';
import type {OfficeState} from '../vendor/pixel-agents/webview-ui/src/office/engine/officeState';
import {OfficeCanvas} from './Canvas';
import {ConnectionPanel} from './ConnectionPanel';
import {createOffice,syncAgent} from './engine';
import {layoutKey,seatsKey} from './layout';
import {officeTimezone,roster,statuses,statusLabels,reduceAgents,todayCompleted,type Agent,type OfficeEvent,type Status} from './model';
import {initialEvents,playScenario} from './mock';

export function App(){
 const [office,setOffice]=useState<OfficeState|null>(null),[error,setError]=useState('');
 const [agents,setAgents]=useState<Agent[]>([]),[events,setEvents]=useState<OfficeEvent[]>([]);
 const [selected,setSelected]=useState(1),[project,setProject]=useState('all'),[agentFilter,setAgentFilter]=useState('all');
 const [zoom,setZoom]=useState(1),[now,setNow]=useState(Date.now()),[playing,setPlaying]=useState(false),[notice,setNotice]=useState('');
 const agentsRef=useRef<Agent[]>([]),eventsRef=useRef<OfficeEvent[]>([]),seen=useRef(new Set<string>()),stopRef=useRef<(()=>void)|null>(null);
 const apply=useCallback((event:OfficeEvent)=>{
  if(!office||seen.current.has(event.eventId))return;
  seen.current.add(event.eventId);
  const next=reduceAgents(agentsRef.current,event);agentsRef.current=next;setAgents(next);
  if(event.type==='remove')office.removeAgent(event.agentId);
  else {const a=next.find(a=>a.id===event.agentId);if(a)syncAgent(office,a,event.type==='spawn');}
  const history=[event,...eventsRef.current].slice(0,1000);eventsRef.current=history;setEvents(history);
 },[office]);
 useEffect(()=>{let cancelled=false;createOffice().then(o=>{if(!cancelled)setOffice(o);}).catch(e=>{if(!cancelled)setError(String(e));});return()=>{cancelled=true;};},[]);
 useEffect(()=>{
  if(!office)return;
  for(const event of initialEvents(Date.now()))apply(event);
 },[office,apply]);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>()=>stopRef.current?.(),[]);
 const visible=agents.filter(a=>(project==='all'||a.project===project)&&(agentFilter==='all'||String(a.id)===agentFilter));
 const current=visible.find(a=>a.id===selected);
 const active=visible.filter(a=>['coding','analysis','testing'].includes(a.status)).length;
 const waiting=visible.filter(a=>a.status==='approval').length;
 const filteredEvents=events.filter(e=>{const a=roster.find(a=>a.id===e.agentId);return a&&(project==='all'||a.project===project)&&(agentFilter==='all'||String(a.id)===agentFilter);});
 const sendStatus=(status:Status)=>apply({eventId:crypto.randomUUID(),agentId:selected,type:'status',status,task:`${current?.name??'Agent'} · ${statusLabels[status]} 시연`,at:Date.now(),source:'mock'});
 const move=(seat:string)=>{
  if(!office||!current)return;
  if(office.seats.get(seat)?.assigned){setNotice('이미 사용 중인 좌석입니다.');return;}
  office.reassignSeat(selected,seat);
  const saved=Object.fromEntries([...office.characters.values()].filter(c=>c.seatId).map(c=>[c.id,c.seatId]));
  try{localStorage.setItem(layoutKey,JSON.stringify(office.getLayout()));localStorage.setItem(seatsKey,JSON.stringify(saved));setNotice('레이아웃과 좌석을 저장했습니다.');}catch{setNotice('브라우저 저장소에 저장하지 못했습니다.');}
 };
 const reset=()=>{
  stopRef.current?.();setPlaying(false);if(!office)return;
  for(const id of [...office.characters.keys()])office.removeAgent(id);
  // Finish only our despawn effects before recreating the demo roster.
  office.update(1);agentsRef.current=[];eventsRef.current=[];seen.current.clear();setAgents([]);setEvents([]);
  for(const event of initialEvents(Date.now()))apply(event);
 };
 if(error)return <div className="error-page"><h1>사무실을 열지 못했습니다</h1><p>{error}</p><button onClick={()=>location.reload()}>다시 시도</button></div>;
 return <div className="app-shell">
  <aside className="rail"><div className="brand-mark">o<span>✦</span></div><div className="rail-icon active" title="Office">▦</div><a className="rail-icon" href="#team" aria-label="팀 목록">♟</a><a className="rail-icon" href="#timeline" aria-label="이벤트">≋</a><div className="rail-bottom">OW<br/><span>01</span></div></aside>
  <div className="workspace">
   <header><div><div className="eyebrow">A SMALL OFFICE. BIG IDEAS.</div><h1>Orbit Works <span>AI 개발회사</span></h1></div><div className="header-right"><span className="mock-badge"><i/> MOCK SANDBOX</span><span className="date">캔버스 Mock · 연결 상태 별도 표시</span></div></header>
   <ConnectionPanel/>
   <section className="overview"><div className="intro"><span className="live-dot"/> OFFICE OVERVIEW <small>여섯 동료가 만드는 작은 우주</small></div><div className="metric"><b>{active.toString().padStart(2,'0')}</b><span>작업 중</span><i className="mint"/></div><div className="metric"><b>{waiting.toString().padStart(2,'0')}</b><span>승인 대기</span><i className="amber"/></div><div className="metric"><b>{todayCompleted(filteredEvents,now).toString().padStart(2,'0')}</b><span>오늘 완료 · Mock</span><i className="lilac"/></div></section>
   <main><section className="office-panel">
    <div className="panel-toolbar"><div><span className="eyebrow">THE FLOOR</span><h2>우리의 작업 공간 <span>1F</span></h2></div><div className="filters"><label>프로젝트<select aria-label="프로젝트 필터" value={project} onChange={e=>setProject(e.target.value)}><option value="all">모든 프로젝트</option>{[...new Set(roster.map(a=>a.project))].map(p=><option key={p}>{p}</option>)}</select></label><label>에이전트<select aria-label="에이전트 필터" value={agentFilter} onChange={e=>setAgentFilter(e.target.value)}><option value="all">모든 에이전트</option>{roster.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label></div></div>
    <div className="canvas-wrap">{office?<OfficeCanvas office={office} agents={visible} selected={selected} zoom={zoom} onSelect={setSelected} onMove={move}/>:<p className="loading">작은 사무실을 준비하고 있어요…</p>}<div className="floor-tag">ORBIT CAMPUS <span>● OPEN</span></div><div className="zoom-controls"><button aria-label="축소" onClick={()=>setZoom(v=>Math.max(.65,v-.1))}>−</button><span>{Math.round(zoom*100)}%</span><button aria-label="확대" onClick={()=>setZoom(v=>Math.min(1.6,v+.1))}>+</button><button aria-label="확대 초기화" onClick={()=>setZoom(1)}>↺</button></div></div>
    <div className="floor-footer"><span>✦ 캐릭터 선택 → 빈 좌석 클릭으로 이동</span><span>기존 Pixel Agents 엔진 · 레이아웃 로컬 저장</span></div>
    <section id="team" className="team-strip">{visible.map(a=><button key={a.id} data-testid={`agent-${a.id}`} className={`agent-card ${selected===a.id?'selected':''}`} onClick={()=>setSelected(a.id)}><span className={`portrait p${a.palette}`} style={{backgroundImage:`url(/characters/char_${a.palette}.png)`}}/><span><strong>{a.name}</strong><small>{a.team} <i className={`status-dot ${a.status}`}/>{statusLabels[a.status]}</small></span></button>)}{visible.length===0&&<p>이 필터에 해당하는 에이전트가 없습니다.</p>}</section>
   </section><aside className="detail-panel"><div className="panel-heading"><span>AGENT INSPECTOR</span><span>↗</span></div>{current?<><div className="agent-hero"><div className={`large-portrait p${current.palette}`} style={{backgroundImage:`url(/characters/char_${current.palette}.png)`}}/><span className="source-chip">MOCK</span><h2>{current.name}</h2><p>{current.team} <span>·</span> {current.project}</p></div><div className="detail-content"><div className={`state-pill ${current.status}`}>● {statusLabels[current.status]}</div><p className="detail-label">CURRENT TASK</p><h3 data-testid="current-task">{current.task}</h3><div className="detail-row"><span>실행 시간</span><b data-testid="elapsed">{Math.floor((now-(current.startedAt??current.since))/60000).toString().padStart(2,'0')}:{Math.floor((now-(current.startedAt??current.since))/1000%60).toString().padStart(2,'0')}</b></div><div className="detail-row"><span>연결 출처</span><b>Mock 재생기</b></div><label className="move-label">좌석으로 이동<select aria-label="선택 에이전트 이동" value="" onChange={e=>move(e.target.value)}><option value="" disabled>팀 · QA · 회의실 · 휴게실</option>{office&&[...office.seats.values()].map(s=><option key={s.uid} value={s.uid} disabled={s.assigned}>{s.uid}</option>)}</select></label><div className="mock-note">이 캐릭터는 Mock 데이터입니다.<br/>실제 수집 세션은 상단 별도 채널에서 확인하세요.</div><div className="demo-label">상태 시연</div><div className="status-controls">{statuses.map(s=><button key={s} data-testid={`status-${s}`} onClick={()=>sendStatus(s)}>{statusLabels[s]}</button>)}</div><button className="remove-button" onClick={()=>apply({eventId:crypto.randomUUID(),agentId:selected,type:'remove',at:Date.now(),source:'mock'})}>Mock 에이전트 제거</button></div></>:<div className="empty-state">캐릭터를 선택하세요.<br/>제거한 에이전트는 초기화로 복원할 수 있어요.</div>}</aside></main>
   <section className="timeline" id="timeline"><div className="timeline-head"><div><span className="eyebrow">ACTIVITY LOG</span><h2>사무실의 지금 <span>MOCK EVENTS</span></h2></div><div className="playback"><button onClick={()=>{if(playing){stopRef.current?.();setPlaying(false);}else{stopRef.current=playScenario(apply,()=>setPlaying(false));setPlaying(true);}}}>{playing?'Ⅱ 재생 중지':'▶ 시나리오 재생'}</button><button onClick={reset}>↺ 초기화</button></div></div><div className="event-list">{filteredEvents.slice(0,8).map(e=><div className="event-row" key={e.eventId}><time>{new Date(e.at).toLocaleTimeString('ko-KR',{hour12:false,timeZone:officeTimezone})}</time><i className={`status-dot ${e.status??'coding'}`}/><strong>{roster.find(a=>a.id===e.agentId)?.name}</strong><span>{e.type==='spawn'?'사무실에 입장했어요':e.type==='remove'?'사무실에서 퇴장했어요':e.task}</span><small>MOCK</small></div>)}</div></section>
   <footer><span>ORBIT WORKS / 작은 픽셀, 함께하는 개발.</span><span role="status">{notice||'로컬 데모 · 캔버스 Mock / 수집 채널 별도'}</span></footer>
  </div>
 </div>;
}
