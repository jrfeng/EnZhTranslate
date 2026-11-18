/**
 * 把剪贴板里的 HTML 片段转成 Markdown。
 *
 * 只覆盖常见排版：标题、段落、换行、加粗/斜体/删除线、行内代码、代码块、
 * 链接、图片、有序/无序列表（可嵌套）、引用、分隔线、表格。
 * 目标是「粘贴后翻译」能读到结构，而不是做完整的 HTML→Markdown 实现。
 */

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'HEAD', 'META', 'LINK', 'TITLE', 'NOSCRIPT'])

function escapeInline(text) {
  return text.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1')
}

function normalizeWhitespace(text) {
  return text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ')
}

function inlineChildren(node) {
  let out = ''
  node.childNodes.forEach((child) => {
    out += inlineNode(child)
  })
  return out
}

function inlineNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return escapeInline(normalizeWhitespace(node.nodeValue ?? ''))
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const tag = node.tagName.toUpperCase()
  if (SKIP_TAGS.has(tag)) return ''
  if (tag === 'BR') return '  \n'

  const inner = inlineChildren(node)

  switch (tag) {
    case 'STRONG':
    case 'B':
      return inner.trim().length > 0 ? '**' + inner.trim() + '**' : inner
    case 'EM':
    case 'I':
      return inner.trim().length > 0 ? '*' + inner.trim() + '*' : inner
    case 'DEL':
    case 'S':
    case 'STRIKE':
      return inner.trim().length > 0 ? '~~' + inner.trim() + '~~' : inner
    case 'CODE':
      return inner.trim().length > 0 ? '`' + inner.trim() + '`' : inner
    case 'MARK':
    case 'U':
    case 'SPAN':
    case 'FONT':
    case 'SUB':
    case 'SUP':
      return inner
    case 'A': {
      const href = node.getAttribute('href') ?? ''
      const label = inner.trim()
      if (!/^(https?:|mailto:)/i.test(href) || label.length === 0) return label
      return '[' + label + '](' + href.trim() + ')'
    }
    case 'IMG': {
      const alt = node.getAttribute('alt') ?? ''
      const src = node.getAttribute('src') ?? ''
      if (!/^(https?:|data:)/i.test(src)) return ''
      return '![' + alt.replace(/[[\]]/g, '') + '](' + src.trim() + ')'
    }
    default:
      return inner
  }
}

function listToMarkdown(node, depth) {
  const ordered = node.tagName.toUpperCase() === 'OL'
  const lines = []
  let index = 1

  node.childNodes.forEach((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE || child.tagName.toUpperCase() !== 'LI') return
    const marker = ordered ? index++ + '. ' : '- '
    const indent = '  '.repeat(depth)
    const parts = []
    let nested = ''

    child.childNodes.forEach((part) => {
      if (part.nodeType === Node.ELEMENT_NODE) {
        const tag = part.tagName.toUpperCase()
        if (tag === 'UL' || tag === 'OL') {
          nested += listToMarkdown(part, depth + 1)
          return
        }
        if (tag === 'P' || tag === 'DIV') {
          parts.push(inlineChildren(part).trim())
          return
        }
      }
      parts.push(inlineNode(part))
    })

    const body = parts.join('').trim()
    lines.push(indent + marker + body)
    if (nested.length > 0) lines.push(nested.replace(/\n$/, ''))
  })

  return lines.join('\n') + '\n'
}

function tableToMarkdown(node) {
  const rows = Array.from(node.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.querySelectorAll('th,td')).map((cell) => inlineChildren(cell).trim().replace(/\|/g, '\\|')),
  )
  if (rows.length === 0) return ''

  const width = Math.max(...rows.map((row) => row.length))
  const pad = (row) => {
    const cells = row.slice()
    while (cells.length < width) cells.push('')
    return '| ' + cells.join(' | ') + ' |'
  }

  const out = [pad(rows[0]), '| ' + new Array(width).fill('---').join(' | ') + ' |']
  rows.slice(1).forEach((row) => out.push(pad(row)))
  return out.join('\n') + '\n\n'
}

function blockToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = normalizeWhitespace(node.nodeValue ?? '').trim()
    return text.length > 0 ? text + '\n\n' : ''
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const tag = node.tagName.toUpperCase()
  if (SKIP_TAGS.has(tag)) return ''

  if (/^H[1-6]$/.test(tag)) {
    const level = Number(tag.slice(1))
    const text = inlineChildren(node).trim()
    return text.length > 0 ? '#'.repeat(level) + ' ' + text + '\n\n' : ''
  }

  switch (tag) {
    case 'P': {
      const text = inlineChildren(node).trim()
      return text.length > 0 ? text + '\n\n' : ''
    }
    case 'HR':
      return '---\n\n'
    case 'BR':
      return '\n'
    case 'PRE': {
      const code = node.textContent ?? ''
      const langMatch = /^language-([\w-]+)/.exec(node.querySelector('code')?.className ?? '')
      const lang = langMatch === null ? '' : langMatch[1]
      return '```' + lang + '\n' + code.replace(/\n+$/, '') + '\n```\n\n'
    }
    case 'UL':
    case 'OL':
      return listToMarkdown(node, 0) + '\n'
    case 'BLOCKQUOTE': {
      const inner = childrenToMarkdown(node).trim()
      if (inner.length === 0) return ''
      return (
        inner
          .split('\n')
          .map((line) => (line.length > 0 ? '> ' + line : '>'))
          .join('\n') + '\n\n'
      )
    }
    case 'TABLE':
      return tableToMarkdown(node)
    case 'IMG':
      return inlineNode(node) + '\n\n'
    case 'DIV':
    case 'SECTION':
    case 'ARTICLE':
    case 'BODY':
    case 'HTML':
      return childrenToMarkdown(node)
    default: {
      const text = inlineChildren(node).trim()
      return text.length > 0 ? text + '\n\n' : ''
    }
  }
}

function childrenToMarkdown(node) {
  let out = ''
  node.childNodes.forEach((child) => {
    out += blockToMarkdown(child)
  })
  return out
}

/**
 * HTML → Markdown。解析失败或没有内容时返回空字符串，调用方可以退回纯文本。
 */
export function htmlToMarkdown(html) {
  if (typeof html !== 'string' || html.trim().length === 0) return ''

  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (doc === null || doc.body === null) return ''

  const markdown = childrenToMarkdown(doc.body)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return markdown
}
