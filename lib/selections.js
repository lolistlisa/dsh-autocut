import path from 'node:path'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { artifact, asAbsolute, exists, loadProject, readJSON, writeJSON } from './util.js'
import { indexAssets } from './assets.js'

async function download(url, destination, signal) {
  if (await exists(destination)) {
    const info = await stat(destination)
    if (info.size > 1024) return { path: destination, reused: true }
  }
  const response = await fetch(url, { signal })
  if (!response.ok || !response.body) throw new Error(`下载失败 ${response.status}: ${url}`)
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.part`
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary), { signal })
    await rename(temporary, destination)
    return { path: destination, reused: false }
  } catch (error) {
    try { await unlink(temporary) } catch {}
    throw error
  }
}

const nameFor = candidate => `${candidate.provider.toLowerCase()}-${String(candidate.id).replace(/[^a-zA-Z0-9_-]+/g, '-')}`

export async function prepareSelections(root, options = {}) {
  const project = await loadProject(root)
  const file = options.selections_file ? asAbsolute(root, options.selections_file) : artifact(root, 'selections.json')
  if (!await exists(file)) throw new Error(`未找到选择文件: ${file}。请在 review.html 勾选后下载，并放到该位置`)
  let selections
  try { selections = JSON.parse(await readFile(file, 'utf8')) } catch (error) { throw new Error(`选择文件不是有效 JSON: ${error.message}`) }
  const materialsDir = asAbsolute(root, options.materials_dir || 'assets/selected-online')
  const musicDir = asAbsolute(root, options.music_dir || 'music/selected-online')
  const warnings = []
  const materialFiles = []
  const musicFiles = []
  let downloadedMaterials = false
  let downloadedMusic = false
  for (const candidate of selections.materials || []) {
    try {
      const local = candidate.local_path ? asAbsolute(root, candidate.local_path) : null
      if (local && await exists(local)) materialFiles.push({ candidate, file: local })
      else if (options.download && candidate.download_url && /pexels|pixabay/i.test(candidate.provider)) {
        const result = await download(candidate.download_url, path.join(materialsDir, `${nameFor(candidate)}.mp4`), options.signal)
        materialFiles.push({ candidate, file: result.path })
        downloadedMaterials = true
      } else warnings.push({ type: 'material', id: candidate.id, message: '没有本地文件，且未允许下载或来源不支持直接下载' })
    } catch (error) { warnings.push({ type: 'material', id: candidate.id, message: error.message }) }
  }
  for (const candidate of selections.music || []) {
    try {
      const local = candidate.local_path ? asAbsolute(root, candidate.local_path) : null
      if (local && await exists(local)) musicFiles.push({ candidate, file: local })
      else if (options.download && candidate.download_url && candidate.download_allowed) {
        const result = await download(candidate.download_url, path.join(musicDir, `${nameFor(candidate)}.mp3`), options.signal)
        musicFiles.push({ candidate, file: result.path })
        downloadedMusic = true
      } else warnings.push({ type: 'music', id: candidate.id, message: '音轨没有可用的本地文件；请在来源页确认许可后下载并填写 local_path，或允许 download' })
    } catch (error) { warnings.push({ type: 'music', id: candidate.id, message: error.message }) }
  }
  const newAssets = downloadedMaterials ? materialsDir : null
  const newMusic = downloadedMusic ? musicDir : null
  project.assets = [...new Set([...project.assets, ...(newAssets ? [newAssets] : [])])]
  project.music = [...new Set([...project.music, ...(newMusic ? [newMusic] : [])])]
  await writeJSON(artifact(root, 'project.json'), project)
  await indexAssets(root)
  const catalog = await readJSON(artifact(root, 'asset_catalog.json'))
  const byPath = new Map(catalog.assets.map(item => [path.normalize(item.path), item]))
  const overrides = await readJSON(artifact(root, 'overrides.json'), { segments: {}, cues: {}, locks: {} })
  for (const item of materialFiles) {
    const asset = byPath.get(path.normalize(item.file))
    if (!asset) { warnings.push({ type: 'material', id: item.candidate.id, message: '下载后未能入库' }); continue }
    overrides.segments[item.candidate.segment_id] ||= {}
    overrides.segments[item.candidate.segment_id].asset = asset.id
    overrides.locks[item.candidate.segment_id] = true
  }
  overrides.music = musicFiles.map(item => ({ source: item.file, title: item.candidate.title, artist: item.candidate.artist, start_segment: item.candidate.start_segment, end_segment: item.candidate.end_segment, license: item.candidate.license }))
  await writeJSON(artifact(root, 'overrides.json'), overrides)
  const summary = { schema_version: 1, source: file, materials: materialFiles.map(item => ({ ...item.candidate, local_path: item.file })), music: overrides.music, warnings, downloaded: Boolean(options.download) }
  await writeJSON(artifact(root, 'selections_applied.json'), summary)
  return { materials: materialFiles.length, music: musicFiles.length, warnings, output: artifact(root, 'selections_applied.json') }
}
