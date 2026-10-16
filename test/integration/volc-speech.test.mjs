// 火山翻译 TTS 引擎的 HTTP 面集成测试：路由、参数校验、分块并发、上游错误映射。
// 上游（translate.volcengine.com）由 mock-upstream 拦截，全程离线确定性。
// Run with: node --test test/integration/volc-speech.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../src/worker.js';
import { installMockFetch, speechRequest, fakeAudio } from '../helpers/mock-upstream.mjs';

const ANON = { ALLOW_ANONYMOUS: 'true' };
// fakeAudio(100) 是 4800 字节；volc mock 把它 base64 后回传，解回来应等长
const CHUNK_BYTES = fakeAudio(100).length;

test('model=volc-tts routes to the volc engine and returns mp3', async () => {
  const mock = installMockFetch({});
  try {
    const res = await worker.fetch(
      speechRequest({ model: 'volc-tts', input: '你好，火山', voice: 'zh_female_sichuan' }),
      ANON,
      {}
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'audio/mpeg');
    assert.equal((await res.arrayBuffer()).byteLength, CHUNK_BYTES);
    assert.equal(mock.calls.volcDetect, 1, 'langdetect exactly once per request');
    assert.equal(mock.calls.volcTts, 1);
    // langdetect 的 language 应透传给合成端
    assert.equal(mock.calls.volcBodies[0].language, 'zh');
    assert.equal(mock.calls.volcBodies[0].speaker, 'zh_female_sichuan');
  } finally {
    mock.restore();
  }
});

test('a volc voice name routes without an explicit model', async () => {
  const mock = installMockFetch({});
  try {
    const res = await worker.fetch(
      speechRequest({ input: '按音色名路由', voice: 'jp_female_hana' }),
      ANON,
      {}
    );
    assert.equal(res.status, 200);
    assert.equal(mock.calls.volcTts, 1);
    assert.equal(mock.calls.token, 0, 'must NOT touch the Microsoft token endpoint');
  } finally {
    mock.restore();
  }
});

test('omitting response_format defaults to mp3 (regression: was rejected as undefined)', async () => {
  const mock = installMockFetch({});
  try {
    const res = await worker.fetch(
      speechRequest({ model: 'volc', input: '省略格式', voice: 'zh_male_zhubo' }),
      ANON,
      {}
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('Content-Type'), 'audio/mpeg');
  } finally {
    mock.restore();
  }
});

test('non-mp3 response_format and unknown voices are 400 with clear codes', async () => {
  const mock = installMockFetch({});
  try {
    const badFormat = await worker.fetch(
      speechRequest({ model: 'volc-tts', input: 'x', voice: 'zh_female_qingxin', response_format: 'opus' }),
      ANON,
      {}
    );
    assert.equal(badFormat.status, 400);
    assert.match((await badFormat.json()).error.code, /invalid_response_format/);

    const badVoice = await worker.fetch(
      speechRequest({ model: 'volc-tts', input: 'x', voice: 'zh_female_sichuan_evil' }),
      ANON,
      {}
    );
    assert.equal(badVoice.status, 400);
    const errBody = await badVoice.json();
    assert.equal(errBody.error.code, 'invalid_voice');
    assert.match(errBody.error.message, /zh_female_sichuan/, 'error lists valid voices');
    assert.equal(mock.calls.volcTts, 0, 'invalid input never reaches upstream');
  } finally {
    mock.restore();
  }
});

test('long text is chunked, synthesized concurrently, and concatenated', async () => {
  const mock = installMockFetch({});
  try {
    // 700 字按默认 chunk_size=300 切 3 块
    const text = '火'.repeat(700);
    const res = await worker.fetch(
      speechRequest({ model: 'volc-tts', input: text, voice: 'zh_female_story' }),
      ANON,
      {}
    );
    assert.equal(res.status, 200);
    assert.equal(mock.calls.volcTts, 3, 'three chunks, one langdetect');
    assert.equal((await res.arrayBuffer()).byteLength, CHUNK_BYTES * 3, 'mp3 frames concatenated');
    for (const b of mock.calls.volcBodies) {
      assert.ok(b.text.length <= 300, 'no chunk exceeds chunk_size');
    }
  } finally {
    mock.restore();
  }
});

test('stream:true streams mp3 chunks progressively through the shared pipeline', async () => {
  const mock = installMockFetch({});
  try {
    const text = '山'.repeat(700); // 3 chunks @ default 300
    const res = await worker.fetch(
      speechRequest({ model: 'volc-tts', input: text, voice: 'zh_female_story', stream: true }),
      ANON,
      {}
    );
    assert.equal(res.status, 200);
    // mp3 流式的响应头就是 audio/mpeg（区别于 edge 流式的 audio/pcm）
    assert.equal(res.headers.get('Content-Type'), 'audio/mpeg');
    assert.equal((await res.arrayBuffer()).byteLength, CHUNK_BYTES * 3, 'concatenated chunk bytes');
    assert.equal(mock.calls.volcTts, 3);
    assert.equal(mock.calls.volcDetect, 1, 'langdetect still once');
  } finally {
    mock.restore();
  }
});

test('upstream business error maps to a 400 carrying the volc code; HTTP 5xx retries once', async () => {
  // 业务错误：base_resp.status_code != 0
  let mock = installMockFetch({
    volcSynth: () =>
      new Response(JSON.stringify({ base_resp: { status_code: 1200, status_message: '音色不存在' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  try {
    const res = await worker.fetch(
      speechRequest({ model: 'volc-tts', input: 'x', voice: 'zh_female_qingxin' }),
      ANON,
      {}
    );
    assert.equal(res.status, 400);
    const msg = (await res.json()).error.message;
    assert.match(msg, /1200/);
    assert.match(msg, /音色不存在/);
  } finally {
    mock.restore();
  }

  // 瞬时 HTTP 500：重试一次后成功
  mock = installMockFetch({ failVolcOnce: { status: 500 } });
  try {
    const res = await worker.fetch(
      speechRequest({ model: 'volc-tts', input: 'x', voice: 'zh_female_qingxin' }),
      ANON,
      {}
    );
    assert.equal(res.status, 200);
    assert.equal(mock.calls.volcTts, 2, 'one failed attempt + one retry');
  } finally {
    mock.restore();
  }
});

test('failure attribution: no_audio → 502 upstream_empty_audio; malformed → 500; neither pretends to be 400', async () => {
  // 200 但没有 audio.data：上游侧故障，不是调用方的错
  let mock = installMockFetch({
    volcSynth: () =>
      new Response(JSON.stringify({ audio: {}, base_resp: { status_code: 0 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  });
  try {
    const res = await worker.fetch(
      speechRequest({ model: 'volc-tts', input: 'x', voice: 'zh_female_qingxin' }),
      ANON,
      {}
    );
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error.code, 'upstream_empty_audio');
    assert.equal(mock.calls.volcTts, 2, 'no_audio is upstream-side and IS retried');
  } finally {
    mock.restore();
  }

  // 畸形响应（代理拦截页等）：500 而非 400
  mock = installMockFetch({
    volcSynth: () => new Response('<html>blocked</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
  });
  try {
    const res = await worker.fetch(
      speechRequest({ model: 'volc-tts', input: 'x', voice: 'zh_female_qingxin' }),
      ANON,
      {}
    );
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error.code, 'tts_generation_error');
  } finally {
    mock.restore();
  }
});

test('langdetect failures are server-side (500), not 400; retried once', async () => {
  // 匿名通道常见 403/429：请求体只有文本，调用方无可改项 —— 必须归因为 5xx
  let mock = installMockFetch({});
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/web/langdetect')) {
      mock.calls.volcDetect++;
      return new Response('forbidden', { status: 403 });
    }
    return origFetch(input, init);
  };
  try {
    const res = await worker.fetch(
      speechRequest({ model: 'volc-tts', input: 'x', voice: 'zh_female_qingxin' }),
      ANON,
      {}
    );
    assert.equal(res.status, 500);
    assert.equal((await res.json()).error.code, 'tts_generation_error');
    assert.equal(mock.calls.volcDetect, 2, 'langdetect retried once');
    assert.equal(mock.calls.volcTts, 0, 'TTS never reached without a language');
  } finally {
    globalThis.fetch = origFetch;
    mock.restore();
  }
});
