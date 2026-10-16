export function ModeSwitch({mode,onMode}:{mode:'mock'|'live';onMode:(mode:'mock'|'live')=>void}){
 return <div className="mode-switch" aria-label="사무실 모드"><button aria-pressed={mode==='mock'} onClick={()=>onMode('mock')}>MOCK SANDBOX</button><button aria-pressed={mode==='live'} onClick={()=>onMode('live')}>LIVE OFFICE</button></div>;
}
