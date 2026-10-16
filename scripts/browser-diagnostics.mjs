export function browserFailure(stage,error){
 const stages=new Set(['launch','initial-agents','status-controls','offline-freeze','filters','seat-move','seat-persistence','zoom','remove-respawn','scenario','mobile','browser-errors','connection-start','connection-load','connection-event','connection-stop','live-start','live-empty','live-spawn','live-tools','live-modes','live-gap','live-evidence','live-end','live-restart','live-mobile','live-scope','live-unprepared']);
 const enums=new Set(['idle','walk','type','read','spawn','despawn','meeting-1','meeting-2']);
 const scalar=value=>typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value))||enums.has(value)?value:null;
 const matcher=error?.matcherResult;
 return {platform:process.platform,stage:stages.has(stage)?stage:'unknown',kind:error?.name==='TimeoutError'||String(error?.message??'').includes('Timeout')?'timeout':'assertion-or-browser',matcher:['toBe','toEqual','toBeVisible','toHaveCount','toHaveText','toContainText','toBeGreaterThan'].includes(matcher?.name)?matcher.name:null,actual:scalar(matcher?.actual),expected:scalar(matcher?.expected)};
}
export function publishBrowserFailure(stage,error){
 const detail=browserFailure(stage,error);
 if(process.env.GITHUB_ACTIONS==='true')console.log('::error title=Orbit browser failure::'+JSON.stringify(detail));
 return detail;
}
