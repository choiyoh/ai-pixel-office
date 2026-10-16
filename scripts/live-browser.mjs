import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createApp} from '../server/app.mjs';
import {publishBrowserFailure} from './browser-diagnostics.mjs';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-live-browser-')),stateDir=path.join(temp,'state');
let instance,browser,page,stage='live-start',token,base,port;
const secret='PRIVATE-SYNTHETIC-PROMPT-DO-NOT-EXPOSE',native='PRIVATE-NATIVE-SESSION';
const errors=[],httpErrors=[],routeErrors=[];
fs.mkdirSync('artifacts',{recursive:true});
async function start(reusePort=0,directory=stateDir){
 instance=await createApp({mode:'claude-local',source:'fixture',stateDir:directory});await instance.listen(reusePort);port=instance.app.server.address().port;base=`http://127.0.0.1:${port}`;
 token=JSON.parse(fs.readFileSync(path.join(directory,'runtime/receiver.json'),'utf8')).token;
}
async function post(id,event,extra={}){
 const r=await fetch(base+'/api/hooks/claude',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({session_id:id,hook_event_name:event,...extra})});expect(r.status).toBe(200);
}
try{
 await start();browser=await chromium.launch({...(process.env.ORBIT_BROWSER_EXECUTABLE?{executablePath:process.env.ORBIT_BROWSER_EXECUTABLE}:{}),headless:true});
 page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',()=>errors.push(true));
 page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/api/'))httpErrors.push(r.status());});
 await page.goto(base);await page.getByRole('button',{name:'LIVE OFFICE',exact:true}).click();
 stage='live-empty';await expect(page.getByTestId('live-count')).toHaveText('0');await expect(page.getByTestId('live-empty')).toBeVisible();
 const actors=async()=>JSON.parse((await page.locator('canvas').getAttribute('data-actors'))??'[]');
 await expect.poll(async()=>(await actors()).length).toBe(0);
 // Genuine intake refusals, not a fake actor injected into React/Canvas.
 expect((await fetch(base+'/api/hooks/claude',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session_id:'invalid',hook_event_name:'SessionStart'})})).status).toBe(401);
 await post('orphan','PreToolUse',{tool_name:'Write'});await post('orphan','SubagentStart');
 await expect(page.getByTestId('live-count')).toHaveText('0');
 stage='live-spawn';
 // Execute the packaged sender with synthetic Hook stdin and a private fixture registry.
 const child=spawn(process.execPath,['dist/claude-forwarder.cjs'],{env:{...process.env,ORBIT_STATE_DIR:stateDir},stdio:['pipe','pipe','pipe'],shell:false});
 const output=[];child.stdout.on('data',b=>output.push(b));child.stderr.on('data',b=>output.push(b));
 child.stdin.end(JSON.stringify({session_id:native,hook_event_name:'SessionStart',prompt:secret,cwd:'/private/'+secret}));
 expect(await new Promise(resolve=>child.on('exit',resolve))).toBe(0);expect(Buffer.concat(output).length).toBe(0);
 await expect(page.getByTestId('live-count')).toHaveText('1',{timeout:20000});
 await post(native,'SessionStart');await expect(page.getByTestId('live-count')).toHaveText('1');
 await Promise.all(Array.from({length:5},(_,i)=>post('parallel-'+i,'SessionStart')));
 await expect(page.getByTestId('live-count')).toHaveText('6',{timeout:15000});await expect.poll(async()=>(await actors()).length).toBe(6);
 await page.getByTestId('live-agent-1').click();
 stage='live-tools';await post(native,'PreToolUse',{tool_name:'Read',tool_input:{password:secret}});
 await expect(page.getByTestId('live-inspector')).toContainText('Read');await expect.poll(async()=>(await actors()).find(a=>a.id===1)?.tool).toBe('Read');
 await expect.poll(async()=>(await actors()).find(a=>a.id===1)?.state,{timeout:15000}).toBe('type');
 await post(native,'PreToolUse',{tool_name:'Write'});await expect.poll(async()=>(await actors()).find(a=>a.id===1)?.tool).toBe('Write');
 await post(native,'PreToolUse',{tool_name:'Bash'});await expect(page.getByTestId('live-inspector')).toContainText('Bash');await expect.poll(async()=>(await actors()).find(a=>a.id===1)?.active).toBe(false);expect((await actors()).find(a=>a.id===1).tool).toBe(null);
 await post(native,'PermissionRequest');await expect(page.getByTestId('live-approval')).toHaveText('1');await expect.poll(async()=>(await actors()).find(a=>a.id===1)?.bubble).toBe('permission');
 await post(native,'Notification',{notification_type:'idle_prompt'});await expect(page.getByTestId('live-inspector')).toContainText('사용자 입력 대기');
 await post(native,'PostToolUseFailure');await expect(page.getByTestId('live-inspector')).toContainText('도구 실패');
 await post(native,'Stop');await expect(page.getByTestId('live-inspector')).toContainText('턴 종료');await expect(page.getByTestId('live-count')).toHaveText('6');
 await post(native,'SubagentStart');await post(native,'SubagentStop');await expect(page.getByTestId('live-count')).toHaveText('6');
 stage='live-modes';await page.getByRole('button',{name:'MOCK SANDBOX',exact:true}).click();await expect(page.locator('.agent-card')).toHaveCount(6);
 await page.getByTestId('agent-3').click();await page.getByLabel('선택 에이전트 이동').selectOption('meeting-1');const mockSeats=await page.evaluate(()=>localStorage.getItem('orbit.seats.v1'));
 await page.getByRole('button',{name:'LIVE OFFICE',exact:true}).click();await expect(page.getByTestId('live-count')).toHaveText('6');await expect(page.getByTestId('agent-3')).toHaveCount(0);
 await page.getByTestId('live-agent-1').click();await page.getByLabel('Live 좌석 이동').selectOption('meeting-2');
 expect(await page.evaluate(()=>localStorage.getItem('orbit.seats.v1'))).toBe(mockSeats);
 await page.reload();await expect(page.getByTestId('live-count')).toHaveText('6');await expect.poll(async()=>(await actors()).find(a=>a.id===1)?.seat).toBe('meeting-2');
 // Actual response loss: next delta cannot bridge the missing response, so UI
 // obtains the authoritative snapshot. No actors are inserted by this route.
 stage='live-gap';let dropped=false,snapshots=0;
 page.on('request',r=>{if(new URL(r.url()).pathname==='/api/live/snapshot')snapshots++;});
 await page.route('**/api/live/events?*',async route=>{
  try{const response=await route.fetch();const data=await response.json();
   if(!dropped&&data.deltas.length){dropped=true;await route.fulfill({response,json:{...data,deltas:[]}});}else await route.fulfill({response});
  }catch{routeErrors.push(true);await route.abort().catch(()=>{});}
 });
 await post('after-gap','SessionStart');await expect(page.getByTestId('live-count')).toHaveText('7',{timeout:15000});expect(dropped).toBe(true);expect(snapshots>0).toBe(true);await page.unrouteAll({behavior:'wait'});
 stage='live-evidence';await page.getByTestId('live-agent-1').click();await post(native,'PreToolUse',{tool_name:'Read'});await post('parallel-0','PreToolUse',{tool_name:'Write'});await post('parallel-1','PermissionRequest');
 await expect(page.getByTestId('live-working')).toHaveText('2');await expect(page.getByTestId('live-approval')).toHaveText('1');await page.waitForTimeout(800);
 const html=await page.locator('body').innerText();for(const value of [secret,native,token])expect(html.includes(value)).toBe(false);
 expect(fs.readFileSync(path.join(stateDir,'live/claude-fixture.json'),'utf8').includes(secret)).toBe(false);
 await page.screenshot({path:'artifacts/live-office-synthetic.png',fullPage:true});
 stage='live-end';
 // Observe actual rendered frames before posting: the upstream effect lasts
 // 300ms, shorter than multiple CI browser round trips. Keep the engine speed.
 await page.evaluate(()=>{
  globalThis.orbitRetirementSeen=false;
  const canvas=document.querySelector('canvas'),observer=new MutationObserver(()=>{
   const characters=JSON.parse(canvas.getAttribute('data-actors')??'[]');
   if(characters.some(a=>a.id===1&&a.effect==='despawn'&&!a.active&&a.tool===null)){globalThis.orbitRetirementSeen=true;observer.disconnect();}
  });
  observer.observe(canvas,{attributes:true,attributeFilter:['data-actors']});setTimeout(()=>observer.disconnect(),10000);
 });
 await post(native,'SessionEnd');await expect(page.getByTestId('live-count')).toHaveText('6');await expect(page.getByTestId('live-agent-1')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>globalThis.orbitRetirementSeen)).toBe(true);
 await expect.poll(async()=>(await actors()).some(a=>a.id===1),{timeout:5000}).toBe(false);
 await post(native,'PreToolUse',{tool_name:'Write'});await post(native,'SessionStart');await expect(page.getByTestId('live-count')).toHaveText('6');
 stage='live-restart';const before=await actors();await instance.app.close();await expect(page.getByTestId('live-connection')).toContainText('서버 연결 끊김',{timeout:10000});
 await expect(page.getByRole('button',{name:'LIVE OFFICE',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByTestId('live-count')).toHaveText('6');
 await expect.poll(async()=>(await actors()).every(a=>!a.active)).toBe(true);
 await start(port);await page.reload();await expect(page.getByTestId('live-count')).toHaveText('6',{timeout:15000});
 await expect.poll(async()=>(await actors()).map(a=>a.id).sort()).toEqual(before.map(a=>a.id).sort());await expect(page.locator('.agent-card').first()).toContainText('stale');
 await post(native,'SessionStart');await expect(page.getByTestId('live-count')).toHaveText('6');
 stage='live-mobile';await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/live-office-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 stage='live-scope';await instance.app.close();await start(port,path.join(temp,'other-installation'));await post('new-one','SessionStart');await post('new-two','SessionStart');
 // Renew the browser's real server cookie without reloading React: exercise a
 // namespace change whose numeric render IDs overlap the old installation.
 await page.request.get(base);await expect(page.getByTestId('live-count')).toHaveText('2',{timeout:15000});
 await expect.poll(async()=>(await actors()).map(a=>a.id).sort()).toEqual([1,2]);await expect(page.getByTestId('live-agent-3')).toHaveCount(0);
 stage='live-unprepared';await instance.app.close();instance=await createApp({mode:'mock'});await instance.listen(port);await page.reload();
 await expect(page.getByTestId('live-connection')).toContainText('연결 준비 필요');await expect(page.getByTestId('live-count')).toHaveText('0');await expect.poll(async()=>(await actors()).length,{timeout:5000}).toBe(0);
 await expect(page.getByRole('button',{name:'LIVE OFFICE',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('button',{name:'▶ 시나리오 재생',exact:true})).toHaveCount(0);
 expect(errors).toEqual([]);expect(httpErrors).toEqual([]);expect(routeErrors).toEqual([]);
 fs.writeFileSync('artifacts/live-browser-result.json',JSON.stringify({status:'passed',source:'synthetic-through-authenticated-hook-provider',realEnvironmentVerified:false,concurrentActors:7,checks:['empty','sender intake','dedup membership','tools and approval','neutral Bash','Stop retains','no phantom children','mode/seat isolation','delta gap resnapshot','terminal despawn/tombstone','offline no Mock fallback','restart and reload','no raw input/credentials in DOM/state','mobile','no JS errors']},null,2));
 console.log('Live Canvas acceptance passed (synthetic intake only).');
}catch(error){const detail=publishBrowserFailure(stage,error);throw Error('Live Canvas browser check failed: '+JSON.stringify(detail));}
finally{await page?.unrouteAll({behavior:'wait'});await browser?.close();await instance?.app.close();fs.rmSync(temp,{recursive:true,force:true});}
