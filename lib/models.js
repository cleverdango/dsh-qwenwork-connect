/**
 * 静态内置的模型目录（按站点）。
 *
 * 来源：两站桌面 App 的真实返回，未臆造任何字段。
 *   · .cn（`QwenWorkCN.app` 日志的 `rawModels`）：
 *       pro / flash / frontier-1 / qwen3.8-max-preview
 *   · .ai 国际版（`GET gateway.qwenwork.ai/algo/api/v2/model/list?Encode=1`
 *     的 200 响应，2026-11-16 实测）：
 *       qwork-auto / qwork-advanced / qwork-ultimate
 *
 * 阶段 B 不依赖 upstream 动态拉取，保证离线 / 首次拉取成功前 provider 不会是空的。
 *
 * ── 为什么目录必须按站点分开 ──────────────────────────────────────
 * 两站的模型 **key 完全不同**：拿 .cn 的 `flash` 去请求 .ai 网关会得到
 * 「模型不存在」，反之亦然。因此这里不存在「一份目录服务两个站点」的写法，
 * 每个站点各持一份，由 `modelsForSite()` 取用。
 *
 * @module dsh-qwenwork-connect/models
 */

import {
  DEFAULT_SITE_ID,
  SITE_IDS,
  providerOf,
  siteIdOfProvider,
  siteOf,
} from './sites.js';

/**
 * .cn 站点的 provider 路由 id（保持既有值：已持久化的模型选择记录不失效）。
 * @deprecated 新代码请用 `providerOf(siteId)`；本常量仅为向后兼容保留。
 */
export const QWENWORK_PROVIDER = providerOf(DEFAULT_SITE_ID);

/**
 * 本插件拥有的**全部** provider 路由 id，顺序与 SITE_IDS 一致。
 * 用于 `ctx.llm.registerAdapter()` 与 stall-guard 的归属判断。
 */
export const QWENWORK_PROVIDERS = Object.freeze(SITE_IDS.map((id) => providerOf(id)));

/**
 * 上下文窗口与输出上限。
 *
 * ⚠️ **`MAX_INPUT_TOKENS` 必须与发给上游的 `model_config.max_input_tokens` 一致**
 * （见 `signer-session.js` 的 `buildInferBody`）。
 *
 * 真实上限的确定过程（教训记录）：
 *   1. App 日志表格列标注「1M」
 *   2. Buddy2api 的 `model_config.max_input_tokens` 写 180000
 *   3. 曾照搬 180000 —— **实测证明是错的**：
 *      probe-context-limit*.mjs 的对照实验显示
 *      ≈150K/200K/400K/700K/850K/1.0M/1.2M tokens 全部被上游接受，
 *      ≈1.5M 才被拒（"Error in upstream response"）。
 *      → 真实上限在 1.2M~1.5M 之间，「1M」是保守而合理的声明值。
 *
 * 声明与实现不一致是本项目反复出现的一类缺陷；这次是**照搬外部值未实测**。
 *
 * ⚠️ 国际版目录里 `max_input_tokens` 为 180000，`context_config` 的默认档是
 * 1M —— 与 .cn 同一套取值策略，因此这里沿用同一常量（见 catalog.js 的
 * `defaultContextWindow`：缺省时取 context_config 最大档）。
 */
export const MAX_INPUT_TOKENS = 1_000_000;
/** 单次回复的输出上限（与 `parameters.max_tokens` 一致）。 */
export const MAX_OUTPUT_TOKENS = 32000;

/**
 * 把 sites.js 的极简条目补全成完整的目录条目。
 *
 * sites.js 只声明「站点之间不同的东西」（id / 名称 / 倍率 / 能力 / 徽章），
 * 上下文窗口与输出上限是两站共用的，因此在这一层补上——这样
 * 「加一个站点」只需要动 sites.js 一处，不必在每个站点表里重复抄两个数字。
 *
 * @param {ReadonlyArray<any>} entries
 * @returns {Array<any>}
 */
function hydrate(entries) {
  return entries.map((entry) => ({
    contextWindow: MAX_INPUT_TOKENS,
    maxTokens: MAX_OUTPUT_TOKENS,
    ...entry,
  }));
}

/**
 * 按站点取内置目录（每次返回新数组，调用方可安全修改/过滤）。
 *
 * @param {unknown} [siteId] 站点 id；缺省为 .cn（向后兼容）
 * @returns {Array<any>}
 */
export function modelsForSite(siteId) {
  return hydrate(siteOf(siteId).fallbackModels);
}

/**
 * .cn 站点的内置目录（既有导出名，行为不变）。
 *
 * @type {Array<{
 *   id: string,
 *   name?: string,
 *   shortName?: string,
 *   description?: string,
 *   billingRate: number,
 *   supportsImages: boolean,
 *   contextWindow: number,
 *   maxTokens: number,
 *   isDefault?: boolean,
 *   isRecommended?: boolean,
 *   isNew?: boolean,
 * }>}
 */
export const FALLBACK_QWENWORK_MODELS = modelsForSite(DEFAULT_SITE_ID);

/**
 * 把宿主传来的模型标识归一化回**上游 model_config.key**。
 *
 * 背景：部分宿主（如 pi）的选择器只渲染描述符 `id`，因此目录条目允许声明
 * `displayNameId`（人类可读全名，如 `qwen3.8-flash`）作为对外 id；请求进
 * shim 后必须换回上游认得的短 key（`flash`）。未声明 displayNameId 的模型
 * 两种写法（短 key 与自身 id）都接受；目录里查不到的一律原样透传，
 * 交给上游自行裁决（不吞新模型的接入路径）。
 *
 * 两站共用本函数但目录不同：先查本站点目录，未命中时再查其它站点，
 * 这样「在 .cn 目录里选了模型、随后切到国际版」也不会把 key 归一化错。
 *
 * @param {string} model 宿主 id（displayNameId 或上游 key）
 * @param {unknown} [siteId] 优先按该站点的目录归一化
 * @returns {string} 上游 model_config.key
 */
export function normalizeModelKey(model, siteId) {
  if (typeof model !== 'string' || model === '') return model;
  const own = modelsForSite(siteId).find(
    (m) => m.id === model || m.displayNameId === model,
  );
  if (own !== undefined) return own.id;
  for (const id of SITE_IDS) {
    if (id === siteOf(siteId).id) continue;
    const other = modelsForSite(id).find(
      (m) => m.id === model || m.displayNameId === model,
    );
    if (other !== undefined) return other.id;
  }
  return model;
}

/**
 * 把倍率格式化成选择器里显示的文本。
 *
 * 形态对齐 WorkBuddy（`Hy3 · x0.00 · 限时免费`）：
 *   - 0 倍率 → `免费`
 *   - 其它   → `x1.00` / `x0.10` / `x1.10`
 *
 * @param {number} rate
 * @returns {string}
 */
export function formatRate(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return '';
  if (rate === 0) return '免费';
  return `x${rate.toFixed(2)}`;
}

/**
 * 生成模型选择器里显示的名字：`名称 · 倍率 · 标记`。
 *
 * ⚠️ 这是**唯一的显示名来源**——DSH 的模型选择器渲染的就是 pi-ai 模型描述符
 * 的 `name` 字段（见 dsh-workbuddy-connect 的 `toPiModel`，它直接透传
 * 上游 `name`，而该值本身就形如 `Hy3 · x0.00 · 限时免费`）。
 * 倍率必须拼进 `name` 才会出现在选择器里；单独放 `billingRate` 字段
 * 只有设置卡片能看到。
 *
 * @param {any} info
 * @returns {string}
 */
export function displayName(info) {
  const parts = [info.shortName ?? info.id];
  const rate = formatRate(info.billingRate);
  if (rate !== '') parts.push(rate);
  if (info.isDefault === true) parts.push('默认');
  if (info.isRecommended === true) parts.push('推荐');
  if (info.isNew === true) parts.push('新');
  return parts.join(' · ');
}

/**
 * 卡片与选择器共用的描述文案。
 *
 * @param {any} info
 * @returns {string}
 */
function describeModel(info) {
  const rate = formatRate(info.billingRate);
  const ctx = info.contextWindow >= 1000000 ? '1M' : `${Math.round(info.contextWindow / 1000)}K`;
  return [
    info.supportsImages === true ? '视觉' : '仅文本',
    ctx,
    rate === '' ? undefined : rate === '免费' ? '免费' : rate,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 供卡片展示的精简模型行。 */
/**
 * 目录 → 卡片数据。
 *
 * ⚠️ 这里**不过滤**已停用的模型：卡片是唯一的重新启用入口，必须把停用
 * 项也列出来（灰显 + 开关关闭）。provider 侧的过滤发生在
 * index.js `wireSite` 的 `visibleCatalog`。
 *
 * @param {any[]} models 该站点当前目录（未过滤）
 * @param {string[]} [disabled] 该站点停用列表
 */
export function catalogForCard(models, disabled) {
  const list = Array.isArray(models) ? models : FALLBACK_QWENWORK_MODELS;
  const off = new Set(Array.isArray(disabled) ? disabled : []);
  return list.map((model) => ({
    id: model.id,
    // 卡片显示短名（倍率已单独成列），选择器则用带倍率的长名。
    name: model.shortName ?? model.id,
    description: describeModel(model),
    rate: model.billingRate,
    // 恒有布尔值（不是「缺省=启用」）：前端开关直接绑这个字段，
    // undefined 会让 aria-checked 落在隐式 false 上，语义巧合不可靠。
    enabled: !off.has(model.id),
    ...(model.isDefault === true ? { isDefault: true } : {}),
    ...(model.isRecommended === true ? { isRecommended: true } : {}),
    ...(model.isNew === true ? { isNew: true } : {}),
  }));
}

/**
 * 把静态目录条目转成 pi-ai 的模型描述符。
 *
 * `name` 是**模型选择器显示的那一行文本**——因此这里用 `displayName()`
 * 把倍率拼进去（形如 `高级 · x1.00 · 默认`），否则选择器只会显示干巴巴的
 * 名称，用户看不到谁贵谁便宜。
 *
 * @param {any} info
 * @param {string} baseUrl 该 provider 的请求基址
 * @param {{ supportsImages?: boolean, displayId?: boolean, provider?: string }} [opts]
 *        `supportsImages` 覆盖：**由调用方按附件服务是否可用传入**。
 *        不传则沿用目录里的声明。这样当宿主没有附件服务时，模态会退回
 *        `['text']`，避免 DSH 走图片路径后抛
 *        `pi-ai image input requires the durable attachment service`。
 *        `provider` 覆盖：多站点时各站点必须声明自己的 provider id，
 *        否则两个站点的模型会被归到同一分组。
 */
export function toPiModel(info, baseUrl, opts = {}) {
  const supportsImages = opts.supportsImages ?? info.supportsImages === true;
  return {
    // 部分宿主（pi）的选择器只渲染描述符 `id`，这类宿主传 `displayId: true`
    // 换用人类可读全名；请求回落到 shim 时由 normalizeModelKey() 换回上游
    // 认识的短 key，两侧契约都不破。DSH 侧选择器显示的是 `name`，故保持
    // 原 id 不变，不动已持久化的模型选择记录。
    id: opts.displayId === true ? (info.displayNameId ?? info.id) : info.id,
    name: displayName(info),
    api: 'openai-completions',
    provider: opts.provider ?? QWENWORK_PROVIDER,
    baseUrl,
    input: supportsImages ? ['text', 'image'] : ['text'],
    /**
     * 推理等级：**开启**（2026-11-26 实测推翻旧结论，见紧随其后的 `thinkingLevelMap`）。
     *
     * 旧实现把这里置 false，理由是「上游不认 effort 档位，属假开关」。该结论
     * 来自 2026-11-08 的 probe-disable-thinking.mjs —— 那组实验只证明**关不掉**
     * 思考（`enable_thinking:false` / `reasoning_effort:"none"` 都被无视），
     * 推不出「档位无效」。2026-11-26 用「非法值是否被拒 + 多轮交错计量思考量」
     * 重测，结论相反：`reasoning_effort` 是上游**认识并执行**的字段。
     *
     * 上游仍返回思维链 `reasoning_content`，而 pi-ai 把它解析成 thinking 块
     * 并不依赖这个标志（openai-completions 的分支无条件读取它）；此处置 true
     * 的作用是让 DSH 的 `reasoningInfo` 生成「推理等级」菜单。
     */
    reasoning: true,
    /**
     * 推理等级 → 上游 wire 值（2026-11-26 实测；.cn 网关 pro 与 deepseek-flash 两模型）。
     *
     * 判据一 · 网关**校验**这个字段：`"abc"` / `"off"` / `"deep"` / `"auto"` 得到帧内
     * 400（`Error in upstream response`），而 `minimal|low|medium|high|xhigh|max`
     * 全部 200 正常作答；同时未知字段（`thinking_budget`、`thinking`、`foo_bar`）被
     * **静默忽略**且不影响作答 —— 两种行为可区分，说明不是「随便什么字符串都收」。
     *
     * 判据二 · 档位真的改变思考量（同一难题、变体交错、多轮取均值；字符数取
     * `delta.reasoning_content` 累计，token 取 `raw_usage.completion_tokens`）：
     *
     *   档位          reasoning 字符均值   completion token 均值
     *   不发该字段           2514                 1066
     *   high                 2463                 1149
     *   max                  5571                 2083
     *   xhigh               10020                 3889
     *
     * 判据三（最干脆）：一个**平凡问题**（17×23）上，不发 / none / minimal / low /
     * medium / high 的思考量都是 ~0 字符，而 `xhigh` 产生 454 字符、`max` 892 字符
     * —— 高档位把「本来不思考」的问题也拉进了思考路径。
     *
     * 因此本表按上游**真实取值** 1:1 映射，不臆造缩写；`off: null` 表示
     * 「不提供这一档」—— 上游关不掉思考（见下方「思考开关握手」），给了也是假开关。
     *
     * ⚠️ 诚实告知：本网关上只有 `xhigh` / `max` 有可观差异，`low` / `medium` /
     * `high` 与「不发该字段」在多次测量中落在同一噪声带内。这是**网关行为**，
     * 插件补不了；仍列出这三档是因为它们合法、且将来网关调整档位时无需改插件。
     */
    thinkingLevelMap: {
      off: null,
      minimal: 'minimal',
      low: 'low',
      medium: 'medium',
      high: 'high',
      xhigh: 'xhigh',
      max: 'max',
    },
    /**
     * 思考开关握手（QwenWork 网关不支持，2026-11-08 实测；国际版同一套
     * 网关实现，2026-11-16 对 .ai 的 200 响应结构与 .cn 完全一致）：
     *
     * pi-ai 对 openai-completions API 按 `compat.thinkingFormat` 决定发不发
     * `enable_thinking`（qwen / qwen-chat-template 两种格式）。不声明时
     * auto-detect 会因 baseUrl 是 127.0.0.1 环回 shim 而落到默认 openai，
     * 宿主设 thinking="off" 只是不发 reasoning_effort，请求体里没有任何
     * 关思考字段。
     *
     * 实测（research/buddy2api-probes/probe-disable-thinking.mjs：5 变体对照；
     * probe-flash-thinking.mjs：flash 模型 3 变体）：QwenWork 网关对
     * `enable_thinking:false`、`chat_template_kwargs.enable_thinking:false`、
     * `reasoning_effort:"none"`、`is_reasoning:false` 全部无视，思考照发。
     * 所以这里**刻意不声明** compat.thinkingFormat（避免 pi-ai 以为「关思考」
     * 已生效而实际没关），并把 `thinkingLevelMap.off` 设 null 让 UI 不提供
     * 「关闭」这一档。上游强制思考，宿主端的正确姿态是容忍 thinking 通道
     * （pi-hermes-memory 的 thinking-channel recovery 那样从 thinking 块恢复答案）。
     *
     * 注意「关不掉」≠「档位无效」：`reasoning: true` + `thinkingLevelMap` 只为
     * 给出**强度**菜单（实测 xhigh/max 真生效），与上面的「关不掉」不矛盾。
     */
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: info.contextWindow,
    maxTokens: info.maxTokens,
  };
}

/**
 * provider id → 站点 id。供 shim / stall-guard 判断「这条请求属于哪个站点」。
 * @param {unknown} provider
 */
export { siteIdOfProvider };
