export class DeepSeekClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY
    this.baseURL = (options.baseURL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
    this.model = options.model || process.env.DEEPSEEK_MODEL || 'deepseek-chat'
    this.fetch = options.fetch || globalThis.fetch
  }

  async json(system, user, { signal, maxTokens = 12000 } = {}) {
    if (!this.apiKey) throw new Error('缺少 DEEPSEEK_API_KEY；插件不会读取或复制 DSH 的私有模型凭据')
    const response = await this.fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: maxTokens,
        stream: false,
      }),
    })
    if (!response.ok) throw new Error(`DeepSeek API ${response.status}: ${(await response.text()).slice(0, 1000)}`)
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('DeepSeek 返回空内容')
    return JSON.parse(content)
  }

  analyzeScript(text, style) {
    const system = `你是中长视频剪辑语义分析器。绝对不改写、润色、纠正或遗漏用户文案。把文案按连续原文切成句段，所有 segment.text 按顺序拼接必须覆盖全部原文（空白可以保留在相邻段）。输出 JSON，不要 Markdown。结构：{"segments":[{"text":"原文精确切片","chapter":"章节","intent":"hook|explain|evidence|turn|punchline|conclusion","emotion":"情绪","visual_queries":["具体可检索画面"],"emphasis":["重点词"],"music":"配乐情绪","sfx":["可选音效事件"]}]}。visual_queries 要包含实体、动作、场景、年代和景别；不要虚构文案中不存在的事实。风格参数：${JSON.stringify(style)}`
    return this.json(system, text)
  }

  async rankAssets(segments, candidates, { signal } = {}) {
    const system = `你是素材检索重排器。只从给定 candidate id 中选择，不得编造素材。输出 JSON：{"matches":[{"segment_id":"...","selected":["candidate id"],"reason":"简短理由"}]}。优先语义、时空与实体一致，其次画面质量和时长；存疑时返回空数组。`
    return this.json(system, JSON.stringify({ segments, candidates }), { signal, maxTokens: 8000 })
  }

  async planResearch(segments, { signal } = {}) {
    const system = `你是视频剪辑调研助手。根据逐段文案生成简洁的素材检索查询和配乐检索查询，不改写文案。输出 JSON：{"materials":[{"segment_id":"...","queries":["英文检索词1","英文检索词2"]}],"music":[{"query":"英文曲风检索词","mood":"中文情绪说明","start_segment":"...","end_segment":"..."}]}。素材查询优先具体人物、动作、地点、年代、物件和景别；避免只写抽象情绪。配乐按叙事段落划分，每段一首候选方向，优先 instrumental，不要建议具体受版权保护的商业歌曲名。`
    return this.json(system, JSON.stringify(segments), { signal, maxTokens: 6000 })
  }

  async rankMusic(candidates, sections, { signal } = {}) {
    const system = `你是配乐导演。只从候选 id 中挑选，不得编造。输出 JSON：{"sections":[{"start_segment":"...","end_segment":"...","picks":["候选id"],"reason":"简短理由"}]}。优先情绪、节奏和段落功能匹配，注意授权字段，商业平台使用不得把 NonCommercial 曲目列为无条件推荐。`
    return this.json(system, JSON.stringify({ candidates, sections }), { signal, maxTokens: 6000 })
  }

  async planSound(segments, musicCatalog, sfxCatalog, { signal } = {}) {
    const system = `你是声音导演。为原创文案视频设计克制、快慢交替的音乐与音效。只使用目录中已有 id，生成音乐则写 generation_prompt。输出 JSON：{"music":[{"id":"目录id或空","start_segment":"...","end_segment":"...","prompt":"...","gain_db":-16}],"sfx":[{"segment_id":"...","asset_id":"目录id或空","event":"...","offset":0,"gain_db":-12}],"vfx":[{"segment_id":"...","type":"punch_in|freeze|caption","target":"重点词","strength":0.08}]}。避免每个句段都加音效。`
    return this.json(system, JSON.stringify({ segments, musicCatalog, sfxCatalog }), { signal, maxTokens: 8000 })
  }
}
