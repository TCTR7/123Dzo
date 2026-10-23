import {defineConfig,devices} from '@playwright/test';
const baseURL=process.env.E2E_BASE_URL;
if(process.env.E2E_ISOLATED_PROJECT!=='true'||!baseURL)throw new Error('E2E requires E2E_ISOLATED_PROJECT=true and E2E_BASE_URL for a configured isolated Clerk/Supabase app. No production or browser-mocked SSR fallback. Run npm run test:ux for the isolated UI component harness.');
const url=new URL(baseURL);
if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('E2E requires HTTPS or loopback');
export default defineConfig({
 testDir:'./automation_test/acceptance',fullyParallel:false,forbidOnly:!!process.env.CI,retries:process.env.CI?1:0,
 workers:1,outputDir:'./automation_test/artifacts/test-results',reporter:[['list'],['html',{outputFolder:'automation_test/artifacts/html-report',open:'never'}]],
 use:{baseURL,headless:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
 // Auth traces/capabilities stay local; staging workflow never uploads them.
 projects:[{name:'chromium',use:{...devices['Desktop Chrome']}}],
});
