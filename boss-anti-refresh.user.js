// ==UserScript==
// @name         BOSS 防刷新
// @name:en      BOSS Anti Refresh
// @namespace    https://github.com/creamtea47/boss-anti-refresh
// @version      0.1.6
// @description  在 BOSS 全站运行，面向浏览器爬虫、自动化与调试场景，定向处理已识别反调试模块引发的刷新、后退和空白。
// @description:en Runs across BOSS pages to target refresh, back navigation and blank pages caused by the recognized anti-debugging module.
// @author       creamtea47
// @license      Copyright 2026 creamtea47
// @homepageURL  https://github.com/creamtea47/boss-anti-refresh
// @supportURL   https://github.com/creamtea47/boss-anti-refresh/issues
// @updateURL    https://raw.githubusercontent.com/creamtea47/boss-anti-refresh/main/boss-anti-refresh.user.js
// @downloadURL  https://raw.githubusercontent.com/creamtea47/boss-anti-refresh/main/boss-anti-refresh.user.js
// @match        https://www.zhipin.com/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  // Reviewed 2026-10-24/25: SSR 309, sign-in 6906, geek SPA 54294,
  // and the standalone geek-seo v5447 Sign.encryptPwd detector.
  // These builds use different chunk queues and exports (a / X / noDebug).
  // SSR and geek callers also check an initialization callback handshake.
  // Preserve that callback and replace only the fingerprinted detector.
  // Reviewed 2026-11-17: chat-new v5580 embeds the detector in its App
  // factory. Capture its initial module table before the entry runs and
  // replace only that detector call, never the complete application module.

  const win = window;
  if (win.top !== win || win.location.protocol !== 'https:' ||
      win.location.hostname !== 'www.zhipin.com') return;
  const version = '0.1.6';
  const chatQueueName = 'webpackChunkGeekChat';
  const queueNames = ['webpackJsonp', 'webpackChunkfe_web_sign', 'webpackChunkgeek', chatQueueName];
  const marker = '__bossAntiRefreshQueueV2';
  const apply = Reflect.apply;
  const getOwnDescriptor = Object.getOwnPropertyDescriptor;
  const define = Object.defineProperty;
  const ownKeys = Object.keys;
  const isArray = Array.isArray;
  const functionSource = Function.prototype.toString;
  const wrappedQueues = new WeakSet();
  const replacements = new WeakMap();
  const chatReplacements = new WeakSet();
  const compileFunction = Function;
  const logInfo = win.console && win.console.info;
  const logWarn = win.console && win.console.warn;

  function report(message, warning = false) {
    try {
      const fn = warning ? logWarn : logInfo;
      if (typeof fn === 'function') {
        apply(fn, win.console, ['[BOSS 定向防跳转] v' + version + ' ' + message]);
      }
    } catch (_) {}
  }

  function matchesReviewedDetector(factory) {
    if (typeof factory !== 'function') return false;
    let source;
    try {
      source = apply(functionSource, factory, []);
    } catch (_) {
      return false;
    }
    // Independent signatures from the reviewed anti-DevTools module.
    // A changed or unrelated module is left alone when a signature is missing.
    const common = source.includes('largeObjectArray') &&
      source.includes('__defineGetter__') &&
      source.includes('Unable to obtain information') &&
      /\b(?:new\s+)?Array\s*\(\s*1e9\s*\)/.test(source);
    const legacyFrame = source.includes('parent.__xbcw');
    const geekFrame = source.includes('createElement("iframe")') &&
      source.includes('.contentWindow') && source.includes('noDebug:');
    return common && (legacyFrame || geekFrame);
  }

  function makeReplacement() {
    return function bossReviewedDetectorReplacement(module, exports) {
      let initialized = false;
      function initialize(options, callback) {
        if (!options || !options.appName) return undefined;
        // Required by ef5591c.js: ie() increments ne before ae(store.state).
        if (typeof callback === 'function') {
          try { callback(); } catch (_) {}
        }
        if (!initialized) {
          initialized = true;
          report('已执行模块初始化替代实现；' +
            (typeof callback === 'function' ? '已调用原初始化回调。' : '调用方未传初始化回调。'));
        }
        return { success: true, reason: '', check: () => true };
      }

      // Direct definitions work with both reviewed Webpack runtimes, whose
      // require.d helpers accept incompatible argument shapes.
      for (const name of ['a', 'X', 'noDebug']) {
        define(exports, name, { enumerable: true, get: () => initialize });
      }
    };
  }

  function reviewedChatCall(factory) {
    if (typeof factory !== 'function' || chatReplacements.has(factory) ||
        !matchesReviewedDetector(factory)) return null;
    let source;
    try { source = apply(functionSource, factory, []); }
    catch (_) { return null; }
    // This is a reviewed application factory, not a detector-only module.
    // Both the callback declaration and its subsequent guard must agree.
    if (!source.includes('getABData("nd_result_13912_number_1")') ||
        source.includes('__bossAntiRefreshChatInitializeV1') ||
        /\b(?:__webpack_require__|__WEBPACK_EXTERNAL_MODULE_\w*)\b/.test(source)) return null;
    const calls = [...source.matchAll(/([A-Za-z_$][\w$]*)\s*\(\s*\{\s*env\s*:\s*"prod"\s*,\s*appName\s*:\s*"fe-geek-chat"\s*\}\s*,\s*([A-Za-z_$][\w$]*)\.cb\s*\)/g)];
    if (calls.length !== 1) return null;
    const call = calls[0];
    if (call.index > 0 && /[\w$.]/.test(source[call.index - 1])) return null;
    const state = call[2].replace(/[$]/g, '\\$');
    const handshake = new RegExp('\\b(?:var|let|const)\\s+' + state +
      '\\s*=\\s*\\{\\s*sta\\s*:\\s*"XSd"\\s*,\\s*cb\\s*:\\s*function\\s*\\(\\s*\\)\\s*\\{\\s*' +
      state + '\\.sta\\s*=\\s*"sd"\\s*;?\\s*\\}\\s*\\}');
    const guard = new RegExp('"sd"\\s*!==\\s*' + state + '\\.sta\\s*&&\\s*function\\s*\\(');
    if (!handshake.test(source) || !guard.test(source)) return null;
    return { source, start: call.index, nameLength: call[1].length };
  }

  function inspectChatModules(modules, initial = false) {
    if (!modules || typeof modules !== 'object') return;
    const candidates = [];
    for (const id of ownKeys(modules)) {
      const descriptor = getOwnDescriptor(modules, id);
      if (!descriptor || !('value' in descriptor)) continue;
      const match = reviewedChatCall(descriptor.value);
      if (match) candidates.push({ id, descriptor, match });
    }
    if (candidates.length !== 1) {
      if (initial || candidates.length > 1) {
        report(candidates.length > 1 ? '聊天页入口匹配不唯一，保留原模块，未生效。' :
          '未识别到已审查的聊天页启动入口；保留原模块，未生效。', true);
      }
      return;
    }
    const { id, descriptor, match } = candidates[0];
    const helperName = '__bossAntiRefreshChatInitializeV1';
    const changedSource = match.source.slice(0, match.start) + helperName +
      match.source.slice(match.start + match.nameLength);
    let initialized = false;
    function initialize(options, callback) {
      if (!options || options.appName !== 'fe-geek-chat' || typeof callback !== 'function') {
        report('聊天页原初始化回调缺失，未完成初始化标记。', true);
        return undefined;
      }
      // The reviewed caller checks its own sta === "sd" immediately after
      // this call. Invoke its actual callback rather than forge that marker.
      callback();
      if (!initialized) {
        initialized = true;
        report('已执行聊天页替代实现，原初始化回调已执行。');
      }
      return { success: true, reason: '', check: () => true };
    }
    try {
      // The reviewed factory takes its imports through its three Webpack
      // parameters. Rebuild that factory in the page realm, preserving its
      // business code and binding only the replacement initializer.
      const build = compileFunction(helperName, '"use strict";return (' + changedSource + '\n);');
      const replacement = build(initialize);
      if (typeof replacement !== 'function') throw new TypeError('Invalid chat factory');
      define(modules, id, { ...descriptor, value: replacement });
      chatReplacements.add(replacement);
      report('已识别并替换聊天页启动入口 ' + id + '；仅替换检测调用，保留原初始化回调与聊天业务。');
    } catch (_) {
      report('聊天页入口无法重建或改写（可能受页面 CSP 限制）；保留原模块，未生效。', true);
    }
  }

  function captureChatRuntime(require) {
    try {
      if (typeof require !== 'function' || !require.m || typeof require.m !== 'object') {
        report('聊天页启动模块表不可用，未生效。', true);
        return;
      }
      inspectChatModules(require.m, true);
    } catch (_) {
      report('聊天页启动模块检查失败；保留原模块，未生效。', true);
    }
  }

  function inspectStandaloneSign(sign) {
    if (!sign || typeof sign !== 'object') return sign;
    const descriptor = getOwnDescriptor(sign, 'encryptPwd');
    if (!descriptor || !('value' in descriptor) ||
        !matchesReviewedDetector(descriptor.value)) return sign;
    let source;
    try { source = apply(functionSource, descriptor.value, []); }
    catch (_) { return sign; }
    // This misleadingly named method contains the reviewed standalone
    // detector, not the SMS/password submission or encryption implementation.
    if (!source.includes('appName:"zhipin_web_geek_jsp_web"') ||
        !source.includes('window.Detail.initDg()')) return sign;

    let initialized = false;
    function bossReviewedStandaloneDetectorReplacement() {
      const detail = win.Detail;
      if (!detail || typeof detail.initDg !== 'function') {
        report('独立页面初始化回调缺失，未完成初始化标记。', true);
        return;
      }
      try {
        // The tail of main.js checks Detail.dgTag === Sign.pwdDetail.
        // Calling the original callback satisfies that check without changing
        // login methods, token handling, agreement checks or captcha logic.
        apply(detail.initDg, detail, []);
        if (!initialized) {
          initialized = true;
          report('已执行 Sign.encryptPwd 替代实现，并调用 Detail.initDg 初始化回调。');
        }
      } catch (_) {
        report('独立页面初始化回调失败，未完成初始化标记。', true);
      }
    }
    try {
      define(sign, 'encryptPwd', { ...descriptor, value: bossReviewedStandaloneDetectorReplacement });
      report('已识别并替换独立页面反调试入口 Sign.encryptPwd；保留 Detail.initDg 初始化回调。');
    } catch (_) {
      report('独立页面 Sign.encryptPwd 不可改写，未生效。', true);
    }
    return sign;
  }

  function installStandaloneSign() {
    const key = 'Sign';
    const signMarker = '__bossAntiRefreshSignV1';
    try {
      const original = getOwnDescriptor(win, key);
      if (original && original.get && original.get[signMarker]) return;
      if (original && !('value' in original)) {
        report('已有 Sign 访问器，未覆盖独立页面入口。', true);
        return;
      }
      if (original && !original.configurable) {
        inspectStandaloneSign(original.value);
        report('Sign 不可重新定义，无法监听后续赋值。', true);
        return;
      }
      let current = inspectStandaloneSign(original ? original.value : undefined);
      const readSign = () => current;
      define(readSign, signMarker, { value: true });
      define(win, key, {
        configurable: true,
        enumerable: original ? original.enumerable : true,
        get: readSign,
        set: (value) => { current = inspectStandaloneSign(value); }
      });
      report('独立页面 Sign 入口已就绪，等待识别目标函数。');
    } catch (_) {
      report('独立页面 Sign 入口初始化失败，未生效。', true);
    }
  }

  function inspectPayload(payload, queueName) {
    if (!isArray(payload)) return;
    const modules = payload[1];
    if (!modules || typeof modules !== 'object') return;
    if (queueName === chatQueueName) {
      inspectChatModules(modules);
      return;
    }

    for (const id of ownKeys(modules)) {
      const descriptor = getOwnDescriptor(modules, id);
      if (!descriptor || !('value' in descriptor)) continue;
      const factory = descriptor.value;
      if (!matchesReviewedDetector(factory)) continue;

      let replacement = replacements.get(factory);
      if (!replacement) {
        replacement = makeReplacement();
        replacements.set(factory, replacement);
      }
      try {
        define(modules, id, { ...descriptor, value: replacement });
        report('已识别并替换反调试模块 ' + id + '（' + queueName + '）；保留初始化回调。');
      } catch (_) {
        report('模块 ' + id + ' 不可改写，未生效。', true);
      }
    }
  }

  function hookQueue(queue, queueName) {
    if (!isArray(queue) || wrappedQueues.has(queue)) return queue;
    const pushDescriptor = getOwnDescriptor(queue, 'push');
    if (pushDescriptor && !pushDescriptor.configurable) {
      report('队列 push 不可改写，未生效。', true);
      return queue;
    }

    // Queued chunks are processed before Webpack starts consuming them.
    for (let i = 0; i < queue.length; i++) inspectPayload(queue[i], queueName);
    let currentPush = queue.push;

    function wrapPush(delegate) {
      if (typeof delegate !== 'function') return delegate;
      // Each wrapper captures its own delegate. Webpack retains the previous
      // push as its parent callback; changing a shared delegate would recurse.
      return function bossGuardedChunkPush(...payloads) {
        for (const payload of payloads) inspectPayload(payload, queueName);
        return apply(delegate, this, payloads);
      };
    }

    currentPush = wrapPush(currentPush);
    try {
      define(queue, 'push', {
        configurable: true,
        enumerable: pushDescriptor ? pushDescriptor.enumerable : false,
        get: () => currentPush,
        set: (nextPush) => { currentPush = wrapPush(nextPush); }
      });
      wrappedQueues.add(queue);
      if (queueName === chatQueueName) {
        // Webpack consumes queued runtime callbacks before requiring its
        // initial entry. A unique Symbol avoids colliding with real chunk
        // IDs; this payload registers no modules and requests no download.
        apply(currentPush, queue, [[[Symbol('bossAntiRefreshChatBootstrap')], {}, captureChatRuntime]]);
      }
    } catch (_) {
      report('无法安装队列钩子，未生效。', true);
    }
    return queue;
  }

  function installQueue(key) {
    try {
      const original = getOwnDescriptor(win, key);
      if (original && original.get && original.get[marker]) return;
      if (original && !original.configurable) {
        report(key + ' 不可改写，未生效。', true);
        return;
      }

      let queue = hookQueue(original ? win[key] : [], key);
      const readQueue = () => queue;
      define(readQueue, marker, { value: true });
      define(win, key, {
        configurable: true,
        enumerable: original ? original.enumerable : true,
        get: readQueue,
        set: (nextQueue) => { queue = hookQueue(nextQueue, key); }
      });
      report(key + ' 已就绪，等待识别目标模块；须整页刷新后生效。');
    } catch (_) {
      report(key + ' 初始化失败，未生效。', true);
    }
  }

  for (const key of queueNames) installQueue(key);
  installStandaloneSign();
})();
