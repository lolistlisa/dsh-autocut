import { analyzeScript } from './project.js'
import { indexAssets, matchAssets } from './assets.js'
import { processVoice, transcribeVoice } from './voice.js'
import { planSound } from './sound.js'
import { buildTimeline } from './timeline.js'
import { renderPreview } from './render.js'
import { artifact, now, readJSON, writeJSON } from './util.js'

export const STAGES = ['script', 'transcribe', 'voice', 'index', 'match', 'sound', 'timeline', 'preview']

export async function runPipeline(root, deepseek, options = {}) {
  const start = options.startAt ? STAGES.indexOf(options.startAt) : 0
  if (start < 0) throw new Error(`未知起始阶段: ${options.startAt}`)
  const end = options.until ? STAGES.indexOf(options.until) : STAGES.length - 1
  if (end < start) throw new Error('until 必须位于 start_at 之后')
  const results = {}
  for (const stage of STAGES.slice(start, end + 1)) {
    if (stage === 'script') results[stage] = await analyzeScript(root, deepseek)
    else if (stage === 'transcribe') results[stage] = await transcribeVoice(root, options)
    else if (stage === 'voice') results[stage] = await processVoice(root, options)
    else if (stage === 'index') results[stage] = await indexAssets(root)
    else if (stage === 'match') results[stage] = await matchAssets(root, deepseek, options)
    else if (stage === 'sound') results[stage] = await planSound(root, deepseek, options)
    else if (stage === 'timeline') results[stage] = await buildTimeline(root)
    else if (stage === 'preview') results[stage] = await renderPreview(root, options)
    const state = await readJSON(artifact(root, 'state.json'), { version: 1, stages: {} })
    state.stages[stage] = { status: 'completed', updated_at: now(), result: results[stage] }
    await writeJSON(artifact(root, 'state.json'), state)
  }
  return { completed: Object.keys(results), results, state: artifact(root, 'state.json') }
}

export async function projectStatus(root) {
  const state = await readJSON(artifact(root, 'state.json'), { version: 1, stages: {} })
  const artifacts = ['project', 'script_graph', 'research_plan', 'online_materials', 'music_candidates', 'alignment', 'breaths', 'voice_edit', 'voice_dsp', 'asset_catalog', 'asset_matches', 'sound_plan', 'music_plan', 'sfx_cues', 'vfx_cues', 'timeline', 'subtitles', 'preview']
  const output = {}
  for (const name of artifacts) output[name] = artifact(root, `${name}.${name === 'subtitles' ? 'srt' : name === 'preview' ? 'mp4' : 'json'}`)
  output.review = artifact(root, 'review.html')
  output.selections_applied = artifact(root, 'selections_applied.json')
  output.clean_voice = artifact(root, 'clean_voice.wav')
  output.otio = artifact(root, 'timeline.otio')
  output.overrides = artifact(root, 'overrides.json')
  return { stages: state.stages, artifacts: output }
}
