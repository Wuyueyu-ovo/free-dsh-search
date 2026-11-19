/**
 * free-dsh-search 的 Client 半：插件详情页里的搜索源面板。
 *
 * 视觉取向是极简黑白技术风：细线描边、方角、等宽小字标签、单一反色主按钮；动效只出现在
 * 「状态点脉冲 / 测试时的流动虚线 / 结果徽标弹入 / 排序位移动画」四处，并遵守 prefers-reduced-motion。
 *
 * Key 写入凭据库（ctx.remote.credentials），保存后立即对下一次搜索生效；降级顺序与连通性测试
 * 走 Host 自己注册的 RPC（free-dsh-search/{state,order,test}），由 Connection 负责鉴权。
 */
window.__ModuleLoader__.load({
  id: 'free-dsh-search',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 字典命名空间。 */
    const NS = 'freeSearch'
    /** 面板在 plugins.bundle.config 里的 key，等于包名。 */
    const SLOT_KEY = 'free-dsh-search'
    /** Host 侧 RPC 端点。 */
    const RPC = {
      state: 'free-dsh-search/state',
      order: 'free-dsh-search/order',
      test: 'free-dsh-search/test',
      adopt: 'free-dsh-search/adopt',
    }

    /**
     * 五家搜索源；ref 必须与 Host 半 PROVIDER_SPECS 里的 ref 一致，
     * 文案键为 <id>Tag（定位）与 <id>Quota（额度）。
     */
    const PROVIDERS = [
      { id: 'tavily', label: 'Tavily', ref: 'TAVILY_API_KEY', url: 'https://app.tavily.com' },
      { id: 'serper', label: 'Serper', ref: 'SERPER_API_KEY', url: 'https://serper.dev' },
      { id: 'exa', label: 'Exa', ref: 'EXA_API_KEY', url: 'https://dashboard.exa.ai' },
      { id: 'firecrawl', label: 'Firecrawl', ref: 'FIRECRAWL_API_KEY', url: 'https://firecrawl.dev' },
      { id: 'langsearch', label: 'LangSearch', ref: 'LANGSEARCH_API_KEY', url: 'https://langsearch.com' },
    ]

    /** 默认顺序：与 Host 的默认优先级一致。 */
    const DEFAULT_ORDER = PROVIDERS.map((provider) => provider.id)
    /** 需要查询状态的凭据引用。 */
    const REFS = PROVIDERS.map((provider) => provider.ref)
    /** id → 展示信息。 */
    const BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]))

    const dictionaries = {
      zh: {
        title: '搜索源',
        configuredCount: '{done} / {total} 已配置',
        testAll: '一键测试',
        testing: '测试中',
        orderHint: '优先级：选中 Free search (auto) 时按下面的顺序依次尝试，失败自动降级。',
        testHint: '测试是一次真实的最小搜索，每家消耗 1 次额度。',
        lastProvider: '上次 · {provider} · {time}',
        lastNone: '上次 · 还没有搜索过',
        currentProvider: '当前搜索源',
        unsetProvider: '未设置',
        adopt: '设为搜索源',
        adoptAuto: '改为 Free search (auto)',
        adopting: '切换中',
        inUseAuto: '本插件 · 自动降级',
        inUseSingle: '本插件 · 单一源',
        adoptDone: '已切换为 {provider}',
        adoptFailed: '切换失败',
        up: '上移',
        down: '下移',
        tavilyTag: '面向 AI',
        tavilyQuota: '1000 次/月',
        serperTag: 'Google 结果',
        serperQuota: '2500 次一次',
        exaTag: '语义检索',
        exaQuota: '注册赠额',
        firecrawlTag: '抓取+检索',
        firecrawlQuota: '每月免费额度',
        langsearchTag: '为 Agent 设计',
        langsearchQuota: '免费计划',
        configured: '已配置',
        notConfigured: '未配置',
        loading: '读取中',
        test: '测试',
        save: '保存',
        replace: '更新',
        clear: '清除',
        getKey: '获取 Key',
        placeholder: '粘贴 API Key',
        saved: '{provider} 已保存',
        cleared: '{provider} 已清除',
        empty: '请先填入 Key',
        reachable: '通 · {ms}ms · {n} 条',
        unreachable: '断 · {msg}',
        orderFailed: '排序保存失败',
        loadFailed: '读取状态失败',
        notReady: '测试接口未就绪，重启 DSH 后再试',
        retry: '重试',
        loopbackOnly: '仅本机访问时可测试',
      },
      en: {
        title: 'Search sources',
        configuredCount: '{done} / {total} configured',
        testAll: 'Test all',
        testing: 'Testing',
        orderHint: 'Priority: with Free search (auto) selected, providers are tried top-down and fall back on failure.',
        testHint: 'A test is one real minimal search and costs one quota unit per provider.',
        lastProvider: 'Last · {provider} · {time}',
        lastNone: 'Last · no search yet',
        currentProvider: 'Current provider',
        unsetProvider: 'not set',
        adopt: 'Use this plugin',
        adoptAuto: 'Switch to Free search (auto)',
        adopting: 'Switching',
        inUseAuto: 'This plugin · auto fallback',
        inUseSingle: 'This plugin · single source',
        adoptDone: 'Switched to {provider}',
        adoptFailed: 'Switch failed',
        up: 'Move up',
        down: 'Move down',
        tavilyTag: 'Built for AI',
        tavilyQuota: '1,000 / month',
        serperTag: 'Google results',
        serperQuota: '2,500 one-time',
        exaTag: 'Neural search',
        exaQuota: 'Sign-up credits',
        firecrawlTag: 'Crawl + search',
        firecrawlQuota: 'Monthly free tier',
        langsearchTag: 'Made for agents',
        langsearchQuota: 'Free plan',
        configured: 'Configured',
        notConfigured: 'Not configured',
        loading: 'Reading',
        test: 'Test',
        save: 'Save',
        replace: 'Update',
        clear: 'Clear',
        getKey: 'Get key',
        placeholder: 'Paste API key',
        saved: '{provider} saved',
        cleared: '{provider} cleared',
        empty: 'Enter a key first',
        reachable: 'Up · {ms}ms · {n} hits',
        unreachable: 'Down · {msg}',
        orderFailed: 'Could not save the order',
        loadFailed: 'Could not read state',
        notReady: 'Test endpoint not ready — restart DSH and retry',
        retry: 'Retry',
        loopbackOnly: 'Testable from this machine only',
      },
    }

    /**
     * 面板样式：只在 token 缺失时回落到中性色值，动效统一在末尾按 reduced-motion 关闭。
     */
    const CSS = `
.wsf{
  --wsf-fg:var(--dsw-alias-label-primary,#111);
  --wsf-fg2:var(--dsw-alias-label-secondary,#6b7280);
  --wsf-line:var(--dsw-alias-border-l2,#e4e4e7);
  --wsf-line-soft:var(--dsw-alias-border-l1,#f1f1f2);
  --wsf-bg:var(--dsw-alias-bg-base,transparent);
  --wsf-ok:var(--dsw-alias-state-success-primary,#16a34a);
  --wsf-err:var(--dsw-alias-state-error-primary,#dc2626);
  display:flex;flex-direction:column;gap:14px;max-width:660px;
  color:var(--wsf-fg);font-size:13px;line-height:1.5;
}
.wsf-bar{display:flex;align-items:center;gap:10px}
.wsf-bar-title{font-size:13px;font-weight:600;letter-spacing:.02em}
.wsf-bar-meta{flex:1;min-width:0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--wsf-fg2);font-variant-numeric:tabular-nums}
.wsf-flow{height:1px;background-image:repeating-linear-gradient(90deg,var(--wsf-line) 0 6px,transparent 6px 12px)}.wsf.is-testing .wsf-flow{background-image:repeating-linear-gradient(90deg,var(--wsf-fg2) 0 6px,transparent 6px 12px);animation:wsf-flow 900ms linear infinite}
.wsf-status{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.wsf-status .wsf-state{flex:1;min-width:0}
.wsf-rows{display:flex;flex-direction:column;border-top:1px solid var(--wsf-line)}
.wsf-row{display:flex;flex-direction:column;gap:8px;padding:12px 0;border-bottom:1px solid var(--wsf-line);animation:wsf-settle 220ms ease-out}
.wsf-head{display:flex;align-items:center;gap:8px;min-width:0}
.wsf-index{font-size:11px;font-variant-numeric:tabular-nums;letter-spacing:.04em;color:var(--wsf-fg2);width:16px;flex:none}
.wsf-dot{width:6px;height:6px;background:var(--wsf-line);flex:none}
.wsf-row.is-on .wsf-dot{background:var(--wsf-ok);animation:wsf-pulse 2.4s ease-in-out infinite}
.wsf-name{font-weight:600;font-size:13px}
.wsf-tag{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--wsf-fg2)}
.wsf-quota{flex:1;min-width:0;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--wsf-fg2);text-align:right;font-variant-numeric:tabular-nums}
.wsf-link{font-size:11px;color:var(--wsf-fg2);text-decoration:none;border-bottom:1px solid var(--wsf-line);padding-bottom:1px;white-space:nowrap}
.wsf-link:hover{color:var(--wsf-fg);border-bottom-color:var(--wsf-fg)}
.wsf-order{display:flex;gap:2px;flex:none}
.wsf-mini{
  width:20px;height:20px;padding:0;line-height:1;border:1px solid var(--wsf-line);border-radius:2px;
  background:transparent;color:var(--wsf-fg2);font:inherit;font-size:11px;cursor:pointer;
  transition:color 120ms ease,border-color 120ms ease;
}
.wsf-mini:hover:not(:disabled){color:var(--wsf-fg);border-color:var(--wsf-fg)}
.wsf-mini:disabled{opacity:.3;cursor:default}
.wsf-controls{display:flex;align-items:center;gap:6px}
.wsf-input{
  flex:1;min-width:0;height:30px;padding:0 8px;border:1px solid var(--wsf-line);border-radius:2px;
  background:var(--wsf-bg);color:var(--wsf-fg);font:inherit;font-size:12px;letter-spacing:.02em;
}
.wsf-input:focus-visible{outline:none;border-color:var(--wsf-fg)}
.wsf-input::placeholder{color:var(--wsf-fg2);opacity:.7}
.wsf-btn{
  height:30px;padding:0 10px;border:1px solid var(--wsf-line);border-radius:2px;background:transparent;
  color:var(--wsf-fg2);font:inherit;font-size:12px;letter-spacing:.04em;cursor:pointer;white-space:nowrap;
  transition:color 120ms ease,border-color 120ms ease,background-color 120ms ease;
}
.wsf-btn:hover:not(:disabled){color:var(--wsf-fg);border-color:var(--wsf-fg)}
.wsf-btn:disabled{opacity:.45;cursor:default}
.wsf-btn.is-primary{background:var(--wsf-fg);border-color:var(--wsf-fg);color:var(--wsf-bg)}
.wsf-btn.is-primary:hover:not(:disabled){opacity:.85;color:var(--wsf-bg)}
.wsf-btn.is-busy{position:relative;overflow:hidden;color:var(--wsf-fg);border-color:var(--wsf-fg)}
.wsf-btn.is-busy::after{
  content:"";position:absolute;inset:0;transform:translateX(-100%);
  background:linear-gradient(90deg,transparent,var(--wsf-line-soft),transparent);
  animation:wsf-sweep 1s linear infinite;
}
.wsf-foot{display:flex;align-items:center;gap:10px;min-height:16px;flex-wrap:wrap}
.wsf-state{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--wsf-fg2);font-variant-numeric:tabular-nums}
.wsf-badge{
  display:inline-flex;align-items:center;gap:6px;padding:1px 6px;border:1px solid var(--wsf-line);border-radius:2px;
  font-size:11px;letter-spacing:.06em;text-transform:uppercase;animation:wsf-pop 260ms cubic-bezier(.2,.9,.2,1);
}
.wsf-badge.is-ok{color:var(--wsf-ok);border-color:var(--wsf-ok)}
.wsf-badge.is-down{color:var(--wsf-err);border-color:var(--wsf-err)}
.wsf-note{font-size:11px;letter-spacing:.04em;color:var(--wsf-fg2)}
.wsf-note.is-err{color:var(--wsf-err)}
@keyframes wsf-flow{from{background-position:0 0}to{background-position:12px 0}}
@keyframes wsf-pulse{0%,100%{box-shadow:0 0 0 0 rgba(22,163,74,.35)}50%{box-shadow:0 0 0 3px rgba(22,163,74,0)}}
@keyframes wsf-pop{from{opacity:0;transform:translateY(3px) scale(.97)}to{opacity:1;transform:none}}
@keyframes wsf-sweep{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
@keyframes wsf-settle{from{opacity:.6;transform:translateY(-2px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){
  .wsf-row.is-on .wsf-dot,.wsf.is-testing .wsf-flow,.wsf-btn.is-busy::after,.wsf-badge,.wsf-row{animation:none}
}
`

    /**
     * 组装面板组件：闭包持有 ctx、t 与 connection，组件只做渲染和 Remote/RPC 调用。
     * @param ctx - 浏览器插件上下文。
     * @returns 渲染 plugins.bundle.config 条目的 React 组件。
     */
    function createPanel(ctx) {
      const t = ctx.locale.bind(NS)

      return function FreeSearchPanel(props) {
        const view = props?.view ?? 'page'
        const connection = ctx.get('connection')
        const canTest = connection !== undefined && connection.isLoopback === true
        const [entries, setEntries] = React.useState(undefined)
        const [order, setOrder] = React.useState(DEFAULT_ORDER)
        const [currentProvider, setCurrentProvider] = React.useState(null)
        const [lastProvider, setLastProvider] = React.useState(null)
        const [loadError, setLoadError] = React.useState(undefined)
        const [drafts, setDrafts] = React.useState({})
        const [busy, setBusy] = React.useState(undefined)
        const [tests, setTests] = React.useState({})
        const [notice, setNotice] = React.useState(undefined)
        const [bulkRunning, setBulkRunning] = React.useState(false)
        const [savingOrder, setSavingOrder] = React.useState(false)
        const [adopting, setAdopting] = React.useState(false)

        /** 读一次 Key 的配置状态（只拿 configured / masked / source，不取明文）。 */
        const refresh = React.useCallback(async () => {
          const response = await ctx.remote.credentials.describe(REFS)
          if (!response.ok) {
            setLoadError(response.error?.message ?? t('loadFailed'))
            return
          }
          setLoadError(undefined)
          setEntries(response.value)
        }, [])

        /** 读一次降级顺序与当前搜索源；RPC 不可用时保留本地默认顺序。 */
        const refreshRemoteState = React.useCallback(async () => {
          if (!canTest) return
          try {
            const response = await connection.rpc.call('/api', RPC.state, {})
            if (!response.ok) return
            if (Array.isArray(response.value?.rows)) {
              setOrder(response.value.rows.map((row) => row.id).filter((id) => BY_ID.has(id)))
            }
            setCurrentProvider(typeof response.value?.searchProvider === 'string' ? response.value.searchProvider : null)
            setLastProvider(response.value?.lastProvider ?? null)
          } catch {
            // 状态读不到不影响填 Key，保留当前值即可。
          }
        }, [])

        React.useEffect(() => {
          void refresh()
          void refreshRemoteState()
        }, [refresh, refreshRemoteState])

        React.useEffect(() => {
          // 别的入口（命令行、另一个页面）改了 Key 时同步刷新。
          return ctx.remote.$on('credentials/reference-updated', (ref) => {
            if (REFS.includes(ref)) void refresh()
          })
        }, [refresh])

        /**
         * 保存一把 Key。
         * @param provider - 某一家搜索源。
         */
        const save = async (provider) => {
          const value = (drafts[provider.id] ?? '').trim()
          if (value.length === 0) {
            setNotice({ kind: 'err', text: t('empty') })
            return
          }
          setBusy({ id: provider.id, kind: 'save' })
          const response = await ctx.remote.credentials.set(provider.ref, value)
          setBusy(undefined)
          if (!response.ok) {
            setNotice({ kind: 'err', text: response.error?.message ?? t('loadFailed') })
            return
          }
          setDrafts((current) => ({ ...current, [provider.id]: '' }))
          setNotice({ kind: 'ok', text: t('saved', { provider: provider.label }) })
          await refresh()
        }

        /**
         * 清除一把已保存的 Key。
         * @param provider - 某一家搜索源。
         */
        const clear = async (provider) => {
          setBusy({ id: provider.id, kind: 'clear' })
          const response = await ctx.remote.credentials.unset(provider.ref)
          setBusy(undefined)
          if (!response.ok) {
            setNotice({ kind: 'err', text: response.error?.message ?? t('loadFailed') })
            return
          }
          setTests((current) => ({ ...current, [provider.id]: undefined }))
          setNotice({ kind: 'ok', text: t('cleared', { provider: provider.label }) })
          await refresh()
        }

        /**
         * 单家连通性测试：走 Host 的 RPC，用一次最小搜索判断 Key / 网络 / 解析是否都通。
         * @param provider - 某一家搜索源。
         * @returns 是否通。
         */
        const test = async (provider) => {
          if (!canTest) return false
          setTests((current) => ({ ...current, [provider.id]: { state: 'running' } }))
          try {
            const response = await connection.rpc.call('/api', RPC.test, { provider: provider.id })
            if (!response.ok) throw new Error(response.error?.message ?? t('loadFailed'))
            const value = response.value
            setTests((current) => ({
              ...current,
              [provider.id]: value.reachable
                ? { state: 'ok', ms: value.ms, sources: value.sources, sample: value.sample }
                : { state: 'down', ms: value.ms, message: value.message },
            }))
            return value.reachable === true
          } catch (error) {
            const message = error?.message ?? String(error)
            setTests((current) => ({
              ...current,
              [provider.id]: /HTTP 404/.test(message)
                ? { state: 'down', message: t('notReady') }
                : { state: 'down', message },
            }))
            return false
          }
        }

        /** 一键测试：依次测所有已配置的 Key，边测边出结果。 */
        const testAll = async () => {
          if (!canTest || entries === undefined) return
          setBulkRunning(true)
          setNotice(undefined)
          for (const id of order) {
            const provider = BY_ID.get(id)
            if (provider === undefined || entries[provider.ref]?.configured !== true) continue
            await test(provider)
          }
          setBulkRunning(false)
        }

        /**
         * 调整某一家的优先级：本地先动，再落盘；失败则回滚。
         * @param id - 搜索源 id。
         * @param delta - -1 上移，+1 下移。
         */
        const move = async (id, delta) => {
          const index = order.indexOf(id)
          const target = index + delta
          if (index < 0 || target < 0 || target >= order.length) return
          const next = [...order]
          next.splice(index, 1)
          next.splice(target, 0, id)
          const previous = order
          setOrder(next)
          if (!canTest) return
          setSavingOrder(true)
          try {
            const response = await connection.rpc.call('/api', RPC.order, { order: next })
            if (!response.ok) throw new Error(response.error?.message ?? t('orderFailed'))
            if (Array.isArray(response.value?.rows)) {
              setOrder(response.value.rows.map((row) => row.id).filter((rowId) => BY_ID.has(rowId)))
            }
            setNotice(undefined)
          } catch (error) {
            setOrder(previous)
            setNotice({ kind: 'err', text: `${t('orderFailed')}：${error?.message ?? String(error)}` })
          } finally {
            setSavingOrder(false)
          }
        }

        /**
         * 一键把搜索源切到本插件：改写 web 行的 searchProvider，字段是 volatile，改完立即生效。
         */
        const adopt = async () => {
          if (!canTest) return
          setAdopting(true)
          setNotice(undefined)
          try {
            const response = await connection.rpc.call('/api', RPC.adopt, { provider: 'free-search' })
            if (!response.ok) throw new Error(response.error?.message ?? t('adoptFailed'))
            setCurrentProvider(typeof response.value?.searchProvider === 'string' ? response.value.searchProvider : 'free-search')
            setNotice({ kind: 'ok', text: t('adoptDone', { provider: 'Free search (auto)' }) })
          } catch (error) {
            setNotice({ kind: 'err', text: `${t('adoptFailed')}：${error?.message ?? String(error)}` })
          } finally {
            setAdopting(false)
          }
        }

        /**
         * 一项搜索源的状态行：未配置时给定位与额度，配置后给掩码与来源。
         * @param provider - 某一家搜索源。
         * @returns 状态文本。
         */
        const stateText = (provider) => {
          if (entries === undefined) return t('loading')
          const entry = entries[provider.ref]
          if (entry === undefined || entry.configured !== true) return `${t('notConfigured')} · ${t(`${provider.id}Tag`)} · ${t(`${provider.id}Quota`)}`
          return [t('configured'), entry.masked, entry.source].filter((part) => part !== undefined && part !== '').join(' · ')
        }

        const configuredCount = entries === undefined
          ? 0
          : PROVIDERS.filter((provider) => entries[provider.ref]?.configured === true).length
        const anyTesting = bulkRunning || Object.values(tests).some((entry) => entry?.state === 'running')
        // 已经在用聚合 provider 时无需再切；用着本插件的单一源时提供「改为 auto」的入口。
        const usingAuto = currentProvider === 'free-search'
        const usingSingle = !usingAuto && BY_ID.has(currentProvider)

        if (view === 'summary') {
          return h('span', { className: 'wsf-state' }, entries === undefined
            ? t('loading')
            : t('configuredCount', { done: configuredCount, total: PROVIDERS.length }))
        }

        return h('div', { className: anyTesting ? 'wsf is-testing' : 'wsf' },
          h('style', { key: 'css' }, CSS),
          h('div', { className: 'wsf-bar' },
            h('span', { className: 'wsf-bar-title' }, t('title')),
            h('span', { className: 'wsf-bar-meta' }, entries === undefined
              ? t('loading')
              : t('configuredCount', { done: configuredCount, total: PROVIDERS.length })),
            h('button', {
              type: 'button',
              className: bulkRunning ? 'wsf-btn is-primary is-busy' : 'wsf-btn is-primary',
              disabled: !canTest || bulkRunning || configuredCount === 0,
              title: canTest ? undefined : t('loopbackOnly'),
              onClick: () => void testAll(),
            }, bulkRunning ? t('testing') : t('testAll')),
          ),
          h('div', { className: 'wsf-flow' }),
          h('div', { className: 'wsf-status' },
            h('span', { className: 'wsf-state' }, `${t('currentProvider')} · ${currentProvider ?? t('unsetProvider')}`),
            h('span', { className: 'wsf-state' }, lastProvider === null
              ? t('lastNone')
              : t('lastProvider', { provider: lastProvider.title ?? lastProvider.id, time: clockOf(lastProvider.at) })),
            usingAuto
              ? h('span', { className: 'wsf-badge is-ok' }, t('inUseAuto'))
              : h('button', {
                type: 'button',
                className: adopting ? 'wsf-btn is-primary is-busy' : 'wsf-btn is-primary',
                disabled: !canTest || adopting,
                title: canTest ? undefined : t('loopbackOnly'),
                onClick: () => void adopt(),
              }, adopting ? t('adopting') : usingSingle ? t('adoptAuto') : t('adopt')),
          ),
          h('div', { className: 'wsf-rows' }, ...order.map((id, index) => {
            const provider = BY_ID.get(id)
            if (provider === undefined) return null
            const entry = entries?.[provider.ref]
            const isOn = entry?.configured === true
            const rowTest = tests[provider.id]
            const saving = busy?.id === provider.id && busy.kind === 'save'
            const clearing = busy?.id === provider.id && busy.kind === 'clear'
            return h('div', { key: provider.id, className: isOn ? 'wsf-row is-on' : 'wsf-row' },
              h('div', { className: 'wsf-head' },
                h('span', { className: 'wsf-index' }, String(index + 1).padStart(2, '0')),
                h('span', { className: 'wsf-dot' }),
                h('span', { className: 'wsf-name' }, provider.label),
                h('span', { className: 'wsf-tag' }, t(`${provider.id}Tag`)),
                h('span', { className: 'wsf-quota' }, t(`${provider.id}Quota`)),
                h('span', { className: 'wsf-order' },
                  h('button', {
                    type: 'button',
                    className: 'wsf-mini',
                    disabled: index === 0 || savingOrder,
                    title: t('up'),
                    onClick: () => void move(provider.id, -1),
                  }, '↑'),
                  h('button', {
                    type: 'button',
                    className: 'wsf-mini',
                    disabled: index === order.length - 1 || savingOrder,
                    title: t('down'),
                    onClick: () => void move(provider.id, 1),
                  }, '↓'),
                ),
                h('a', { className: 'wsf-link', href: provider.url, target: '_blank', rel: 'noreferrer' }, t('getKey')),
              ),
              h('div', { className: 'wsf-controls' },
                h('input', {
                  className: 'wsf-input',
                  type: 'password',
                  autoComplete: 'off',
                  spellCheck: false,
                  placeholder: t('placeholder'),
                  value: drafts[provider.id] ?? '',
                  onChange: (event) => {
                    const value = event.target.value
                    setDrafts((current) => ({ ...current, [provider.id]: value }))
                  },
                }),
                h('button', {
                  type: 'button',
                  className: 'wsf-btn is-primary',
                  disabled: saving,
                  onClick: () => void save(provider),
                }, saving ? '···' : isOn ? t('replace') : t('save')),
                h('button', {
                  type: 'button',
                  className: rowTest?.state === 'running' ? 'wsf-btn is-busy' : 'wsf-btn',
                  disabled: !canTest || rowTest?.state === 'running',
                  title: canTest ? undefined : t('loopbackOnly'),
                  onClick: () => void test(provider),
                }, t('test')),
                h('button', {
                  type: 'button',
                  className: 'wsf-btn',
                  disabled: !isOn || clearing,
                  onClick: () => void clear(provider),
                }, t('clear')),
              ),
              h('div', { className: 'wsf-foot' },
                h('span', { className: 'wsf-state' }, stateText(provider)),
                rowTest?.state === 'ok'
                  ? h('span', { className: 'wsf-badge is-ok' }, t('reachable', { ms: rowTest.ms, n: rowTest.sources }))
                  : null,
                rowTest?.state === 'down'
                  ? h('span', { className: 'wsf-badge is-down' }, t('unreachable', { msg: shorten(rowTest.message, 90) }))
                  : null,
              ),
            )
          })),
          h('div', { className: 'wsf-foot' },
            h('span', { className: 'wsf-note' }, t('orderHint')),
            h('span', { className: 'wsf-note' }, t('testHint')),
            loadError === undefined ? null : h('span', { className: 'wsf-note is-err' }, `${t('loadFailed')}：${loadError}`),
            loadError === undefined ? null : h('button', {
              type: 'button',
              className: 'wsf-btn',
              onClick: () => void refresh(),
            }, t('retry')),
            notice === undefined
              ? null
              : h('span', { className: notice.kind === 'ok' ? 'wsf-note' : 'wsf-note is-err' }, notice.text),
          ),
        )
      }
    }

    /**
     * 截断过长文案，避免一行提示被撑爆。
     * @param value - 原始文本。
     * @param limit - 字符上限。
     * @returns 截断后的文本。
     */
    function shorten(value, limit) {
      const text = typeof value === 'string' ? value : String(value ?? '')
      return text.length <= limit ? text : `${text.slice(0, limit)}…`
    }

    /**
     * 把 ISO 时间显示成本地时:分，时间缺失或非法时返回空串。
     * @param iso - ISO-8601 时间。
     * @returns 形如 14:05 的本地时间。
     */
    function clockOf(iso) {
      if (typeof iso !== 'string') return ''
      const at = new Date(iso)
      if (Number.isNaN(at.getTime())) return ''
      return at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.credentials'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, dictionaries), 'free-dsh-search: dictionaries')
        ctx.effect(
          () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
            name: 'plugins.bundle.config',
            key: SLOT_KEY,
            locale: NS,
          }, createPanel(ctx))),
          'free-dsh-search: panel',
        )
      },
    }
  },
})
