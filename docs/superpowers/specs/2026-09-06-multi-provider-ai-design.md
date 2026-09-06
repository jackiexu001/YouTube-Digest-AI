# 多服务商 AI 支持设计

日期：2026-09-06
关联：[AI 字幕设计](2026-09-06-youtube-digest-ai-captions-design.md)

## 1. 目标

原项目只支持 DeepSeek 一家做概览、翻译、讲解和笔记润色。本设计把它扩展成
可选择的多服务商，并允许用户接入任何 OpenAI 兼容的服务。

**注意**：本文说的是**文本模型**（概览／翻译／讲解／润色笔记）。
语音识别的服务商选择在 [AI 字幕设计](2026-09-06-youtube-digest-ai-captions-design.md) 里，两者互不影响。

## 2. 为什么做

原项目的设置页有一个「本地改造 / 想使用其他 AI 模型？」板块，
它给用户一段提示词，让用户把提示词交给编程 Agent 去改代码，从而支持别的模型。

这是在绕路解决问题。用户真正要的是换模型，不是改代码。
本设计直接提供选择器，那个板块已在 `fe298f6` 中移除。

**与上游的产品方向差异**：原作者刻意做过减法（`Simplify AI provider setup` #8），
测试里有两条断言明确禁止出现服务商选择器：

```js
assert.doesNotMatch(optionsPage, /<select\b/i);
assert.doesNotMatch(optionsPage, /id="(?:provider|aiBaseUrl|aiModel)"/);
```

我们的方向相反，这两条断言需要反转。这是有意的分叉，不是疏漏。

## 3. 服务商与适配器

三个适配器覆盖全部六家：

| 适配器 | 服务商 | 基础地址 |
|---|---|---|
| `openai-compatible` | DeepSeek（默认） | `https://api.deepseek.com` |
| | OpenAI | `https://api.openai.com/v1` |
| | 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` |
| | 豆包 | `https://ark.cn-beijing.volces.com/api/v3` |
| | 自定义 | 用户填写 |
| `anthropic` | Anthropic Claude | `https://api.anthropic.com` |
| `gemini` | Google Gemini | `https://generativelanguage.googleapis.com` |

### 3.1 基础地址必须完整存储

各家的路径前缀不一致，**不能由代码拼接 `/v1`**：

- DeepSeek：`https://api.deepseek.com` + `/chat/completions`
- OpenAI：`https://api.openai.com/v1` + `/chat/completions`
- 智谱：`https://open.bigmodel.cn/api/paas/v4` + `/chat/completions`

智谱用的是 `/api/paas/v4` 而非 `/v1`，很多工具因为硬拼 `/v1` 而 404
（参见 [cc-switch#1013](https://github.com/farion1231/cc-switch/issues/1013)）。

原项目的 `chatCompletionsUrl()` 已经是 `${aiBaseUrl}/chat/completions` 的正确形式，
沿用即可。

### 3.2 适配器接口

每个适配器实现同一组方法，`background.js` 不需要知道具体是哪一家：

```
buildRequest({ baseUrl, model, apiKey, messages, maxTokens, temperature, responseFormat })
  → { url, headers, body }

extractText(responseData) → string
extractError(responseData, httpStatus) → string
listModelsRequest({ baseUrl, apiKey }) → { url, headers } | null
extractModels(responseData) → string[]
```

`listModelsRequest` 返回 `null` 表示这家不支持获取模型列表。

### 3.3 服务商专属参数必须隔离

原代码写死了 `body.thinking = { type: "disabled" }`，这是 DeepSeek 特有的字段，
发给 OpenAI 会报错。改为由服务商配置声明，只在声明了的服务商上附加。

## 4. 获取模型列表

模型更新太快，写死列表三个月就过期；纯文本框又要求用户自己知道模型名。
折中方案：**文本框 + 「获取模型」按钮**。

| 服务商 | 接口 | 状态 |
|---|---|---|
| OpenAI | `GET {base}/models` | 官方标准接口 |
| DeepSeek | `GET {base}/models` | 兼容 OpenAI |
| Anthropic | `GET {base}/v1/models` | 官方接口，需 `x-api-key` + `anthropic-version` |
| Gemini | `GET {base}/v1beta/models` | 官方接口 |
| 智谱 GLM | `GET {base}/models` | **待实测**，文档未查到 |
| 豆包 | — | **大概率不支持**，它用「接入点 ID」而非模型名，列表接口需火山引擎签名认证 |
| 自定义 | `GET {base}/models` | 取决于对方是否兼容 |

**失败不能挡路**：任何一家获取失败（接口不存在、格式变了、网络错误），
界面只提示「这家不支持自动获取，请手动填写模型名」，文本框照常可用。

按钮在未填 API Key 前禁用——获取列表本身要带 Key。

## 5. API Key 按服务商分开存储

切换服务商时不能丢掉已填的 Key。存储结构：

```
ytd_settings = {
  provider: "deepseek",
  aiModel: "deepseek-v4-flash",
  aiBaseUrl: "",                  // 仅自定义服务商使用
  aiApiKeys: {                    // 按服务商分开
    deepseek: "...",
    openai: "...",
  },
  supadataApiKey: "...",
}
```

原有的顶层 `aiApiKey` 字段在读取时迁移进 `aiApiKeys.deepseek`，保证老用户升级后不用重填。

## 6. Chrome 权限

固定服务商的域名写进 `manifest.json` 的 `host_permissions`。

自定义服务商的地址事先未知，无法预先声明，改用 `optional_host_permissions`：
用户保存自定义配置时，通过 `chrome.permissions.request()` 弹一次授权框。
这是 Chrome 的硬性要求，绕不开，但只弹一次。

若用户拒绝授权，保存流程中止并明确说明原因，不留下一个点了必然失败的配置。

## 7. 界面

设置页「AI 服务」区块改为：

```
AI 服务
  服务商   [ DeepSeek        ▾ ]
  模型     [ deepseek-v4-flash    ]  [ 获取模型 ]
  API 密钥 [ ····················· ]   创建 DeepSeek API 密钥 ↗

  （选择「自定义」时，额外出现一个「接口地址」输入框）
```

- 切换服务商时，模型名自动填入该服务商的默认值，Key 自动取回已存的
- 「创建 API 密钥」链接随服务商变化
- 隐私提示文案里的服务商名随选择变化（原文案写死了 DeepSeek）

## 8. 明确不做（YAGNI）

- **不做 Key 有效性预检**：多一次请求和一套错误处理，收益只是提前一步知道 Key 错了；
  保存后第一次使用就会知道
- **不做模型能力探测**（上下文长度、是否支持 JSON 输出等）：各家披露方式不一，
  维护成本高；出错时按错误信息提示即可
- **不做多服务商并存/自动降级**：一次只用一个，降级逻辑会让费用和行为都变得难以预期

## 9. 测试策略

**自动化测试**（不联网）：

- `tests/providers.test.js` — 三个适配器的 `buildRequest` / `extractText` /
  `extractError` / `extractModels`；断言 DeepSeek 专属字段不会出现在其他服务商的请求里；
  断言基础地址拼接不会多出 `/v1`
- `tests/settings.test.js`（扩充）— 按服务商存取 Key、老配置迁移、切换服务商不丢 Key
- `tests/options-provider.test.js` — 服务商切换时模型名与链接同步更新；
  未填 Key 时「获取模型」按钮禁用

**手动验证**：每家服务商各跑一次真实请求，记录哪几家的「获取模型」实际可用，
并把结果回填到本文第 4 节的表格。
