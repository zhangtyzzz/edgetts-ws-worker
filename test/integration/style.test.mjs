// 情绪风格（style / style_degree）的 HTTP 面集成测试：透传进 SSML、非法值拒绝。
// Run with: node --test test/integration/style.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../src/worker.js';
import { installMockFetch, speechRequest } from '../helpers/mock-upstream.mjs';

const ANON = { ALLOW_ANONYMOUS: 'true' };

test('style + style_degree reach upstream SSML as express-as attributes', async () => {
  const mock = installMockFetch({});
  try {
    const res = await worker.fetch(
      speechRequest({
        model: 'tts-1', voice: 'zh-CN-XiaoxiaoMultilingualNeural',
        input: '开心测试', style: 'cheerful', style_degree: 1.5,
      }),
      ANON,
      {}
    );
    assert.equal(res.status, 200);
    const ssml = mock.calls.synthSsml[0];
    assert.ok(ssml.includes('<mstts:express-as style="cheerful" styledegree="1.5">'), ssml.slice(0, 300));
  } finally {
    mock.restore();
  }
});

test('style without style_degree emits no styledegree attribute (upstream default = 1)', async () => {
  const mock = installMockFetch({});
  try {
    const res = await worker.fetch(
      speechRequest({ model: 'tts-1', voice: 'zh-CN-XiaoxiaoNeural', input: 'x', style: 'sad' }),
      ANON, {}
    );
    assert.equal(res.status, 200);
    assert.ok(!mock.calls.synthSsml[0].includes('styledegree'));
  } finally {
    mock.restore();
  }
});

test('invalid style_degree values are 400 invalid_style_degree with param', async () => {
  const mock = installMockFetch({});
  try {
    for (const bad of [0.01, 3, 'abc', null]) {
      const res = await worker.fetch(
        speechRequest({ model: 'tts-1', voice: 'zh-CN-XiaoxiaoNeural', input: 'x', style: 'sad', style_degree: bad }),
        ANON, {}
      );
      assert.equal(res.status, 400, `style_degree=${JSON.stringify(bad)}`);
      const err = (await res.json()).error;
      assert.equal(err.code, 'invalid_style_degree');
      assert.equal(err.param, 'style_degree');
    }
    assert.equal(mock.calls.synth, 0, 'invalid values never reach upstream');
  } finally {
    mock.restore();
  }
});

test('boundary style_degree values are accepted (0.05 and 2)', async () => {
  const mock = installMockFetch({});
  try {
    for (const d of [0.05, 2]) {
      const res = await worker.fetch(
        speechRequest({ model: 'tts-1', voice: 'zh-CN-XiaoxiaoNeural', input: 'x', style: 'sad', style_degree: d }),
        ANON, {}
      );
      assert.equal(res.status, 200, `style_degree=${d}`);
      assert.ok(mock.calls.synthSsml.at(-1).includes(`styledegree="${d}"`));
    }
  } finally {
    mock.restore();
  }
});

test('volc engine ignores style/style_degree silently (upstream has no such params)', async () => {
  const mock = installMockFetch({});
  try {
    const res = await worker.fetch(
      speechRequest({ model: 'volc-tts', input: 'x', voice: 'zh_female_qingxin', style: 'cheerful', style_degree: 2 }),
      ANON, {}
    );
    assert.equal(res.status, 200);
    assert.equal(mock.calls.volcTts, 1);
    // 火山请求体只有 text/speaker/language
    assert.deepEqual(Object.keys(mock.calls.volcBodies[0]).sort(), ['language', 'speaker', 'text']);
  } finally {
    mock.restore();
  }
});
