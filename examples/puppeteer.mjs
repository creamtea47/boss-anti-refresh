import puppeteer from 'puppeteer';
import { readFile } from 'node:fs/promises';

const targetUrl = process.argv[2];
if (!targetUrl) throw new Error('请传入 BOSS 公司职位页 URL。');

const source = await readFile(new URL('../boss-anti-refresh.user.js', import.meta.url), 'utf8');
const browser = await puppeteer.launch({ headless: false });
const page = await browser.newPage();
await page.evaluateOnNewDocument(source);
page.on('console', (message) => {
  if (message.text().startsWith('[BOSS 定向防跳转]')) {
    console.log(message.text());
  }
});
await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
console.log('已注册加载前注入。请检查页面及补丁命中日志；本示例尚未独立实测。');
