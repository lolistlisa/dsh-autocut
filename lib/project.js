import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { artifact, asAbsolute, ensureProject, exists, fileHash, loadProject, now, readJSON, writeJSON } from './util.js'

export async function initProject(options) {
  const root = path.resolve(options.root)
  await ensureProject(root)
  const scriptPath = asAbsolute(root, options.script)
  const narrationPath = options.narration ? asAbsolute(root, options.narration) : null
  if (!await exists(scriptPath)) throw new Error(`文案不存在: ${scriptPath}`)
  if (narrationPath && !await exists(narrationPath)) throw new Error(`旁白不存在: ${narrationPath}`)
  const current = await readJSON(artifact(root, 'project.json'), {})
  const project = {
    schema_version: 1,
    name: options.name || path.basename(root),
    created_at: current.created_at || now(),
    updated_at: now(),
    script: scriptPath,
    narration: narrationPath,
    assets: (options.assets || []).map(item => asAbsolute(root, item)),
    music: (options.music || []).map(item => asAbsolute(root, item)),
    width: options.width || 1920,
    height: options.height || 1080,
    fps: options.fps || 30,
    style: {
      shot_min: 1.5,
      shot_max: 4,
      emphasis_max: 1.2,
      pause_sentence_ms: 350,
      pause_paragraph_ms: 700,
      target_sentence_gap_ms: 220,
      target_paragraph_gap_ms: 500,
      speed: 1.03,
      breath_sensitivity: 'conservative',
      sfx_density: 'medium',
      ...(current.style || {}),
      ...(options.style || {}),
    },
  }
  project.source_hashes = { script: await fileHash(scriptPath) }
  if (narrationPath) project.source_hashes.narration = await fileHash(narrationPath)
  await writeJSON(artifact(root, 'project.json'), project)
  await writeJSON(artifact(root, 'overrides.json'), await readJSON(artifact(root, 'overrides.json'), { segments: {}, cues: {}, locks: {} }))
  return { root, project: artifact(root, 'project.json'), name: project.name }
}

export async function analyzeScript(root, deepseek) {
  const project = await loadProject(root)
  const text = await readFile(project.script, 'utf8')
  const result = await deepseek.analyzeScript(text, project.style)
  if (!Array.isArray(result.segments) || !result.segments.length) throw new Error('DeepSeek 未返回有效句段')
  let cursor = 0
  const segments = result.segments.map((segment, index) => {
    const content = String(segment.text || '')
    const offset = text.indexOf(content, cursor)
    if (!content || offset < 0) throw new Error(`第 ${index + 1} 段不是原文的连续精确切片，已停止以避免改写文案`)
    cursor = offset + content.length
    return {
      id: `seg_${String(index + 1).padStart(4, '0')}`,
      text: content,
      start: offset,
      end: cursor,
      chapter: String(segment.chapter || '正文'),
      intent: String(segment.intent || 'explain'),
      emotion: String(segment.emotion || 'neutral'),
      visual_queries: Array.isArray(segment.visual_queries) ? segment.visual_queries.map(String).slice(0, 6) : [],
      emphasis: Array.isArray(segment.emphasis) ? segment.emphasis.map(String) : [],
      music: String(segment.music || ''),
      sfx: Array.isArray(segment.sfx) ? segment.sfx.map(String).slice(0, 4) : [],
    }
  })
  if (text.slice(cursor).trim()) throw new Error('DeepSeek 遗漏了文案末尾，未生成不完整分析')
  const output = { schema_version: 1, source_hash: project.source_hashes.script, text_hash: project.source_hashes.script, segments }
  await writeJSON(artifact(root, 'script_graph.json'), output)
  return { segments: segments.length, output: artifact(root, 'script_graph.json') }
}

export async function setOverride(root, options) {
  const file = artifact(root, 'overrides.json')
  const overrides = await readJSON(file, { segments: {}, cues: {}, locks: {} })
  if (!options.id) throw new Error('必须提供 segment_id 或 cue id')
  if (options.action === 'lock') overrides.locks[options.id] = true
  else if (options.action === 'unlock') delete overrides.locks[options.id]
  else if (options.action === 'asset') {
    const mediaPath = asAbsolute(root, options.value || '')
    const catalog = await readJSON(artifact(root, 'asset_catalog.json'))
    const asset = catalog.assets.find(item => path.normalize(item.path) === mediaPath)
    if (!asset) throw new Error('该素材不在索引中；请先将其目录加入项目并运行 autocut_index')
    overrides.segments[options.id] ||= {}
    overrides.segments[options.id].asset = asset.id
  } else if (options.action === 'enable' || options.action === 'disable') {
    overrides.cues[options.id] = { enabled: options.action === 'enable' }
  } else throw new Error(`未知操作: ${options.action}`)
  await writeJSON(file, overrides)
  return { output: file, overrides }
}
