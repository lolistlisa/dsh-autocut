import { defineTool } from '@deepseek-ai/dsh-tools'
import { DeepSeekClient } from './lib/deepseek.js'
import { initProject, analyzeScript, setOverride } from './lib/project.js'
import { indexAssets, matchAssets } from './lib/assets.js'
import { transcribeVoice, processVoice, estimateTiming } from './lib/voice.js'
import { planSound } from './lib/sound.js'
import { buildTimeline } from './lib/timeline.js'
import { renderPreview } from './lib/render.js'
import { exportJianying } from './lib/export.js'
import { runPipeline, projectStatus } from './lib/pipeline.js'
import { researchOnline, researchMusic, planResearchOnly } from './lib/online.js'
import { buildReview } from './lib/review.js'
import { prepareSelections } from './lib/selections.js'
import { importResearch } from './lib/import-research.js'

export const name = 'autocut'
export const inject = ['tools']

const root = { type: 'string', required: true, description: '项目工作区绝对路径；所有中间产物写入其 .autocut 子目录' }
const output = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

export function apply(ctx) {
  const deepseek = new DeepSeekClient()
  const register = (toolName, description, parameters, execute) => ctx.tools.register(defineTool({ name: toolName, description, parameters, output, execute }))

  register('autocut_init', '创建或更新自动剪辑项目。只读原始文案、旁白和素材，不覆盖源文件。', {
    root, script: { type: 'string', required: true, description: '原创文案路径' },
    narration: { type: 'string', description: '旁白录音路径' }, name: { type: 'string' },
    assets: { type: 'array', items: { type: 'string' }, description: '明确授权的素材目录列表' },
    music: { type: 'array', items: { type: 'string' }, description: '音乐与音效目录列表' },
    width: { type: 'number' }, height: { type: 'number' }, fps: { type: 'number' },
  }, async args => initProject(args))

  register('autocut_analyze', '调用 DeepSeek 对原创文案做不改写的连续句段分析，生成 script_graph.json。', { root },
    async (args, exec) => analyzeScript(args.root, deepseek, { signal: exec.signal }))

  register('autocut_transcribe', '用 faster-whisper 生成词级时间码。需要 Python 依赖。', {
    root, model: { type: 'string', description: 'faster-whisper 模型名，默认 small' },
  }, async (args, exec) => transcribeVoice(args.root, { model: args.model, signal: exec.signal }))

  register('autocut_voice', '非破坏性压缩长停顿、保守去除高置信喘气并处理人声，输出 voice_edit.json 和 clean_voice.wav。', { root },
    async (args, exec) => processVoice(args.root, { signal: exec.signal }))

  register('autocut_estimate_timing', '无旁白录音时的降级模式：按中文字符数估算句段时长，生成可编辑粗剪与字幕；之后可换成真实录音重跑。', { root },
    async args => estimateTiming(args.root))

  register('autocut_research', '第一步：按文案生成检索计划，检索 Pexels/Pixabay 在线视频并返回每条素材页面链接、预览、作者和许可。', {
    root, per_segment: { type: 'number', description: '每个检索词最多返回数量，默认 5' },
  }, async (args, exec) => researchOnline(args.root, deepseek, { perSegment: args.per_segment || 5, signal: exec.signal }))

  register('autocut_research_music', '第二步：按文案叙事段落检索 Jamendo CC 配乐，输出试听与来源页面链接供人工挑选。', { root },
    async (args, exec) => researchMusic(args.root, deepseek, { signal: exec.signal }))

  register('autocut_research_plan', '只生成素材和配乐的检索词计划，不请求第三方接口。', { root },
    async (args, exec) => planResearchOnly(args.root, deepseek, { signal: exec.signal }))

  register('autocut_import_research', '把 DSH 内置网页搜索得到的素材页面合并进在线候选；每条必须有 http(s) 来源链接，仅浏览不自动下载。', {
    root, file: { type: 'string', required: true, description: '包含 segments[].segment_id 和 candidates[].page_url 的 JSON 文件' },
  }, async args => importResearch(args.root, { file: args.file }))

  register('autocut_review', '生成可勾选素材与配乐的本地审阅页；下载 selections.json 后交回插件。', { root },
    async args => buildReview(args.root))

  register('autocut_prepare_selections', '把审阅页导出的 selections.json 转成本地入库素材、人工锁定和配乐覆盖；下载必须在 download=true 时进行。', {
    root, selections_file: { type: 'string', description: '默认 .autocut/selections.json' },
    download: { type: 'boolean', description: '是否下载所选 Pexels/Pixabay 视频和允许下载的 Jamendo 音乐' },
    materials_dir: { type: 'string' }, music_dir: { type: 'string' },
  }, async (args, exec) => prepareSelections(args.root, { selections_file: args.selections_file, download: Boolean(args.download), materials_dir: args.materials_dir, music_dir: args.music_dir, signal: exec.signal }))

  register('autocut_index', '索引明确指定的素材目录及 .autocut.json 元数据；不修改素材。', {
    root, directories: { type: 'array', items: { type: 'string' } },
  }, async args => indexAssets(args.root, args.directories))

  register('autocut_match', '按文案句段混合检索素材，并由 DeepSeek 重排；保留每段候选和选择理由。', {
    root, top_k: { type: 'number' },
  }, async (args, exec) => matchAssets(args.root, deepseek, { topK: args.top_k, signal: exec.signal }))

  register('autocut_sound', '生成可编辑 BGM、音效、视觉强调计划；可选调用本地 MusicGen。', {
    root, generate: { type: 'boolean', description: '没有匹配曲目时是否用本地 MusicGen 生成' },
  }, async (args, exec) => planSound(args.root, deepseek, { generate: args.generate, signal: exec.signal }))

  register('autocut_timeline', '从当前中间 JSON 重建多轨时间线、OTIO 和 SRT，保留人工锁定与替换。', { root }, async args => buildTimeline(args.root))
  register('autocut_preview', '用 FFmpeg 渲染当前时间线审片 MP4。', { root, subtitles: { type: 'boolean' } },
    async (args, exec) => renderPreview(args.root, { subtitles: args.subtitles !== false, signal: exec.signal }))

  register('autocut_export_jianying', '通过 pyJianYingDraft 创建独立剪映专业版草稿；必须显式提供草稿目录，拒绝覆盖同名草稿。', {
    root, draft_dir: { type: 'string', description: '中国版桌面剪映专业版草稿目录' }, name: { type: 'string' },
  }, async (args, exec) => exportJianying(args.root, { draftDir: args.draft_dir, name: args.name, signal: exec.signal }))

  register('autocut_override', '锁定句段、指定替换素材或启停音效事件；之后只重建时间线和预览。', {
    root, id: { type: 'string', required: true }, action: { type: 'string', required: true, description: 'lock|unlock|asset|enable|disable' }, value: { type: 'string', description: 'action=asset 时的素材绝对路径' },
  }, async args => setOverride(args.root, args))

  register('autocut_run', '按阶段运行流水线。用 start_at/until 只重跑受影响阶段，例如改素材后从 match 开始。', {
    root, start_at: { type: 'string', description: 'script|transcribe|voice|index|match|sound|timeline|preview' },
    until: { type: 'string' }, model: { type: 'string' }, generate: { type: 'boolean' },
  }, async (args, exec) => runPipeline(args.root, deepseek, { startAt: args.start_at, until: args.until, model: args.model, generate: args.generate, signal: exec.signal }))

  register('autocut_status', '查看各阶段状态和全部可编辑中间产物路径。', { root }, async args => projectStatus(args.root))
}
