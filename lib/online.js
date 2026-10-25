import { artifact, hash, readJSON, writeJSON } from './util.js'

const DAY = 24 * 60 * 60 * 1000

async function cachedJSON(root, key, loader) {
  const file = artifact(root, `cache/online/${hash(key).slice(0, 32)}.json`)
  const cached = await readJSON(file, null)
  if (cached && Date.now() - cached.at < DAY) return { data: cached.data, cached: true }
  const data = await loader()
  await writeJSON(file, { at: Date.now(), key, data })
  return { data, cached: false }
}

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, { ...options, signal: options.signal })
  if (!response.ok) throw new Error(`${new URL(url).host} ${response.status}: ${(await response.text()).slice(0, 300)}`)
  return response.json()
}

export async function searchPexels(query, { perPage = 6, locale = 'zh-CN', signal } = {}) {
  const key = process.env.PEXELS_API_KEY
  if (!key) throw new Error('缺少 PEXELS_API_KEY')
  const url = new URL('https://api.pexels.com/v1/videos/search')
  url.searchParams.set('query', query)
  url.searchParams.set('per_page', String(perPage))
  url.searchParams.set('locale', locale)
  url.searchParams.set('orientation', 'landscape')
  const data = await jsonRequest(url, { headers: { Authorization: key }, signal })
  return (data.videos || []).map(video => {
    const files = (video.video_files || []).filter(file => file.file_type === 'video/mp4')
    const best = [...files].sort((a, b) => (b.width || 0) - (a.width || 0)).find(file => (file.width || 0) <= 1920) || files[0]
    return {
      id: `pexels:${video.id}`, provider: 'Pexels', kind: 'video',
      title: `Pexels 视频 ${video.id}`, page_url: video.url,
      preview_url: video.image, download_url: best?.link || '',
      duration: video.duration, width: video.width, height: video.height,
      author: video.user?.name || '', author_url: video.user?.url || '',
      license: 'Pexels License', license_url: 'https://www.pexels.com/license/',
      attribution: `Video by ${video.user?.name || 'Pexels contributor'} on Pexels`,
    }
  })
}

export async function searchPixabay(query, { perPage = 6, lang = 'zh', signal } = {}) {
  const key = process.env.PIXABAY_API_KEY
  if (!key) throw new Error('缺少 PIXABAY_API_KEY')
  const url = new URL('https://pixabay.com/api/videos/')
  url.searchParams.set('key', key)
  url.searchParams.set('q', query)
  url.searchParams.set('per_page', String(Math.max(3, perPage)))
  url.searchParams.set('lang', lang)
  url.searchParams.set('safesearch', 'true')
  url.searchParams.set('video_type', 'film')
  const data = await jsonRequest(url, { signal })
  return (data.hits || []).map(video => {
    const best = video.videos?.large?.url ? video.videos.large : video.videos?.medium || video.videos?.small
    return {
      id: `pixabay:${video.id}`, provider: 'Pixabay', kind: 'video',
      title: video.tags || `Pixabay 视频 ${video.id}`, page_url: video.pageURL,
      preview_url: best?.thumbnail || '', download_url: best?.url || '',
      duration: video.duration, width: best?.width, height: best?.height,
      author: video.user || '', author_url: `https://pixabay.com/users/${video.user}-${video.user_id}/`,
      license: 'Pixabay Content License', license_url: 'https://pixabay.com/service/license-summary/',
      attribution: `Video by ${video.user} on Pixabay`,
    }
  })
}

export async function searchJamendo(query, { limit = 12, signal } = {}) {
  const clientId = process.env.JAMENDO_CLIENT_ID
  if (!clientId) throw new Error('缺少 JAMENDO_CLIENT_ID')
  const url = new URL('https://api.jamendo.com/v3.0/tracks/')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('format', 'json')
  url.searchParams.set('search', query)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('vocalinstrumental', 'instrumental')
  url.searchParams.set('audioformat', 'mp32')
  url.searchParams.set('audiodlformat', 'mp32')
  url.searchParams.set('include', 'licenses')
  url.searchParams.set('imagesize', '300')
  const data = await jsonRequest(url, { signal })
  return (data.results || []).map(track => ({
    id: `jamendo:${track.id}`, provider: 'Jamendo', kind: 'music',
    title: track.name, artist: track.artist_name, duration: Number(track.duration),
    share_url: track.shareurl, audio_url: track.audio, download_url: track.audiodownload_allowed ? track.audiodownload : '',
    download_allowed: Boolean(track.audiodownload_allowed), image: track.image,
    license: track.license_ccurl || 'Jamendo license', license_url: track.license_ccurl || track.shareurl,
    commercial_warning: /nc|noncommercial/i.test(track.license_ccurl || '') ? 'NonCommercial：商用或平台变现前需确认授权' : '',
    attribution: `${track.name} — ${track.artist_name}`,
  }))
}

async function collect(loader) {
  try { return { candidates: await loader(), error: null } } catch (error) { return { candidates: [], error: error.message } }
}

export async function researchOnline(root, deepseek, { perSegment = 5, signal } = {}) {
  const graph = await readJSON(artifact(root, 'script_graph.json'))
  const plan = await deepseek.planResearch(graph.segments, { signal })
  await writeJSON(artifact(root, 'research_plan.json'), plan)
  const materialResults = []
  const providerStatus = []
  const hasPexels = Boolean(process.env.PEXELS_API_KEY)
  const hasPixabay = Boolean(process.env.PIXABAY_API_KEY)
  if (!hasPexels && !hasPixabay) providerStatus.push({ provider: 'materials', error: '未配置 PEXELS_API_KEY 或 PIXABAY_API_KEY；仍会生成配乐候选' })
  for (const item of plan.materials || []) {
    const segment = graph.segments.find(entry => entry.id === item.segment_id)
    if (!segment) continue
    const found = []
    for (const query of (item.queries || []).slice(0, 2)) {
      if (hasPexels) {
        try {
          const key = ['pexels', query, perSegment]
          const result = await cachedJSON(root, key, () => searchPexels(query, { perPage: perSegment, signal }))
          found.push(...result.data.map(candidate => ({ ...candidate, segment_id: segment.id, query, from_cache: result.cached })))
        } catch (error) {
          if (!providerStatus.some(item => item.provider === 'Pexels' && item.error === error.message)) providerStatus.push({ provider: 'Pexels', error: error.message })
        }
      }
      if (hasPixabay) {
        try {
          const key = ['pixabay', query, perSegment]
          const result = await cachedJSON(root, key, () => searchPixabay(query, { perPage: perSegment, signal }))
          found.push(...result.data.map(candidate => ({ ...candidate, segment_id: segment.id, query, from_cache: result.cached })))
        } catch (error) {
          if (!providerStatus.some(item => item.provider === 'Pixabay' && item.error === error.message)) providerStatus.push({ provider: 'Pixabay', error: error.message })
        }
      }
    }
    const unique = [...new Map(found.map(candidate => [candidate.id, candidate])).values()]
    materialResults.push({ segment_id: segment.id, text: segment.text, queries: item.queries || [], candidates: unique.slice(0, perSegment * 2) })
  }
  const materials = { schema_version: 1, providers: providerStatus, segments: materialResults }
  await writeJSON(artifact(root, 'online_materials.json'), materials)
  return { segments: materialResults.length, candidates: materialResults.reduce((sum, item) => sum + item.candidates.length, 0), output: artifact(root, 'online_materials.json'), warnings: providerStatus }
}

export async function researchMusic(root, deepseek, { signal } = {}) {
  const graph = await readJSON(artifact(root, 'script_graph.json'))
  const plan = await readJSON(artifact(root, 'research_plan.json'), null) || await deepseek.planResearch(graph.segments, { signal })
  const candidates = []
  const warnings = []
  if (!process.env.JAMENDO_CLIENT_ID) warnings.push({ provider: 'Jamendo', error: '未配置 JAMENDO_CLIENT_ID；只能使用本地音乐目录' })
  for (const section of plan.music || []) {
    for (const query of [section.query, `${section.query} cinematic`]) {
      if (!process.env.JAMENDO_CLIENT_ID) break
      const result = await collect(async () => {
        const cached = await cachedJSON(root, ['jamendo', query], () => searchJamendo(query, { limit: 10, signal }))
        return cached.data.map(track => ({ ...track, query, from_cache: cached.cached }))
      })
      if (result.error) warnings.push({ provider: 'Jamendo', query, error: result.error })
      for (const track of result.candidates) candidates.push({ ...track, start_segment: section.start_segment, end_segment: section.end_segment, suggested_mood: section.mood })
    }
  }
  const unique = [...new Map(candidates.map(track => [track.id, track])).values()]
  let ranked = unique
  if (unique.length > 4) {
    try {
      const result = await deepseek.rankMusic(unique.map(({ id, title, artist, license, commercial_warning, suggested_mood }) => ({ id, title, artist, license, commercial_warning, suggested_mood })), plan.music, { signal })
      const order = new Map((result.sections || []).flatMap(section => (section.picks || []).map((id, index) => [id, index])))
      ranked = unique.map(track => ({ ...track, recommended: order.has(track.id), rank: order.get(track.id) ?? 999 })).sort((a, b) => a.rank - b.rank)
    } catch (error) {
      warnings.push({ provider: 'DeepSeek', error: `配乐重排失败，保留曲库检索顺序: ${error.message}` })
    }
  }
  const output = { schema_version: 1, plan: plan.music || [], warnings, candidates: ranked }
  await writeJSON(artifact(root, 'music_candidates.json'), output)
  return { sections: output.plan.length, candidates: ranked.length, output: artifact(root, 'music_candidates.json'), warnings }
}

export async function planResearchOnly(root, deepseek, { signal } = {}) {
  const graph = await readJSON(artifact(root, 'script_graph.json'))
  const plan = await deepseek.planResearch(graph.segments, { signal })
  const file = artifact(root, 'research_plan.json')
  await writeJSON(file, plan)
  return { materials: plan.materials?.length || 0, music: plan.music?.length || 0, output: file }
}
