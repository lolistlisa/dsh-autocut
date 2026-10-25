import { artifact, loadProject, readJSON, run } from './util.js'

function subtitlePath(file) {
  return file.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

export async function renderPreview(root, { signal, subtitles = true } = {}) {
  const project = await loadProject(root)
  const timeline = await readJSON(artifact(root, 'timeline.json'))
  const video = timeline.tracks.find(track => track.id === 'V1').clips
  if (!video.length) throw new Error('没有可渲染的画面片段；请先补齐素材匹配')
  const inputs = []
  const filters = []
  let inputCount = 0
  const addInput = (clip, image = false) => {
    const index = inputCount++
    if (image) inputs.push('-loop', '1', '-framerate', String(project.fps), '-t', String(clip.end - clip.start))
    else inputs.push('-ss', String(clip.source_start || 0), '-t', String((clip.source_end || clip.end - clip.start) - (clip.source_start || 0)))
    inputs.push('-i', clip.source)
    return index
  }
  const visualLabels = video.map((clip, index) => {
    const input = addInput(clip, clip.kind === 'image')
    const duration = clip.end - clip.start
    filters.push(`[${input}:v]scale=${project.width}:${project.height}:force_original_aspect_ratio=decrease,pad=${project.width}:${project.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${project.fps},trim=duration=${duration},setpts=PTS-STARTPTS[v${index}]`)
    return `[v${index}]`
  })
  filters.push(`${visualLabels.join('')}concat=n=${video.length}:v=1:a=0${subtitles ? `,subtitles=filename='${subtitlePath(artifact(root, 'subtitles.srt'))}'` : ''}[vout]`)
  const audioClips = timeline.tracks.filter(track => track.kind === 'audio').flatMap(track => track.clips)
  const audioLabels = audioClips.map((clip, index) => {
    const input = addInput(clip)
    const delay = Math.max(0, Math.round(clip.start * 1000))
    const volume = Math.pow(10, (clip.gain_db || 0) / 20)
    filters.push(`[${input}:a]atrim=duration=${clip.end - clip.start},asetpts=PTS-STARTPTS,volume=${volume},adelay=${delay}|${delay},apad,atrim=duration=${timeline.duration}[a${index}]`)
    return `[a${index}]`
  })
  if (audioLabels.length) {
    filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,alimiter=limit=0.95,atrim=duration=${timeline.duration}[aout]`)
  } else {
    const silent = inputCount++
    inputs.push('-f', 'lavfi', '-t', String(timeline.duration), '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000')
    filters.push(`[${silent}:a]atrim=duration=${timeline.duration}[aout]`)
  }
  const output = artifact(root, 'preview.mp4')
  await run(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', String(timeline.duration), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output], { signal })
  return { output, duration: timeline.duration }
}
