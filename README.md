# free-dsh-search

[![ci](https://github.com/Wuyueyu-ovo/free-dsh-search/actions/workflows/ci.yml/badge.svg)](https://github.com/Wuyueyu-ovo/free-dsh-search/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-black.svg)](LICENSE)

给 [DeepSeek Harness](https://www.deepseek.com/harness)（DSH）加上五家有免费额度的网页搜索源，替代原生 DeepSeek Search API，并支持**按优先级失败降级**。

DSH 的网页搜索走 `ctx.web` 这个可插拔的搜索能力接口。本插件把自己实现的 provider 注册进去，于是在 **Plugins → Web search and fetch** 里就能把它们选为搜索源——不修改任何 dsh 自带文件，也不覆盖部署组合。

## 支持的搜索源

| Provider id | 服务 | 免费额度（以官网为准） | 凭据引用 |
|---|---|---|---|
| `free-search` | **聚合（推荐）**：按可调优先级依次尝试，失败自动降级 | — | — |
| `tavily` | [Tavily](https://tavily.com) | 约 1000 次/月 | `TAVILY_API_KEY` |
| `serper` | [Serper](https://serper.dev)（Google 结果） | 一次性 2500 次 | `SERPER_API_KEY` |
| `exa` | [Exa](https://exa.ai) 语义搜索 | 注册赠额 + 月度小额 | `EXA_API_KEY` |
| `firecrawl` | [Firecrawl](https://firecrawl.dev) | 每月免费额度 | `FIRECRAWL_API_KEY` |
| `langsearch` | [LangSearch](https://langsearch.com) | 免费计划 | `LANGSEARCH_API_KEY` |

只配一家也能用；聚合 provider 只会调已配置的那些。

## 安装

编译产物就是仓库里的纯 JavaScript，无构建步骤、无运行时依赖。

- **图形界面**：Plugins → **Add plugin**，选中本仓库目录。
- **命令行**：`dsh plugin --profile <profile> add <本仓库路径>`，随后启用该 bundle（具体子命令随 dsh 版本变化，以 `dsh plugin --help` 为准）。
- **本会话验证过的路径**：插件管理器 `install_bundle`，目标为仓库绝对路径。

安装后插件行出现在 Plugins 列表里，`free-dsh-search` 会注册到 `ctx.web`。

## 使用

1. 打开 **Plugins → 免费网页搜索**，粘贴至少一家的 API Key 并保存（写入本机凭据库，保存即生效，无需重启）。
2. 点 **一键测试** 或某行的 **测试**：这是一次真实的最小搜索（每家消耗 1 次额度），返回 `通 · xxxms · n 条` 或带原因的 `断`。
3. 用 **设为搜索源** 一键把 `web.searchProvider` 指向本插件；也可以到 **Plugins → Web search and fetch** 里选 `Free search (auto)`（走降级）或某一家具体服务（锁定单一来源）。

### 失败降级与优先级

- 选 **Free search (auto)** 时，按面板上的序号顺序依次尝试：网络错误、401、429、响应解析失败都会自动换下一家；**调用方取消不降级**。
- 结果会在 `content` 顶部标一行 `来源：<服务名>`，面板顶部也显示「上次 · 服务名 · 时间」，用来确认这次是谁出的结果。
- 全部失败时抛一条汇总错误，逐家列出原因；一个 Key 都没配时提示先填 Key。
- 面板上的 ↑ ↓ 可调优先级，落盘在 `$DSH_HOME/free-dsh-search/state.json`，重启保留。
- 首次启用时，如果当前搜索源还是 dsh 原生实现（`deepseek-search-api` / `deepseek-official`）且至少有一个 Key，会自动接管一次；之后不再覆盖你的选择。

### Key 存在哪

走 `ctx.credentials` 解析，顺序为：凭据库（`$DSH_HOME/.credentials.yaml`）> 启动环境变量 > 项目 `.env` > `$DSH_HOME/.env`。也可以用环境变量 `TAVILY_API_KEY` 等直接提供。

## 兼容性

DSH 的「版本」和「形态」是两件事，能跑什么取决于两者的组合。本插件由两部分组成：Host 半（注册搜索源，任何形态都需要）和 Client 半（插件页里的面板，仅 Web 界面需要）。

### 一、DSH 版本

| 范围 | 状态 |
|---|---|
| `0.2.2-rc.3` | **实测可用**（下表逐项验证过） |
| `0.2.2-rc.5` | **实测可用**：真实搜索、聚合降级、来源标注、`lastProvider` 落盘，以及面板的测试 RPC 均通过 |
| `0.2.2` / `0.2.3-rc.x` 等 0.2.x 后续版本 | 装得上（`engines.dsh: ^0.2.2-rc.3`），未验证 |
| `0.3.0` 及以后 | 被 `engines.dsh` 拒绝，需在 profile 里授予版本豁免后再装 |

`^0.2.2-rc.3` 用的是 dsh 自己的判定（`semver.satisfies(..., { includePrerelease: true })`），所以 0.2 线上的 rc 版本不会被误拦。这个范围是我按"整条 0.2 线"给的，不代表逐版本测过——升级后请照下面的清单回归。

从 `0.2.2-rc.4` 起，官方基础组合不再把 `web.searchProvider` 固定为 `deepseek-search-api`，默认改为按模型路由自动选择（DeepSeek 模型路由上走 Messages 搜索）。已在 profile 里钉住 `free-search` 的安装不受影响；而未钉住时上游会静默优先 DeepSeek 的搜索源，不再抛歧义错误——本插件的首次自动接管正好覆盖这个新默认（`undefined`）。

### 二、DSH 形态与平台

| 形态 | 搜索（Host 半） | 插件页面板（Client 半） | 状态 |
|---|---|---|---|
| **Desktop · Windows**（Electron，打包在 `app.asar`） | ✅ | ✅ | **实测**：本机 0.2.2-rc.3 与 0.2.2-rc.5 全通 |
| **Desktop · macOS** | 理论可用 | 理论可用 | **未实测**。同一套打包，无平台相关代码；asar 内解析不到 `@deepseek-ai/dsh-web` 时会退化成带 `code` 的本地错误类，不会因此崩 |
| **Web（`dsh web` / npm 安装，浏览器）** | ✅ | ✅ | **未实测**。差别只在安装布局（非 asar）；pnpm 嵌套布局下若解析不到 `@deepseek-ai/dsh-web`，同上走兜底 |
| **CLI 无界面（headless / ACP / SDK profile）** | ✅（只要有 `web` 服务行） | ❌ 没有浏览器面 | Key 需写进 `$DSH_HOME/.credentials.yaml` 或环境变量，`searchProvider` 需在 profile 配置里钉住 |

补充说明：

- Node：本插件自身要求 `>=22.19.0`；而 dsh 0.2.2-rc.3 本身已要求 `>=24.9.0`，实际由 dsh 决定。
- 该组合里没有 `web` 服务时（例如精简 headless 组合），插件因为 `inject: ['web']` 会自动不激活——不会报错，也不会留下半截状态。
- 桌面的 Windows / macOS 差异对本插件只有一处可能影响：从 `DSH_INSTALL_DIR` 解析 dsh 自带包的路径形式。两种平台都支持，且失败有兜底。

### 三、升级 DSH 后要回归的点

1. `ctx.web.registerSearchProvider()` 与 `WebSearchProvider` 契约；
2. `ctx.connection.fetch.register()` 的精确路由 + `client-request` / `server-response` 信封（测试 / 排序 / 接管三个接口靠它）；
3. 客户端的 `plugins.bundle.config` 槽位及其 `view` / `form` props（面板本体）；
4. `configEditor.configuration()` / `edit()` 与 `web.searchProvider` 仍是 volatile 字段（「设为搜索源」靠它）。

回归方式：`node scripts/selftest.mjs` 反映不到 1~4 的破坏，必须再打开插件页点一次「一键测试」并跑一次真实搜索。

## 限制

- dsh 的搜索请求只有 `query` 和 `maxResults`，因此不支持时效过滤、域名限定、搜索深度这些厂商参数。
- 单次搜索超时 30 秒（测试 15 秒），条数上限 20、默认 5，以控制免费额度消耗；重定向一律按失败处理。
- 一次只能选一个 provider（dsh 的选择规则）；降级只在 `free-search` 内部发生，不做多源结果合并。
- `available()` 是同步检查，看不到凭据库里的 Key：Key 写错时选择仍然成功，直到真正搜索才报错。
- 未支持 FreeSerp（无稳定官方 API 文档）；Firecrawl 的无 Key 模式尚未接入。

## 开发

```sh
node scripts/selftest.mjs   # 或 npm test
```

离线自测，不联网、不消耗额度：用桩替换 `fetch` 与凭据服务，覆盖五家响应归一化（含 Firecrawl v1/v2 两种结构）、鉴权头与请求体、条数收敛、`ready()` 状态，以及缺 Key / 401 / 网络异常 / 空结果 / 降级 / 全部失败 / 无 Key / 取消不降级等路径。

目录：

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半：五个 provider + 聚合 provider + 三个 RPC 端点 |
| `client.js` | Client 半：插件页里的搜索源面板 |
| `cordis.patch.yml` | bundle 补丁，插入一行 `free-dsh-search` |
| `locale/*.json` | 插件列表里的标题与描述 |
| `docs/DETAIL.md` | 插件页面上展示的短说明 |
| `scripts/selftest.mjs` | 离线自测 |

## 许可

[MIT](LICENSE)
