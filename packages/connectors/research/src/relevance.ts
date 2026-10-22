/** A lexical bridge is evidence of a shared topic, not a semantic relevance score. */
export interface RelevanceMatch {
  externalId: string;
  basis: 'provider_rank' | 'title_latin' | 'title_cjk' | 'title_topic' | 'abstract_topic';
  terms: string[];
}

export interface QueryRewrite {
  strategy: 'bilingual_topics_v1';
  originalQuery: string;
  effectiveQuery: string;
  mappings: {source: string; target: string}[];
}

const CJK_CHAR = /[\u3400-\u9fff]/;
const LATIN_TERM = /[a-z][a-z0-9+#.]*/g;
const LATIN_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'for', 'with', 'on', 'in', 'to', 'is', 'are', 'be',
  'by', 'as', 'at', 'vs', 'via', 'using', 'based', 'new', 'how',
]);
// Search instructions and broad quality/method words cannot establish the subject of a paper.
const CJK_STOPWORDS = new Set([
  '搜索', '检索', '搜一下', '查一下', '研究', '一下', '论文', '文献', '资料', '综述', '方法',
  '优化', '调优', '性能', '提升', '分析', '设计', '系统', '技术', '应用', '实现', '问题',
  '相关', '最新', '主要', '特性', '要点', '来源', '介绍', '如何', '怎么', '基于', '通过',
]);

// Deliberately bounded, auditable topic aliases. No product/language name implies one of these
// topics: C++ alone must never imply allocator. Unsupported translations remain unconfirmed.
const TOPIC_ALIASES: readonly {zh: readonly string[]; en: readonly string[]}[] = [
  {zh: ['内存分配器', '内存分配', '动态内存分配'], en: ['memory allocator', 'memory allocators', 'memory allocation', 'heap allocation', 'heap allocator', 'heap allocators', 'malloc', 'jemalloc', 'tcmalloc', 'mimalloc']},
  {zh: ['内存池', '对象池'], en: ['memory pool', 'memory pools', 'object pool', 'object pools', 'pool allocator', 'pool allocators', 'pooled allocation']},
  {zh: ['内存碎片'], en: ['memory fragmentation', 'heap fragmentation']},
  {zh: ['垃圾回收'], en: ['garbage collection', 'garbage collector', 'garbage collectors']},
  {zh: ['知识图谱'], en: ['knowledge graph', 'knowledge graphs']},
  {zh: ['大型语言模型', '大语言模型'], en: ['large language model', 'large language models', 'llm', 'llms']},
  {zh: ['检索增强生成'], en: ['retrieval augmented generation', 'retrieval-augmented generation']},
  {zh: ['图神经网络'], en: ['graph neural network', 'graph neural networks']},
];

/** Rewrite only fully understood Chinese spans; preserve Latin tokens and unknown constraints. */
export function sourceQuery(query: string): {query: string; rewrite?: QueryRewrite} {
  if (!hasCjk(query)) return {query};
  let translated = query;
  const mappings: QueryRewrite['mappings'] = [];
  const aliases = TOPIC_ALIASES.flatMap(topic => topic.zh.map(source => ({source,
    target: source === '动态内存分配' ? 'dynamic memory allocation'
      : source === '对象池' ? 'object pool' : topic.en[0]!}))).sort((a, b) => b.source.length - a.source.length);
  for (const mapping of aliases) {
    if (!translated.includes(mapping.source)) continue;
    translated = translated.split(mapping.source).join(` ${mapping.target} `);
    mappings.push(mapping);
  }
  if (mappings.length === 0) return {query};
  for (const word of ['优化', '调优']) translated = translated.split(word).join(' optimization ');
  for (const word of [...CJK_STOPWORDS].sort((a, b) => b.length - a.length)) translated = translated.split(word).join(' ');
  translated = translated.replace(/[的与和及]/g, ' ');
  // Unsupported subject, negation, date, or condition stays on the original source query.
  if (hasCjk(translated)) return {query};
  translated = translated.replace(/\s+/g, ' ').trim();
  return {query: translated, rewrite: {strategy: 'bilingual_topics_v1', originalQuery: query,
    effectiveQuery: translated, mappings}};
}

export function hasCjk(text: string): boolean {
  return CJK_CHAR.test(text);
}

function latinQueryTerms(query: string): string[] {
  const terms: string[] = [];
  for (const match of query.toLowerCase().matchAll(LATIN_TERM)) {
    const term = match[0]?.replace(/[.]+$/, '');
    if (term !== undefined && term.length >= 2 && !LATIN_STOPWORDS.has(term)) terms.push(term);
  }
  return [...new Set(terms)];
}

function containsLatinTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // #447: +/# stay inside a token; C++11/C#12 do not match an unversioned token.
  return new RegExp(`(^|[^a-z0-9+#])${escaped}($|[^a-z0-9+#])`).test(text.toLowerCase());
}

function significantBigrams(text: string): Set<string> {
  // Replace whole stop phrases with separators before forming adjacent pairs. This also
  // avoids retaining "优化的" via overlapping pairs such as 化的/的论.
  let subject = text;
  for (const word of [...CJK_STOPWORDS].sort((a, b) => b.length - a.length)) subject = subject.split(word).join(' ');
  const chars = Array.from(subject);
  const pairs = new Set<string>();
  for (let i = 0; i + 1 < chars.length; i++) {
    const a = chars[i];
    const b = chars[i + 1];
    if (a !== undefined && b !== undefined && CJK_CHAR.test(a) && CJK_CHAR.test(b)) pairs.add(a + b);
  }
  return pairs;
}

/** Read only bounded inverted-index positions. Malformed/oversized abstracts provide no bridge. */
export function readAbstract(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > 4096) return undefined;
  const words = new Map<number, string>();
  let characters = 0;
  for (const [word, positions] of entries) {
    if (word.length > 4096 || !Array.isArray(positions) || positions.length > 4096) return undefined;
    characters += (word.length + 1) * positions.length;
    if (characters > 32_768) return undefined;
    for (const position of positions) {
      if (!Number.isSafeInteger(position) || position < 0 || position >= 4096 || words.has(position)) return undefined;
      words.set(position, word);
    }
  }
  if (words.size === 0) return undefined;
  // Gaps are separators, not permission to invent adjacent words/phrases.
  let result = '';
  let previous = -2;
  for (const [position, word] of [...words].sort(([a], [b]) => a - b)) {
    result += position === previous + 1 ? ` ${word}` : `\n${word}`;
    previous = position;
  }
  return result;
}

export function matchQuery(query: string, title: string, abstract?: string): Omit<RelevanceMatch, 'externalId'> | undefined {
  if (!hasCjk(query)) return {basis: 'provider_rank', terms: []};
  const topics = TOPIC_ALIASES.filter(topic => topic.zh.some(phrase => query.includes(phrase)));
  for (const [field, text] of [['title_topic', title], ['abstract_topic', abstract]] as const) {
    if (text === undefined) continue;
    for (const topic of topics) {
      const terms = [...topic.en.filter(term => containsLatinTerm(text, term)), ...topic.zh.filter(term => text.includes(term))];
      if (terms.length > 0) return {basis: field, terms};
    }
  }
  // An explicit subject outranks a broad programming-language token or an overlapping suffix.
  // "C++ 内存池" must not retain an unrelated C++ paper or a generic resource 分配器 paper.
  if (topics.length > 0) return undefined;
  const latin = latinQueryTerms(query).filter(term => containsLatinTerm(title, term));
  if (latin.length > 0) return {basis: 'title_latin', terms: latin};
  const queryPairs = significantBigrams(query);
  const titlePairs = significantBigrams(title);
  const shared = [...queryPairs].filter(pair => titlePairs.has(pair));
  if (shared.length >= (queryPairs.size >= 2 ? 2 : 1)) return {basis: 'title_cjk', terms: shared};
  return undefined;
}
