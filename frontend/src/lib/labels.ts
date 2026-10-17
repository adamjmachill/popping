// Display labels for source and category names.
//
// Source names are stored as slugs (``bank_of_canada``, ``r_fantasyfootball``)
// because the backend uses them as identifiers; these helpers turn them
// into what a reader expects to see ("Bank of Canada",
// "r/fantasyfootball"). Display only: anything sent back to the API
// keeps using the raw name.

// Built-in sources whose slug doesn't read well when title-cased.
const KNOWN_SOURCES: Record<string, string> = {
  hn_top: 'Hacker News',
  bbc_news: 'BBC News',
  nvd_recent: 'NVD',
  cisa_kev: 'CISA KEV',
  rfd_hot_deals: 'RedFlagDeals',
  wikipedia_on_this_day: 'Wikipedia: On This Day',
  github_releases: 'GitHub Releases',
}

// Words shown in capitals rather than title case.
const ACRONYMS = new Set([
  'ai', 'erp', 'cpa', 'cpabc', 'bc', 'cbc', 'bnn', 'cfo', 'cfos', 'eia', 'opec',
  'pbo', 'icd', 'hbr', 'ey', 'kpmg', 'pwc', 'bdc', 'icsg', 'ccpa', 'cra', 'us',
  'uk', 'tsx', 'ceo', 'gdp', 'cpi', 'rss', 'nfl', 'qbo', 'cd',
])

// Words kept lower case unless they start the label.
const MINOR = new Set(['of', 'and', 'the', 'on', 'in', 'for', 'to', 'a', 'an', 'at', 'by'])

const TLDS = new Set(['com', 'ca', 'org', 'net', 'io'])

function titleWord(word: string, index: number): string {
  const lower = word.toLowerCase()
  if (ACRONYMS.has(lower)) return lower.toUpperCase()
  if (index > 0 && MINOR.has(lower)) return lower
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

/** "bank_of_canada" -> "Bank of Canada", "r_canadianinvestor" ->
 *  "r/canadianinvestor", "mining_com" -> "Mining.com",
 *  "anthropic_yt" -> "Anthropic (YouTube)". Names that already look
 *  human (contain spaces or capitals) are returned unchanged. */
export function sourceLabel(name: string | null | undefined): string {
  if (!name) return ''
  if (KNOWN_SOURCES[name]) return KNOWN_SOURCES[name]
  if (/[A-Z ]/.test(name)) return name
  if (name.startsWith('r_') && name.length > 2) return `r/${name.slice(2)}`
  let words = name.split(/[_-]+/).filter(Boolean)
  let suffix = ''
  if (words.length > 1 && words[words.length - 1] === 'yt') {
    words = words.slice(0, -1)
    suffix = ' (YouTube)'
  }
  if (words.length > 1 && TLDS.has(words[words.length - 1])) {
    const tld = words[words.length - 1]
    words = words.slice(0, -1)
    return words.map(titleWord).join(' ') + `.${tld}` + suffix
  }
  return words.map(titleWord).join(' ') + suffix
}

/** "ai" -> "AI", "erp" -> "ERP", "commodities" -> "Commodities".
 *  Labels with capitals already ("For You") are returned unchanged. */
export function categoryLabel(name: string | null | undefined): string {
  if (!name) return ''
  if (/[A-Z]/.test(name)) return name
  return name.split(/[_\s-]+/).filter(Boolean).map(titleWord).join(' ')
}
