import test from 'node:test';
import assert from 'node:assert/strict';
import { assignVisuals, visualStats } from '../public/visual-plan.mjs';
import { validateAnalysis } from '../src/analysis.mjs';

test('多份图表自动增加页面且每份恰好出现一次', () => {
  const visuals = Array.from({ length: 5 }, (_, index) => ({ id: `pdf-2-${index + 1}`, page: 2, title: `图 ${index + 1}`, status: 'ok' }));
  const slides = [{ id: 'one', title: '研究方法', message: '第 2 页方法', bullets: [], pages: [2], visuals: [] }];
  assignVisuals(slides, visuals);
  const inserted = slides.flatMap(slide => slide.visuals);
  assert.equal(slides.length, 3);
  assert.equal(new Set(inserted).size, 5);
  assert.deepEqual(visualStats(slides, visuals), { extracted: 5, inserted: 5, failed: 0, removed: 0, unassigned: 0 });
});

test('大纲中的伪造图表 ID 被清除，手动移除的不重新插入', () => {
  const visuals = [{ id: 'pdf-3-1', page: 3, title: '表 1', status: 'ok' }];
  const slides = [{ id: 'one', title: '结果', message: '', bullets: [], pages: [3], visuals: ['fake-id'] }];
  assignVisuals(slides, visuals, ['pdf-3-1']);
  assert.deepEqual(slides[0].visuals, []);
  assert.equal(visualStats(slides, visuals, [], ['pdf-3-1']).removed, 1);
});

test('模型引用不存在的图表 ID 不进入大纲', () => {
  const data = { title: '论文', outlineRationale: '', sections: {}, guide: {}, slides: [
    { title: '方法', message: '方法', bullets: [], pages: [2], layout: 'visuals', visualIds: ['fake', 'pdf-2-1'] }
  ] };
  assert.deepEqual(validateAnalysis(data, 3, ['pdf-2-1']).slides[0].visualIds, ['pdf-2-1']);
});

test('重复引用同一图表时只保留一次展示', () => {
  const visuals = [{ id: 'pdf-1-1', page: 1, title: '图 1', status: 'ok' }];
  const slides = [
    { id: 'a', title: '背景', message: '', bullets: [], pages: [1], visuals: ['pdf-1-1'] },
    { id: 'b', title: '方法', message: '', bullets: [], pages: [1], visuals: ['pdf-1-1'] }
  ];
  assignVisuals(slides, visuals);
  assert.deepEqual(slides.map(slide => slide.visuals), [['pdf-1-1'], []]);
});
