function tidy(value) {
  return String(value || '').trim().replace(/[。！？；;，,\s]+$/u, '');
}

function uniquePoints(slide) {
  const raw = [slide.message, ...(slide.bullets || [])].map(tidy).filter(Boolean);
  return raw.filter((point, index) => !raw.some((other, otherIndex) => otherIndex < index && (other === point || other.includes(point))));
}

export function draftSpeakerNotes(slide, nextSlide) {
  const title = tidy(slide.title) || '本页内容';
  const [main, ...details] = uniquePoints(slide);
  if (!main) return `下面说明${title}。请先在大纲中补充这一页的内容，再完善讲稿。`;

  const parts = [`下面说明${title}。${main}。`];
  const connectors = ['具体来看', '同时', '另外', '最后'];
  details.forEach((detail, index) => {
    const connector = connectors[Math.min(index, connectors.length - 1)];
    parts.push(`${connector}，${detail}。`);
  });
  if (nextSlide?.title) parts.push(`接下来再看${tidy(nextSlide.title)}。`);
  return parts.join('\n\n');
}

export function exportSpeakerNotesText(slides, fileName = '') {
  const lines = ['文献汇报演讲稿'];
  if (fileName) lines.push(`论文：${fileName}`);
  slides.forEach((slide, index) => {
    lines.push('', `第 ${index + 1} 页｜${slide.title || '未命名页面'}`);
    if (slide.pages?.length) lines.push(`内容依据：PDF 第 ${slide.pages.join('、')} 页`);
    lines.push(slide.speakerNotes || '（暂无讲稿）');
  });
  return `${lines.join('\n')}\n`;
}
