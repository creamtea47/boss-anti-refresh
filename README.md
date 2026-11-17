# BOSS 防刷新

**[从 Greasy Fork 安装「BOSS 防刷新」](https://greasyfork.org/zh-CN/scripts/601962-boss-%E9%98%B2%E5%88%B7%E6%96%B0)** · [反馈问题](https://github.com/creamtea47/boss-anti-refresh/issues)

在 BOSS 全站运行，面向爬虫、浏览器自动化和调试场景，定向处理已识别反调试模块引发的异常刷新、后退与空白。

v0.1.6 已在 Codex 调试连接下验证聊天页：成功替换启动主包中的检测调用并执行原初始化回调，消息列表、已读会话切换和草稿输入正常；主动刷新后持续观察超过五分钟，未观察到自动重载。历史 v0.1.5 已复测公司职位列表、推荐页、简历页跳转和一条 MES 独立详情页。**完整短信登录提交流程仍待连续复测，其他页面与工具仍以验证表为准。**

## 为什么会反复刷新

排查时，公司页实际加载的公开脚本中包含一组反调试检测：

- 通过对象属性读取、日期和函数的 `toString()` 探针感知调试环境。
- 比较控制台打印对象的耗时。
- 创建隐藏 iframe，取得另一套原生对象和控制台方法。

检测命中后，代码会尝试后退、关页、清空页面内容、重新加载，部分分支还会制造内存压力。重新加载后检测再次运行，就可能表现为反复刷新或页面变白。

这是本次代码分析、补丁命中日志和修复前后表现共同支持的判断；没有取得导致现场导航的动态调用栈，不能据此解释所有跳转。

## 脚本怎么处理

1. 在 `document-start` 阶段运行，尽早监听公司页的 `webpackJsonp`、登录页的 `webpackChunkfe_web_sign`、推荐页的 `webpackChunkgeek` 和聊天页的 `webpackChunkGeekChat` 模块注册。
2. 在模块交给 Webpack 执行前读取其函数源码。
3. 先检查四个共同特征：`largeObjectArray`、`__defineGetter__`、`Unable to obtain information` 和 `Array(1e9)` 内存分配代码。再检查已审查构建的 iframe 特征：旧构建的 `parent.__xbcw`，或者新版的 `createElement("iframe")`、`.contentWindow` 和 `noDebug:` 三项组合。共同特征与其中一套 iframe 特征必须同时匹配，才替换模块。
4. 替换实现保留初始化回调、返回值形状，并同时提供已审查构建使用的 `a`、`X` 和 `noDebug` 导出，让页面其余初始化继续进行。
5. v0.1.5 同时监听旧版页面脚本的 `Sign` 全局对象赋值。只有 `encryptPwd` 函数符合上述特征，且包含已审查的应用名和 `window.Detail.initDg()` 回调，才替换这个独立反调试入口，并调用原来的初始化回调。
6. v0.1.6 为聊天页队列注册一个没有业务模块的启动回调，在入口执行前检查初始模块表。聊天根模块采用单独处理：只替换其中已审查的检测调用，保留整个应用模块和原初始化回调。

**保留回调是关键。** 调用方还会检查初始化计数；直接删除模块或换成空函数，可能触发另一处大量分配内存的分支。

当前公司页识别到的模块编号为 `309`，登录页为 `6906`，推荐页为 `54294`，但编号不参与匹配。网站只调整编号时仍可识别；如果改写了源码特征，需要重新分析和更新补丁。

### 为什么 v0.1.2 的全站匹配仍没覆盖登录页

登录页使用另一套打包入口 `webpackChunkfe_web_sign`，导出名称也由公司页的 `a` 变为 `X`，Webpack 的导出辅助函数参数格式同样不同。v0.1.2 只扩大了网址范围，仍只监听旧队列，因此无法拦截这套登录页模块。v0.1.3 增加了登录队列，并直接定义两种导出接口。

推荐页又使用 `webpackChunkgeek` 队列和 `noDebug` 导出，iframe 实现也换成了 `contentWindow`。v0.1.4 兼容这第三套已审查构建，并继续保留调用方要求的初始化回调。

### 为什么模块队列已经命中，页面仍可能卡住

推荐页还同时加载 `zhipin-geek-seo/v5447/web/geek/js/main.js`。其中另一套检测直接放在 `Sign.encryptPwd()` 内，不经过上述三种模块队列。这个名字容易造成误解：已审查的函数体是反调试检测，实际登录提交和加密方法是同一对象中的其他方法。

脚本末尾会调用它，并检查 `Detail.dgTag === Sign.pwdDetail`。如果只把函数清空，初始化标记缺失，仍可能进入大量分配内存的分支。v0.1.5 只替换匹配到的检测函数，调用原 `Detail.initDg()` 完成标记；保留其他登录、短信、加密和验证方法。

这处源码与现场控制台探针记录吻合，但没有取得现场导航调用栈。站点另有“当前登录状态已失效”提示，不能将正常登录过期跳转也归因于此检测；本脚本不会伪造登录状态或屏蔽验证码。

### 为什么聊天页需要单独处理

2026-11-17 审查的 `chat-new/v5580` 使用 `webpackChunkGeekChat`，并将检测代码与聊天根组件合并在启动主包内。它不是通过队列单独注册的检测模块，因此只增加队列监听仍然不够；把整个根模块替换成空实现又会破坏聊天功能。

v0.1.6 在 Webpack 消费预先注册的启动回调时取得初始模块表。只有共同检测特征、`fe-geek-chat` 调用、已审查的实验键、原回调声明及后续标记检查同时匹配，且候选模块和调用均唯一，才在该函数源码中替换检测调用的函数名。其参数、原回调和其余聊天业务保持原样；模块编号与压缩后的局部变量名不参与识别。

聊天调用方会在检测之后立即检查自己的 `sta === "sd"`。替代实现调用它的原回调完成这个标记，不伪造实验结果，也不屏蔽所有刷新、消息连接、登录失效或验证码处理。

这个入口需要在页面环境中重新构建匹配到的函数。如果页面 CSP 不允许函数构建、模块不可改写、特征不匹配或匹配不唯一，脚本会保留原模块并明确警告；不能把“已就绪”当成修复成功。

## 安装和使用

1. 安装 Tampermonkey 等用户脚本管理器。
2. 打开上方 Greasy Fork 链接，安装「BOSS 防刷新」。
3. 完整刷新需要使用的 BOSS 页面，让脚本在页面开始加载时运行。
4. 如需确认，在控制台查找带有 `v0.1.6` 的 `已识别并替换反调试模块`、`已识别并替换独立页面反调试入口 Sign.encryptPwd`，或聊天页的 `已识别并替换聊天页启动入口`。聊天页还应出现 `原初始化回调已执行`。只有 `已就绪` 代表钩子已安装，不代表已匹配到目标。

若此前手动装过「BOSS 公司页调试防跳转 · 定向补丁」，请停用旧版后再使用正式版，便于管理更新。

从 v0.1.2 起，作用范围为 `https://www.zhipin.com/*` 的所有顶层页面，脚本内部也已移除路径限制。全站页面都会尝试识别目标模块；进入匹配范围不等于该页面的所有反调试实现均已覆盖。已完成的现场验证范围仍以以下记录为准。

## 场景与验证状态

| 场景 | 当前状态 |
| --- | --- |
| 消息聊天页 `/web/geek/chat` | v0.1.6 已实测命中聊天启动主包并执行原回调；消息列表、两个已读会话切换和草稿输入正常。主动刷新后观察 309 秒，所选会话与输入框保留，未观察到自动重载；该标签采集到的 warn/error 日志为空。17 组离线检查（含实际主包静态核对）通过 |
| Codex 连接浏览器，公司职位列表 | v0.1.5 已重新实测翻页 1→2→3→4→5→1，各页选中页码与实际列表内容均变化 |
| 公司列表内切换职位详情 | v0.1.5 已重新实测 PLM/ERP 与 MES 详情切换，完整职责、要求和工作地址可读 |
| 登录页 `/web/user/` | v0.1.3 已实测命中 6906 模块；输入、发码期间保持调试连接约七分钟，未观察到异常刷新 |
| 输入手机号、发送验证码 | v0.1.5 已输入并触发正常滑块，人工完成后用户确认收到本次短信；v0.1.3 曾直接读到“已发送”倒计时 |
| 已有登录态下的页面跳转 | v0.1.5 新打开登录地址后自动进入带账号的首页；推荐页加载、主动刷新和进入简历页均可用。已读到推荐页模块及独立入口的替换、实际调用与初始化回调日志 |
| 完整短信登录提交 | 本次发码后的原标签控制连接中断，随后已有登录态可用；未形成从填码、提交到落地页的同一页面连续观察记录，仍待复测 |
| 独立 `/job_detail/` 页面 | v0.1.5 已测试著赫电子 MES 职位，标题、职责与要求可读，持续观察超过 2 分钟未自动退回；确认独立入口及初始化回调实际执行。其他独立详情页仍待验证 |
| Chrome 开发者工具、其他 CDP 调试工具 | 兼容目标，尚未单独验证 |
| GPT 等浏览器代理 | 兼容目标，尚未单独验证 |
| Playwright、Puppeteer 浏览器爬虫 | 已提供加载前注入示例，尚未独立实测 |

聊天页现场实测日期：2026-11-17；在用户当前 Chrome 扩展环境中进行，未隔离其他扩展。检查结合实际页面、会话和输入框状态及初始化日志，不是完整的网络或导航事件录制。测试草稿已清空，没有发送聊天消息。

其他条目的历史现场实测日期：2026-10-24～25。历史实测时同时启用了通用反反调试脚本，因此这些记录不等同于独立运行本脚本的验证结果。

本项目处理执行网页 JavaScript 时的特定反调试问题。纯 HTTP 请求爬虫不执行这些脚本，接入方式和问题范围不同。

## 离线检查

在仓库目录运行 `node tests/verify.cjs`。检查覆盖聊天页启动顺序、原回调和业务代码保留、队列重赋值与重复安装、CSP 拒绝及旧入口回归。测试使用会主动抛错的安全检测器替身，不执行下载的原始检测器函数体；离线通过不能代替现场稳定性验证。

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
- [聊天页实际加载的启动主包与内嵌检测调用](https://static.zhipin.com/fe-zhipin-geek/web/chat-new/v5580/static/js/app.7be55fb7.js)
- [Playwright 初始化脚本接口](https://playwright.dev/docs/api/class-browsercontext#browser-context-add-init-script)
- [Puppeteer 初始化脚本接口](https://pptr.dev/api/puppeteer.page.evaluateonnewdocument)
- [Greasy Fork 元信息与更新地址说明](https://greasyfork.org/zh-CN/help/meta-keys)

## 友链

- [LINUX DO 社区](https://linux.do/)
