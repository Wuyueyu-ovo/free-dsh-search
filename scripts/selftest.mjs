/**
 * 自测脚本：不联网、不消耗额度地验证五家 provider 的请求构造、归一化与失败路径。
 * 用桩替换 fetch 与凭据服务；运行：node scripts/selftest.mjs
 */
import assert from 'node:assert/strict'
import { PROVIDER_SPECS, annotateResult, createAutoProvider, createSearchProvider, resolveOrder, shouldAutoAdopt } from '../index.js'

/** 记录每个 provider 实际发出的请求，便于断言鉴权头与请求体。 */
const requests = []

/** 下一次 fetch 要返回的假响应。 */
let nextResponse

globalThis.fetch = async (url, init) => {
  requests.push({ url, init })
  if (nextResponse instanceof Error) throw nextResponse
  const response = nextResponse
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    text: async () => response.body,
  }
}

/** 固定返回某些 Key 的凭据桩。 */
function credentialsStub(values) {
  return {
    async describe(ref) {
      return { configured: values[ref] !== undefined, writable: true }
    },
    async resolve(ref) {
      return values[ref] === undefined ? undefined : { value: values[ref], source: 'file' }
    },
  }
}

/** 组装只带凭据服务的假 ctx。 */
function ctxStub(values) {
  return { get: (name) => (name === 'credentials' ? credentialsStub(values) : undefined) }
}

/** 取某个 provider，并在调用时返回给定 JSON 载荷。 */
function withPayload(id, payload, status = 200) {
  nextResponse = { status, body: JSON.stringify(payload) }
}

const keys = {
  TAVILY_API_KEY: 'tvly-test',
  SERPER_API_KEY: 'serper-test',
  EXA_API_KEY: 'exa-test',
  FIRECRAWL_API_KEY: 'fc-test',
  LANGSEARCH_API_KEY: 'ls-test',
}
const ctx = ctxStub(keys)
const providers = new Map(PROVIDER_SPECS.map((spec) => [spec.id, createSearchProvider(ctx, spec)]))

assert.deepEqual([...providers.keys()], ['tavily', 'serper', 'exa', 'firecrawl', 'langsearch'])

// 每家的响应形态差异必须都能归一化到同一结果结构。
const cases = [
  ['tavily', {
    answer: '直答',
    results: [{ title: 'A', url: 'https://a.example/1', content: 'x'.repeat(500), published_date: '2026-11-01T00:00:00Z' }, { title: '没有 url' }],
  }, (result) => {
    assert.equal(result.content, '直答')
    assert.equal(result.sources.length, 1, '无 url 的条目必须被丢弃')
    assert.ok(result.sources[0].snippet.endsWith('…'), 'snippet 应被截断')
  }],
  ['serper', {
    answerBox: { answer: '42' },
    organic: [{ title: 'C', link: 'https://c.example/', snippet: '摘要', date: '3 days ago' }, { title: 'D', link: 'https://d.example/', date: '2026-10-30' }],
  }, (result) => {
    assert.equal(result.content, '42')
    assert.equal(result.sources[0].publishedAt, undefined, '相对时间不应被当成发布时间')
    assert.equal(result.sources[1].publishedAt, '2026-10-30T00:00:00.000Z')
  }],
  ['exa', {
    results: [{ title: 'E', url: 'https://e.example/', summary: '摘要 E', publishedDate: '2026-09-01' }],
  }, (result) => {
    assert.equal(result.sources[0].snippet, '摘要 E')
    assert.equal(result.sources[0].publishedAt, '2026-09-01T00:00:00.000Z')
  }],
  ['firecrawl', {
    success: true,
    data: { web: [{ title: 'F', url: 'https://f.example/', description: '摘要 F', metadata: { publishedTime: '2026-08-01T10:00:00Z' } }] },
  }, (result) => {
    assert.equal(result.sources[0].title, 'F')
    assert.equal(result.sources[0].publishedAt, '2026-08-01T10:00:00.000Z')
  }],
  ['langsearch', {
    data: { webPages: { value: [{ name: 'G', url: 'https://g.example/', snippet: '摘要 G' }] } },
  }, (result) => {
    assert.equal(result.sources[0].title, 'G')
    assert.equal(result.sources[0].snippet, '摘要 G')
  }],
]

for (const [id, payload, verify] of cases) {
  withPayload(id, payload)
  const result = await providers.get(id).search({ query: '  q  ', maxResults: 3 })
  assert.equal(result.truncated, false)
  verify(result)
}

// Firecrawl 旧版把结果直接放在 data[]，也要接受。
withPayload('firecrawl', { success: true, data: [{ title: 'H', url: 'https://h.example/', markdown: '正文' }] })
assert.equal((await providers.get('firecrawl').search({ query: 'q' })).sources[0].url, 'https://h.example/')

// 请求构造：端点、鉴权头、条数收敛。
withPayload('exa', { results: [{ url: 'https://x.example/' }] })
await providers.get('exa').search({ query: 'q', maxResults: 100 })
assert.equal(requests.at(-1).url, 'https://api.exa.ai/search')
assert.equal(requests.at(-1).init.headers['x-api-key'], 'exa-test')
assert.equal(JSON.parse(requests.at(-1).init.body).numResults, 20, '条数应被收敛到 20')

withPayload('langsearch', { data: { webPages: { value: [{ url: 'https://y.example/' }] } } })
await providers.get('langsearch').search({ query: 'q' })
assert.equal(JSON.parse(requests.at(-1).init.body).count, 5, '未给条数时用默认 5')
assert.equal(requests.at(-1).init.headers.authorization, 'Bearer ls-test')

withPayload('firecrawl', { data: { web: [{ url: 'https://z.example/' }] } })
await providers.get('firecrawl').search({ query: 'q' })
assert.equal(requests.at(-1).url, 'https://api.firecrawl.dev/v2/search')
assert.equal(requests.at(-1).init.headers.authorization, 'Bearer fc-test')

// ready()：有 Key 为真，无 Key 为假。
assert.equal(await providers.get('tavily').ready(), true)
assert.equal(await createSearchProvider(ctxStub({}), PROVIDER_SPECS[0]).ready(), false)

// 缺 Key、401、网络异常三条失败路径。
await assert.rejects(
  () => createSearchProvider(ctxStub({}), PROVIDER_SPECS[4]).search({ query: 'q' }),
  (error) => error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING',
  '缺 Key 应抛 WEB_PROVIDER_CREDENTIAL_MISSING',
)

withPayload('serper', { message: 'bad key' }, 401)
await assert.rejects(
  () => providers.get('serper').search({ query: 'q' }),
  (error) => error.code === 'WEB_PROVIDER_ERROR' && error.message.includes('HTTP 401'),
  '401 应归类为 WEB_PROVIDER_ERROR 并携带状态码',
)

nextResponse = new Error('network down')
await assert.rejects(
  () => providers.get('tavily').search({ query: 'q' }),
  (error) => error.code === 'WEB_PROVIDER_ERROR' && error.message.includes('network down'),
  '网络异常应归类为 WEB_PROVIDER_ERROR',
)

// 空结果集应当报错，而不是静默返回空数组。
withPayload('exa', { results: [] })
await assert.rejects(
  () => providers.get('exa').search({ query: 'q' }),
  (error) => error.code === 'WEB_PROVIDER_ERROR',
  '没有任何来源时应报错',
)

// ── 聚合 provider：按优先级降级 ───────────────────────────────────────────────
process.env.DSH_HOME = `${process.env.TEMP ?? '/tmp'}/free-dsh-search-selftest`

const autoProviders = new Map(PROVIDER_SPECS.map((spec) => [spec.id, createSearchProvider(ctx, spec)]))
const auto = createAutoProvider(ctx, autoProviders)

assert.deepEqual(
  await resolveOrder(autoProviders),
  PROVIDER_SPECS.map((spec) => spec.id),
  '默认顺序应与声明顺序一致',
)

// 第一优先失败时，应自动降级到下一家并把结果原样返回。
globalThis.fetch = async (url, init) => {
  requests.push({ url, init })
  if (url.includes('tavily')) throw new Error('tavily down')
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ organic: [{ title: '降级结果', link: 'https://fallback.example/', snippet: '来自 Serper' }] }),
  }
}
const fallenBack = await auto.search({ query: 'q', maxResults: 2 })
assert.equal(fallenBack.sources[0].url, 'https://fallback.example/', '失败后应降级到下一家')
assert.equal(fallenBack.content, '来源：Serper', '聚合结果应标出实际提供者（该载荷没有直答，标注补位）')

// 来源标注：没有直答时用标注补位，有直答时前置一行。
assert.equal(annotateResult({ content: undefined, sources: [], truncated: false }, 'Exa').content, '来源：Exa')
assert.equal(annotateResult({ content: '直答', sources: [], truncated: false }, 'Tavily').content, '来源：Tavily\n\n直答')

// 全部失败时抛汇总错误。
globalThis.fetch = async () => { throw new Error('all down') }
await assert.rejects(
  () => auto.search({ query: 'q' }),
  (error) => error.code === 'WEB_PROVIDER_ERROR' && error.message.includes('都失败了'),
  '全部失败时应抛汇总错误',
)

// 一个 Key 都没有时，给出可操作的提示。
await assert.rejects(
  () => createAutoProvider(ctxStub({}), new Map(PROVIDER_SPECS.map((spec) => [spec.id, createSearchProvider(ctxStub({}), spec)]))).search({ query: 'q' }),
  (error) => error.code === 'WEB_PROVIDER_UNAVAILABLE' && error.message.includes('没有可用的搜索源'),
  '无 Key 时应提示先填 Key',
)

// 取消不是失败：不应降级，直接把取消交还调用方。
const aborter = new AbortController()
aborter.abort()
await assert.rejects(
  () => auto.search({ query: 'q' }, aborter.signal),
  (error) => error.code === 'WEB_ABORTED',
  '取消应原样抛出，不触发降级',
)

// 自动接管只针对 dsh 原生搜索源，用户自己的选择不覆盖。
assert.equal(shouldAutoAdopt(undefined), true, '未设置搜索源时应自动接管')
assert.equal(shouldAutoAdopt('deepseek-search-api'), true, '原生 Search API 应自动接管')
assert.equal(shouldAutoAdopt('deepseek-official'), true, '原生 Messages 搜索应自动接管')
assert.equal(shouldAutoAdopt('tavily'), false, '用户自选的具体 provider 不应被覆盖')
assert.equal(shouldAutoAdopt('free-search'), false, '已经是本插件时无需再接管')

console.log('selftest: 全部断言通过')