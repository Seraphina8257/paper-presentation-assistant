import test from 'node:test';
import assert from 'node:assert/strict';
import { draftSpeakerNotes, exportSpeakerNotesText } from '../public/speaker-notes.mjs';

test('speaker notes connect confirmed points into a talk track without inventing claims', () => {
  const slide = { title: '研究方法', message: '采用访谈了解使用者体验', bullets: ['采用访谈了解使用者体验', '整理受访者提到的问题', '归纳设计机会'] };
  const text = draftSpeakerNotes(slide, { title: '研究发现' });
  assert.match(text, /^下面说明研究方法。/);
  assert.match(text, /具体来看，整理受访者提到的问题。/);
  assert.match(text, /接下来再看研究发现。$/);
  assert.equal(text.split('采用访谈了解使用者体验').length - 1, 1);
  assert.doesNotMatch(text, /样本量|百分比/);
});

test('export includes every page and manually edited notes', () => {
  const text = exportSpeakerNotesText([
    { title: '研究背景', pages: [2], speakerNotes: '人工修改的讲法。' },
    { title: '研究结果', pages: [5, 6], speakerNotes: '第二页讲稿。' }
  ], '论文.pdf');
  assert.match(text, /论文：论文.pdf/);
  assert.match(text, /第 1 页｜研究背景\n内容依据：PDF 第 2 页\n人工修改的讲法。/);
  assert.match(text, /第 2 页｜研究结果\n内容依据：PDF 第 5、6 页\n第二页讲稿。/);
});
