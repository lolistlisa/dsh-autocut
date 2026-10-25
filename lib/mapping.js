function chars(text) {
  return String(text).replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase()
}

export function alignSegments(segments, words, fallbackDuration) {
  const stream = words.map(word => chars(word.text)).join('')
  const boundaries = [0]
  for (const word of words) boundaries.push(boundaries.at(-1) + chars(word.text).length)
  let cursor = 0
  return segments.map((segment, index) => {
    const content = chars(segment.text)
    let start = stream.indexOf(content, cursor)
    if (start < 0) start = cursor
    const end = start + content.length
    const startWord = words.findIndex((_, i) => boundaries[i + 1] > start)
    let endWord = words.findIndex((_, i) => boundaries[i + 1] >= end)
    if (endWord < 0) endWord = words.length - 1
    cursor = Math.min(stream.length, end)
    const fallbackStart = fallbackDuration * index / segments.length
    const fallbackEnd = fallbackDuration * (index + 1) / segments.length
    return {
      segment_id: segment.id,
      start: words[startWord]?.edited_start ?? fallbackStart,
      end: Math.max(words[endWord]?.edited_end ?? fallbackEnd, words[startWord]?.edited_end ?? fallbackEnd),
      alignment: stream.indexOf(content, start) >= 0 ? 'exact' : 'estimated',
    }
  }).map((item, index, all) => ({ ...item, end: Math.max(item.start + 0.05, item.end, all[index + 1]?.start || 0) }))
}
