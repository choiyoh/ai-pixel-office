import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
fs.mkdirSync('artifacts',{recursive:true});
const browser=await chromium.launch({...(process.env.ORBIT_BROWSER_EXECUTABLE?{executablePath:process.env.ORBIT_BROWSER_EXECUTABLE}:{}),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:1});
const errors=[],network=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('response',r=>{if(r.status()>=400)network.push(`${r.status()} ${r.url()}`);});
try{
 await page.goto(process.env.ORBIT_BASE_URL??'http://127.0.0.1:4173');
 await expect(page.getByTestId('agent-6')).toBeVisible();
 await expect(page.locator('.agent-card')).toHaveCount(6);
 await expect.poll(async()=>JSON.parse(await page.locator('canvas').getAttribute('data-actors')).length).toBe(6);
 await page.waitForTimeout(2500);
 await page.screenshot({path:'artifacts/office-desktop.png',fullPage:true});
 await page.getByTestId('agent-3').click();
 await expect(page.getByTestId('current-task')).toHaveText('사용자 흐름 분석');
 for(const [status,label] of [['coding','코딩'],['analysis','분석'],['testing','테스트'],['approval','승인 대기'],['idle','휴식'],['completed','완료'],['failed','실패'],['disconnected','연결 끊김']]){
  await page.getByTestId(`status-${status}`).click();
  await expect(page.locator('.state-pill')).toContainText(label);
 }
 const offlinePosition=async()=>JSON.parse(await page.locator('canvas').getAttribute('data-actors')).find(a=>a.id===3);
 await page.waitForTimeout(200);const beforeOffline=await offlinePosition();await page.waitForTimeout(350);const afterOffline=await offlinePosition();
 expect(afterOffline.state).toBe('idle');expect(afterOffline.x).toBe(beforeOffline.x);expect(afterOffline.y).toBe(beforeOffline.y);
 await page.screenshot({path:'artifacts/office-disconnected.png',fullPage:true});
 await page.getByLabel('프로젝트 필터').selectOption('Signal Lab');await expect(page.locator('.agent-card')).toHaveCount(2);
 await page.getByLabel('에이전트 필터').selectOption('3');await expect(page.locator('.agent-card')).toHaveCount(1);
 await page.getByLabel('프로젝트 필터').selectOption('all');await page.getByLabel('에이전트 필터').selectOption('all');
 await page.getByTestId('agent-1').click();
 await page.getByLabel('선택 에이전트 이동').selectOption('meeting-1');
 await expect(page.getByRole('status')).toHaveText('레이아웃과 좌석을 저장했습니다.');
 await page.getByTestId('agent-2').click();await page.getByLabel('선택 에이전트 이동').selectOption('meeting-2');
 const stored=await page.evaluate(()=>({layout:localStorage.getItem('orbit.layout.v1'),seats:localStorage.getItem('orbit.seats.v1')}));
 expect(JSON.parse(stored.seats)['1']).toBe('meeting-1');expect(JSON.parse(stored.seats)['2']).toBe('meeting-2');
 await page.reload();await expect(page.locator('.agent-card')).toHaveCount(6);
 expect(await page.evaluate(()=>localStorage.getItem('orbit.layout.v1'))).toBe(stored.layout);
 expect(await page.evaluate(()=>localStorage.getItem('orbit.seats.v1'))).toBe(stored.seats);
 await expect.poll(async()=>JSON.parse(await page.locator('canvas').getAttribute('data-actors')).find(a=>a.id===2)?.seat).toBe('meeting-2');
 await page.getByRole('button',{name:'확대',exact:true}).click();await expect(page.locator('.zoom-controls')).toContainText('110%');
 await page.waitForTimeout(350);
 expect(await page.locator('canvas').evaluate(c=>c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data[3])).toBeGreaterThan(0);
 await page.getByRole('button',{name:'축소',exact:true}).click();await expect(page.locator('.zoom-controls')).toContainText('100%');
 await page.getByRole('button',{name:'Mock 에이전트 제거'}).click();await expect(page.locator('.agent-card')).toHaveCount(5);
 await expect.poll(async()=>JSON.parse(await page.locator('canvas').getAttribute('data-actors')).length).toBe(5);
 await page.getByRole('button',{name:'↺ 초기화',exact:true}).click();await expect(page.locator('.agent-card')).toHaveCount(6);
 await page.getByRole('button',{name:'▶ 시나리오 재생'}).click();
 await expect(page.locator('.event-row').filter({hasText:'Mock 테스트 실패'})).toBeVisible({timeout:20000});
 await expect(page.locator('.event-row').filter({hasText:'Mock 연결 종료'})).toBeVisible({timeout:7000});
 await expect(page.getByRole('button',{name:'▶ 시나리오 재생'})).toBeVisible({timeout:3000});
 await page.screenshot({path:'artifacts/office-scenario.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'artifacts/office-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 expect(errors).toEqual([]);expect(network).toEqual([]);
 fs.writeFileSync('artifacts/browser-result.json',JSON.stringify({status:'passed',concurrentAgents:6,checks:['8 explicit Mock states','project and agent filters','seat/layout persisted across reload','zoom','remove and respawn','timed scenario','desktop and mobile','no JS or HTTP errors'],errors,network},null,2));
 console.log('Browser acceptance checks passed.');
}catch(e){fs.writeFileSync('artifacts/browser-result.json',JSON.stringify({status:'failed',error:String(e),errors,network},null,2));throw e;}
finally{await browser.close();}
