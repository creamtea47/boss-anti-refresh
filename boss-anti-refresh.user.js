// ==UserScript==
// @name         BOSS 防刷新
// @name:en      BOSS Anti Refresh
// @namespace    https://github.com/creamtea47/boss-anti-refresh
// @version      0.1.1
// @description  面向浏览器爬虫、自动化与调试场景，定向处理 BOSS 公司职位页的异常刷新、后退和空白。
// @description:en Targeted fix for anti-debugging refresh, back navigation and blank pages on BOSS company job listings.
// @author       creamtea47
// @license      Copyright 2026 creamtea47
// @homepageURL  https://github.com/creamtea47/boss-anti-refresh
// @supportURL   https://github.com/creamtea47/boss-anti-refresh/issues
// @updateURL    https://raw.githubusercontent.com/creamtea47/boss-anti-refresh/main/boss-anti-refresh.user.js
// @downloadURL  https://raw.githubusercontent.com/creamtea47/boss-anti-refresh/main/boss-anti-refresh.user.js
// @match        https://www.zhipin.com/gongsi/*
// @match        https://www.zhipin.com/job_detail/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  // Companion to the generic anti-debugger script. Source reviewed 2026-10-24:
  // zhipin-ssr-site/v5686/client/f30eda7.js, module 309, caller ef5591c.js.
  // The original module's callback increments a counter checked by the caller.
  // Omitting that callback can trigger the caller's memory-pressure branch.
  // Only this module is replaced. Passport, token and verification code stay active.

  const win = window;
  if (win.top !== win || win.location.protocol !== 'https:' ||
      win.location.hostname !== 'www.zhipin.com' ||
      !/^\/(?:gongsi\/|job_detail\/)/.test(win.location.pathname)) return;
  const key = 'webpackJsonp';
  const marker = '__bossSsrDebugGuardV1';
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
        apply(fn, win.console, ['[BOSS 定向防跳转] ' + message]);
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
    return source.includes('parent.__xbcw') &&
      source.includes('largeObjectArray') &&
      source.includes('__defineGetter__') &&
      source.includes('Unable to obtain information') &&
      source.includes('new Array(1e9)');
  }

  function makeReplacement() {
    return function bossReviewedDetectorReplacement(module, exports, webpackRequire) {
      function initialize(options, callback) {
        if (!options || !options.appName) return undefined;
        // Required by ef5591c.js: ie() increments ne before ae(store.state).
        if (typeof callback === 'function') {
          try { callback(); } catch (_) {}
        }
        return { success: true, reason: '', check: () => true };
      }

      if (webpackRequire && typeof webpackRequire.d === 'function') {
        webpackRequire.d(exports, 'a', () => initialize);
      } else {
        define(exports, 'a', { enumerable: true, get: () => initialize });
      }
    };
  }

  function inspectPayload(payload) {
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
        report('已识别并替换反调试模块 ' + id + '；保留初始化回调。');
      } catch (_) {
        report('模块 ' + id + ' 不可改写，未生效。', true);
      }
    }
  }

  function hookQueue(queue) {
    if (!isArray(queue) || wrappedQueues.has(queue)) return queue;
    const pushDescriptor = getOwnDescriptor(queue, 'push');
    if (pushDescriptor && !pushDescriptor.configurable) {
      report('队列 push 不可改写，未生效。', true);
      return queue;
    }

    // Queued chunks are processed before Webpack starts consuming them.
    for (let i = 0; i < queue.length; i++) inspectPayload(queue[i]);
    let currentPush = queue.push;

    function wrapPush(delegate) {
      if (typeof delegate !== 'function') return delegate;
      // Each wrapper captures its own delegate. Webpack retains the previous
      // push as its parent callback; changing a shared delegate would recurse.
      return function bossGuardedChunkPush(...payloads) {
        for (const payload of payloads) inspectPayload(payload);
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

  try {
    const original = getOwnDescriptor(win, key);
    if (original && original.get && original.get[marker]) return;
    if (original && !original.configurable) {
      report('webpackJsonp 不可改写，未生效。', true);
      return;
    }

    let queue = hookQueue(original ? win[key] : []);
    const readQueue = () => queue;
    define(readQueue, marker, { value: true });
    define(win, key, {
      configurable: true,
      enumerable: original ? original.enumerable : true,
      get: readQueue,
      set: (nextQueue) => { queue = hookQueue(nextQueue); }
    });
    report('已就绪，等待识别目标模块；须整页刷新后生效。');
  } catch (_) {
    report('初始化失败，未生效。', true);
  }
})();
