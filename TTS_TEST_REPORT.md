# 免费 TTS 通道调研与实测报告

- **日期**：2026-10-16（第一轮调研+实测；第二轮补充验证同日下午）
- **测试环境**：macOS (Apple Silicon)，家庭网络，`curl` / Node `fetch` 匿名直连（无 Cookie、无代理）；带登录态验证使用 BrowserSkill 驱动本机 Chrome
- **结论速览**：✅ 完全可用 2 条（Edge TTS、火山翻译）；⚠️ 需登录态 2 条（必剪、智谱 audio.z.ai）；❌ 本轮排除 5 条（GLM 官方收费、Gitee 已收费、AI Hobbyist 停机、豆包逆向绑号、New API 多余）

---

## 一、实测通过（可直接使用）

### 1. Edge TTS（微软"大声朗读"通道）✅

| 项目 | 结果 |
|---|---|
| 声音列表 | `speech.platform.bing.com/.../voices/list` 匿名返回 322 个音色 |
| Token 获取 | `dev.microsofttranslator.com/apps/endpoint` + MSTranslatorAndroidApp HMAC 签名，匿名可用 |
| 语音合成 | `{region}.tts.speech.microsoft.com/cognitiveservices/v1`，mp3/opus/wav/pcm |
| 端到端验证 | 已部署为 Cloudflare Worker（`edgetts.tymee.site`），多次合成 200，约 2.6–2.9s 返回有效 MP3（22–38KB） |
| 成本 | 免费无配额，无需任何 key |

> 与 linux.do 帖子《几个能白嫖的 TTS API》主楼"Azure"一节是**同一套协议**（同一把 `oik6PdDd...` 签名密钥）。

### 2. 火山翻译 TTS（字节·火山翻译浏览器扩展接口）✅ 已接入上线

| 项目 | 结果 |
|---|---|
| 语种检测 | `POST translate.volcengine.com/web/langdetect/v1/` → `{"language":"zh"}` |
| 语音合成 | `POST translate.volcengine.com/crx/tts/v1/`，body `{text, speaker, language}`，返回 JSON 内 `audio.data`（base64 MP3） |
| 实测样本 | `zh_female_sichuan`（四川女声，川英混）多次合成有效 MP3，本机播放成功 |
| 鉴权 | **无需 key**，仅需伪装扩展请求头（`Origin: chrome-extension://klgfhbiooeogdfodpopgppeadghjjemk`） |
| 音色（10 个） | 少儿故事、清新女声、女主播、男主播、影视男解说、**四川女声**、嘻哈男歌手（以上中英混）、澳英女声、日语男/女声 |
| 来源 | linux.do 帖子主楼"火山"节代码 |
| **上线状态（2026-10-16）** | **已并入 Worker 正式部署**：`model: "volc-tts"` 或直接传火山音色名即可路由；长文本自动分块并发合成；支持 Worker 层 MP3 分块流式（首块即下发）。线上实测：标准 200/34KB，流式长文本首字节 2.40s vs 总 6.94s；UI 引擎标签切换、MSE 渐进播放、统计面板全部验证通过；341 项自动化测试全绿 |

---

## 二、协议已摸清、需登录态（源码级验证，端到端待登录）

### 3. 智谱 GLM-TTS 免费通道（audio.z.ai 逆向）⚠️ 等登录

| 项目 | 结果 |
|---|---|
| 原理 | 智谱官方免费工作台 `audio.z.ai` 的内部 API，开源项目 [aahl/zai-tts2api](https://github.com/aahl/zai-tts2api) 已转成 OpenAI Speech 格式 |
| 协议（读源码确认） | `GET /api/v1/z-audio/voices/list_system` + `/voices/list` 拉音色；`POST /api/v1/z-audio/tts/create`（body: voice_id/voice_name/user_id/input_text/speed/volume）→ SSE 流返回 base64 WAV 分片，`[DONE]` 结束 |
| 鉴权 | z.ai 账号 Bearer token + user_id（audio.z.ai 登录后 F12 控制台 `localStorage['auth-storage']` 获取） |
| 能力 | 系统音色 + **克隆音色**（3 秒样本），即 GLM-TTS 官方模型能力 |
| 实测状态 | 本机 Chrome 未登录 audio.z.ai → **待登录后验证**（可在登录页内直接发起同源 fetch 测试，无需导出 token） |
| 附赠发现 | 同作者 [aahl/qwen-tts2api](https://github.com/aahl/qwen-tts2api)：**Qwen3-TTS 同款免费逆向**（需通义账号 token），未测 |

### 4. 必剪 bcut TTS（B 站创作工具接口）⚠️

| 项目 | 结果 |
|---|---|
| 端点迁移 | 旧路径 `/x/bcut/rubick-interface/*` 已 404；现路径 `/x/creative-tool/*` |
| 音色列表 | ✅ 匿名可用，7 分类 **61 个音色**（梦想家、激昂张飞、麦克阿瑟、理塘小子、锤大力等 B 站特色音色） |
| 创建任务 | ✅ 202ms 返回 task_id（`model_id: tts_common_bcut_pc`） |
| 任务执行 | ❌ **state=0 永久排队**（实测 48s+ 不动）→ 判定服务端要求登录态，匿名任务被静默搁置 |
| 旁证 | 逆向项目 bcut-asr 的 TTS PR #14 提交于 2025-05 至今未合并；2026-06 的 bcut-asr-skill 封装同样无 Cookie，疑似未真正跑通 |
| 结论 | 带登录 Cookie 或许可用（未验证）；不适合公开服务 |

---

## 三、第二轮验证中排除

| 通道 | 排除原因（均已实地验证） |
|---|---|
| **Gitee AI serverless** | 平台已改版为"模力方舟"转向收费：语音合成分类仅剩 **Qwen3-TTS，0.8 元/万字符**；帖子提到的 IndexTTS2、GLM-TTS 已下架，"每天免费 100 次"政策已取消（登录用户账号确认无免费 TTS 额度入口） |
| **AI Hobbyist**（tts.acgnai.top） | **停机维护中**："模型更新中，新数据集整理中，更新完成再开"——暂无法注册/调用；恢复时间未知 |
| GLM-TTS 官方 API | 收费（已核实；免费替代 = 上方 audio.z.ai 逆向通道） |
| 豆包网页逆向（callmerio/doubao-tts 等） | 必须绑豆包账号 Cookie（约 30 天过期），有风控/封号风险，仅适合本地自用 |
| New API 中转方案 | 架构上可行但多余——更优方向是把本 Worker 作为 New API 的上游渠道；未实施 |

## 四、调研确认、未实测（保留候选）

| 通道 | 情况 | 免费额度 | 未测原因 |
|---|---|---|---|
| IndexTTS-2.5 官方 Demo | HF Space / 魔搭创空间，Gradio API 官方明牌可调（克隆+情感控制） | ZeroGPU 配额，排队 | 配额/排队限制，未实测 |
| 魔搭 CosyVoice3 创空间 | 阿里官方免费 Studio，gradio 调用 | 免费需 SDK token + 排队 | 需魔搭 token |
| 豆包（火山引擎）官方 API | `openspeech.bytedance.com`，X-Api-Key，自有协议需适配器 | 试用 2 万字符（半年） | 需 key |
| Azure 官方 TTS (F0) | 与 Edge 同端点族的官方版，500+ 音色 | **每月 50 万字符永久免费** | 需 Azure 订阅 |
| qwen-tts2api（通义逆向） | 同 zai-tts2api 模式 | 免费需通义账号 token | 需登录 token |

---

## 附：当前线上部署与行动项

- **服务**：`https://edgetts.tymee.site/v1/audio/speech`（OpenAI 兼容格式，Cloudflare Worker）
- **双引擎**：`model: "tts-1"` → Edge TTS（322 音色，mp3/opus/wav/pcm，支持流式）；`model: "volc-tts"` 或火山音色名 → 火山翻译（10 音色含四川话/日语，mp3，支持 Worker 层分块流式）
- **网关密钥**：随机 48 位 hex，存于 CF Secrets；网页工作台 `https://edgetts.tymee.site/`（右上角引擎标签切换）
- **待用户动作**：登录 `audio.z.ai`（浏览器标签页已打开）→ 通知 agent 继续实测智谱通道
- **下一步候选**：智谱 audio.z.ai（待登录）＞ IndexTTS-2.5 Demo ＞ 魔搭 CosyVoice3
