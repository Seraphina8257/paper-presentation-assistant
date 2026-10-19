const sectionNames = ['background', 'question', 'method', 'design', 'results', 'conclusion'];
const sectionLabels = ['研究背景', '研究问题', '研究方法', '实验设计', '研究结果', '核心结论'];
export const guideKeys = ['paperInfo', 'relatedWork', 'researchGoal', 'researchRoute', 'researchMethod', 'findings', 'conclusions', 'oneMinute', 'logicChain'];
const guideFromSection = {
  paperInfo: null, relatedWork: 'background', researchGoal: 'question',
  researchRoute: 'design', researchMethod: 'method', findings: 'results',
  conclusions: 'conclusion', oneMinute: null, logicChain: null
};

function fallbackGuide(title, sections) {
  return Object.fromEntries(guideKeys.map(key => {
    if (key === 'paperInfo') return [key, [{ text: `论文标题：${title}`, page: 1, basis: 'source' }]];
    const section = sections[guideFromSection[key]];
    return [key, section?.page ? [{ text: section.text, page: section.page, basis: 'source' }] : []];
  }));
}
const keywords = {
  background: /研究背景|背景|现状|已有研究|近年来|background|introduction|context/i,
  question: /研究问题|研究目的|旨在|目标|问题|research question|aim|objective|purpose/i,
  method: /研究方法|方法|访谈|问卷|观察|案例|实验|method|interview|survey|approach/i,
  design: /实验设计|研究设计|流程|步骤|样本|参与者|participant|procedure|experiment|study design/i,
  results: /研究结果|结果表明|结果|\bresults?\b|\bfindings?\b|\boutcomes?\b/i,
  conclusion: /结论|总结|讨论|启示|意义|conclusion|discussion|implication/i
};

function snippets(pages) {
  return pages.flatMap(({ page, text }) => String(text)
    .replace(/[ \t]+/g, ' ')
    .split(/\n+|(?<=[。！？.!?])\s*|(?=\b(?:Background|Method|Results|Conclusion)\b)/i)
    .map(part => ({ page, text: part.trim() }))
    .filter(part => part.text.length >= 8 && part.text.length <= 360));
}

function pick(parts, key) {
  const relevant = parts.find(part => keywords[key].test(part.text));
  const match = relevant?.text.match(keywords[key]);
  return relevant
    ? { text: relevant.text.slice(match?.index || 0, (match?.index || 0) + 150), page: relevant.page }
    : { text: '原文中未自动定位到明确表述，请在大纲中自行补充。', page: null };
}

function paperType(parts) {
  const text = parts.map(part => part.text).join(' ');
  if (/系统综述|文献综述|范围综述|systematic review|literature review|scoping review/i.test(text)) return 'review';
  if (/原型|设计实践|设计干预|prototype|co-design|design intervention/i.test(text)) return 'practice';
  if (/对照组|实验组|随机分配|实验设计|controlled experiment|randomized|实验/i.test(text)) return 'experiment';
  if (/访谈|田野|观察|质性|interview|ethnograph|qualitative/i.test(text)) return 'qualitative';
  return 'general';
}

const outlinePlans = {
  review: {
    name: '综述类',
    sections: [
      ['background', '综述缘起', 'statement'], ['question', '综述关注的问题', 'statement'],
      ['method', '文献如何筛选', 'steps'], ['results', '文献归纳出的观点', 'split'],
      ['conclusion', '研究空白与启示', 'summary']
    ]
  },
  practice: {
    name: '设计实践类',
    sections: [
      ['background', '设计情境', 'statement'], ['question', '要解决的设计问题', 'statement'],
      ['method', '调研与设计方法', 'steps'], ['design', '设计过程与原型', 'split'],
      ['results', '评估与反馈', 'split'], ['conclusion', '设计启示', 'summary']
    ]
  },
  experiment: {
    name: '实验类',
    sections: [
      ['background', '研究缘起', 'statement'], ['question', '研究问题或假设', 'statement'],
      ['design', '实验如何安排', 'split'], ['method', '测量与分析方法', 'steps'],
      ['results', '实验发现', 'split'], ['conclusion', '结论与讨论', 'summary']
    ]
  },
  qualitative: {
    name: '质性研究类',
    sections: [
      ['background', '研究情境', 'statement'], ['question', '研究关注的问题', 'statement'],
      ['method', '访谈与观察方法', 'steps'], ['design', '样本与研究流程', 'split'],
      ['results', '主要发现', 'split'], ['conclusion', '讨论与启示', 'summary']
    ]
  },
  general: {
    name: '一般研究类',
    sections: [
      ['background', '研究背景', 'statement'], ['question', '研究问题', 'statement'],
      ['method', '研究方法', 'steps'], ['design', '研究过程', 'split'],
      ['results', '主要结果', 'split'], ['conclusion', '结论与讨论', 'summary']
    ]
  }
};

function adaptiveOutline(title, sections, firstText, type) {
  const plan = outlinePlans[type];
  const available = key => sections[key].page !== null;
  const leadKey = available('question') ? 'question' : available('background') ? 'background' :
    plan.sections.find(([key]) => available(key))?.[0];
  const lead = leadKey ? sections[leadKey] : { text: firstText.slice(0, 150), page: 1 };
  const slides = [{
    title, message: lead.text || '请根据原文填写汇报重点。',
    bullets: [], pages: lead.page ? [lead.page] : [], layout: 'cover'
  }];
  const included = [];
  for (const [key, pageTitle, layout] of plan.sections) {
    if (!available(key) || key === leadKey) continue;
    // 同一句话被多个关键词命中时，只安排一页，避免重复汇报。
    if (slides.some(slide => slide.message === sections[key].text)) continue;
    slides.push({ title: pageTitle, message: sections[key].text, bullets: [], pages: [sections[key].page], layout });
    included.push(pageTitle);
  }
  return {
    slides: slides.map((slide, index) => ({ id: `slide-${index + 1}`, ...slide })),
    outlineRationale: `演示模式：暂按${included.length ? included.join('、') : plan.name}安排页面。请对照原文检查顺序和重点。`
  };
}

export function buildFallbackAnalysis(pages) {
  const parts = snippets(pages);
  const sections = Object.fromEntries(sectionNames.map(key => [key, pick(parts, key)]));
  const first = pages.find(page => page.text.trim())?.text || '';
  const title = first.split(/\n/).map(line => line.trim().split(/[。！？]/)[0]).find(line => line.length > 8 && line.length < 100) || '待确认的论文标题';
  const type = paperType(parts);
  const outline = adaptiveOutline(title.slice(0, 80), sections, first, type);
  return {
    title: title.slice(0, 80), sections, guide: fallbackGuide(title.slice(0, 80), sections), mode: 'rules',
    outlineRationale: outline.outlineRationale, slides: outline.slides
  };
}

export function makeModelInput(pages) {
  const text = pages.map(page => `【PDF 第 ${page.page} 页】\n${String(page.text).slice(0, 7000)}`).join('\n\n');
  const notice = text.length > 80000 ? '注意：由于长度限制，以下只包含论文前一部分文字；不要把未提供的章节当成论文没有，也不要推测其结果。\n\n' : '';
  return `请仅依据以下论文内容生成理解卡片和汇报大纲。页码必须来自对应内容所在的 PDF 页面，不确定时写 null。\n\n${notice}${text.slice(0, 80000)}`;
}

export function validateAnalysis(value, pageCount) {
  if (!value || typeof value.title !== 'string' || !value.sections || !Array.isArray(value.slides)) {
    throw new Error('模型输出结构不完整。');
  }
  const sections = {};
  for (const key of sectionNames) {
    const input = value.sections[key] || {};
    sections[key] = {
      text: String(input.text || '原文未明确说明').slice(0, 500),
      page: Number.isInteger(input.page) && input.page >= 1 && input.page <= pageCount ? input.page : null
    };
  }
  const slides = value.slides.slice(0, 10).map((slide, index) => ({
    id: `slide-${index + 1}`,
    title: String(slide.title || `第 ${index + 1} 页`).slice(0, 80),
    message: String(slide.message || '').slice(0, 500),
    bullets: Array.isArray(slide.bullets) ? slide.bullets.slice(0, 5).map(item => String(item).slice(0, 160)) : [],
    pages: Array.isArray(slide.pages) ? [...new Set(slide.pages.filter(page => Number.isInteger(page) && page >= 1 && page <= pageCount))] : [],
    layout: ['cover', 'statement', 'split', 'steps', 'summary'].includes(slide.layout) ? slide.layout : 'statement'
  }));
  if (!slides.length) throw new Error('模型没有生成汇报大纲。');
  const guide = Object.fromEntries(guideKeys.map(key => [key,
    (Array.isArray(value.guide?.[key]) ? value.guide[key] : []).slice(0, 5).map(item => ({
      text: String(item?.text || '').slice(0, 240),
      page: Number.isInteger(item?.page) && item.page >= 1 && item.page <= pageCount ? item.page : null,
      basis: ['source', 'inference', 'unknown'].includes(item?.basis) ? item.basis : 'unknown'
    })).filter(item => item.text)
  ]));
  return {
    title: value.title.slice(0, 120), sections, guide, slides,
    outlineRationale: String(value.outlineRationale || '请按论文重点检查并调整这份大纲。').slice(0, 350)
  };
}

export { sectionLabels };
