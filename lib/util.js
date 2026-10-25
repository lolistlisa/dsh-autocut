import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises'
import path from 'node:path'

export const AUTOCUT_DIR = '.autocut'
export const now = () => new Date().toISOString()
export const projectDir = root => path.join(path.resolve(root), AUTOCUT_DIR)
export const artifact = (root, name) => path.join(projectDir(root), name)

export async function ensureProject(root) {
  const dir = projectDir(root)
  await mkdir(dir, { recursive: true })
  return dir
}

export async function exists(file) {
  try { await access(file); return true } catch { return false }
}

export async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch (error) {
    if (fallback !== undefined && error.code === 'ENOENT') return structuredClone(fallback)
    throw error
  }
}

export async function writeJSON(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await copyFile(temporary, file)
  await import('node:fs/promises').then(({ unlink }) => unlink(temporary))
  return file
}

export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function hash(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex')
}

export async function fileHash(file) {
  return hash(await readFile(file))
}

export async function loadProject(root) {
  const project = await readJSON(artifact(root, 'project.json'))
  project.root = path.resolve(root)
  return project
}

export async function saveStage(root, stage, input, output, extra = {}) {
  const key = hash(input)
  const stateFile = artifact(root, 'state.json')
  const state = await readJSON(stateFile, { version: 1, stages: {} })
  const previous = state.stages[stage]
  const reused = previous?.key === key
  if (!reused) {
    await writeJSON(artifact(root, `${stage}.json`), output)
    await writeJSON(artifact(root, path.join('versions', stage, `${key.slice(0, 16)}.json`)), output)
  }
  state.stages[stage] = { key, updated_at: now(), reused, ...extra }
  await writeJSON(stateFile, state)
  return { reused, key, output: reused ? previous.output ?? output : output }
}

export function run(command, args, { cwd, signal, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, windowsHide: true })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const abort = () => child.kill()
    signal?.addEventListener('abort', abort, { once: true })
    child.on('error', reject)
    child.on('close', code => {
      signal?.removeEventListener('abort', abort)
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${command} exited ${code}: ${stderr.slice(-3000)}`))
    })
  })
}

export async function resolveExecutable(envName, fallback) {
  return process.env[envName] || fallback
}

export function seconds(value) {
  return Math.max(0, Number(value) || 0)
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function uniqueName(name) {
  const safe = name.replace(/[<>:"/\\|?*]/g, '_').slice(0, 60)
  return `${safe}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')}`
}

export function asAbsolute(root, value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(root, value)
}
