import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const targetUrl = process.argv[2];
if (!targetUrl) throw new Error('请传入 BOSS 公司职位页 URL。');

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
await context.addInitScript({
  path: fileURLToPath(new URL('../boss-anti-refresh.user.js', import.meta.url))
});
const page = await context.newPage();
page.on('console', (message) => {
  if (message.text().startsWith('[BOSS 定向防跳转]')) {
    console.log(message.text());
  }
});
await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
console.log('已注册加载前注入。请检查页面及补丁命中日志；本示例尚未独立实测。');
