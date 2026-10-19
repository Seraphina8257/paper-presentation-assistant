import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFallbackAnalysis, makeModelInput, validateAnalysis } from '../src/analysis.mjs';

test('规则模式保留来源页码，缺失内容不编造', () => {
  const result = buildFallbackAnalysis([
    { page: 1, text: 'A sample paper\n研究背景：新生需要找到校园服务中心。' },
    { page: 2, text: '研究方法：访谈使用者并记录路线。' }
  ]);
  assert.equal(result.sections.background.page, 1);
  assert.equal(result.sections.method.page, 2);
  assert.equal(result.sections.results.page, null);
  assert.match(result.sections.results.text, /未自动定位/);
  assert.equal(result.slides.length, 2);
  assert.ok(result.slides.every(slide => !/结果/.test(slide.title)));
});

test('模型输出只接受 PDF 范围内的页码', () => {
  const section = { text: '内容', page: 99 };
  const output = validateAnalysis({
    title: '论文',
    sections: Object.fromEntries(['background', 'question', 'method', 'design', 'results', 'conclusion'].map(key => [key, section])),
    slides: [{ title: '主题', message: '要点', bullets: [], pages: [1, 99], layout: 'cover' }]
  }, 2);
  assert.equal(output.sections.background.page, null);
  assert.deepEqual(output.slides[0].pages, [1]);
});

test('理解框架区分原文事实、解释和缺失信息，并过滤无效页码', () => {
  const result = validateAnalysis({
    title: '论文',
    sections: Object.fromEntries(['background', 'question', 'method', 'design', 'results', 'conclusion']
      .map(key => [key, { text: '原文未明确说明', page: null }])),
    guide: { findings: [
      { text: '访谈了 12 人', page: 2, basis: 'source' },
      { text: '基于原文分析：样本范围可能限制适用性', page: 99, basis: 'inference' },
      { text: '原文未明确说明', page: null, basis: 'unknown' }
    ] },
    slides: [{ title: '主题', message: '要点', bullets: [], pages: [1], layout: 'cover' }]
  }, 3);
  assert.deepEqual(result.guide.findings.map(item => item.basis), ['source', 'inference', 'unknown']);
  assert.deepEqual(result.guide.findings.map(item => item.page), [2, null, null]);
  assert.deepEqual(result.guide.logicChain, []);
});

test('模型输入显式标明 PDF 顺序页码', () => {
  assert.match(makeModelInput([{ page: 3, text: 'Method text.' }]), /PDF 第 3 页/);
});

test('Wayfinding 标题不会被错认成研究结果', () => {
  const result = buildFallbackAnalysis([{ page: 1, text: 'Campus Wayfinding\nResults: No actual findings are reported in this sample.' }]);
  assert.match(result.sections.results.text, /^Results:/);
});

test('背景中提到数据不会提前占用结果卡片', () => {
  const result = buildFallbackAnalysis([
    { page: 1, text: '背景：此处没有真实调研数据。' },
    { page: 2, text: '研究结果：论文给出三个发现。' }
  ]);
  assert.equal(result.sections.results.page, 2);
});

test('不同论文会生成不同页数和侧重点', () => {
  const qualitative = buildFallbackAnalysis([
    { page: 1, text: '公共空间使用体验研究\n背景：首次到访者不熟悉服务区。研究问题：他们如何寻找服务点？' },
    { page: 2, text: '研究方法：通过访谈和现场观察记录寻找过程。' },
    { page: 3, text: '研究结果：受访者依赖入口处的标识。结论：入口信息需要更清晰。' }
  ]);
  const experimental = buildFallbackAnalysis([
    { page: 1, text: '导视标识对路径选择的影响\n研究问题：不同标识是否影响路径选择？' },
    { page: 2, text: '实验设计：设置两种标识条件并记录完成时间。' },
    { page: 3, text: '实验结果：两组完成时间不同。结论：标识形式影响路径选择。' }
  ]);
  assert.notDeepEqual(qualitative.slides.map(slide => slide.title), experimental.slides.map(slide => slide.title));
  assert.notEqual(qualitative.slides.length, experimental.slides.length);
  assert.match(qualitative.outlineRationale, /访谈与观察方法/);
  assert.match(experimental.outlineRationale, /实验如何安排/);
});
