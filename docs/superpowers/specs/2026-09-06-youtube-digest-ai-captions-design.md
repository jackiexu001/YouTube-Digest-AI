# YouTube Digest 二创：自研 AI 字幕设计

日期：2026-09-06
基础项目：[zarazhangrui/youtube-digest](https://github.com/zarazhangrui/youtube-digest) v1.2.0
参考项目：[jackiexu001/youtube-transcript](https://github.com/jackiexu001/youtube-transcript)（自研 ASR 流水线）

## 1. 目标

给 YouTube Digest 加一条兜底能力：**视频没有字幕时，用 AI 生成带时间戳的字幕**，
让翻译、AI 概览、时间戳笔记、字幕搜索这些现有功能对无字幕视频同样可用。

约束：不删改原项目的任何功能，改动面积尽可能小，保持"下载 ZIP 直接加载"的零构建特性。

## 2. 实测结论（本设计的事实基础）

以下全部在真实 Chrome 扩展环境实测得出，不是推断。测试视频 `iBgKWE1WBKA`，38:56。

### 2.1 YouTube 网页版已转 SABR

`ytInitialPlayerResponse` 中 12 个音频格式**全部没有 `url`，也没有 `signatureCipher`**，
只有 `serverAbrStreamingUrl`。播放器改用 SABR 协议取流（实测捕获到
`POST ...&sabr=1&alr=yes`）。

**推论**：两条常见路线都已失效——
- 监听播放器请求拿地址：请求参数里没有 `mime=audio`，无从筛选
- 移植 ytdl-core 的签名解密（如 audio-only-youtube）：问题不是地址被加密，是根本没有地址

### 2.2 换客户端身份可拿到直连地址

带上页面里的匿名 `visitorData`，向 `/youtubei/v1/player` 发请求并声明为
`VISIONOS`（clientVersion `1.02`，client name `101`）或 `IOS` 客户端，
返回 10 个带直连 `url` 的音频格式，且不需要签名解密。

| 客户端 | 结果 |
|---|---|
| VISIONOS | OK，10 个音频，10 个带地址 |
| IOS | OK，10 个音频，10 个带地址 |
| TVHTML5_SIMPLY_EMBEDDED_PLAYER | ERROR |
| WEB_EMBEDDED_PLAYER | ERROR |
| ANDROID_VR | LOGIN_REQUIRED |

**关键实现约束**：这个请求**必须在页面 MAIN world 里发**。扩展自己发会带上
`Origin: chrome-extension://...`，YouTube 返回 403。命令行用相同请求体测试返回 200，
差别仅在这个头，而浏览器不允许扩展伪造 Origin。

使用 `credentials: "omit"`，不需要也不使用用户的 YouTube 登录 Cookie。

### 2.3 音频下载必须分段并行

同一个地址，同一台机器：

| 方式 | 结果 |
|---|---|
| 单条顺序 GET 整个文件 | 3 分钟只下了 1.5 MB（被限速） |
| 8 条并行 ranged GET | 2.7 秒下载 8 MB（约 3.0 MB/秒） |

googlevideo 对 `Origin` 不敏感（无 Origin、youtube.com、chrome-extension 三种都返回 206），
扩展凭 `host_permissions` 可直接读取，无需走页面环境。

### 2.4 切片不需要 ffmpeg

itag 139 的 m4a 是分片格式：`ftyp → moov → sidx → moof/mdat × N`。
`sidx` 索引表给出每个片段的字节偏移和时长，精度完美：

- 索引表算出总时长 38.94 分钟、总字节 14,246,170，与播放器报告的数值**完全一致**
- 全部 234 个片段起点**精确落在 moof 边界**上
- 切片 = init 段（前 3,572 字节）+ 任意连续片段字节，纯拼接
- 解码后时长与索引表**误差 0.00 秒**

### 2.5 必须转成 WAV，且这是省钱而非花钱

直接把 m4a 切片送 Groq 会稳定返回 HTTP 500（试过两次）。原因从完整错误信息可见：

```
seconds of audio per hour (ASPH): Limit 7200, Used 5956, Requested 2336
```

传的是 **30 秒**切片，Groq 却按 **2336 秒**（整片时长）计费——它读的是容器头部声明的时长，
而切片继承了整片的声明。文件里只有 30 秒数据，其处理管线因此崩溃。

| 方案 | 每段消耗额度 | 39 分钟视频合计 |
|---|---|---|
| m4a 切片 | 2336 秒（整片时长） | 8 × 2336 = 18,688 秒 |
| WAV | 300 秒（真实时长） | 2,336 秒 |

WAV 声明真实时长，是**唯一可行且计费正确**的方案。Groq 按音频时长计费而非文件大小，
所以 WAV 不增加费用，只增加上传流量。

### 2.6 端到端速度（真实 5 分钟分段）

| 环节 | 耗时 |
|---|---|
| 下载音频（1.80 MB） | 0.15 秒 |
| 解码 + 转 16kHz 单声道 WAV（309.5 秒音频 → 9.45 MB） | 0.93 秒（约 333 倍速） |
| 上传 + Groq 识别（返回 166 段） | 5.26 秒 |
| **单段合计** | **6.3 秒** |

推算 38:56 视频（8 段，2 路并发）：**第一段字幕约 6 秒出现，全部完成约 25 秒。**
瓶颈是上传 + 识别，占 83%。

### 2.7 YouTube 原生字幕可直接免费获取

同一个 InnerTube 响应里带着 `captions.playerCaptionsTracklistRenderer.captionTracks`，
其 `baseUrl` 加 `&fmt=json3` 可直接取回带时间戳字幕：实测 1400 段，覆盖到 38:54（视频 38:56）。

### 2.8 Groq 免费档限额

`whisper-large-v3-turbo` 免费档（[官方文档](https://console.groq.com/docs/rate-limits)）：

| 限制 | 数值 | 换算 |
|---|---|---|
| 每小时音频秒数（ASH） | 7,200 | 2 小时音频 |
| 每天音频秒数（ASD） | 28,800 | 8 小时音频 |
| 每天请求数（RPD） | 2,000 | 非瓶颈 |

**单个视频上限 2 小时**；超过则一次跑不完，必须跨限流窗口续跑。

## 3. 架构

### 3.1 三层字幕获取

唯一改动的现有函数是 `background.js` 的 `handleFetchTranscript(videoId)`。
它的返回格式不变，因此下游全部功能（翻译、概览、笔记、搜索）无需改动。

```
handleFetchTranscript(videoId)
  │
  ├─ ① 本地缓存命中 ────────────────► 直接返回（零成本）
  │
  ├─ ② 取 InnerTube 响应（页面环境内，一次请求同时拿到字幕轨列表和音频地址）
  │     │
  │     ├─ 请求本身失败（403 / 客户端被封 / 网络错误）
  │     │     → 无法判断有无字幕，落到 ③ 让 Supadata 判断。
  │     │       若 ③ 也说没字幕，则不提供 AI 选项（因为拿不到音频地址），
  │     │       界面明确告知「暂时无法读取这个视频，请稍后重试」
  │     │
  │     ├─ 字幕轨非空 → 直接下载 timedtext（免费、无上限）
  │     │                 └─ 失败 → 落到 ③
  │     │
  │     └─ 字幕轨为空 → 跳过 ③，直接到 ④
  │                      （原项目用 mode=native 调 Supadata，
  │                        YouTube 自己都说没有，Supadata 也不可能有）
  │
  ├─ ③ Supadata（原项目代码，一字不改，降为备胎）
  │
  └─ ④ 返回 NO_NATIVE_CAPTIONS + 视频时长 + 费用/额度预估
        └─ 用户点击「生成 AI 字幕」 → ⑤ 自研 ASR 流程
```

②③⑤ 产出完全相同的数据结构，下游无从区分来源（仅缓存中记录 `source` 字段供界面标注）。

### 3.2 AI 字幕流程（⑤）

```
InnerTube 响应中的音频格式列表
  └─ 选最低码率的 m4a（itag 139 类）
       ↓
下载 init 段（前 ~4KB）→ 解析 sidx → 得到「时间 → 字节」映射
       ↓
按 5 分钟切分，段间重叠 10 秒
       ↓
每段（最多 2 段并发）：
   8 条并行 ranged GET → 拼成 init + 片段字节
       ↓
   decodeAudioData → OfflineAudioContext 重采样 16kHz 单声道 → WAV
       ↓
   上传 Groq / OpenAI → 带时间戳的 segments
       ↓
   加上段起点偏移 → 立刻写入缓存 → 立刻追加显示
       ↓
全部完成后：按重叠区中点合并，消除切口重复
```

### 3.3 参数选择依据

| 参数 | 取值 | 依据 |
|---|---|---|
| 分段长度 | 5 分钟 | WAV 9.45 MB，安全落在 Groq 25MB 上限内；再大逼近上限，再小徒增请求数 |
| 段间重叠 | 10 秒 | 沿用 youtube-transcript 已验证的做法，避免切口吃字 |
| 识别并发 | 2 | 瓶颈是上传带宽，并发再高也抢同一条管道；且 Groq 限流易撞 |
| 下载并发 | 8 | 实测 3.0 MB/秒；单条顺序会被限速 |
| 首段长度 | 与其他段相同 | **不做**自适应首段。原 Python 版的 `choose_first_chunk_seconds` 是为对付 yt-dlp 下载慢，而浏览器端下载仅 0.15 秒 |

## 4. 断点续传与限流处理

### 4.1 分段级断点

每段识别完成立刻写入 `chrome.storage.local`，不等整个视频跑完。缓存结构：

```
ytd_ai_transcript_<videoId> = {
  source: "ai",
  provider: "groq",
  totalChunks: 8,
  chunks: { 0: [...segments], 1: [...segments], ... },   // 稀疏，只存已完成的
  audioSeconds: 2336,
  updatedAt: <timestamp>
}
```

### 4.2 撞到限流时

Groq 的 429 响应里带有明确的等待时间（形如 `Please try again in 9m6s`），
以及 `retry-after` 头。解析规则已实现并测试。

- 等待时间 ≤ 120 秒：自动等待后重试，界面显示倒计时。
  **同一段最多自动重试 2 次**，仍失败则按下一条处理，避免无限等待
- 等待时间 > 120 秒：停止，界面显示
  「已完成 12/25 段（0:00–1:00 已可阅读），额度约 34 分钟后恢复」+「继续」按钮
- 已完成的段照常显示，用户可以先读
- 点「继续」从断点接着跑，不重复计费

### 4.3 超长视频的事前提示

视频音频秒数 > 7200 时，在按钮上方明确提示：
「这个视频 2 小时 15 分，超过免费档单次额度上限，会分两次完成」

不允许用户在不知情的情况下跑到一半才发现。

## 5. 缓存

- 键：`ytd_ai_transcript_<videoId>`
- AI 字幕**永不因容量被淘汰**（它是花过钱的），仅按用户手动清除
- `chrome.storage.local` 默认配额约 10 MB，一份 39 分钟字幕约 100–200 KB，
  即约 50–100 个视频。因此 manifest 需申请 `unlimitedStorage` 权限；
  同时设置页提供「清除 AI 字幕缓存」入口和当前占用显示，
  接近配额时提示用户而非静默写入失败
- 原项目的 `digest_<videoId>` 缓存（20 条上限）保持原样，两者独立
- 第 ② 层拿到的免费字幕沿用原项目缓存策略即可（重取零成本）

## 6. 界面

### 6.1 无字幕时的入口

```
这个视频没有字幕
38 分 56 秒 · 约 $0.026 · 会用掉本小时额度的 32%
                              [ 生成 AI 字幕 ]
```

费用与额度数字**按当前选中的服务商计算**（Groq 与 OpenAI 单价和限额都不同），
单价写在 `asr/providers.js` 的适配器里，界面只负责显示，不硬编码任何数字。
额度百分比仅在服务商公布了明确限额时显示；否则只显示时长和预估费用。

### 6.2 生成中

原地替换为进度，**每段完成即追加到字幕区**：

```
正在识别 3/8 段 · 已完成 0:00–15:00
```

### 6.3 完成后

字幕区顶部标注来源（如「AI 生成字幕 · Groq」），让用户知道这份字幕不是 YouTube 官方的。

## 7. 设置

设置页新增一块，与现有 Supadata / DeepSeek 并列：

- AI 字幕总开关（默认开）
- 识别服务商：Groq（默认）/ OpenAI
- 两个服务商的 API Key 分开存储，互不覆盖
- 「获取 API Key」链接指向各自官方控制台

## 8. 文件结构

新增文件全部独立，不修改原有文件（`background.js` 除外，仅加分支）：

| 文件 | 职责 |
|---|---|
| `asr/youtube-player.js` | 页面 MAIN world 内取 InnerTube 响应（字幕轨 + 音频格式，一次拿全） |
| `asr/native-captions.js` | 第 ② 层：下载并解析 timedtext json3 |
| `asr/mp4-index.js` | 解析 sidx，提供「时间窗 → 字节范围」查询 |
| `asr/fetcher.js` | 并行 ranged 下载 + init/片段拼接 |
| `asr/wav.js` | 解码 → 16kHz 单声道 WAV |
| `asr/providers.js` | Groq / OpenAI 适配器，含 429 解析与重试 |
| `asr/transcribe.js` | 调度、断点续传、时间轴偏移与重叠合并 |

`background.js` 的改动仅限 `handleFetchTranscript` 内新增分支，以及新增几个 message handler。

## 9. 测试策略

**自动化测试**（不联网，可进 CI，与原项目 `tests/` 并列）：

- `tests/mp4-index.test.js` — sidx 解析。用真实文件头字节做样本，断言片段数、
  总时长、总字节、各片段起点
- `tests/transcript-merge.test.js` — 时间轴偏移与重叠区中点合并。构造已知输入，
  断言无重叠、无倒退、无重复文本
- `tests/wav.test.js` — WAV 字节布局。断言 RIFF/WAVE 头各字段、采样率、声道数、数据长度
- `tests/rate-limit.test.js` — 429 等待时间解析。覆盖 `1m23.45s`、`7.5s`、
  `retry-after` 头、无信息四种情况

**手动检查脚本**：联网部分（取地址、下载、识别）不写自动化测试。
这些依赖 YouTube 和 Groq 的实时状态，写进 CI 只会变成随机失败的噪音。
改为提供一个可手动运行的检查页，思路与本次验证用的探针相同。

## 10. 用户须知（README 必须写明）

以下内容必须在 README 和设置页显著位置说明，不能让用户自己去撞：

1. **AI 字幕会真实产生费用**，按 Groq 官方价格 `whisper-large-v3-turbo`
   约 $0.04 / 小时音频；39 分钟视频约 $0.026
2. **Groq 免费档限额**（引用[官方文档](https://console.groq.com/docs/rate-limits)）：
   每小时 7,200 秒音频、每天 28,800 秒音频、每天 2,000 次请求
3. **单个视频上限 2 小时**；超过需跨限流窗口分次完成
4. **API Key 保存在本地 Chrome**，不上传到除对应服务商官方接口以外的任何地方
5. **不使用用户的 YouTube 登录 Cookie**
6. 只处理纯音频流，**不下载视频文件**，音频数据不落盘

## 11. 已知风险与未验证项

| 项目 | 状态 | 缓解 |
|---|---|---|
| 第 ② 层仅测过人工字幕轨（`kind` 非 asr） | **未验证** | 自动生成字幕、翻译轨、超长视频需逐个验证；验不过落 Supadata 兜底 |
| VISIONOS / IOS 客户端可能被 YouTube 收紧 | 已知风险 | 双客户端互为备份；失效时明确提示用户而非静默失败 |
| `visitorData` 读取路径依赖 `ytcfg` 结构 | 已知风险 | 已实现正则兜底（从页面 HTML 提取） |
| webm/opus 容器的切片 | **不支持** | 优先选 m4a；YouTube 始终同时提供两者，实测 10 个格式中 m4a 有 4 个 |
| Groq 服务端行为变化 | 已知风险 | WAV 是最保守的格式选择 |

## 12. 明确不做（YAGNI）

- **自适应首段长度** — 实测第一段 6 秒出现，无必要
- **WebCodecs + Opus 压缩上传** — 上传虽占 83%，但绝对值 5.26 秒足够快；
  真觉得慢再做，可把 9.45 MB 降到约 0.9 MB
- **转码挪到 Web Worker** — 0.93 秒，不会卡界面
- **移植 ytdl-core 签名解密** — 问题不是加密，是没有地址（见 2.1）
- **实现 SABR 协议** — 换客户端身份即可绕开
- **替换掉 Supadata** — 保留为备胎，兜住未验证的边角情况
