import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { artifact, exists, loadProject, run, uniqueName } from './util.js'

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts')

export async function exportJianying(root, options = {}) {
  const project = await loadProject(root)
  const draftDir = options.draftDir || process.env.JIANYING_DRAFT_DIR
  if (!draftDir) throw new Error('请提供剪映草稿目录 draft_dir，或设置 JIANYING_DRAFT_DIR；插件不会猜测并修改现有草稿')
  if (!await exists(draftDir)) throw new Error(`剪映草稿目录不存在: ${draftDir}`)
  if (!await exists(artifact(root, 'timeline.json'))) throw new Error('请先构建时间线')
  const name = uniqueName(options.name || project.name)
  const { stdout } = await run(process.env.PYTHON_PATH || 'python', [path.join(scripts, 'export_jianying.py'), artifact(root, 'timeline.json'), path.resolve(draftDir), name], { signal: options.signal })
  return { ...JSON.parse(stdout.trim().split('\n').at(-1)), timeline: artifact(root, 'timeline.json'), note: '已创建独立新草稿；重启剪映后检查素材、字体和版本兼容性' }
}
