'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'boss-anti-refresh.user.js'), 'utf8');
const chatQueue = 'webpackChunkGeekChat';
let passed = 0;
function test(name, check) {
  check();
  console.log('PASS:', name);
  passed++;
}
function environment({ url = 'https://www.zhipin.com/web/geek/chat', framed = false,
  queue, denyCompilation = false } = {}) {
  const logs = [];
  const window = { location: new URL(url), console: { info: s => logs.push(s), warn: s => logs.push(s) } };
  window.top = framed ? {} : window;
  if (queue) window[chatQueue] = queue;
  const context = vm.createContext({ window, self: window });
  if (denyCompilation) vm.runInContext(`
    const NativeFunction = Function;
    function deniedFunction() { throw new EvalError('CSP: unsafe-eval is disabled'); }
    deniedFunction.prototype = NativeFunction.prototype;
    Function = deniedFunction;
  `, context);
  new vm.Script(source).runInContext(context, { timeout: 1000 });
  return { window, context, logs };
}

// These are inert test fixtures. Their detector bodies throw if mistakenly
// executed; the real downloaded detector is never run by these tests.
const chatFactoryText = `function(module,exports,require){
  "use strict";
  /* largeObjectArray __defineGetter__ Unable to obtain information
     parent.__xbcw Array(1e9) */
  void 'getABData("nd_result_13912_number_1")';
  var jr=function(){throw new Error("Original detector must not run")};
  var Tr={sta:"XSd",cb:function(){Tr.sta="sd"}};
  var result=jr({env:"prod",appName:"fe-geek-chat"},Tr.cb);
  "sd"!==Tr.sta&&function(){throw new Error("Memory-pressure branch must not run")}();
  module.exports={business:require("dep"),marker:Tr.sta,result:result,receiver:this===exports};
}`;
const legacyFactoryText = `function(module,exports,require){
  /* largeObjectArray __defineGetter__ Unable to obtain information
     parent.__xbcw Array(1e9) */
  throw new Error("Original detector must not run");
}`;
function factory(text, context) {
  return new vm.Script('(' + text + ')').runInContext(context, { timeout: 1000 });
}
function initialModules(env, text = chatFactoryText, id = 'renumberedRoot') {
  return { [id]: factory(text, env.context), dep(module) { module.exports = 'chat business intact'; } };
}
function runtime(env, modules, queue = env.window[chatQueue]) {
  const cache = Object.create(null);
  const states = Object.create(null);
  let registrations = 0;
  function require(id) {
    if (cache[id]) return cache[id].exports;
    const module = cache[id] = { exports: {} };
    modules[id].call(module.exports, module, module.exports, require);
    return module.exports;
  }
  require.m = modules;
  // Mirror the reviewed Webpack startup ordering: queued callbacks are
  // consumed before push is replaced and before the initial entry executes.
  function register(parent, data) {
    const [ids, additions, callback] = data;
    if (ids.some(id => states[id] !== 0)) {
      for (const id of Object.keys(additions)) modules[id] = additions[id];
      if (callback) callback(require);
      registrations++;
    }
    if (parent) parent(data);
    for (const id of ids) states[id] = 0;
  }
  queue.forEach(register.bind(null, null));
  queue.push = register.bind(null, queue.push.bind(queue));
  return { require, get registrations() { return registrations; } };
}
function assertLegacyReplacement(replacement, original) {
  assert.notEqual(replacement, original);
  const exports = {};
  replacement({}, exports, () => { throw new Error('Original imports must not run'); });
  for (const key of ['a', 'X', 'noDebug']) assert.equal(typeof exports[key], 'function');
  let initialized = 0;
  const result = exports.a({ appName: 'reviewed' }, () => initialized++);
  assert.equal(initialized, 1);
  assert.equal(result.success, true);
  assert.equal(result.reason, '');
  assert.equal(result.check(), true);
}

test('chat factory is patched before the entry runs; business, receiver and handshake survive', () => {
  const env = environment();
  const modules = initialModules(env);
  const original = modules.renumberedRoot;
  const rt = runtime(env, modules);
  assert.notEqual(modules.renumberedRoot, original);
  const result = rt.require('renumberedRoot');
  assert.equal(result.business, 'chat business intact');
  assert.equal(result.marker, 'sd');
  assert.equal(result.receiver, true);
  assert.equal(result.result.success, true);
  assert.equal(result.result.check(), true);
  assert(env.logs.some(s => s.includes('原初始化回调已执行')));
});

test('chat patch changes only the reviewed call identifier', () => {
  const env = environment();
  const modules = initialModules(env);
  runtime(env, modules);
  assert.equal(modules.renumberedRoot.toString(), chatFactoryText.replace(
    'jr({env:"prod",appName:"fe-geek-chat"},Tr.cb)',
    '__bossAntiRefreshChatInitializeV1({env:"prod",appName:"fe-geek-chat"},Tr.cb)'));
});

test('minified identifiers and module numbers are not hardcoded', () => {
  const env = environment();
  const renamed = chatFactoryText.replace(/\bjr\b/g, '$detect').replace(/\bTr\b/g, '$state');
  const modules = initialModules(env, renamed, '123456');
  assert.equal(runtime(env, modules).require('123456').marker, 'sd');
});

test('repeated installation does not seed duplicate bootstraps', () => {
  const env = environment();
  const queue = env.window[chatQueue];
  const getter = Object.getOwnPropertyDescriptor(env.window, chatQueue).get;
  assert.equal(queue.length, 1);
  new vm.Script(source).runInContext(env.context, { timeout: 1000 });
  assert.equal(queue.length, 1);
  assert.equal(Object.getOwnPropertyDescriptor(env.window, chatQueue).get, getter);
});

test('a reassigned chat queue is seeded before Webpack startup', () => {
  const env = environment();
  const queue = [];
  env.window[chatQueue] = queue;
  assert.equal(queue.length, 1);
  const modules = initialModules(env);
  assert.equal(runtime(env, modules, queue).require('renumberedRoot').marker, 'sd');
});

test('subsequent chunks keep their original Webpack push without recursion', () => {
  const env = environment();
  const rt = runtime(env, initialModules(env));
  env.window[chatQueue].push([[901], { lazy(module) { module.exports = 'lazy business intact'; } }]);
  assert.equal(rt.registrations, 2);
  assert.equal(rt.require('lazy'), 'lazy business intact');
});

test('a uniquely reviewed application in a later chunk is not replaced wholesale', () => {
  const env = environment();
  const rt = runtime(env, {});
  const modules = initialModules(env);
  env.window[chatQueue].push([[902], modules]);
  assert.equal(rt.require('renumberedRoot').business, 'chat business intact');
});

test('two matching chat applications leave both factories intact', () => {
  const env = environment();
  const a = factory(chatFactoryText, env.context), b = factory(chatFactoryText, env.context);
  const modules = { a, b };
  runtime(env, modules);
  assert.equal(modules.a, a); assert.equal(modules.b, b);
  assert(env.logs.some(s => s.includes('匹配不唯一')));
});

test('missing fingerprint, callback declaration or subsequent guard fails closed', () => {
  for (const text of [
    chatFactoryText.replace('largeObjectArray', 'differentArray'),
    chatFactoryText.replace('parent.__xbcw', 'differentFrame'),
    chatFactoryText.replace('Tr.sta="sd"', 'Tr.sta="different"'),
    chatFactoryText.replace('"sd"!==Tr.sta', '"different"!==Tr.sta'),
    chatFactoryText.replace('nd_result_13912_number_1', 'differentExperiment')
  ]) {
    const env = environment();
    const modules = initialModules(env, text), original = modules.renumberedRoot;
    runtime(env, modules);
    assert.equal(modules.renumberedRoot, original);
    assert(!env.logs.some(s => s.includes('已识别并替换聊天页')));
  }
});

test('multiple matching calls and unsafe external lexical references are rejected', () => {
  for (const text of [
    chatFactoryText.replace('var result=', 'jr({env:"prod",appName:"fe-geek-chat"},Tr.cb);var result='),
    chatFactoryText.replace('var result=', 'void __WEBPACK_EXTERNAL_MODULE__1__;var result=')
  ]) {
    const env = environment();
    const modules = initialModules(env, text), original = modules.renumberedRoot;
    runtime(env, modules);
    assert.equal(modules.renumberedRoot, original);
  }
});

test('CSP compilation denial leaves the original factory and reports failure', () => {
  const env = environment({ denyCompilation: true });
  const modules = initialModules(env), original = modules.renumberedRoot;
  runtime(env, modules);
  assert.equal(modules.renumberedRoot, original);
  assert(env.logs.some(s => s.includes('CSP')));
  assert(!env.logs.some(s => s.includes('已识别并替换聊天页')));
});

test('locked module tables fail visibly without breaking Webpack startup', () => {
  const env = environment();
  const modules = Object.freeze(initialModules(env)), original = modules.renumberedRoot;
  runtime(env, modules);
  assert.equal(modules.renumberedRoot, original);
  assert(env.logs.some(s => s.includes('无法重建或改写')));
});

test('module getters are not invoked during inspection', () => {
  const env = environment();
  const modules = initialModules(env);
  Object.defineProperty(modules, 'unsafeGetter', { enumerable: true, get() { throw new Error('Getter invoked'); } });
  assert.equal(runtime(env, modules).require('renumberedRoot').marker, 'sd');
});

test('company, sign-in and recommendation detector exports and callbacks still work', () => {
  for (const name of ['webpackJsonp', 'webpackChunkfe_web_sign', 'webpackChunkgeek']) {
    const env = environment();
    const original = factory(legacyFactoryText, env.context);
    const unrelated = function business() { return 42; };
    const data = [[1], { 98765: original, business: unrelated }];
    env.window[name].push(data);
    assertLegacyReplacement(data[1][98765], original);
    assert.equal(data[1].business, unrelated);
    const queue = env.window[name], parent = queue.push.bind(queue);
    let calls = 0;
    queue.push = function(data) { calls++; return parent(data); };
    const next = [[2], { 54321: original }];
    queue.push(next);
    assert.equal(calls, 1);
    assertLegacyReplacement(next[1][54321], original);
  }
});

test('the standalone Sign entry preserves Detail.initDg and unrelated login methods', () => {
  const env = environment();
  let callbacks = 0;
  env.window.Detail = { initDg() { callbacks++; } };
  const original = factory(`function(){
    /* largeObjectArray __defineGetter__ Unable to obtain information parent.__xbcw Array(1e9) */
    var config={appName:"zhipin_web_geek_jsp_web"};
    window.Detail.initDg();
    throw new Error("Original detector must not run");
  }`, env.context);
  const login = () => 'login preserved';
  env.window.Sign = { encryptPwd: original, login };
  assert.notEqual(env.window.Sign.encryptPwd, original);
  env.window.Sign.encryptPwd();
  assert.equal(callbacks, 1);
  assert.equal(env.window.Sign.login, login);
});

test('unrelated origins, HTTP and frames receive no hooks', () => {
  for (const options of [{ url: 'https://example.com/web/geek/chat' },
    { url: 'http://www.zhipin.com/web/geek/chat' }, { framed: true }]) {
    const env = environment(options);
    for (const name of [chatQueue, 'webpackJsonp', 'Sign']) assert(!Object.hasOwn(env.window, name));
  }
});

const fixtureFlag = process.argv.indexOf('--chat-factory');
if (fixtureFlag !== -1) {
  const text = fs.readFileSync(process.argv[fixtureFlag + 1], 'utf8').trim();
  test('real reviewed chat factory compiles and changes only its detector call (body never executed)', () => {
    const env = environment();
    const modules = initialModules(env, text, 'actualBuild');
    const original = modules.actualBuild;
    runtime(env, modules);
    assert.notEqual(modules.actualBuild, original);
    assert.equal(modules.actualBuild.toString(), text.replace(
      'jr({env:"prod",appName:"fe-geek-chat"},Tr.cb)',
      '__bossAntiRefreshChatInitializeV1({env:"prod",appName:"fe-geek-chat"},Tr.cb)'));
    assert(!env.logs.some(s => s.includes('原初始化回调已执行')));
  });
}

console.log(`${passed} verification groups passed. Original downloaded detector bodies were not executed.`);
