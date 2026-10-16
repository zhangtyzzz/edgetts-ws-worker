// 火山翻译 TTS 引擎的纯函数测试：路由判定、响应解析、音色表完整性。
// 协议本身（langdetect / crx tts）属于上游集成，不在单测范围。
// Run with: node --test test/unit/volc-engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../../src/worker.js';

const { resolveEngine, parseVolcResponse, VOLC_VOICES, VOLC_DEFAULT_VOICE } = __test__;

// ---------------------------------------------------------------- resolveEngine

test('resolveEngine: model 显式指定火山', () => {
  assert.equal(resolveEngine('volc', undefined), 'volc');
  assert.equal(resolveEngine('volc-tts', 'zh-CN-XiaoxiaoNeural'), 'volc');
  assert.equal(resolveEngine('VOLC-TTS-1', undefined), 'volc');
  // 前缀匹配只认 volc-tts 系，不能吞掉无关模型名
  assert.equal(resolveEngine('volcano-model-x', undefined), 'edge');
});

test('resolveEngine: voice 精确命中火山音色名', () => {
  assert.equal(resolveEngine('tts-1', 'zh_female_sichuan'), 'volc');
  assert.equal(resolveEngine(undefined, 'jp_female_hana'), 'volc');
});

test('resolveEngine: 其余一律 edge，保持存量调用方行为不变', () => {
  assert.equal(resolveEngine('tts-1', 'zh-CN-XiaoxiaoNeural'), 'edge');
  assert.equal(resolveEngine('tts-1-hd', 'alloy'), 'edge');
  assert.equal(resolveEngine('tts-1', undefined), 'edge');
  assert.equal(resolveEngine(undefined, undefined), 'edge');
});

test('resolveEngine: 相似但不相等的音色名不得误判（前缀/后缀注入）', () => {
  assert.equal(resolveEngine('tts-1', 'zh_female_sichuan_evil'), 'edge');
  assert.equal(resolveEngine('tts-1', 'xx_zh_female_sichuan'), 'edge');
  // 原型链上的属性名（hasOwnProperty/constructor）不算火山音色
  assert.equal(resolveEngine('tts-1', 'hasOwnProperty'), 'edge');
});

// ---------------------------------------------------------------- parseVolcResponse

test('parseVolcResponse: 成功路径返回 base64 数据', () => {
  const r = parseVolcResponse({ audio: { data: 'AAAA', duration: 3 }, base_resp: { status_code: 0, status_message: '' } });
  assert.equal(r.ok, true);
  assert.equal(r.data, 'AAAA');
});

test('parseVolcResponse: 上游业务错误码原样透出', () => {
  const r = parseVolcResponse({ base_resp: { status_code: 1000, status_message: '限流' } });
  assert.equal(r.ok, false);
  assert.equal(r.errCode, '1000');
  assert.match(r.errMsg, /限流/);
});

test('parseVolcResponse: 空音频与垃圾输入都判失败', () => {
  assert.equal(parseVolcResponse({ audio: { data: '' }, base_resp: { status_code: 0 } }).ok, false);
  assert.equal(parseVolcResponse({ audio: {}, base_resp: { status_code: 0 } }).ok, false);
  // 无 base_resp 字段（上游格式漂移）不应当成成功
  assert.equal(parseVolcResponse({ audio: { data: 'AA' } }).ok, true);
  assert.equal(parseVolcResponse(null).ok, false);
  assert.equal(parseVolcResponse('string').ok, false);
  assert.equal(parseVolcResponse(undefined).ok, false);
});

// ---------------------------------------------------------------- VOLC_VOICES

test('VOLC_VOICES: 10 个音色，字段完整、命名规整', () => {
  const keys = Object.keys(VOLC_VOICES);
  assert.equal(keys.length, 10);
  for (const k of keys) {
    const v = VOLC_VOICES[k];
    assert.ok(v.label, `${k} 缺 label`);
    assert.ok(['zh', 'en', 'ja'].includes(v.language), `${k} language 非法: ${v.language}`);
    assert.ok(['Female', 'Male'].includes(v.gender), `${k} gender 非法`);
    // 命名约定：<lang>_<gender>_<name>，全小写 —— 带下划线也是与 edge 音色天然区分的依据
    assert.match(k, /^(zh|en|jp)_(fe)?male_[a-z]+$/, `${k} 命名不合规`);
    // language 前缀与音色名一致（jp 音色的 language 是 ja —— 火山用 jp、ISO 用 ja，允许这个差异）
    assert.ok(k.startsWith(v.language) || k.startsWith('jp'), `${k} 与 language=${v.language} 不匹配`);
  }
  // 默认音色必须在表内
  assert.ok(Object.hasOwn(VOLC_VOICES, VOLC_DEFAULT_VOICE));
});
