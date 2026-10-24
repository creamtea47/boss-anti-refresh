// ==UserScript==
// @name         BOSS 防刷新
// @name:en      BOSS Anti Refresh
// @namespace    https://github.com/creamtea47/boss-anti-refresh
// @version      0.1.3
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

  // Reviewed 2026-10-24: SSR module 309 and sign-in module 6906.
  // These builds use different chunk queues and named exports (a / X).
  // The SSR caller also checks an initialization callback counter.
  // Preserve that callback and replace only the fingerprinted detector.

  const win = window;
  if (win.top !== win || win.location.protocol !== 'https:' ||
      win.location.hostname !== 'www.zhipin.com') return;
  const version = '0.1.3';
  const queueNames = ['webpackJsonp', 'webpackChunkfe_web_sign'];
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
    return source.includes('parent.__xbcw') &&
      source.includes('largeObjectArray') &&
      source.includes('__defineGetter__') &&
      source.includes('Unable to obtain information') &&
      source.includes('new Array(1e9)');
  }

  function makeReplacement() {
    return function bossReviewedDetectorReplacement(module, exports) {
      function initialize(options, callback) {
        if (!options || !options.appName) return undefined;
        // Required by ef5591c.js: ie() increments ne before ae(store.state).
        if (typeof callback === 'function') {
          try { callback(); } catch (_) {}
        }
        return { success: true, reason: '', check: () => true };
      }

      // Direct definitions work with both reviewed Webpack runtimes, whose
      // require.d helpers accept incompatible argument shapes.
      for (const name of ['a', 'X']) {
        define(exports, name, { enumerable: true, get: () => initialize });
      }
    };
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
})();
