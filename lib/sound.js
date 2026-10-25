import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { artifact, readJSON, run, writeJSON } from './util.js'

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts')

export async function planSound(root, deepseek, { generate = false, signal } = {}) {
  const graph = await readJSON(artifact(root, 'script_graph.json'))
  const catalog = await readJSON(artifact(root, 'asset_catalog.json'))
  const audio = catalog.assets.filter(item => item.enabled && item.kind === 'audio')
  const music = audio.filter(item => /music|bgm|音乐|配乐/i.test(`${item.tags.join(' ')} ${item.description} ${item.name}`))
  const sfx = audio.filter(item => !music.includes(item))
  const response = await deepseek.planSound(graph.segments, music, sfx, { signal })
  const overrides = await readJSON(artifact(root, 'overrides.json'), { music: [] })
  if (overrides.music?.length) {
    response.music = overrides.music.map(item => ({
      id: null, generated_path: item.source, start_segment: item.start_segment,
      end_segment: item.end_segment, gain_db: -18, selected_by_user: true,
    }))
  }
  const output = {
    schema_version: 1,
    music: Array.isArray(response.music) ? response.music : [],
    sfx: Array.isArray(response.sfx) ? response.sfx : [],
    vfx: Array.isArray(response.vfx) ? response.vfx : [],
    generated: [],
  }
  if (generate) {
    for (let index = 0; index < output.music.length; index++) {
      const cue = output.music[index]
      if (cue.id || !cue.prompt) continue
      const file = artifact(root, `music-${index + 1}.wav`)
      await run(process.env.PYTHON_PATH || 'python', [path.join(scripts, 'generate_music.py'), cue.prompt, file, '--duration', String(cue.duration || 30), '--seed', String(cue.seed || 42)], { signal })
      cue.generated_path = file
      output.generated.push({ file, prompt: cue.prompt, seed: cue.seed || 42, model: process.env.MUSICGEN_MODEL || 'facebook/musicgen-small' })
    }
  }
  await writeJSON(artifact(root, 'sound_plan.json'), output)
  await writeJSON(artifact(root, 'music_plan.json'), { schema_version: 1, music: output.music, generated: output.generated })
  await writeJSON(artifact(root, 'sfx_cues.json'), { schema_version: 1, cues: output.sfx })
  await writeJSON(artifact(root, 'vfx_cues.json'), { schema_version: 1, cues: output.vfx })
  return { music: output.music.length, sfx: output.sfx.length, vfx: output.vfx.length, generated: output.generated.length, output: artifact(root, 'sound_plan.json') }
}
