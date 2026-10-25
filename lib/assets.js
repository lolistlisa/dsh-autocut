import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { artifact, exists, fileHash, loadProject, readJSON, run, writeJSON } from './util.js'

const VIDEO = new Set(['.mp4', '.mov', '.mkv', '.webm', '.avi', '.m4v'])
const AUDIO = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac', '.ogg'])
const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp'])

async function walk(directory, output = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) await walk(file, output)
    else output.push(file)
  }
  return output
}

async function probe(file) {
  try {
    const { stdout } = await run(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'json', file])
    const data = JSON.parse(stdout)
    const video = data.streams?.find(stream => stream.codec_type === 'video')
    return { duration: Number(data.format?.duration) || null, width: video?.width || null, height: video?.height || null, fps: video?.r_frame_rate || null }
  } catch { return { duration: null, width: null, height: null, fps: null } }
}

export async function indexAssets(root, directories) {
  const project = await loadProject(root)
  const files = []
  for (const directory of directories || [...project.assets, ...project.music]) {
    if (!await exists(directory)) throw new Error(`素材目录不存在: ${directory}`)
    files.push(...await walk(directory))
  }
  const catalog = []
  for (const file of [...new Set(files)]) {
    const extension = path.extname(file).toLowerCase()
    const kind = VIDEO.has(extension) ? 'video' : AUDIO.has(extension) ? 'audio' : IMAGE.has(extension) ? 'image' : null
    if (!kind) continue
    let sidecar = {}
    try { sidecar = JSON.parse(await readFile(`${file}.autocut.json`, 'utf8')) } catch {}
    const id = (await fileHash(file)).slice(0, 16)
    catalog.push({
      id, path: file, kind, name: path.basename(file, extension),
      description: String(sidecar.description || ''),
      tags: Array.isArray(sidecar.tags) ? sidecar.tags.map(String) : [],
      license: String(sidecar.license || 'unknown'),
      source: String(sidecar.source || 'local'),
      enabled: sidecar.enabled !== false,
      ...(await probe(file)),
    })
  }
  await writeJSON(artifact(root, 'asset_catalog.json'), { schema_version: 1, assets: catalog })
  return { assets: catalog.length, output: artifact(root, 'asset_catalog.json'), unknown_duration: catalog.filter(item => item.duration === null).length }
}

function grams(text) {
  const normalized = String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')
  const tokens = normalized.split(/\s+/).filter(Boolean)
  const compact = normalized.replace(/\s/g, '')
  for (let index = 0; index < compact.length - 1; index++) tokens.push(compact.slice(index, index + 2))
  return new Set(tokens)
}

export function lexicalScore(query, asset) {
  const terms = grams(query)
  const fields = grams(`${asset.name} ${asset.description} ${asset.tags.join(' ')}`)
  if (!terms.size) return 0
  let matched = 0
  for (const term of terms) if (fields.has(term)) matched++
  return matched / Math.sqrt(terms.size * Math.max(1, fields.size))
}

export async function matchAssets(root, deepseek, { topK = 5, signal } = {}) {
  const graph = await readJSON(artifact(root, 'script_graph.json'))
  const catalog = (await readJSON(artifact(root, 'asset_catalog.json'))).assets.filter(item => item.enabled && item.kind !== 'audio')
  const candidateMap = {}
  const requests = graph.segments.map(segment => {
    const query = [segment.text, ...segment.visual_queries].join(' ')
    const ranked = catalog.map(asset => ({ asset, score: lexicalScore(query, asset) }))
      .sort((a, b) => b.score - a.score).slice(0, Math.max(topK, 8))
    candidateMap[segment.id] = ranked
    return { segment_id: segment.id, text: segment.text, queries: segment.visual_queries }
  })
  const compactCandidates = Object.fromEntries(Object.entries(candidateMap).map(([id, rows]) => [id, rows.map(({ asset, score }) => ({ ...asset, lexical_score: score }))]))
  let modelMatches = []
  if (requests.length) {
    const response = await deepseek.rankAssets(requests, compactCandidates, { signal })
    modelMatches = response.matches || []
  }
  const overrides = await readJSON(artifact(root, 'overrides.json'), { segments: {}, locks: {} })
  const byId = new Map(catalog.map(item => [item.id, item]))
  const matches = graph.segments.map(segment => {
    const rows = candidateMap[segment.id] || []
    const model = modelMatches.find(item => item.segment_id === segment.id)
    const selectedIds = (model?.selected || []).filter(id => byId.has(id))
    const selected = selectedIds.length ? selectedIds : rows.slice(0, topK).map(row => row.asset.id)
    const locked = overrides.locks?.[segment.id]
    const manual = overrides.segments?.[segment.id]?.asset
    return {
      segment_id: segment.id,
      candidates: rows.map(({ asset, score }) => ({ ...asset, lexical_score: score })),
      selected: locked && manual ? manual : selected[0] || null,
      alternatives: selected.slice(1),
      locked: Boolean(locked),
      reason: model?.reason || '词汇与元数据召回；无模型选择时保留本地排序',
    }
  })
  const output = { schema_version: 1, matches }
  await writeJSON(artifact(root, 'asset_matches.json'), output)
  return { segments: matches.length, unmatched: matches.filter(item => !item.selected).length, output: artifact(root, 'asset_matches.json') }
}
