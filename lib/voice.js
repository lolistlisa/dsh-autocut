import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { artifact, clamp, fileHash, loadProject, now, readJSON, run, writeJSON } from './util.js'

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts')

export async function transcribeVoice(root, { model = 'small', signal } = {}) {
  const project = await loadProject(root)
  if (!project.narration) throw new Error('项目没有旁白录音')
  const output = artifact(root, 'alignment.json')
  await run(process.env.PYTHON_PATH || 'python', [path.join(scripts, 'transcribe.py'), project.narration, output, '--model', model], { signal })
  const alignment = await readJSON(output)
  alignment.source_hash = await fileHash(project.narration)
  await writeJSON(output, alignment)
  return { words: alignment.words.length, duration: alignment.duration, output }
}

function normalizeDeletes(deletes, duration) {
  const sorted = deletes.map(item => ({ ...item, start: clamp(item.start, 0, duration), end: clamp(item.end, 0, duration) }))
    .filter(item => item.end - item.start > 0.02).sort((a, b) => a.start - b.start)
  const merged = []
  for (const item of sorted) {
    const last = merged.at(-1)
    if (last && item.start <= last.end) {
      last.end = Math.max(last.end, item.end)
      last.reasons.push(...item.reasons)
    } else merged.push({ ...item, reasons: [...item.reasons] })
  }
  return merged
}

export function planVoiceEdit(alignment, breaths, style) {
  const words = alignment.words
  if (!words.length) throw new Error('ASR 没有词级时间码，无法进行安全精剪')
  const deletes = []
  for (let index = 0; index < words.length - 1; index++) {
    const previous = words[index], next = words[index + 1]
    const gap = next.start - previous.end
    const paragraph = /[。！？!?；;\n]$/.test(previous.text.trim())
    const threshold = (paragraph ? style.pause_paragraph_ms : style.pause_sentence_ms) / 1000
    const target = (paragraph ? style.target_paragraph_gap_ms : style.target_sentence_gap_ms) / 1000
    if (gap > threshold) deletes.push({ start: previous.end + target / 2, end: next.start - target / 2, reasons: ['long_pause'], original_gap: gap, target_gap: target })
  }
  for (const event of breaths?.events || []) {
    if (event.confidence >= 0.72) deletes.push({ start: event.start, end: event.end, reasons: ['breath'], confidence: event.confidence })
  }
  const duration = alignment.duration || words.at(-1).end
  const operations = normalizeDeletes(deletes, duration)
  const keeps = []
  let cursor = 0
  for (const operation of operations) {
    if (operation.start > cursor) keeps.push({ start: cursor, end: operation.start })
    cursor = operation.end
  }
  if (cursor < duration) keeps.push({ start: cursor, end: duration })
  const mapTime = source => {
    let removed = 0
    for (const operation of operations) {
      if (source <= operation.start) break
      removed += Math.min(source, operation.end) - operation.start
    }
    return Math.max(0, source - removed) / style.speed
  }
  return {
    schema_version: 1,
    speed: style.speed,
    source_duration: duration,
    output_duration: keeps.reduce((sum, item) => sum + item.end - item.start, 0) / style.speed,
    keeps,
    operations,
    words: words.map(word => ({ ...word, edited_start: mapTime(word.start), edited_end: mapTime(word.end) })),
  }
}

export async function estimateTiming(root) {
  const graph = await readJSON(artifact(root, 'script_graph.json'))
  let cursor = 0
  const words = graph.segments.map(segment => {
    const spoken = segment.text.replace(/[\s\p{P}\p{S}]/gu, '')
    const duration = Math.max(1.2, spoken.length / 4.8)
    const word = { text: segment.text, start: cursor, end: cursor + duration, probability: 0, estimated: true }
    cursor += duration + 0.2
    return word
  })
  const output = {
    schema_version: 1, estimated: true, speed: 1,
    source_duration: cursor, output_duration: Math.max(0.5, cursor - 0.2),
    keeps: [], operations: [], words,
    warning: '按中文字符数估算，不是语音对齐；请仅用于无旁白时的粗剪，放入录音后重跑 transcribe 和 voice',
  }
  await writeJSON(artifact(root, 'voice_edit.json'), output)
  return { estimated: true, duration: output.output_duration, output: artifact(root, 'voice_edit.json'), warning: output.warning }
}

export async function processVoice(root, { signal } = {}) {
  const project = await loadProject(root)
  const alignment = await readJSON(artifact(root, 'alignment.json'))
  const breathPath = artifact(root, 'breaths.json')
  const analysisWav = artifact(root, 'analysis-16k.wav')
  await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-i', project.narration, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', analysisWav], { signal })
  await run(process.env.PYTHON_PATH || 'python', [path.join(scripts, 'detect_breaths.py'), analysisWav, artifact(root, 'alignment.json'), breathPath], { signal })
  const breaths = await readJSON(breathPath)
  const edit = planVoiceEdit(alignment, breaths, project.style)
  await writeJSON(artifact(root, 'voice_edit.json'), edit)
  const filters = []
  edit.keeps.forEach((item, index) => {
    filters.push(`[0:a]atrim=start=${item.start.toFixed(6)}:end=${item.end.toFixed(6)},asetpts=PTS-STARTPTS[a${index}]`)
  })
  const concatInputs = edit.keeps.map((_, index) => `[a${index}]`).join('')
  filters.push(`${concatInputs}concat=n=${edit.keeps.length}:v=0:a=1,atempo=${project.style.speed},highpass=f=70,acompressor=threshold=-18dB:ratio=2.5:attack=15:release=180,loudnorm=I=-16:TP=-1.5:LRA=9[out]`)
  const output = artifact(root, 'clean_voice.wav')
  await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-i', project.narration, '-filter_complex', filters.join(';'), '-map', '[out]', '-c:a', 'pcm_s24le', output], { signal })
  await writeJSON(artifact(root, 'voice_dsp.json'), { schema_version: 1, filters, output, sample_format: 'pcm_s24le', created_at: now() })
  return { removed_seconds: edit.source_duration - edit.output_duration, operations: edit.operations.length, breath_candidates: breaths.events.length, edit: artifact(root, 'voice_edit.json'), output }
}
