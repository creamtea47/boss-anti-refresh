# BOSS 防刷新

**[从 Greasy Fork 安装「BOSS 防刷新」](https://greasyfork.org/zh-CN/scripts/601962-boss-%E9%98%B2%E5%88%B7%E6%96%B0)** · [反馈问题](https://github.com/creamtea47/boss-anti-refresh/issues)

在 BOSS 全站运行，面向爬虫、浏览器自动化和调试场景，定向处理已识别反调试模块引发的异常刷新、后退与空白。

当前已验证：Codex 连接浏览器后，公司职位列表第 1～5 页和列表内详情可用；v0.1.3 登录页输入与短信发码可用。**v0.1.5 新增独立页面入口补丁，尚待现场验证，不能视为登录后跳转和独立详情页均已修复。**

## 为什么会反复刷新

排查时，公司页实际加载的公开脚本中包含一组反调试检测：

- 通过对象属性读取、日期和函数的 `toString()` 探针感知调试环境。
- 比较控制台打印对象的耗时。
- 创建隐藏 iframe，取得另一套原生对象和控制台方法。

检测命中后，代码会尝试后退、关页、清空页面内容、重新加载，部分分支还会制造内存压力。重新加载后检测再次运行，就可能表现为反复刷新或页面变白。

这是本次代码分析、补丁命中日志和修复前后表现共同支持的判断；没有取得导致现场导航的动态调用栈，不能据此解释所有跳转。

## 脚本怎么处理

1. 在 `document-start` 阶段运行，尽早监听公司页的 `webpackJsonp`、登录页的 `webpackChunkfe_web_sign` 和推荐页的 `webpackChunkgeek` 模块注册。
2. 在模块交给 Webpack 执行前读取其函数源码。
3. 先检查四个共同特征：`largeObjectArray`、`__defineGetter__`、`Unable to obtain information` 和 `Array(1e9)` 内存分配代码。再检查已审查构建的 iframe 特征：旧构建的 `parent.__xbcw`，或者新版的 `createElement("iframe")`、`.contentWindow` 和 `noDebug:` 三项组合。共同特征与其中一套 iframe 特征必须同时匹配，才替换模块。
4. 替换实现保留初始化回调、返回值形状，并同时提供已审查构建使用的 `a`、`X` 和 `noDebug` 导出，让页面其余初始化继续进行。
5. v0.1.5 同时监听旧版页面脚本的 `Sign` 全局对象赋值。只有 `encryptPwd` 函数符合上述特征，且包含已审查的应用名和 `window.Detail.initDg()` 回调，才替换这个独立反调试入口，并调用原来的初始化回调。

**保留回调是关键。** 调用方还会检查初始化计数；直接删除模块或换成空函数，可能触发另一处大量分配内存的分支。

当前公司页识别到的模块编号为 `309`，登录页为 `6906`，推荐页为 `54294`，但编号不参与匹配。网站只调整编号时仍可识别；如果改写了源码特征，需要重新分析和更新补丁。

### 为什么 v0.1.2 的全站匹配仍没覆盖登录页

登录页使用另一套打包入口 `webpackChunkfe_web_sign`，导出名称也由公司页的 `a` 变为 `X`，Webpack 的导出辅助函数参数格式同样不同。v0.1.2 只扩大了网址范围，仍只监听旧队列，因此无法拦截这套登录页模块。v0.1.3 增加了登录队列，并直接定义两种导出接口。

推荐页又使用 `webpackChunkgeek` 队列和 `noDebug` 导出，iframe 实现也换成了 `contentWindow`。v0.1.4 兼容这第三套已审查构建，并继续保留调用方要求的初始化回调。

### 为什么模块队列已经命中，页面仍可能卡住

推荐页还同时加载 `zhipin-geek-seo/v5447/web/geek/js/main.js`。其中另一套检测直接放在 `Sign.encryptPwd()` 内，不经过上述三种模块队列。这个名字容易造成误解：已审查的函数体是反调试检测，实际登录提交和加密方法是同一对象中的其他方法。

脚本末尾会调用它，并检查 `Detail.dgTag === Sign.pwdDetail`。如果只把函数清空，初始化标记缺失，仍可能进入大量分配内存的分支。v0.1.5 只替换匹配到的检测函数，调用原 `Detail.initDg()` 完成标记；保留其他登录、短信、加密和验证方法。

这处源码与现场控制台探针记录吻合，但没有取得现场导航调用栈。站点另有“当前登录状态已失效”提示，不能将正常登录过期跳转也归因于此检测；本脚本不会伪造登录状态或屏蔽验证码。

## 安装和使用

1. 安装 Tampermonkey 等用户脚本管理器。
2. 打开上方 Greasy Fork 链接，安装「BOSS 防刷新」。
3. 完整刷新需要使用的 BOSS 页面，让脚本在页面开始加载时运行。
4. 如需确认，在控制台查找带有 `v0.1.5` 的 `已识别并替换反调试模块` 或 `已识别并替换独立页面反调试入口 Sign.encryptPwd`。只有 `已就绪` 代表钩子已安装，不代表已匹配到目标。执行替代实现时还会输出初始化回调记录，便于区分“已注册替换”与“已实际调用”。

若此前手动装过「BOSS 公司页调试防跳转 · 定向补丁」，请停用旧版后再使用正式版，便于管理更新。

从 v0.1.2 起，作用范围为 `https://www.zhipin.com/*` 的所有顶层页面，脚本内部也已移除路径限制。全站页面都会尝试识别目标模块；进入匹配范围不等于该页面的所有反调试实现均已覆盖。已完成的现场验证范围仍以以下记录为准。

## 场景与验证状态

| 场景 | 当前状态 |
| --- | --- |
| Codex 连接浏览器，公司职位列表 | 已实测翻页 1→2→3→4→5→1，实际列表内容变化，持续数分钟保持可读 |
| 公司列表内切换职位详情 | 已实测完整职责、要求和工作地址可读 |
| 登录页 `/web/user/` | v0.1.3 已实测命中 6906 模块；输入、发码期间保持调试连接约七分钟，未观察到异常刷新 |
| 输入手机号、发送验证码 | v0.1.3 已实测：输入成功，发码按钮触发正常滑块；人工完成后站点显示“已发送”倒计时 |
| 提交登录后的跳转 | v0.1.4 已实测命中登录与推荐页模块；新开推荐页仍出现登录失效提示并返回登录页。v0.1.5 补上同时加载的独立入口，待现场验证 |
| 独立 `/job_detail/` 页面 | 旧版能短暂读取，随后仍可能自动退回列表；v0.1.5 候选修复尚未实测 |
| Chrome 开发者工具、其他 CDP 调试工具 | 兼容目标，尚未单独验证 |
| GPT 等浏览器代理 | 兼容目标，尚未单独验证 |
| Playwright、Puppeteer 浏览器爬虫 | 已提供加载前注入示例，尚未独立实测 |

现场实测日期：2026-10-24～25。实测时同时启用了通用反反调试脚本，因此上述记录不等同于独立运行本脚本的验证结果。

本项目处理执行网页 JavaScript 时的特定反调试问题。纯 HTTP 请求爬虫不执行这些脚本，接入方式和问题范围不同。

## 浏览器自动化接入

同一份 `boss-anti-refresh.user.js` 可以作为页面初始化脚本使用；元信息本身也是 JavaScript 注释。应在导航前注册，并在页面主 JavaScript 环境中执行。

### Playwright

```js
await context.addInitScript({ path: './boss-anti-refresh.user.js' });
// 此后再创建页面、访问需要使用的 BOSS 页面。
```

示例：[examples/playwright.mjs](examples/playwright.mjs)。在仓库目录安装 `playwright` 及其浏览器后运行：

```sh
node examples/playwright.mjs '你的 BOSS 页面 URL'
```

### Puppeteer

```js
const source = await readFile('./boss-anti-refresh.user.js', 'utf8');
await page.evaluateOnNewDocument(source);
// 此后再导航到目标页面。
```

示例：[examples/puppeteer.mjs](examples/puppeteer.mjs)。安装 `puppeteer` 后运行：

```sh
node examples/puppeteer.mjs '你的 BOSS 页面 URL'
```

使用 CDP 连接既有浏览器时，同样需要在目标页下一次加载之前完成初始化脚本注册。已经运行过的页面脚本不会被追溯替换。

## 自动更新

代码维护入口为本仓库的 `main` 分支。Greasy Fork 已开启自动同步，从该分支的脚本原始地址获取更新：

```text
https://raw.githubusercontent.com/creamtea47/boss-anti-refresh/main/boss-anti-refresh.user.js
```

更新链路为：GitHub 发布更高 `@version` → Greasy Fork 自动同步 → 用户脚本管理器按自身更新设置检查新版。Greasy Fork 同步和浏览器检查都有各自的周期，更新可能有延迟。

自动更新用于获取维护者发布的新版本，不表示脚本会自行适配 BOSS 的所有改版。

## 代码分析依据

- [当时加载的反调试模块所在脚本](https://static.zhipin.com/zhipin-ssr-site/v5686/client/f30eda7.js)
- [当时的模块调用方](https://static.zhipin.com/zhipin-ssr-site/v5686/client/ef5591c.js)
- [登录页实际加载的模块所在脚本](https://static.zhipin.com/zhipin-sign/v5333/static/js/vendors.9a2efe85.js)
- [登录页实际加载的调用方与模块运行时](https://static.zhipin.com/zhipin-sign/v5333/static/js/app.85b65004.js)
- [推荐页实际加载的反调试模块](https://static.zhipin.com/zhipin-geek-spa/web/v6783/static/js/vendor-0.8bed8397.js)
- [推荐页的调用方与回调检查](https://static.zhipin.com/zhipin-geek-spa/web/v6783/static/js/app~3.f161807f.js)
- [同时加载的独立检测入口与初始化标记检查](https://static.zhipin.com/zhipin-geek-seo/v5447/web/geek/js/main.js)
- [Playwright 初始化脚本接口](https://playwright.dev/docs/api/class-browsercontext#browser-context-add-init-script)
- [Puppeteer 初始化脚本接口](https://pptr.dev/api/puppeteer.page.evaluateonnewdocument)
- [Greasy Fork 元信息与更新地址说明](https://greasyfork.org/zh-CN/help/meta-keys)
