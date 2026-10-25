import { artifact, loadProject, readJSON, writeJSON } from './util.js'

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c')

function warningBlock(warnings) {
  if (!warnings?.length) return ''
  return `<section class="warnings"><h2>需要处理的限制</h2>${warnings.map(item => `<p><strong>${escapeHTML(item.provider)}</strong>：${escapeHTML(item.error)}</p>`).join('')}</section>`
}

function materialCard(candidate) {
  return `<article class="candidate">
    <label class="pick"><input type="checkbox" data-kind="material" value="${escapeHTML(candidate.id)}" data-segment="${escapeHTML(candidate.segment_id)}"> 选入这一段</label>
    ${candidate.preview_url ? `<a href="${escapeHTML(candidate.page_url)}" target="_blank" rel="noreferrer"><img loading="lazy" src="${escapeHTML(candidate.preview_url)}" alt="素材预览" referrerpolicy="no-referrer"></a>` : '<div class="no-preview">无预览图</div>'}
    <h3>${escapeHTML(candidate.title || candidate.provider)}</h3>
    <p class="meta">${escapeHTML(candidate.provider)} · ${candidate.duration ? `${candidate.duration} 秒` : '时长未知'}${candidate.width ? ` · ${candidate.width}×${candidate.height}` : ''}</p>
    <p class="meta">作者：${candidate.author_url ? `<a href="${escapeHTML(candidate.author_url)}" target="_blank" rel="noreferrer">${escapeHTML(candidate.author)}</a>` : escapeHTML(candidate.author || '未知')}</p>
    <p class="meta">检索词：${escapeHTML(candidate.query)}</p>
    <p class="license">${escapeHTML(candidate.license)}${candidate.commercial_warning ? ` · ${escapeHTML(candidate.commercial_warning)}` : ''}</p>
    <div class="links"><a href="${escapeHTML(candidate.page_url)}" target="_blank" rel="noreferrer">打开素材页</a>${candidate.download_url ? `<a href="${escapeHTML(candidate.download_url)}" target="_blank" rel="noreferrer">下载文件</a>` : ''}<a href="${escapeHTML(candidate.license_url)}" target="_blank" rel="noreferrer">查看许可</a></div>
  </article>`
}

function musicCard(track) {
  return `<article class="candidate music">
    <label class="pick"><input type="checkbox" data-kind="music" value="${escapeHTML(track.id)}"> 选用这首</label>
    ${track.image ? `<img loading="lazy" src="${escapeHTML(track.image)}" alt="专辑封面" referrerpolicy="no-referrer">` : ''}
    <h3>${escapeHTML(track.title)}</h3>
    <p class="meta">${escapeHTML(track.artist)} · ${Math.round(Number(track.duration) / 60)}:${String(Math.round(Number(track.duration) % 60)).padStart(2, '0')}${track.recommended ? ' · 推荐' : ''}</p>
    <p class="meta">建议段落：${escapeHTML(track.suggested_mood)}</p>
    ${track.audio_url ? `<audio controls preload="none" src="${escapeHTML(track.audio_url)}"></audio>` : ''}
    <p class="license">${escapeHTML(track.license)}${track.commercial_warning ? ` · ${escapeHTML(track.commercial_warning)}` : ''}</p>
    <div class="links"><a href="${escapeHTML(track.share_url)}" target="_blank" rel="noreferrer">打开来源页</a>${track.download_url ? `<a href="${escapeHTML(track.download_url)}" target="_blank" rel="noreferrer">下载音频</a>` : ''}<a href="${escapeHTML(track.license_url)}" target="_blank" rel="noreferrer">查看许可</a></div>
  </article>`
}

export async function buildReview(root) {
  const project = await loadProject(root)
  const graph = await readJSON(artifact(root, 'script_graph.json'))
  const materials = await readJSON(artifact(root, 'online_materials.json'), { segments: [], providers: [] })
  const music = await readJSON(artifact(root, 'music_candidates.json'), { plan: [], candidates: [], warnings: [] })
  const materialIndex = new Map()
  for (const section of materials.segments) for (const candidate of section.candidates) materialIndex.set(`${section.segment_id}|${candidate.id}`, { ...candidate, segment_id: section.segment_id })
  const musicIndex = new Map(music.candidates.map(track => [track.id, track]))
  const sections = graph.segments.map(segment => {
    const result = materials.segments.find(item => item.segment_id === segment.id)
    const cards = result?.candidates?.length ? result.candidates.map(materialCard).join('') : '<p class="empty">这一段没有返回在线素材，可调整检索词后重跑，或改用本地素材。</p>'
    return `<section class="script-segment"><div class="script"><span>${escapeHTML(segment.chapter)}</span><h2>${escapeHTML(segment.text)}</h2><p>检索词：${escapeHTML((result?.queries || segment.visual_queries).join(' / '))}</p></div><div class="grid">${cards}</div></section>`
  }).join('')
  const musicCards = music.candidates.length ? music.candidates.map(musicCard).join('') : '<p class="empty">没有在线配乐候选。可在本地音乐目录中放置音频并运行索引。</p>'
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AutoCut 素材与配乐审阅</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f5f5f2;color:#20201e;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif}.wrap{max-width:1240px;margin:auto;padding:32px 24px 80px}header{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;border-bottom:1px solid #d9d8d2;padding-bottom:20px}h1{font-size:24px;margin:0}.sub{color:#66645f;margin:6px 0 0}.actions{position:sticky;top:0;z-index:5;background:#f5f5f2;padding:16px 0;display:flex;gap:12px;align-items:center;flex-wrap:wrap}.button{border:1px solid #20201e;background:#20201e;color:#fff;border-radius:8px;padding:9px 14px;cursor:pointer;font:inherit}.button.secondary{background:transparent;color:#20201e}.count{color:#66645f}.warnings{margin:24px 0;border:1px solid #d9b36c;background:#fff8e8;border-radius:10px;padding:8px 18px}.warnings h2{font-size:16px}.script-segment{margin:36px 0 48px}.script{background:#fff;border:1px solid #deddd8;border-radius:12px;padding:18px 20px;margin-bottom:16px}.script span{font-size:12px;color:#66645f}.script h2{font-size:18px;margin:6px 0}.script p{margin:0;color:#66645f}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}.candidate{background:#fff;border:1px solid #deddd8;border-radius:10px;padding:12px;display:flex;flex-direction:column;min-width:0}.candidate img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px;background:#e8e7e2}.candidate h3{font-size:14px;line-height:1.4;margin:10px 0 4px}.candidate p{margin:2px 0}.meta{font-size:12px;color:#66645f}.license{font-size:12px;color:#7a4a13;margin-top:8px}.links{display:flex;gap:12px;flex-wrap:wrap;margin-top:auto;padding-top:10px;font-size:12px}.links a{color:#185fa5;text-decoration:none}.pick{font-size:13px;font-weight:500;display:block;margin-bottom:8px}.candidate:has(input:checked){outline:2px solid #185fa5;outline-offset:1px}.music audio{width:100%;margin-top:8px}.no-preview{aspect-ratio:16/9;background:#e8e7e2;border-radius:6px;display:grid;place-items:center;color:#777}.empty{color:#66645f;background:#fff;border:1px dashed #c9c8c2;border-radius:8px;padding:18px}.music-section{margin-top:48px}.music-section h2{font-size:20px}footer{margin-top:44px;color:#66645f;font-size:12px}@media(max-width:640px){.wrap{padding:20px 14px 60px}header{display:block}.actions{margin-top:14px}.grid{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<header><div><h1>素材与配乐审阅</h1><p class="sub">${escapeHTML(project.name)} · 先勾选，再下载 selections JSON 交给下一步</p></div><div class="sub">在线素材只作候选，不自动进入成片</div></header>
${warningBlock([...(materials.providers || []), ...(music.warnings || [])])}
<div class="actions"><button class="button" id="download">下载 selections.json</button><span class="count" id="count">已选 0 项</span><span class="sub">第三方素材与音乐请按各自许可使用；商用前复核授权。</span></div>
${sections}
<section class="music-section"><h2>配乐候选</h2><p class="sub">每段可以多选试听，但最终成片只会应用你放进 selections.json 的音乐。</p><div class="grid">${musicCards}</div></section>
<footer>Pexels、Pixabay、Jamendo 内容分别遵循其来源许可。推荐不等于授权结论。</footer></div>
<script>
const materials=${safeJSON(Object.fromEntries(materialIndex))};
const music=${safeJSON(Object.fromEntries(musicIndex))};
const selected=()=>[...document.querySelectorAll('input[type=checkbox]:checked')];
const refresh=()=>{document.getElementById('count').textContent='已选 '+selected().length+' 项'};
document.addEventListener('change',refresh);refresh();
document.getElementById('download').addEventListener('click',()=>{
 const picks=selected();const out={schema_version:1,created_at:new Date().toISOString(),materials:[],music:[]};
 for(const input of picks){if(input.dataset.kind==='material'){const item=materials[input.dataset.segment+'|'+input.value];if(item)out.materials.push(item)}else{const item=music[input.value];if(item)out.music.push(item)}}
 const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='selections.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
});
</script></body></html>`
  const output = artifact(root, 'review.html')
  await import('node:fs/promises').then(({ writeFile }) => writeFile(output, html, 'utf8'))
  await writeJSON(artifact(root, 'review_manifest.json'), { materials: materialIndex.size, music: musicIndex.size, output })
  return { output, materials: materialIndex.size, music: musicIndex.size }
}
