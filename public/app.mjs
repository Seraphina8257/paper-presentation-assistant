import * as pdfjs from './vendor/pdf.mjs';
import { getLastProjectId, getPaper, getProject, pdfFingerprint, savePaper, saveProject, setLastProjectId } from './storage.mjs';
import { extractPdfVisuals } from './visual-extraction.mjs';
import { assignVisuals, visualStats } from './visual-plan.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;

const labels = [
  ['background', '研究背景'], ['question', '研究问题'], ['method', '研究方法'],
  ['design', '实验／研究设计'], ['results', '研究结果'], ['conclusion', '核心结论']
];
const guideLabels = [
  ['paperInfo', '论文基本信息', '标题、作者、年份与研究主题'],
  ['relatedWork', '背景与相关研究', '前人做了什么，本文从哪里切入'],
  ['researchGoal', '目标与研究问题', '作者希望回答什么'],
  ['researchRoute', '整体研究路径', '各步骤怎样衔接'],
  ['researchMethod', '研究方法与过程', '对象、材料、流程及分析方式'],
  ['findings', '结果与关键图表', '发现、数据及图表的作用'],
  ['conclusions', '结论、局限与后续', '作者结论和有依据的补充分析'],
  ['oneMinute', '一分钟速览', '快速回顾问题、方法与发现'],
  ['logicChain', '论文逻辑链', '按论文真实顺序串起研究过程']
];
const basisLabels = { source: '原文信息', inference: '基于原文的解释', unknown: '原文未说明' };
const layoutLabels = { cover: '封面', statement: '重点陈述', split: '图文分栏', steps: '方法流程', summary: '总结', visuals: '图表展示' };
const demoPages = [
  { page: 1, text: '演示材料：校园公共空间导视体验练习（虚构示例）\n研究背景：新生初次进入校园公共空间时，需要辨认建筑入口、服务窗口和行走路径。研究问题：如何梳理他们在寻找目的地时遇到的信息障碍？' },
  { page: 2, text: '研究方法：本练习设想使用现场观察和半结构访谈，记录使用者寻找目的地时的行为与表达。研究设计：先记录典型路线，再整理信息触点，最后归纳可能的设计机会。这里不包含真实调研数据。' },
  { page: 3, text: '研究结果：本演示材料没有真实研究结果。结论：请在使用真实论文时，依据论文原文重新确认结论。以上文字只是操作演示，不代表任何已发表论文。' }
];

const state = {
  step: 'upload', projectId: null, fileName: '', pages: [], pdf: null, analysis: null, slides: [],
  visuals: [], visualFailures: [], excludedVisualIds: [],
  confirmed: false, selected: 0, theme: 'cream', fontSize: 100, imageSize: 100
};
const $ = id => document.getElementById(id);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const escapeAttr = escapeHtml;
let toastTimer;
let saveTimer;
let saveQueue = Promise.resolve();
let storageWarningShown = false;
const draftKey = projectId => `paper-presentation-draft:${projectId}`;
const lastProjectKey = 'paper-presentation-last-project';

function projectSnapshot() {
  return {
    id: state.projectId, slides: state.slides, confirmed: state.confirmed,
    selected: state.selected, step: state.step, theme: state.theme,
    fontSize: state.fontSize, imageSize: state.imageSize, excludedVisualIds: state.excludedVisualIds,
    updatedAt: Date.now()
  };
}

function saveImmediateDraft() {
  if (!state.projectId || !state.analysis) return;
  const snapshot = projectSnapshot();
  try {
    localStorage.setItem(lastProjectKey, snapshot.id);
    const withoutImages = {
      ...snapshot,
      slides: snapshot.slides.map(slide => ({ ...slide, image: null, imageFromDatabase: Boolean(slide.image) }))
    };
    localStorage.setItem(draftKey(snapshot.id), JSON.stringify(withoutImages));
  } catch { /* 浏览器禁用本地存储时仍可在当前页面继续使用。 */ }
}

function readImmediateDraft(projectId, savedProject) {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey(projectId)) || 'null');
    if (!draft || draft.id !== projectId || !Array.isArray(draft.slides) ||
        (savedProject && draft.updatedAt < savedProject.updatedAt)) return savedProject;
    const images = new Map((savedProject?.slides || []).map(slide => [slide.id, slide.image]));
    return {
      ...draft,
      slides: draft.slides.map(slide => ({
        ...slide,
        image: slide.imageFromDatabase ? images.get(slide.id) || null : slide.image || null
      }))
    };
  } catch { return savedProject; }
}

function saveCurrentProject() {
  if (!state.projectId || !state.analysis) return saveQueue;
  const snapshot = projectSnapshot();
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    await saveProject(snapshot);
    await setLastProjectId(snapshot.id);
  }).catch(error => {
    if (!storageWarningShown) toast(`本地保存失败：${error.message}。刷新后可能无法恢复。`);
    storageWarningShown = true;
  });
  return saveQueue;
}

function scheduleSave() {
  if (!state.projectId) return;
  saveImmediateDraft();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; saveCurrentProject(); }, 250);
}

async function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    await saveCurrentProject();
  }
  await saveQueue;
}

function toast(message) {
  const element = $('toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 3600);
}

function setStep(step) {
  if ((step === 'understand' || step === 'outline') && !state.analysis) return toast('请先上传论文或打开演示材料。');
  if (step === 'slides' && !state.confirmed) return toast('请先确认汇报大纲，才能生成页面。');
  state.step = step;
  document.querySelectorAll('.screen').forEach(screen => screen.classList.toggle('active', screen.id === `screen-${step}`));
  document.querySelectorAll('.step').forEach(button => button.classList.toggle('active', button.dataset.step === step));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (step === 'slides') renderSlideStudio();
  scheduleSave();
}

function setBusy(busy, message = '') {
  $('mode-pill').textContent = busy ? message : state.analysis?.mode === 'ai' ? 'DeepSeek 分析已完成' : state.analysis ? '演示模式' : '准备就绪';
  $('mode-pill').style.background = busy ? '#fff0cf' : '';
  $('pdf-input').disabled = busy;
  $('use-demo').disabled = busy;
}

function loadVisuals(visuals = [], failures = []) {
  for (const visual of state.visuals) if (visual.url) URL.revokeObjectURL(visual.url);
  state.visuals = visuals.map(visual => ({ ...visual, url: visual.blob ? URL.createObjectURL(visual.blob) : null }));
  state.visualFailures = failures;
}

function ensureVisualsAssigned() {
  assignVisuals(state.slides, state.visuals, state.excludedVisualIds);
  renderVisualSummary();
}

async function processPages(pages, fileName, pdf = null, projectId = null, pdfBlob = null, extraction = { visuals: [], failures: [] }) {
  $('upload-result').hidden = false;
  $('upload-result').innerHTML = `<strong>${escapeHtml(fileName)}</strong> · ${pages.length} 页 · 正在梳理内容…`;
  setBusy(true, '正在分析论文');
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pages, visuals: extraction.visuals.map(({ id, page, number, title, type }) => ({ id, page, number, title, type })) })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '分析失败。');
    state.fileName = fileName;
    state.pages = pages;
    state.pdf = pdf;
    state.projectId = projectId;
    state.analysis = result;
    loadVisuals(extraction.visuals, extraction.failures);
    state.excludedVisualIds = [];
    state.slides = result.slides.map((slide, index) => ({ ...slide, id: `slide-${index + 1}`, visuals: slide.visualIds || [], image: null, speakerNotes: '', notesEdited: false, notesSource: '' }));
    ensureVisualsAssigned();
    state.confirmed = false;
    state.selected = 0;
    renderUnderstanding();
    renderOutline();
    if (projectId && pdfBlob) {
      try {
        await savePaper({ id: projectId, fileName, pdfBlob, pages, analysis: result, visuals: extraction.visuals,
          visualFailures: extraction.failures, visualsVersion: 1, createdAt: Date.now() });
        await saveCurrentProject();
      } catch (error) {
        state.projectId = null;
        renderUnderstanding();
        toast(`本地保存失败：${error.message}。本次仍可继续使用。`);
      }
    }
    $('upload-result').innerHTML = `<strong>${escapeHtml(fileName)}</strong> · ${pages.length} 页 · 已提取文字与 ${state.visuals.length} 份图表素材，${result.mode === 'ai' ? 'DeepSeek 分析完成' : '规则提取演示完成'}`;
    setStep('understand');
    if (result.mode !== 'ai') toast('未配置模型接口：当前是规则提取演示结果，请自行核对并修改大纲。');
  } catch (error) {
    $('upload-result').textContent = error.message;
    toast(error.message);
  } finally { setBusy(false); }
}

async function restoreProject(projectId, label = '已恢复本地记录') {
  const paper = await getPaper(projectId);
  if (!paper?.analysis || !paper.pdfBlob) return false;
  let savedProject;
  try { savedProject = await getProject(projectId); } catch { savedProject = null; }
  const project = readImmediateDraft(projectId, savedProject);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await paper.pdfBlob.arrayBuffer()) }).promise;
  if (paper.visualsVersion !== 1) {
    const found = await extractPdfVisuals(pdf, (page, total) => { $('mode-pill').textContent = `正在补提取图表 ${page}/${total} 页`; });
    paper.visuals = found.visuals; paper.visualFailures = found.failures; paper.visualsVersion = 1;
    try { await savePaper(paper); } catch { toast('图表已提取，但浏览器存储空间不足；刷新后可能需要再次提取。'); }
  }
  state.projectId = projectId;
  state.fileName = paper.fileName;
  state.pages = paper.pages;
  state.pdf = pdf;
  state.analysis = paper.analysis;
  loadVisuals(paper.visuals || [], paper.visualFailures || []);
  state.excludedVisualIds = project?.excludedVisualIds || [];
  state.slides = project?.slides?.length ? project.slides : paper.analysis.slides.map((slide, index) => ({
    ...slide, id: `slide-${index + 1}`, visuals: slide.visualIds || [], image: null, speakerNotes: '', notesEdited: false, notesSource: ''
  }));
  ensureVisualsAssigned();
  state.confirmed = Boolean(project?.confirmed);
  state.selected = Number.isInteger(project?.selected) ? project.selected : 0;
  state.theme = project?.theme || 'cream';
  state.fontSize = project?.fontSize || 100;
  state.imageSize = project?.imageSize || 100;
  renderUnderstanding();
  renderOutline();
  $('upload-result').hidden = false;
  $('upload-result').innerHTML = `<strong>${escapeHtml(paper.fileName)}</strong> · ${paper.pages.length} 页 · ${label}，未再次调用 DeepSeek`;
  const requestedStep = ['understand', 'outline', 'slides'].includes(project?.step) ? project.step : 'understand';
  setStep(requestedStep === 'slides' && !state.confirmed ? 'outline' : requestedStep);
  await setLastProjectId(projectId);
  setBusy(false);
  return true;
}

async function readPdf(file) {
  if (!file || (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf')) return toast('请选择 PDF 文件。');
  if (file.size > 25 * 1024 * 1024) return toast('当前原型仅支持 25 MB 以内的 PDF。');
  setBusy(true, '正在读取 PDF');
  try {
    await flushSave();
    const bytes = await file.arrayBuffer();
    const projectId = await pdfFingerprint(bytes);
    let cachedPaper;
    try { cachedPaper = await getPaper(projectId); } catch { /* 本地存储不可用时仍可分析论文。 */ }
    if (cachedPaper) {
      try {
        if (await restoreProject(projectId, '已找到同一篇论文的本地记录')) {
          toast('已复用本地分析和大纲，没有再次调用 DeepSeek。');
          return;
        }
      } catch { toast('本地记录未能打开，正在重新读取这份 PDF。'); }
    }
    const pdfBlob = new Blob([bytes], { type: 'application/pdf' });
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
    if (pdf.numPages > 100) throw new Error('当前原型仅支持 100 页以内的论文。');
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      $('mode-pill').textContent = `正在读取 ${i}/${pdf.numPages} 页`;
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map(item => `${item.str || ''}${item.hasEOL ? '\n' : ' '}`).join('')
        .replace(/[ \t]+/g, ' ').trim();
      pages.push({ page: i, text });
    }
    if (pages.every(page => page.text.length < 20)) throw new Error('没有提取到足够文字；扫描版 PDF 暂不支持。');
    const extraction = await extractPdfVisuals(pdf, (page, total) => { $('mode-pill').textContent = `正在提取图表 ${page}/${total} 页`; });
    await processPages(pages, file.name, pdf, projectId, pdfBlob, extraction);
  } catch (error) { toast(`读取失败：${error.message}`); setBusy(false); }
}

function renderUnderstanding() {
  const data = state.analysis;
  $('paper-title').textContent = data.title || state.fileName;
  $('paper-meta').textContent = `${state.fileName} · ${state.pages.length} 页 PDF${state.projectId ? ' · 已在本机浏览器保存' : ''}`;
  $('analysis-mode').textContent = data.mode === 'ai' ? 'DeepSeek 辅助梳理' : '规则提取 · 演示模式';
  $('understanding-grid').innerHTML = labels.map(([key, label], index) => {
    const section = data.sections[key];
    return `<article class="understanding-card"><div class="card-top"><span class="card-number">0${index + 1} / ${label.toUpperCase()}</span><span class="page-tag">${section.page ? `PDF 第 ${section.page} 页` : '待补充'}</span></div><h3>${label}</h3><p>${escapeHtml(section.text)}</p></article>`;
  }).join('');
  $('research-guide').innerHTML = guideLabels.map(([key, label, description], index) => {
    const items = Array.isArray(data.guide?.[key]) ? data.guide[key] : [];
    const content = items.length ? items.map(item => `<li class="guide-item">
      <div class="guide-item-text">${escapeHtml(item.text)}</div>
      <div class="guide-item-meta"><span class="basis-tag basis-${escapeAttr(item.basis)}">${basisLabels[item.basis] || '待确认'}</span><span>${item.page ? `PDF 第 ${item.page} 页` : '未定位页码'}</span></div>
    </li>`).join('') : '<li class="guide-empty">原文未明确说明，或当前材料中未找到可靠依据。</li>';
    return `<details class="guide-card" ${index === 0 || (index === 7 && items.length) ? 'open' : ''}>
      <summary><span class="guide-num">${String(index + 1).padStart(2, '0')}</span><span class="guide-title"><strong>${label}</strong><small>${description}</small></span><span class="guide-count">${items.length ? `${items.length} 条` : '待补充'}</span><span class="guide-chevron" aria-hidden="true">⌄</span></summary>
      <ul class="guide-items">${content}</ul>
    </details>`;
  }).join('');
}

function markOutlineChanged() {
  if (!state.confirmed) return;
  state.confirmed = false;
  updateGateStatus();
}

function updateGateStatus() {
  const status = $('gate-status');
  status.textContent = state.confirmed ? '已确认' : '待确认';
  status.classList.toggle('confirmed', state.confirmed);
}

function renderVisualSummary() {
  const stats = visualStats(state.slides, state.visuals, state.visualFailures, state.excludedVisualIds);
  const summary = $('visual-summary');
  if (!summary) return;
  const label = `图表素材：成功提取 ${stats.extracted} · 已插入 ${stats.inserted} · 失败 ${stats.failed}${stats.removed ? ` · 手动移除 ${stats.removed}` : ''}${stats.unassigned ? ` · 待分配 ${stats.unassigned}` : ''}`;
  summary.textContent = label;
  if ($('slide-visual-summary')) $('slide-visual-summary').textContent = label;
  const catalog = $('visual-catalog');
  catalog.innerHTML = [...state.visuals.map(visual => `<div class="visual-catalog-item"><img src="${escapeAttr(visual.url)}" alt="${escapeAttr(visual.title)}" /><span><strong>${escapeHtml(visual.title)}</strong><small>PDF 第 ${visual.page} 页 · ${visual.source === 'embedded-image' ? '嵌入图片' : '区域裁切'} · ${state.excludedVisualIds.includes(visual.id) ? '已手动移除' : '提取成功'}</small></span></div>`),
    ...state.visualFailures.map(item => `<div class="visual-catalog-item failure"><span><strong>${escapeHtml(item.title)}</strong><small>PDF 第 ${item.page} 页 · 提取失败：${escapeHtml(item.reason)}</small></span></div>`)].join('') || '<p>未定位到可单独提取的图表。你仍可在页面中手动添加图片。</p>';
}

function renderOutline() {
  $('outline-count').textContent = `${state.slides.length} 页大纲`;
  $('outline-rationale').textContent = state.analysis?.outlineRationale || '请根据论文内容调整大纲。';
  updateGateStatus();
  $('outline-list').innerHTML = state.slides.map((slide, index) => `<article class="outline-card" data-id="${escapeAttr(slide.id)}">
    <div class="outline-num">${String(index + 1).padStart(2, '0')}</div>
    <div class="outline-body"><div class="outline-card-head"><span>SLIDE ${String(index + 1).padStart(2, '0')}</span><div class="small-actions"><button data-action="up" title="上移" aria-label="上移第 ${index + 1} 页" ${index === 0 ? 'disabled' : ''}>↑</button><button data-action="down" title="下移" aria-label="下移第 ${index + 1} 页" ${index === state.slides.length - 1 ? 'disabled' : ''}>↓</button><button data-action="delete" class="delete" title="删除" aria-label="删除第 ${index + 1} 页">×</button></div></div>
      <div class="field-grid"><label>页面标题<input data-field="title" value="${escapeAttr(slide.title)}" maxlength="80" /></label><label>预设版式<select data-field="layout">${Object.entries(layoutLabels).map(([key, label]) => `<option value="${key}" ${slide.layout === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="wide">本页要讲什么<textarea data-field="message" maxlength="500">${escapeHtml(slide.message)}</textarea></label><label>补充要点（每行一条）<textarea data-field="bullets" maxlength="900">${escapeHtml(slide.bullets.join('\n'))}</textarea></label><label>对应 PDF 页码（逗号分隔）<input data-field="pages" value="${escapeAttr(slide.pages.join(', '))}" placeholder="例如：2, 5" /></label></div>
      ${(slide.visuals || []).length ? `<p class="outline-visual-note">已关联图表：${slide.visuals.map(id => escapeHtml(state.visuals.find(item => item.id === id)?.title || id)).join('、')}</p>` : ''}
    </div></article>`).join('');
  renderVisualSummary();
}

function slideById(id) { return state.slides.find(slide => slide.id === id); }

function notesSource(slide) {
  return JSON.stringify([slide.title, slide.message, slide.bullets]);
}

function draftSpeakerNotes(slide) {
  const lines = [slide.message, ...slide.bullets].map(text => String(text || '').trim()).filter(Boolean);
  return [...new Set(lines)].map(text => /[。！？.!?]$/.test(text) ? text : `${text}。`).join('\n');
}

function prepareSpeakerNotes() {
  for (const slide of state.slides) {
    if (slide.notesEdited) continue;
    const source = notesSource(slide);
    if (slide.notesSource !== source) {
      slide.speakerNotes = draftSpeakerNotes(slide);
      slide.notesSource = source;
    }
  }
}

function outlineEdit(event) {
  const target = event.target;
  const field = target.dataset.field;
  const id = target.closest('.outline-card')?.dataset.id;
  if (!field || !id) return;
  const slide = slideById(id);
  if (!slide) return;
  if (field === 'bullets') slide.bullets = target.value.split('\n').map(item => item.trim()).filter(Boolean).slice(0, 5);
  else if (field === 'pages') slide.pages = [...new Set(target.value.split(/[，,、\s]+/).map(Number).filter(number => Number.isInteger(number) && number >= 1 && number <= state.pages.length))];
  else slide[field] = target.value;
  markOutlineChanged();
  scheduleSave();
}

function outlineAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const index = state.slides.findIndex(slide => slide.id === button.closest('.outline-card')?.dataset.id);
  if (index < 0) return;
  const action = button.dataset.action;
  if (action === 'delete') {
    if (state.slides.length <= 1) return toast('至少保留一页汇报大纲。');
    state.slides.splice(index, 1);
  } else {
    const other = action === 'up' ? index - 1 : index + 1;
    if (other < 0 || other >= state.slides.length) return;
    [state.slides[index], state.slides[other]] = [state.slides[other], state.slides[index]];
  }
  markOutlineChanged();
  renderOutline();
  scheduleSave();
}

function slideHtml(slide, index, print = false) {
  const linked = (slide.visuals || []).map(id => state.visuals.find(item => item.id === id)).filter(Boolean);
  const images = [...linked.map(visual => ({ src: visual.url, title: visual.title, page: visual.page })),
    ...(slide.image ? [{ src: slide.image, title: '手动添加的图片', page: null }] : [])];
  const image = images.length ? `<div class="slide-visual-grid count-${Math.min(images.length, 3)}">${images.map(item => `<figure class="slide-figure"><img src="${escapeAttr(item.src)}" alt="${escapeAttr(item.title)}" /><figcaption>${escapeHtml(item.title)}${item.page ? ` · PDF 第 ${item.page} 页` : ''}</figcaption></figure>`).join('')}</div>`
    : slide.layout === 'split' ? '<div class="slide-visual"><div class="slide-visual-empty">可添加论文图表<br>或自己的图片</div></div>' : '';
  const bullets = slide.bullets.length ? `<ul class="slide-bullets">${slide.bullets.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
  return `<div class="slide-canvas theme-${escapeAttr(state.theme)} layout-${escapeAttr(slide.layout)} ${images.length ? `has-visuals visual-count-${Math.min(images.length, 3)}` : ''}" style="--scale:${state.fontSize / 100};--image-scale:${state.imageSize / 100}">
    <div class="slide-accent"></div><div class="slide-content"><div class="slide-kicker">RESEARCH PRESENTATION / ${String(index + 1).padStart(2, '0')}</div><h2 class="slide-title">${escapeHtml(slide.title || '未命名页面')}</h2><div class="slide-message">${escapeHtml(slide.message || '请返回大纲填写本页重点')}</div>${bullets}</div>${image}<div class="slide-footer"><span>${escapeHtml(state.fileName)}</span><span>${slide.pages.length ? `依据：PDF 第 ${slide.pages.join('、')} 页` : '页码待补充'} · ${String(index + 1).padStart(2, '0')}</span></div>
  </div>`;
}

function renderSlideStudio() {
  if (!state.slides.length) return;
  state.selected = Math.max(0, Math.min(state.selected, state.slides.length - 1));
  const slide = state.slides[state.selected];
  $('preview-index').textContent = `第 ${state.selected + 1} / ${state.slides.length} 页`;
  $('slide-stage').innerHTML = slideHtml(slide, state.selected);
  $('slide-thumbs').innerHTML = state.slides.map((item, index) => `<button class="thumb ${index === state.selected ? 'active' : ''}" data-index="${index}" aria-label="查看第 ${index + 1} 页">${String(index + 1).padStart(2, '0')}</button>`).join('');
  $('layout-select').value = slide.layout;
  $('theme-select').value = state.theme;
  $('font-size').value = state.fontSize;
  $('image-size').value = state.imageSize;
  $('font-value').textContent = `${state.fontSize}%`;
  $('image-value').textContent = `${state.imageSize}%`;
  $('prev-slide').disabled = state.selected === 0;
  $('next-slide').disabled = state.selected === state.slides.length - 1;
  $('paper-image-page').innerHTML = '<option value="">选择 PDF 页码</option>' + state.pages.map(page => `<option value="${page.page}">PDF 第 ${page.page} 页</option>`).join('');
  $('current-visuals').innerHTML = (slide.visuals || []).map(id => {
    const visual = state.visuals.find(item => item.id === id);
    return visual ? `<div class="current-visual"><span>${escapeHtml(visual.title)}<small>PDF 第 ${visual.page} 页</small></span><button data-remove-visual="${escapeAttr(id)}" aria-label="从 PPT 移除 ${escapeAttr(visual.title)}">移除</button></div>` : '';
  }).join('') || '<span class="visual-empty-note">当前页没有自动提取的图表</span>';
  $('insert-paper-page').disabled = !state.pdf;
  $('speaker-notes-input').value = slide.speakerNotes || '';
  const stale = slide.notesEdited && slide.notesSource !== notesSource(slide);
  $('speaker-notes-status').textContent = stale ? '大纲已修改，请检查讲稿' : slide.notesEdited ? '已手动修改' : '根据大纲整理';
  $('speaker-notes-status').classList.toggle('stale', stale);
  $('speaker-notes-source').textContent = slide.pages.length ? `内容依据：PDF 第 ${slide.pages.join('、')} 页` : '当前页没有标注论文页码';
  renderVisualSummary();
  scheduleSave();
}

function refreshCurrentSlide() {
  $('slide-stage').innerHTML = slideHtml(state.slides[state.selected], state.selected);
  scheduleSave();
}

async function insertPaperPage() {
  if (!state.pdf) return toast('演示材料没有 PDF 页面截图。请上传真实 PDF。');
  const number = Number($('paper-image-page').value);
  if (!number) return toast('请先选择 PDF 页码。');
  try {
    const page = await state.pdf.getPage(number);
    const viewport = page.getViewport({ scale: Math.min(1.6, 1100 / page.getViewport({ scale: 1 }).width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    state.slides[state.selected].image = canvas.toDataURL('image/jpeg', .82);
    state.slides[state.selected].layout = 'split';
    renderSlideStudio();
    toast(`已插入 PDF 第 ${number} 页截图。`);
  } catch (error) { toast(`插入失败：${error.message}`); }
}

function preparePrint() {
  ensureVisualsAssigned();
  $('print-pages').innerHTML = state.slides.map((slide, index) => `<div class="print-page">${slideHtml(slide, index, true)}</div>`).join('');
  window.print();
}

document.querySelectorAll('.step').forEach(button => button.addEventListener('click', () => setStep(button.dataset.step)));
const dropzone = $('dropzone');
dropzone.addEventListener('click', () => $('pdf-input').click());
dropzone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('pdf-input').click(); } });
dropzone.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('dragging'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
dropzone.addEventListener('drop', event => { event.preventDefault(); dropzone.classList.remove('dragging'); readPdf(event.dataTransfer.files[0]); });
$('pdf-input').addEventListener('change', event => readPdf(event.target.files[0]));
$('use-demo').addEventListener('click', () => processPages(demoPages, '演示材料（虚构示例）'));
$('to-outline').addEventListener('click', () => setStep('outline'));
$('outline-list').addEventListener('input', outlineEdit);
$('outline-list').addEventListener('change', outlineEdit);
$('outline-list').addEventListener('click', outlineAction);
$('add-slide').addEventListener('click', () => {
  state.slides.push({ id: `slide-${Date.now()}`, title: '新的一页', message: '', bullets: [], pages: [], layout: 'statement', visuals: [], image: null, speakerNotes: '', notesEdited: false, notesSource: '' });
  markOutlineChanged(); renderOutline();
  scheduleSave();
});
$('confirm-outline').addEventListener('click', () => {
  if (state.slides.some(slide => !slide.title.trim() || !slide.message.trim())) return toast('请先填写每页标题和核心观点。');
  ensureVisualsAssigned();
  prepareSpeakerNotes();
  state.confirmed = true;
  updateGateStatus();
  renderOutline();
  setStep('slides');
  toast('大纲已确认，网页幻灯片已生成。');
});
$('back-outline').addEventListener('click', () => setStep('outline'));
$('prev-slide').addEventListener('click', () => { state.selected--; renderSlideStudio(); });
$('next-slide').addEventListener('click', () => { state.selected++; renderSlideStudio(); });
$('slide-thumbs').addEventListener('click', event => { const button = event.target.closest('[data-index]'); if (button) { state.selected = Number(button.dataset.index); renderSlideStudio(); } });
$('speaker-notes-input').addEventListener('input', event => {
  const slide = state.slides[state.selected];
  slide.speakerNotes = event.target.value;
  slide.notesEdited = true;
  slide.notesSource = notesSource(slide);
  $('speaker-notes-status').textContent = '已手动修改';
  $('speaker-notes-status').classList.remove('stale');
  scheduleSave();
});
$('copy-speaker-notes').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.slides[state.selected].speakerNotes || '');
    toast('本页讲稿已复制。');
  } catch { toast('复制失败，请选中讲稿文字后手动复制。'); }
});
$('layout-select').addEventListener('change', event => { state.slides[state.selected].layout = event.target.value; refreshCurrentSlide(); });
$('theme-select').addEventListener('change', event => { state.theme = event.target.value; refreshCurrentSlide(); });
$('font-size').addEventListener('input', event => { state.fontSize = Number(event.target.value); $('font-value').textContent = `${state.fontSize}%`; refreshCurrentSlide(); });
$('image-size').addEventListener('input', event => { state.imageSize = Number(event.target.value); $('image-value').textContent = `${state.imageSize}%`; refreshCurrentSlide(); });
$('image-input').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) return toast('请选择 8 MB 以内的图片。');
  const reader = new FileReader();
  reader.onload = () => { state.slides[state.selected].image = reader.result; state.slides[state.selected].layout = 'split'; renderSlideStudio(); };
  reader.readAsDataURL(file);
});
$('insert-paper-page').addEventListener('click', insertPaperPage);
$('remove-image').addEventListener('click', () => { state.slides[state.selected].image = null; refreshCurrentSlide(); });
$('current-visuals').addEventListener('click', event => {
  const button = event.target.closest('[data-remove-visual]');
  if (!button) return;
  const id = button.dataset.removeVisual;
  state.slides[state.selected].visuals = (state.slides[state.selected].visuals || []).filter(item => item !== id);
  if (!state.slides.some(slide => (slide.visuals || []).includes(id))) state.excludedVisualIds.push(id);
  renderSlideStudio();
  toast('已从汇报中移除该图表；原素材仍保存在图表清单中。');
});
$('print-slides').addEventListener('click', preparePrint);
document.addEventListener('keydown', event => {
  if (state.step !== 'slides' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  if (event.key === 'ArrowRight' && state.selected < state.slides.length - 1) { state.selected++; renderSlideStudio(); }
  if (event.key === 'ArrowLeft' && state.selected > 0) { state.selected--; renderSlideStudio(); }
});
fetch('/api/health').then(response => response.json()).then(data => { $('mode-pill').textContent = data.aiConfigured ? 'DeepSeek 模式可用' : '演示模式可用'; }).catch(() => { $('mode-pill').textContent = '服务未连接'; });

async function restoreLastProject() {
  try {
    let recentId;
    try { recentId = localStorage.getItem(lastProjectKey); } catch { /* 尝试 IndexedDB 记录。 */ }
    const projectId = recentId || await getLastProjectId();
    if (projectId) await restoreProject(projectId);
  } catch (error) { toast(`本地记录读取失败：${error.message}。可以重新导入论文。`); }
}

window.addEventListener('pagehide', () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveCurrentProject();
});
restoreLastProject();
