import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApp} from '../server/app.mjs';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-p2a4-browser-'));let app,browser,page,stage="startup";
const result={source:'synthetic-http-provider-canvas',realEnvironmentVerified:false,observations:[]};
try{
 app=await createApp({mode:'claude-local',source:'fixture',stateDir:path.join(temp,'state')});await app.listen(0);const base=`http://127.0.0.1:${app.app.server.address().port}`;const {token}=JSON.parse(fs.readFileSync(path.join(temp,'state/runtime/receiver.json'),'utf8'));
 const post=async(event,extra={})=>{const r=await fetch(base+'/api/hooks/claude',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({session_id:'P2A4-SENSITIVE-NATIVE',hook_event_name:event,prompt:'SENSITIVE-PROMPT',tool_input:{path:'/private/SENSITIVE-FILE'},...extra})});expect(r.status).toBe(200);};
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:1100}});await page.goto(base);await page.getByRole('button',{name:'LIVE OFFICE',exact:true}).click();await expect(page.getByTestId('live-count')).toHaveText('0');stage='session-start';await post('SessionStart');await expect(page.getByTestId('live-count')).toHaveText('1');
 const actors=async()=>JSON.parse(await page.locator('canvas').getAttribute('data-actors')??'[]');
 await page.evaluate(()=>{const c=document.querySelector('canvas');globalThis.orbitFrames=[];let last='';new MutationObserver(()=>{const values=JSON.parse(c.getAttribute('data-actors')??'[]').map(a=>({id:a.id,state:a.state,frame:a.frame,tool:a.tool,active:a.active}));const key=JSON.stringify(values.map(a=>[a.id,a.state,a.tool,a.active]));if(key!==last){last=key;globalThis.orbitFrames.push({at:performance.now(),actors:values});}}).observe(c,{attributes:true,attributeFilter:['data-actors']});});
 for(const [tool,visual,delay] of [['Read','Read',100],['Edit','Write',300]]){
  stage='short-'+tool;await page.waitForResponse(r=>r.url().includes('/api/live/events?'));await post('PreToolUse',{tool_name:tool});await new Promise(r=>setTimeout(r,delay));await post('PostToolUse',{tool_name:tool});
  await expect.poll(async()=>(await actors())[0]?.tool,{timeout:4000,intervals:[20]}).toBe(visual);
  await expect(page.getByTestId('live-working')).toHaveText('0');
  await expect.poll(async()=>(await actors())[0]?.state,{intervals:[20]}).toBe('type');
  await page.screenshot({path:`artifacts/p2a4-short-${tool}.png`,fullPage:true});
  await expect.poll(async()=>(await actors())[0]?.tool,{timeout:3000,intervals:[20]}).toBe(null);
  result.observations.push({tool,actualDurationMs:delay,modelStatus:'between-tools',workingCount:0,visual});
 }
 // New non-reading tool preempts the previous cosmetic observation.
 await post('PreToolUse',{tool_name:'Read'});await post('PostToolUse',{tool_name:'Read'});await expect.poll(async()=>(await actors())[0]?.tool,{timeout:4000,intervals:[20]}).toBe('Read');await post('PreToolUse',{tool_name:'Bash'});await post('PostToolUse',{tool_name:'Bash'});await expect.poll(async()=>(await actors())[0]?.tool,{timeout:3000,intervals:[20]}).toBe(null);
 // An authenticated SessionEnd always removes the actor even mid-animation.
 await post('PreToolUse',{tool_name:'Edit'});await post('PostToolUse',{tool_name:'Edit'});await expect.poll(async()=>(await actors())[0]?.tool,{timeout:4000,intervals:[20]}).toBe('Write');await post('SessionEnd');await expect(page.getByTestId('live-count')).toHaveText('0');await expect.poll(async()=>(await actors()).length).toBe(0);await post('PreToolUse',{tool_name:'Read'});await expect(page.getByTestId('live-count')).toHaveText('0');
 result.frames=await page.evaluate(()=>globalThis.orbitFrames);result.measuredDurations=[];for(let i=0;i<result.frames.length;i++){const f=result.frames[i],tool=f.actors[0]?.tool;if(tool&&i+1<result.frames.length&&result.frames[i+1].actors[0]?.tool!==tool)result.measuredDurations.push({tool,ms:Math.round(result.frames[i+1].at-f.at)});}
 const html=await page.content(),bytes=fs.readFileSync(path.join(temp,'state/live/claude-fixture.json'),'utf8');for(const secret of ['P2A4-SENSITIVE-NATIVE','SENSITIVE-PROMPT','SENSITIVE-FILE',token]){expect(html.includes(secret)).toBe(false);expect(bytes.includes(secret)).toBe(false);}result.privacyPassed=true;result.status='passed';
 console.log('P2-A.4 short-action Canvas and authoritative model checks passed.');
}catch(e){result.status='failed';result.failureType=e.name;result.stage=stage;if(page){await page.screenshot({path:'artifacts/p2a4-browser-failed.png',fullPage:true});result.lastActors=JSON.parse(await page.locator('canvas').getAttribute('data-actors')??'[]');result.frames=await page.evaluate(()=>globalThis.orbitFrames??[]);}console.log('P2-A.4 browser failed; sanitized result saved.');process.exitCode=1;}
finally{fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/p2a4-browser-result.json',JSON.stringify(result,null,2)+'\n');await browser?.close();await app?.app.close();fs.rmSync(temp,{recursive:true,force:true});}
