// ==UserScript==
// @name         BOSS 防刷新
// @name:en      BOSS Anti Refresh
// @namespace    https://github.com/creamtea47/boss-anti-refresh
// @version      0.1.5
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

  const win = window;
  if (win.top !== win || win.location.protocol !== 'https:' ||
      win.location.hostname !== 'www.zhipin.com') return;
  const version = '0.1.5';
  const queueNames = ['webpackJsonp', 'webpackChunkfe_web_sign', 'webpackChunkgeek'];
  const marker = '__bossAntiRefreshQueueV2';
  const apply = Reflect.apply;
  const getOwnDescriptor = Object.getOwnPropertyDescriptor;
  const define = Object.defineProperty;
  const ownKeys = Object.keys;
  const isArray = Array.isArray;
  const functionSource = Function.prototype.toString;
  const wrappedQueues = new WeakSet();
  const replacements = new WeakMap();
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
