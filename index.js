/**
 * free-dsh-search 的 Host 半。
 *
 * 两部分能力：
 * 1. 把五家带免费额度的搜索服务注册成 ctx.web 的搜索 provider（tavily / serper / exa / firecrawl / langsearch）。
 * 2. 注册一个聚合 provider（free-search）：按可调优先级依次尝试，前一家失败自动降级到下一家。
 *
 * 三条与 dsh-web 契约相关的设计约束：
 * - available() 必须同步且不发网络请求，只能表达「provider 可用」，看不到异步凭据库里的 Key；
 *   Key 缺失由 search() 抛 WEB_PROVIDER_CREDENTIAL_MISSING 报出，ready() 决定模型这一步是否拿到 web_search。
 * - Key 统一走 ctx.credentials 解析（存储在 .credentials.yaml 的 Key 优先于环境变量，改完立即生效），
 *   没有该服务时回落到进程环境变量。
 * - 五家厂商的请求体与响应结构差异全部在本文件内归一化为 WebSearchResult，不向上层泄漏。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * dsh 安装目录里的 WebError 兜底实现：只在自定义安装布局下取不到真实类时使用，
 * 保证插件仍能激活，且错误仍带稳定 code。
 */
class FallbackWebError extends Error {
  constructor(message, code, options) {
    super(message, options)
    this.code = code
    this.name = 'WebError'
  }
}

/**
 * 取运行时正在用的那份 WebError。
 *
 * 插件是用 junction 装在 profile 里的，包内写 `import '@deepseek-ai/dsh-web'` 会被 Node
 * 从插件真实路径解析，而 dsh 自带包只在安装目录下，因此按 DSH_INSTALL_DIR 解析后动态导入
 * 同一个文件 URL —— 这样拿到的类和 ctx.web 抛的是同一个模块实例，instanceof 与 code 都成立。
 * @returns WebError 构造函数。
 */
async function loadWebError() {
  const installDir = process.env.DSH_INSTALL_DIR
  if (typeof installDir === 'string' && installDir.length > 0) {
    try {
      const requireFromInstall = createRequire(pathToFileURL(`${installDir.replaceAll('\\', '/')}/index.js`))
      const resolved = requireFromInstall.resolve('@deepseek-ai/dsh-web')
      const module = await import(pathToFileURL(resolved).href)
      if (typeof module.WebError === 'function') return module.WebError
    } catch {
      // 落到兜底实现：错误信息照常可读，只是不再与 seam 共用同一个类。
    }
  }
  return FallbackWebError
}

const WebError = await loadWebError()

/** Loader 诊断用的插件名。 */
export const name = 'free-dsh-search'

/** 依赖 web seam；connection 等可选服务用 ctx.inject 单独取。 */
export const inject = ['web']

// 导出给自测脚本使用（scripts/selftest.mjs）；对外仍只有 apply 参与运行时装配。
export { annotateResult, createAutoProvider, createSearchProvider, PROVIDER_SPECS, resolveOrder, shouldAutoAdopt }

/** 聚合 provider 的 id，也是设置页「Web search provider」菜单里的那一项。 */
const AUTO_PROVIDER_ID = 'free-search'
/** 请求没带 maxResults 时的条数，避免默认拉满消耗额度。 */
const DEFAULT_MAX_RESULTS = 5
/** 单次搜索最多取多少条，控制免费额度消耗。 */
const MAX_RESULTS_LIMIT = 20
/** 单次搜索的整体超时；dsh-tool-web 给 web_search 的超时是 60 秒，这里留出余量。 */
const SEARCH_TIMEOUT_MS = 30_000
/** 连通性测试的超时，比正式搜索更短，避免按钮长时间转圈。 */
const TEST_TIMEOUT_MS = 15_000
/** 摘录进 snippet 的字符上限，避免把整段正文塞进模型上下文。 */
const SNIPPET_LIMIT = 400
/** 失败信息里回显的响应体上限。 */
const ERROR_BODY_LIMIT = 300
/** 连通性测试用的查询词。 */
const TEST_QUERY = 'ping'
/** 本插件自有 RPC 的 endpoint 前缀。 */
const RPC_NS = 'free-dsh-search'

/**
 * 五家 provider 的声明。ref 与 Client 卡片写入的凭据引用必须一致；
 * headers / buildBody / read 是该厂商的全部差异所在。
 */
const PROVIDER_SPECS = [
  {
    id: 'tavily',
    title: 'Tavily',
    ref: 'TAVILY_API_KEY',
    description: {
      en: 'Tavily search. Free tier: about 1,000 credits per month, no card required.',
      zh: 'Tavily 搜索。免费额度约每月 1000 次，无需绑卡。',
    },
    endpoint: 'https://api.tavily.com/search',
    headers: (key) => ({ authorization: `Bearer ${key}` }),
    buildBody: (query, limit) => ({ query, max_results: limit, search_depth: 'basic' }),
    read: readTavily,
  },
  {
    id: 'serper',
    title: 'Serper',
    ref: 'SERPER_API_KEY',
    description: {
      en: 'Google results through Serper. One-off 2,500 free queries, no card required.',
      zh: '通过 Serper 取 Google 结果。一次性 2500 次免费查询，无需绑卡。',
    },
    endpoint: 'https://google.serper.dev/search',
    headers: (key) => ({ 'x-api-key': key }),
    buildBody: (query, limit) => ({ q: query, num: limit }),
    read: readSerper,
  },
  {
    id: 'exa',
    title: 'Exa',
    ref: 'EXA_API_KEY',
    description: {
      en: 'Exa neural search. Free credits on sign-up plus a small monthly allowance.',
      zh: 'Exa 语义搜索。注册赠额度，另有每月小额免费额度。',
    },
    endpoint: 'https://api.exa.ai/search',
    headers: (key) => ({ 'x-api-key': key }),
    buildBody: (query, limit) => ({ query, numResults: limit, contents: { text: true } }),
    read: readExa,
  },
  {
    id: 'firecrawl',
    title: 'Firecrawl',
    ref: 'FIRECRAWL_API_KEY',
    description: {
      en: 'Firecrawl search over crawled pages. Free plan credits per month.',
      zh: 'Firecrawl 检索已抓取页面。免费计划每月有额度。',
    },
    endpoint: 'https://api.firecrawl.dev/v2/search',
    headers: (key) => ({ authorization: `Bearer ${key}` }),
    buildBody: (query, limit) => ({ query, limit }),
    read: readFirecrawl,
  },
  {
    id: 'langsearch',
    title: 'LangSearch',
    ref: 'LANGSEARCH_API_KEY',
    description: {
      en: 'LangSearch web search for AI agents. Free plan for light use.',
      zh: 'LangSearch 面向 AI agent 的网页搜索。免费计划适合轻量使用。',
    },
    endpoint: 'https://api.langsearch.com/v1/web-search',
    headers: (key) => ({ authorization: `Bearer ${key}` }),
    buildBody: (query, limit) => ({ query, count: limit }),
    read: readLangSearch,
  },
]

/** 默认降级顺序：列表顺序即优先级。 */
const DEFAULT_ORDER = PROVIDER_SPECS.map((spec) => spec.id)

/** 插件自有状态（降级顺序 + 是否已自动接管）在 $DSH_HOME 下的落盘位置，与 emoji-packs 同层。 */
const STATE_DIR = 'free-dsh-search'
const STATE_FILE = 'state.json'

/** 进程内缓存的状态（顺序 + 是否已自动接管过），避免每次搜索都读盘。 */
let cachedState

/**
 * 读落盘状态，读不到或格式不对时回落到默认值。
 * @returns { order: string[], adopted: boolean, lastProvider?: { id: string, title: string, at: string } }
 */
async function loadState() {
  if (cachedState !== undefined) return cachedState
  try {
    const parsed = JSON.parse(await readFile(statePath(), 'utf8'))
    cachedState = {
      order: Array.isArray(parsed?.order) ? parsed.order.filter((id) => typeof id === 'string') : [...DEFAULT_ORDER],
      adopted: parsed?.adopted === true,
      ...isRecord(parsed?.lastProvider) ? { lastProvider: parsed.lastProvider } : {},
    }
  } catch {
    cachedState = { order: [...DEFAULT_ORDER], adopted: false }
  }
  return cachedState
}

/**
 * 写入状态：先写临时文件再 rename，避免半截文件。
 * @param patch - 要合并进状态的部分字段。
 */
async function saveState(patch) {
  const current = await loadState()
  const next = { ...current, ...patch }
  const target = statePath()
  await mkdir(join(dirnameOf(target)), { recursive: true })
  const temp = `${target}.tmp`
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await rename(temp, target)
  cachedState = next
}

/**
 * 状态文件的绝对路径。
 * @returns 路径。
 */
function statePath() {
  const home = typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, STATE_DIR, STATE_FILE)
}

/**
 * 挂载五个 provider + 聚合 provider，并注册本插件的 RPC（测试 / 状态 / 排序）。
 * @param ctx - Host 插件上下文。
 */
export function apply(ctx) {
  const providers = new Map()
  for (const spec of PROVIDER_SPECS) {
    const provider = createSearchProvider(ctx, spec)
    providers.set(spec.id, provider)
    ctx.effect(() => ctx.web.registerSearchProvider(provider), `free-dsh-search: ${spec.id}`)
  }
  const autoProvider = createAutoProvider(ctx, providers)
  ctx.effect(() => ctx.web.registerSearchProvider(autoProvider), 'free-dsh-search: aggregate')

  // 首次启用时如果搜索源还是 dsh 原生那家，直接接管一次；之后不再覆盖用户的选择。
  // 放在微任务里跑：写配置会走 Loader reconcile，不该阻塞本插件的激活。
  void Promise.resolve().then(() => autoAdoptOnce(ctx)).catch((error) => {
    try {
      ctx.logger?.warn?.(`free-dsh-search: 自动接管搜索源失败：${describeError(error)}`)
    } catch {
      // 日志不可用时静默：接管失败不影响插件本身工作。
    }
  })

  // RPC 用 Connection 的精确 Fetch 路由注册：鉴权、来源校验与请求体上限由 Connection 负责，
  // 信封（client-request / server-response）在下面自己校验与组装。
  ctx.inject(['connection'], (scope) => {
    registerRpcRoute(scope, 'test', (payload, signal) => handleTest(providers, payload, signal))
    registerRpcRoute(scope, 'state', () => handleState(ctx, providers))
    registerRpcRoute(scope, 'order', (payload) => handleOrder(ctx, providers, payload))
    registerRpcRoute(scope, 'adopt', (payload) => handleAdopt(ctx, payload))
  })
}

/**
 * 注册一个本插件的 RPC 端点：POST /api/free-dsh-search/<name>。
 * @param scope - 带 connection 服务的作用域。
 * @param name - 端点名，如 test / state / order。
 * @param handle - 处理函数，返回成功值。
 */
function registerRpcRoute(scope, name, handle) {
  const method = `${RPC_NS}/${name}`
  scope.effect(() => scope.connection.fetch.register({
    path: `/api/${method}`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
      if (contentType !== 'application/json') return new Response('content type must be application/json', { status: 415 })
      let envelope
      try {
        envelope = await request.json()
      } catch {
        return new Response('body is not JSON', { status: 400 })
      }
      if (!isRecord(envelope) || envelope.type !== 'client-request' || envelope.method !== method || typeof envelope.rpcId !== 'string') {
        return new Response('invalid RPC envelope', { status: 400 })
      }
      let result
      try {
        result = { ok: true, value: await handle(envelope.payload, request.signal) }
      } catch (error) {
        result = failure('rpc-failed', describeError(error))
      }
      return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result })
    },
  }), `free-dsh-search: rpc ${name}`)
}

/**
 * 造一个单家 provider：把确认好的 Key、请求体和响应读取器组合起来。
 * @param ctx - Host 上下文，用于取凭据服务。
 * @param spec - PROVIDER_SPECS 里的一项。
 * @returns ctx.web 可注册的搜索 provider。
 */
function createSearchProvider(ctx, spec) {
  return {
    id: spec.id,
    title: spec.title,
    description: spec.description,
    /**
     * 契约要求同步且不发网络请求，因此这里只表示「provider 可用」，
     * 不代表 Key 已配置（Key 是否配置由 ready() 和 search() 回答）。
     * @returns 恒为 true。
     */
    available() {
      return true
    },
    /**
     * 本次搜索能否带上凭据；只看配置，不发网络请求。
     * @returns Key 已配置时为 true。
     */
    async ready() {
      return await hasCredential(ctx, spec.ref)
    },
    /**
     * 执行一次搜索。
     * @param request - 查询词与条数上限。
     * @param signal - 调用方的取消信号。
     * @returns 归一化后的搜索结果。
     */
    async search(request, signal) {
      return await runSearch(ctx, spec, request.query, resolveLimit(request.maxResults), SEARCH_TIMEOUT_MS, signal)
    },
  }
}

/**
 * 造聚合 provider：按优先级依次尝试，前一家失败自动降级。
 * @param ctx - Host 上下文。
 * @param providers - id → 单家 provider 的映射。
 * @returns ctx.web 可注册的聚合 provider。
 */
function createAutoProvider(ctx, providers) {
  const specsById = new Map(PROVIDER_SPECS.map((spec) => [spec.id, spec]))
  return {
    id: AUTO_PROVIDER_ID,
    title: 'Free search (auto)',
    description: {
      en: 'Tries the configured free search providers in your priority order and falls back on failure.',
      zh: '按你设定的优先级依次尝试已配置的免费搜索源，失败自动降级。',
    },
    available() {
      return true
    },
    /**
     * 只要还有一个配置了 Key 的搜索源就可用。
     * @returns 有可用搜索源时为 true。
     */
    async ready() {
      for (const id of await resolveOrder(providers)) {
        const spec = specsById.get(id)
        if (spec !== undefined && await hasCredential(ctx, spec.ref)) return true
      }
      return false
    },
    /**
     * 按优先级尝试，成功即返回；全部失败时抛出汇总错误。
     * @param request - 查询词与条数上限。
     * @param signal - 调用方的取消信号。
     * @returns 第一家成功 provider 的结果。
     */
    async search(request, signal) {
      const attempts = []
      let attempted = 0
      let lastError
      for (const id of await resolveOrder(providers)) {
        const provider = providers.get(id)
        const spec = specsById.get(id)
        if (provider === undefined || spec === undefined) continue
        if (!await hasCredential(ctx, spec.ref)) {
          attempts.push(`${spec.title}=未配置`)
          continue
        }
        attempted += 1
        try {
          const result = await provider.search(request, signal)
          // 聚合状态下必须能看出结果来自哪一家：content 前缀足够便宜（十来个 token），
          // 且 dsh-tool-web 只在 content 非空时才渲染答案段，因此这里统一补齐。
          await saveState({ lastProvider: { id: spec.id, title: spec.title, at: new Date().toISOString() } })
          return annotateResult(result, spec.title)
        } catch (error) {
          // 取消不是失败，不降级：直接把它交还给调用方。
          if (signal?.aborted === true) throw error
          attempts.push(`${spec.title}=${shortenError(describeError(error))}`)
          lastError = error
        }
      }
      if (attempted === 0) {
        throw new WebError(
          '没有可用的搜索源：请先在 Plugins > 免费网页搜索 里填写至少一个 API Key',
          'WEB_PROVIDER_UNAVAILABLE',
        )
      }
      throw new WebError(
        `所有搜索源都失败了（${attempts.filter((item) => !item.endsWith('=未配置')).join('；')}）`,
        typeof lastError?.code === 'string' ? lastError.code : 'WEB_PROVIDER_UNAVAILABLE',
        lastError === undefined ? undefined : { cause: lastError },
      )
    },
  }
}

/**
 * 在结果前面标出实际提供者：content 已有直答时前置一行，没有时用这一行补位。
 * @param result - 单家 provider 的搜索结果。
 * @param title - 该 provider 的显示名。
 * @returns 带来源标注的结果。
 */
function annotateResult(result, title) {
  const marker = `来源：${title}`
  const content = result.content === undefined || result.content.length === 0
    ? marker
    : `${marker}\n\n${result.content}`
  return { ...result, content }
}

/**
 * 读出当前降级顺序：调用方给的顺序里只保留已知 id，再补上遗漏的 id。
 * @param providers - 已注册的单家 provider。
 * @returns provider id 数组。
 */
async function resolveOrder(providers) {
  const stored = await readOrder()
  const known = [...providers.keys()]
  const ordered = stored.filter((id) => known.includes(id))
  for (const id of known) if (!ordered.includes(id)) ordered.push(id)
  return ordered
}

/**
 * 读落盘的顺序，读不到或格式不对时回落到默认顺序。
 * @returns provider id 数组。
 */
async function readOrder() {
  return (await loadState()).order
}

/**
 * 写入新的降级顺序。
 * @param order - provider id 数组。
 */
async function writeOrder(order) {
  await saveState({ order })
}

/**
 * 取某个路径的目录部分。
 * @param path - 文件路径。
 * @returns 目录路径。
 */
function dirnameOf(path) {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index <= 0 ? path : path.slice(0, index)
}

/**
 * RPC：单家连通性测试。用一次最小搜索验证 Key、网络与响应解析是否都通。
 * @param providers - 已注册的单家 provider。
 * @param payload - { provider }。
 * @param signal - 调用方取消信号。
 * @returns 测试结论；provider 不存在时返回 unknown-provider。
 */
async function handleTest(providers, payload, signal) {
  const requested = isRecord(payload) && typeof payload.provider === 'string' ? payload.provider : ''
  const provider = providers.get(requested)
  if (provider === undefined) {
    throw new Error(`没有名为 ${requested || '(空)'} 的搜索源`)
  }
  const startedAt = performance.now()
  try {
    const result = await provider.search({ query: TEST_QUERY, maxResults: 1 }, signal)
    return {
      reachable: true,
      ms: Math.round(performance.now() - startedAt),
      sources: result.sources.length,
      sample: result.sources[0]?.title ?? result.sources[0]?.url,
    }
  } catch (error) {
    return {
      reachable: false,
      ms: Math.round(performance.now() - startedAt),
      code: typeof error?.code === 'string' ? error.code : 'WEB_PROVIDER_ERROR',
      message: describeError(error),
    }
  }
}

/**
 * RPC：面板状态（顺序 + 各家是否已配置 + 当前搜索源）。
 * @param ctx - Host 上下文。
 * @param providers - 已注册的单家 provider。
 * @returns 面板所需的快照。
 */
async function handleState(ctx, providers) {
  const order = await resolveOrder(providers)
  const specsById = new Map(PROVIDER_SPECS.map((spec) => [spec.id, spec]))
  const rows = []
  for (const id of order) {
    const spec = specsById.get(id)
    if (spec === undefined) continue
    rows.push({ id, title: spec.title, ref: spec.ref, configured: await hasCredential(ctx, spec.ref) })
  }
  return {
    autoProviderId: AUTO_PROVIDER_ID,
    searchProvider: currentSearchProvider(ctx) ?? null,
    lastProvider: (await loadState()).lastProvider ?? null,
    rows,
  }
}

/**
 * RPC：把当前搜索源切到本插件（默认切到聚合 provider）。
 * @param ctx - Host 上下文。
 * @param payload - { provider? }，省略时用聚合 provider。
 * @returns 切换结果。
 */
async function handleAdopt(ctx, payload) {
  const requested = isRecord(payload) && typeof payload.provider === 'string' ? payload.provider : AUTO_PROVIDER_ID
  if (requested !== AUTO_PROVIDER_ID && !PROVIDER_SPECS.some((spec) => spec.id === requested)) {
    throw new Error(`不认识的搜索源：${requested}`)
  }
  const result = await adoptSearchProvider(ctx, requested)
  return { ...result, autoProviderId: AUTO_PROVIDER_ID }
}

/** dsh 自带的两个搜索源 id；只有当前是它们（或未设置）时才自动接管。 */
const NATIVE_PROVIDER_IDS = ['deepseek-search-api', 'deepseek-official']
/** web 服务所在的 Loader 行名。 */
const WEB_ROW_NAME = '@deepseek-ai/dsh-web'

/**
 * 读当前 web 行钉住的搜索源 id。
 * @param ctx - Host 上下文。
 * @returns provider id，未设置或读不到时为 undefined。
 */
function currentSearchProvider(ctx) {
  const row = findWebRow(ctx)
  if (row === undefined) return undefined
  const value = row.override.searchProvider ?? row.inherited.searchProvider
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * 定位 web 服务那一行的配置视图。
 * @param ctx - Host 上下文。
 * @returns configuration() 里的一项，找不到时为 undefined。
 */
function findWebRow(ctx) {
  const editor = ctx.get('configEditor')
  if (editor === undefined) return undefined
  try {
    return editor.configuration().find((item) => item.entry?.options?.name === WEB_ROW_NAME)
  } catch {
    return undefined
  }
}

/**
 * 是否应当自动接管：当前搜索源是原生实现或尚未设置时才接管。
 * @param current - 当前搜索源 id。
 * @returns 应当接管时为 true。
 */
function shouldAutoAdopt(current) {
  return current === undefined || NATIVE_PROVIDER_IDS.includes(current)
}

/**
 * 把 web 行的 searchProvider 写成本插件的 id。该字段是 volatile，改完就地生效，不重启。
 * @param ctx - Host 上下文。
 * @param providerId - 本插件的 provider id。
 * @returns 切换结果：是否变化、切换前后的 id。
 */
async function adoptSearchProvider(ctx, providerId) {
  const editor = ctx.get('configEditor')
  if (editor === undefined) throw new Error('当前 profile 没有配置编辑器，无法切换搜索源')
  const row = findWebRow(ctx)
  if (row === undefined) throw new Error(`找不到 ${WEB_ROW_NAME} 这一行，无法切换搜索源`)
  const current = row.override.searchProvider ?? row.inherited.searchProvider
  if (current === providerId) {
    return { changed: false, searchProvider: providerId, previous: typeof current === 'string' ? current : null }
  }
  await editor.edit(row.entry, (config) => ({ ...config, searchProvider: providerId }))
  return { changed: true, searchProvider: providerId, previous: typeof current === 'string' ? current : null }
}

/**
 * 首次启用时的一次性接管：没有 Key 时不抢，留给面板上的按钮。
 * @param ctx - Host 上下文。
 */
async function autoAdoptOnce(ctx) {
  const state = await loadState()
  if (state.adopted) return
  if (!await hasAnyCredential(ctx)) return
  const current = currentSearchProvider(ctx)
  if (!shouldAutoAdopt(current)) {
    // 用户已经自己选过了，记一笔，以后不再覆盖。
    await saveState({ adopted: true })
    return
  }
  await adoptSearchProvider(ctx, AUTO_PROVIDER_ID)
  await saveState({ adopted: true })
}

/**
 * 是否至少有一家 Key 已配置。
 * @param ctx - Host 上下文。
 * @returns 有 Key 时为 true。
 */
async function hasAnyCredential(ctx) {
  for (const spec of PROVIDER_SPECS) {
    if (await hasCredential(ctx, spec.ref)) return true
  }
  return false
}

/**
 * RPC：保存新的降级顺序。
 * @param ctx - Host 上下文。
 * @param providers - 已注册的单家 provider。
 * @param payload - { order: string[] }。
 * @returns 保存后的面板状态。
 */
async function handleOrder(ctx, providers, payload) {
  const order = isRecord(payload) && Array.isArray(payload.order) ? payload.order.filter((id) => typeof id === 'string') : undefined
  if (order === undefined) throw new Error('order 必须是一个 provider id 数组')
  await writeOrder(normalizeOrder(order, providers))
  return await handleState(ctx, providers)
}

/**
 * 校验并补全客户端提交的顺序：只接受已知 id，去重后把遗漏的补到末尾。
 * @param order - 客户端提交的顺序。
 * @param providers - 已注册的单家 provider。
 * @returns 合法且完整的顺序。
 */
function normalizeOrder(order, providers) {
  const known = [...providers.keys()]
  const unique = order.filter((id, index) => known.includes(id) && order.indexOf(id) === index)
  for (const id of known) if (!unique.includes(id)) unique.push(id)
  return unique
}

/**
 * 真正发起一次搜索并归一化结果：单家 provider 与连通性测试共用这条路径。
 * @param ctx - Host 上下文。
 * @param spec - 厂商声明。
 * @param query - 原始查询词。
 * @param limit - 已收敛的条数上限。
 * @param timeoutMs - 整体超时。
 * @param signal - 调用方取消信号。
 * @returns 归一化后的搜索结果。
 */
async function runSearch(ctx, spec, query, limit, timeoutMs, signal) {
  const text = normalizeQuery(query, spec.title)
  const apiKey = await requireCredential(ctx, spec.ref, spec.title)
  const payload = await postJson({
    url: spec.endpoint,
    headers: spec.headers(apiKey),
    body: spec.buildBody(text, limit),
    signal,
    timeoutMs,
    label: spec.title,
    credentialHint: `请到 Plugins > 免费网页搜索里重新填写 ${spec.title} 的 API Key，或检查 ${spec.ref} 的取值。`,
  })
  return spec.read(payload)
}

/**
 * 构造 RPC 失败结果。
 * @param code - 机器可读的错误码。
 * @param message - 人可读的说明。
 * @returns Connection RPC 的失败结果。
 */
function failure(code, message) {
  return { ok: false, error: { code, message, details: {} } }
}

/**
 * 校验并发起一次 JSON POST。
 * @param options - 端点、请求头、请求体、超时与调用方取消信号。
 * @returns 解析后的响应体。
 */
async function postJson(options) {
  const { url, headers, body, signal, timeoutMs, label, credentialHint } = options
  const timeout = AbortSignal.timeout(timeoutMs)
  const composed = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body),
      // 重定向一律按失败处理，避免把 Key 带到未确认的目标。
      redirect: 'error',
      signal: composed,
    })
  } catch (error) {
    if (signal?.aborted === true) throw new WebError(`${label} 搜索已取消`, 'WEB_ABORTED', { cause: error })
    if (timeout.aborted) {
      throw new WebError(`${label} 在 ${String(Math.round(timeoutMs / 1000))} 秒内没有响应，请检查网络或代理`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    throw new WebError(`${label} 请求失败：${describeError(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  let text
  try {
    text = await response.text()
  } catch (error) {
    if (signal?.aborted === true) throw new WebError(`${label} 搜索已取消`, 'WEB_ABORTED', { cause: error })
    throw new WebError(`${label} 的响应体读取失败：${describeError(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  if (!response.ok) {
    throw new WebError(httpFailureMessage(label, response.status, text, credentialHint), 'WEB_PROVIDER_ERROR')
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new WebError(`${label} 返回了无法解析的响应（HTTP ${String(response.status)}）`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/**
 * 组装 HTTP 失败信息：状态码、厂商回显片段，以及按状态码给出的处理建议。
 * @param label - 厂商名。
 * @param status - HTTP 状态码。
 * @param text - 响应体原文。
 * @param credentialHint - 凭据问题的处理建议。
 * @returns 面向用户与模型的失败说明。
 */
function httpFailureMessage(label, status, text, credentialHint) {
  const detail = truncateText(text.trim(), ERROR_BODY_LIMIT)
  const head = `${label} 搜索失败：HTTP ${String(status)}${detail === undefined ? '' : `，响应：${detail}`}`
  if (status === 401 || status === 403) return `${head}。API Key 可能无效或已过期，${credentialHint}`
  if (status === 429) return `${head}。已达到免费额度上限或被限流，请稍后重试或换用另一个 provider。`
  return `${head}。请检查网络连通性与 ${label} 服务状态。`
}

/** Tavily：结果在 results[]，answer 作为直答。 */
function readTavily(payload) {
  const items = requireArray(payload, 'results', 'Tavily')
  return finish(items.map((item) => ({
    url: text(item.url),
    title: text(item.title),
    snippet: truncateText(text(item.content)),
    publishedAt: isoDate(item.published_date),
  })), text(payload.answer), 'Tavily')
}

/** Serper：结果在 organic[]，answerBox / knowledgeGraph 作为直答。 */
function readSerper(payload) {
  const items = requireArray(payload, 'organic', 'Serper')
  const answerBox = isRecord(payload.answerBox) ? payload.answerBox : undefined
  const knowledgeGraph = isRecord(payload.knowledgeGraph) ? payload.knowledgeGraph : undefined
  const answer = (answerBox === undefined ? undefined : text(answerBox.answer) ?? text(answerBox.snippet))
    ?? (knowledgeGraph === undefined ? undefined : text(knowledgeGraph.description))
  return finish(items.map((item) => ({
    url: text(item.link),
    title: text(item.title),
    snippet: truncateText(text(item.snippet)),
    publishedAt: isoDate(item.date),
  })), answer, 'Serper')
}

/** Exa：结果在 results[]，summary/text 直接作为可读摘要。 */
function readExa(payload) {
  const items = requireArray(payload, 'results', 'Exa')
  return finish(items.map((item) => ({
    url: text(item.url),
    title: text(item.title),
    snippet: truncateText(text(item.summary) ?? text(item.text) ?? firstText(item.highlights)),
    publishedAt: isoDate(item.publishedDate),
  })), undefined, 'Exa')
}

/** Firecrawl：v2 把结果分组在 data.web[]，旧版是 data[]，两种都接受。 */
function readFirecrawl(payload) {
  const data = payload?.data
  const items = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.web) ? data.web : undefined
  if (items === undefined) throw new WebError('Firecrawl 返回的响应里没有 data.web 数组', 'WEB_PROVIDER_ERROR')
  return finish(items.map((item) => ({
    url: text(item.url),
    title: text(item.title) ?? text(item.metadata?.title),
    snippet: truncateText(text(item.description) ?? text(item.markdown)),
    publishedAt: isoDate(item.metadata?.publishedTime),
  })), undefined, 'Firecrawl')
}

/** LangSearch：结果在 data.webPages.value[]（旧版可能是顶层 webPages）。 */
function readLangSearch(payload) {
  const pages = payload?.data?.webPages ?? payload?.webPages
  if (!isRecord(pages) || !Array.isArray(pages.value)) {
    throw new WebError('LangSearch 返回的响应里没有 webPages.value 数组', 'WEB_PROVIDER_ERROR')
  }
  return finish(pages.value.map((item) => ({
    url: text(item.url),
    title: text(item.name) ?? text(item.title),
    snippet: truncateText(text(item.snippet) ?? text(item.summary) ?? text(item.text)),
    publishedAt: isoDate(item.datePublished ?? item.date),
  })), undefined, 'LangSearch')
}

/**
 * 统一收尾：丢弃没有 URL 的条目，并在一条都不剩时报错。
 * @param candidates - 候选来源。
 * @param content - 可选直答文本。
 * @param label - 厂商名，用于报错。
 * @returns 归一化后的搜索结果。
 */
function finish(candidates, content, label) {
  const sources = candidates.filter((source) => source.url !== undefined && source.url.length > 0)
  if (sources.length === 0) throw new WebError(`${label} 没有返回任何可引用的来源`, 'WEB_PROVIDER_ERROR')
  return {
    ...content === undefined ? {} : { content },
    sources: sources.map((source) => ({
      url: source.url,
      ...source.title === undefined ? {} : { title: source.title },
      ...source.snippet === undefined ? {} : { snippet: source.snippet },
      ...source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt },
    })),
    truncated: false,
  }
}

/**
 * 取必需的结果数组。
 * @param payload - 厂商响应。
 * @param key - 数组所在的字段名。
 * @param label - 厂商名。
 * @returns 该数组。
 */
function requireArray(payload, key, label) {
  const items = isRecord(payload) ? payload[key] : undefined
  if (!Array.isArray(items)) throw new WebError(`${label} 返回的响应里没有 ${key} 数组`, 'WEB_PROVIDER_ERROR')
  return items
}

/**
 * 校验查询词。
 * @param query - 原始查询词。
 * @param label - 厂商名，用于报错。
 * @returns 去空白后的查询词。
 */
function normalizeQuery(query, label) {
  const value = typeof query === 'string' ? query.trim() : ''
  if (value.length === 0) throw new WebError(`${label} 搜索需要一个非空的查询词`, 'WEB_PROVIDER_ERROR')
  return value
}

/**
 * 收敛条数上限。
 * @param maxResults - 调用方给出的上限。
 * @returns 1 到 MAX_RESULTS_LIMIT 之间的整数。
 */
function resolveLimit(maxResults) {
  if (!Number.isSafeInteger(maxResults) || maxResults < 1) return DEFAULT_MAX_RESULTS
  return Math.min(maxResults, MAX_RESULTS_LIMIT)
}

/**
 * Key 是否已配置：有凭据服务时问它（不取值），否则看进程环境。
 * @param ctx - Host 上下文。
 * @param ref - 凭据引用名。
 * @returns 已配置时为 true。
 */
async function hasCredential(ctx, ref) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return environmentValue(ref) !== undefined
  try {
    const info = await credentials.describe(ref)
    return info.configured === true
  } catch {
    // 凭据库读取失败等价于「不可用」：搜索会在这个读取上失败，而不是换下一个来源。
    return false
  }
}

/**
 * 取出 Key，缺失时按契约抛结构化错误。
 * @param ctx - Host 上下文。
 * @param ref - 凭据引用名。
 * @param label - 厂商名。
 * @returns 非空的 Key。
 */
async function requireCredential(ctx, ref, label) {
  const value = await resolveCredential(ctx, ref)
  if (value === undefined) {
    throw new WebError(
      `${label} API Key 尚未配置：在 Plugins > 免费网页搜索里填写，或设置环境变量 ${ref}`,
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
  return value
}

/**
 * 解析 Key：优先凭据服务（存储文件 > 启动环境 > .env），没有该服务时读进程环境。
 * @param ctx - Host 上下文。
 * @param ref - 凭据引用名。
 * @returns Key 文本，未配置时为 undefined。
 */
async function resolveCredential(ctx, ref) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return environmentValue(ref)
  try {
    const resolved = await credentials.resolve(ref)
    return resolved === undefined ? undefined : resolved.value
  } catch (error) {
    throw new WebError(`读取 ${ref} 失败：${describeError(error)}`, 'WEB_PROVIDER_CREDENTIAL_MISSING', { cause: error })
  }
}

/**
 * 读进程环境里的 Key，空串按未配置处理。
 * @param ref - 环境变量名。
 * @returns 环境变量值，缺失或为空白时为 undefined。
 */
function environmentValue(ref) {
  const value = process.env[ref]
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/**
 * 判断是否为普通对象。
 * @param value - 待判断的值。
 * @returns 是对象字面量时为 true。
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 取可选的非空文本字段。
 * @param value - 原始字段值。
 * @returns 去空白后的文本，空或非字符串时为 undefined。
 */
function text(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

/**
 * 取字符串数组里的第一项。
 * @param value - 原始字段值。
 * @returns 第一段非空文本，或 undefined。
 */
function firstText(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).find((item) => item !== undefined) : undefined
}

/**
 * 截断文本到指定长度。
 * @param value - 原始文本。
 * @param limit - 字符上限，默认 SNIPPET_LIMIT。
 * @returns 截断后的文本，空文本为 undefined。
 */
function truncateText(value, limit = SNIPPET_LIMIT) {
  if (value === undefined) return undefined
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

/**
 * 降级汇总里的单条错误，压到一行内。
 * @param message - 原始错误信息。
 * @returns 截断后的信息。
 */
function shortenError(message) {
  return message.length <= 60 ? message : `${message.slice(0, 60)}…`
}

/**
 * 只在字段是 ISO-8601 时间时保留为 publishedAt；相对时间（如「3 days ago」）直接丢弃。
 * @param value - 原始日期字段。
 * @returns ISO 时间字符串或 undefined。
 */
function isoDate(value) {
  const parsed = text(value)
  if (parsed === undefined) return undefined
  if (!/^\d{4}-\d{2}-\d{2}/.test(parsed)) return undefined
  const timestamp = Date.parse(parsed)
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString()
}

/**
 * 生成简短错误描述。
 * @param error - 捕获到的异常。
 * @returns 可读描述。
 */
function describeError(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
