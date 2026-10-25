import { asAbsolute, artifact, hash, readJSON, writeJSON } from './util.js'

function normalizeCandidate(candidate, segmentId) {
  if (!candidate.page_url || !/^https?:\/\//i.test(candidate.page_url)) throw new Error(`候选缺少有效 page_url: ${JSON.stringify(candidate).slice(0, 200)}`)
  return {
    id: candidate.id || `web:${hash(candidate.page_url).slice(0, 16)}`,
    provider: candidate.provider || 'Web',
    kind: candidate.kind || 'reference',
    title: candidate.title || candidate.page_url,
    page_url: candidate.page_url,
    preview_url: candidate.preview_url || '',
    download_url: candidate.download_url || '',
    duration: candidate.duration || null,
    width: candidate.width || null,
    height: candidate.height || null,
    author: candidate.author || '',
    author_url: candidate.author_url || '',
    license: candidate.license || '未确认，仅供浏览参考',
    license_url: candidate.license_url || '',
    attribution: candidate.attribution || '',
    segment_id: segmentId,
    query: candidate.query || '',
    imported: true,
  }
}

export async function importResearch(root, { file }) {
  const input = await readJSON(asAbsolute(root, file))
  if (!Array.isArray(input.segments)) throw new Error('导入文件必须包含 segments 数组')
  const existing = await readJSON(artifact(root, 'online_materials.json'), { schema_version: 1, providers: [], segments: [] })
  const bySegment = new Map(existing.segments.map(section => [section.segment_id, section]))
  let imported = 0
  for (const section of input.segments) {
    if (!section.segment_id) continue
    const target = bySegment.get(section.segment_id) || { segment_id: section.segment_id, text: section.text || '', queries: [], candidates: [] }
    target.queries = [...new Set([...(target.queries || []), ...(section.queries || [])])]
    for (const raw of section.candidates || []) {
      const candidate = normalizeCandidate(raw, section.segment_id)
      const index = target.candidates.findIndex(item => item.id === candidate.id || item.page_url === candidate.page_url)
      if (index >= 0) target.candidates[index] = candidate
      else target.candidates.push(candidate)
      imported++
    }
    bySegment.set(section.segment_id, target)
  }
  const output = { ...existing, schema_version: 1, imported_at: new Date().toISOString(), segments: [...bySegment.values()] }
  await writeJSON(artifact(root, 'online_materials.json'), output)
  return { imported, segments: output.segments.length, output: artifact(root, 'online_materials.json'), note: '网页参考链接不会自动下载；进入时间线的素材必须有本地文件或明确许可的直接下载地址' }
}
