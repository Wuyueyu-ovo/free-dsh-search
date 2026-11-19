# Changelog

本项目的所有重要变更都记录在这里。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [2.0.1] - 2026-11-19

### Added

- 聚合 provider 的结果在 `content` 顶部标出实际提供者（如 `来源：Firecrawl`），面板顶部同时显示「上次由谁提供」与时间；来源落盘在 `state.json` 的 `lastProvider`。

### Changed

- 兼容性复核：DSH `0.2.2-rc.5` 实测通过（真实搜索、聚合降级、来源标注、`lastProvider` 落盘，以及面板的测试 RPC 均正常），无需改动代码即可在该版本运行。
- 记录上游语义变化：`0.2.2-rc.4` 起官方基础组合不再固定 `web.searchProvider`，默认按模型路由自动选择；已钉住 `free-search` 的 profile 不受影响，未钉住时上游静默优先 DeepSeek 的搜索源，本插件的一次性自动接管覆盖该新默认。

## [2.0.0]

### Added

- 聚合 provider `free-search`：按可调优先级依次尝试，失败自动降级；取消不降级，全部失败时汇总错误。
- 新增 Exa、Firecrawl、LangSearch 三家搜索源，连同 Tavily、Serper 共五家。
- 插件页搜索源面板：黑白极简风格，含状态脉冲、流动虚线、结果徽标与排序位移等动效（遵守 `prefers-reduced-motion`）。
- 一键测试与单家测试：经 `ctx.connection.fetch.register` 注册的 `free-dsh-search/test`，真实最小搜索判断通断。
- 「设为搜索源」：通过 `configEditor` 改写 `web.searchProvider`（volatile，就地生效），并支持首次启用时对原生搜索源的一次性自动接管。
- 优先级排序接口 `free-dsh-search/order`，顺序落盘于 `$DSH_HOME/free-dsh-search/state.json`。
- 离线自测脚本 `scripts/selftest.mjs` 与 GitHub Actions 工作流。

### Fixed

- 连通性测试此前用 `ctx.connection.rpc.intercept()` 注册，自定义端点不生效导致全部报 HTTP 404；改为精确 Fetch 路由。

### Changed

- 包名由 `dsh-web-search-free` 改为 `free-dsh-search`（凭据引用名不变，旧 Key 继续可用）。
- `engines.dsh` 声明为 `^0.2.2-rc.3`（0.2.x 线；0.3.0 及以后需版本豁免），并在 README 给出「版本 × 形态 × 平台」的兼容矩阵。

## [1.0.0]

### Added

- 首个可用版本：Tavily 与 Serper 两个搜索 provider，插件页可填 Key，`web.searchProvider` 选到即可替换原生 DeepSeek Search API。
