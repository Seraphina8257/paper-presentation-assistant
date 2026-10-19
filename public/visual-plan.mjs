function words(value) {
  return String(value || '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
}

function matchScore(visual, slide) {
  const pageDistance = slide.pages?.length ? Math.min(...slide.pages.map(page => Math.abs(page - visual.page))) : Infinity;
  const pageScore = pageDistance === 0 ? 30 : pageDistance === 1 ? 10 : pageDistance === 2 ? 3 : 0;
  const slideText = `${slide.title} ${slide.message} ${(slide.bullets || []).join(' ')}`.toLowerCase();
  const terms = [...new Set(words(visual.title).filter(term => !/^(figure|table|image|pdf|图表)$/.test(term)))];
  const titleScore = terms.reduce((score, term) => score + (slideText.includes(term) ? 4 : 0), 0);
  return pageScore + Math.min(titleScore, 20);
}

export function assignVisuals(slides, visuals, excludedIds = []) {
  const valid = new Set(visuals.filter(visual => visual.status === 'ok').map(visual => visual.id));
  const excluded = new Set(excludedIds);
  const alreadyPlaced = new Set();
  for (const slide of slides) {
    const capacity = (slide.bullets || []).length > 1 ? 1 : 2;
    slide.visuals = [...new Set((slide.visuals || []).filter(id => valid.has(id) && !excluded.has(id) && !alreadyPlaced.has(id)))].slice(0, capacity);
    slide.visuals.forEach(id => alreadyPlaced.add(id));
  }
  const placed = new Set(slides.flatMap(slide => slide.visuals));
  for (const visual of visuals) {
    if (visual.status !== 'ok' || excluded.has(visual.id) || placed.has(visual.id)) continue;
    const ranked = slides.map(slide => ({ slide, score: matchScore(visual, slide) }))
      .filter(item => !item.slide.generatedVisualPage || item.slide.pages.includes(visual.page))
      .sort((a, b) => b.score - a.score);
    const target = ranked.find(item => item.score > 0 && item.slide.visuals.length < ((item.slide.bullets || []).length > 1 ? 1 : 2))?.slide;
    if (target) target.visuals.push(visual.id);
    else {
      const related = ranked[0]?.score > 0 ? ranked[0].slide : null;
      slides.push({
        id: `visual-page-${visual.id}`, title: related ? `${related.title} · 图表` : '论文图表补充',
        message: related ? `补充展示与“${related.title}”相关的论文图表。` : '以下图表来自论文原文，请结合正文讲解。',
        bullets: [], pages: [visual.page], layout: 'visuals', visuals: [visual.id], image: null,
        generatedVisualPage: true, speakerNotes: '', notesEdited: false, notesSource: ''
      });
    }
    placed.add(visual.id);
  }
  return slides;
}

export function visualStats(slides, visuals, failures = [], excludedIds = []) {
  const shown = new Set(slides.flatMap(slide => slide.visuals || []));
  const excluded = new Set(excludedIds);
  return {
    extracted: visuals.length,
    inserted: visuals.filter(visual => shown.has(visual.id)).length,
    failed: failures.length,
    removed: visuals.filter(visual => excluded.has(visual.id)).length,
    unassigned: visuals.filter(visual => !shown.has(visual.id) && !excluded.has(visual.id)).length
  };
}
