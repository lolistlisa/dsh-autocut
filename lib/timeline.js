import path from 'node:path'
import { artifact, clamp, exists, loadProject, readJSON, writeJSON } from './util.js'
import { alignSegments } from './mapping.js'

function splitShots(segment, timing, match, style, catalog) {
  const duration = timing.end - timing.start
  const count = Math.max(1, Math.ceil(duration / style.shot_max))
  const ids = [match?.selected, ...(match?.alternatives || [])].filter(Boolean)
  if (!ids.length) return []
  const clips = []
  for (let index = 0; index < count; index++) {
    const start = timing.start + duration * index / count
    const end = timing.start + duration * (index + 1) / count
    const asset = catalog.get(ids[index % ids.length])
    if (!asset) continue
    clips.push({
      id: `${segment.id}_shot_${index + 1}`, segment_id: segment.id,
      asset_id: asset.id, source: asset.path, kind: asset.kind,
      start, end, source_start: 0, source_end: Math.min(asset.duration || end - start, end - start),
      volume: 0, effects: [],
    })
  }
  return clips
}

function srtTime(value) {
  const ms = Math.round(value * 1000)
  const hours = String(Math.floor(ms / 3600000)).padStart(2, '0')
  const minutes = String(Math.floor(ms / 60000) % 60).padStart(2, '0')
  const seconds = String(Math.floor(ms / 1000) % 60).padStart(2, '0')
  return `${hours}:${minutes}:${seconds},${String(ms % 1000).padStart(3, '0')}`
}

function toOTIO(project, timeline) {
  const rate = project.fps
  const range = (start, duration) => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: { OTIO_SCHEMA: 'RationalTime.1', rate, value: Math.round(start * rate) }, duration: { OTIO_SCHEMA: 'RationalTime.1', rate, value: Math.round(duration * rate) } })
  const tracks = timeline.tracks.filter(track => track.kind !== 'text').map(track => {
    const children = []
    let cursor = 0
    for (const clip of track.clips) {
      if (clip.start > cursor) children.push({ OTIO_SCHEMA: 'Gap.1', source_range: range(0, clip.start - cursor) })
      children.push({
        OTIO_SCHEMA: 'Clip.2', name: clip.id,
        source_range: range(clip.source_start || 0, clip.end - clip.start),
        media_reference: { OTIO_SCHEMA: 'ExternalReference.1', target_url: clip.source ? `file://${clip.source.replace(/\\/g, '/')}` : '', available_range: range(0, clip.source_end || clip.end - clip.start) },
        metadata: { autocut: { segment_id: clip.segment_id || null } },
      })
      cursor = clip.end
    }
    return { OTIO_SCHEMA: 'Track.1', name: track.name, kind: track.kind === 'video' ? 'Video' : 'Audio', children, metadata: { autocut: { track_id: track.id } } }
  })
  return { OTIO_SCHEMA: 'Timeline.1', name: project.name, global_start_time: range(0, 0).start_time, tracks: { OTIO_SCHEMA: 'Stack.1', children: tracks }, metadata: { autocut: { schema_version: 1 } } }
}

export async function buildTimeline(root) {
  const project = await loadProject(root)
  const graph = await readJSON(artifact(root, 'script_graph.json'))
  const matches = await readJSON(artifact(root, 'asset_matches.json'))
  const voice = await readJSON(artifact(root, 'voice_edit.json'))
  const sound = await readJSON(artifact(root, 'sound_plan.json'))
  const catalogData = await readJSON(artifact(root, 'asset_catalog.json'))
  const overrides = await readJSON(artifact(root, 'overrides.json'), { cues: {} })
  const catalog = new Map(catalogData.assets.map(item => [item.id, item]))
  const timings = alignSegments(graph.segments, voice.words, voice.output_duration)
  const timingMap = new Map(timings.map(item => [item.segment_id, item]))
  const video = graph.segments.flatMap(segment => splitShots(segment, timingMap.get(segment.id), matches.matches.find(item => item.segment_id === segment.id), project.style, catalog))
  const byAsset = id => catalog.get(id)
  const music = sound.music.map((cue, index) => {
    const asset = byAsset(cue.id)
    const start = timingMap.get(cue.start_segment)?.start ?? 0
    const end = timingMap.get(cue.end_segment)?.end ?? voice.output_duration
    const source = cue.generated_path || asset?.path
    return source ? { id: `music_${index + 1}`, source, asset_id: cue.id || null, start, end, source_start: 0, source_end: end - start, gain_db: cue.gain_db ?? -16 } : null
  }).filter(Boolean)
  const sfx = sound.sfx.map((cue, index) => {
    const asset = byAsset(cue.asset_id)
    const timing = timingMap.get(cue.segment_id)
    const id = cue.id || `sfx_${index + 1}`
    if (!asset || !timing || overrides.cues?.[id]?.enabled === false) return null
    const start = timing.start + Number(cue.offset || 0)
    const duration = Math.min(asset.duration || 1.5, 3)
    return { id, segment_id: cue.segment_id, source: asset.path, asset_id: asset.id, start, end: start + duration, source_start: 0, source_end: duration, gain_db: cue.gain_db ?? -12, event: cue.event }
  }).filter(Boolean)
  const vfx = sound.vfx.map((cue, index) => ({ ...cue, id: cue.id || `vfx_${index + 1}`, start: timingMap.get(cue.segment_id)?.start || 0, end: timingMap.get(cue.segment_id)?.end || 0 }))
  for (const cue of vfx) {
    if (cue.type === 'punch_in') video.filter(clip => clip.segment_id === cue.segment_id).forEach(clip => clip.effects.push('punch_in'))
  }
  const subtitles = graph.segments.map(segment => ({ id: `subtitle_${segment.id}`, segment_id: segment.id, text: segment.text.trim(), start: timingMap.get(segment.id).start, end: timingMap.get(segment.id).end }))
  const narrationPath = artifact(root, 'clean_voice.wav')
  const narrationClips = await exists(narrationPath) ? [{ id: 'narration', source: narrationPath, start: 0, end: voice.output_duration, source_start: 0, source_end: voice.output_duration, gain_db: 0 }] : []
  const timeline = {
    schema_version: 1, duration: voice.output_duration, width: project.width, height: project.height, fps: project.fps, timings,
    tracks: [
      { id: 'V1', name: '自动画面', kind: 'video', clips: video },
      { id: 'A1', name: '精剪旁白', kind: 'audio', clips: narrationClips },
      { id: 'A2', name: '背景音乐', kind: 'audio', clips: music },
      { id: 'A3', name: '音效', kind: 'audio', clips: sfx },
      { id: 'T1', name: '字幕', kind: 'text', clips: subtitles },
    ],
    vfx,
  }
  await writeJSON(artifact(root, 'timeline.json'), timeline)
  await writeJSON(artifact(root, 'timeline.otio'), toOTIO(project, timeline))
  const srt = subtitles.map((item, index) => `${index + 1}\n${srtTime(item.start)} --> ${srtTime(item.end)}\n${item.text}\n`).join('\n')
  await import('node:fs/promises').then(({ writeFile }) => writeFile(artifact(root, 'subtitles.srt'), srt, 'utf8'))
  return { duration: timeline.duration, video_clips: video.length, music_clips: music.length, sfx_clips: sfx.length, unmatched_segments: timings.filter(timing => !video.some(clip => clip.segment_id === timing.segment_id)).map(item => item.segment_id), output: artifact(root, 'timeline.json'), otio: artifact(root, 'timeline.otio') }
}
