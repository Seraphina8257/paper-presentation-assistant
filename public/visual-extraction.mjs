import { OPS } from './vendor/pdf.mjs';

const figurePattern = /^(?:图版|图|figure|fig\.?)\s*([\dIVXivx]+(?:[.\-–][\dA-Za-z]+)*)\s*[.:：、\-–]?\s*(.*)$/i;
const tablePattern = /^(?:表|table)\s*([\dIVXivx]+(?:[.\-–][\dA-Za-z]+)*)\s*[.:：、\-–]?\s*(.*)$/i;
const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintJpegXObject, OPS.paintImageMaskXObject]);
const unsupportedImageOps = new Set([OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat, OPS.paintInlineImageXObjectGroup]);

function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

function unitBounds(matrix) {
  const points = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]);
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function boxBounds(matrix, box) {
  const [x0, y0, x1, y1] = box;
  const points = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) =>
    [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]);
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function clampRect(rect, width, height) {
  const x = Math.max(0, Math.min(width, rect.x));
  const y = Math.max(0, Math.min(height, rect.y));
  return { x, y, w: Math.max(0, Math.min(width, rect.x + rect.w) - x), h: Math.max(0, Math.min(height, rect.y + rect.h) - y) };
}

function intersection(a, b) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h;
}

function imagePlacements(ops, viewport) {
  const results = [];
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] || [];
    if (fn === OPS.save) stack.push(matrix.slice());
    else if (fn === OPS.restore) matrix = stack.pop() || matrix;
    else if (fn === OPS.transform) matrix = multiply(matrix, args);
    else if (imageOps.has(fn)) {
      const rect = clampRect(unitBounds(multiply(viewport.transform, matrix)), viewport.width, viewport.height);
      if (rect.w >= 28 && rect.h >= 28) results.push({ rect, objectId: typeof args[0] === 'string' ? args[0] : null, inline: typeof args[0] === 'object' ? args[0] : null });
    }
  }
  return results;
}

function vectorPlacements(ops, viewport) {
  const paths = [];
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] || [];
    if (fn === OPS.save) stack.push(matrix.slice());
    else if (fn === OPS.restore) matrix = stack.pop() || matrix;
    else if (fn === OPS.transform) matrix = multiply(matrix, args);
    else if (fn === OPS.constructPath && args[2]?.length === 4) {
      const rect = clampRect(boxBounds(multiply(viewport.transform, matrix), args[2]), viewport.width, viewport.height);
      if (rect.w < viewport.width * .94 && rect.h < viewport.height * .9) paths.push(rect);
    }
  }
  const groups = [];
  for (const rect of paths) {
    const expanded = { x: rect.x - 8, y: rect.y - 8, w: rect.w + 16, h: rect.h + 16 };
    const matches = groups.filter(group => intersection(group.rect, expanded) > 0);
    if (!matches.length) groups.push({ rect: expanded, count: 1 });
    else {
      const group = matches[0];
      const all = [group.rect, expanded, ...matches.slice(1).map(item => item.rect)];
      const x = Math.min(...all.map(item => item.x));
      const y = Math.min(...all.map(item => item.y));
      group.rect = { x, y, w: Math.max(...all.map(item => item.x + item.w)) - x, h: Math.max(...all.map(item => item.y + item.h)) - y };
      group.count += 1 + matches.slice(1).reduce((sum, item) => sum + item.count, 0);
      for (const item of matches.slice(1)) groups.splice(groups.indexOf(item), 1);
    }
  }
  return groups.filter(group => group.count >= 4 && group.rect.w >= 65 && group.rect.h >= 38)
    .map(group => clampRect(group.rect, viewport.width, viewport.height));
}

function textLines(content, viewport) {
  const items = content.items.filter(item => item.str?.trim()).map(item => {
    const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
    return { text: item.str.trim(), x, y, w: Math.abs(item.width * viewport.scale), h: Math.max(8, Math.abs(item.height * viewport.scale)) };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
  const lines = [];
  for (const item of items) {
    let line = lines.find(candidate => Math.abs(candidate.y - item.y) <= Math.max(4, item.h * .35) && Math.abs(candidate.x - item.x) < viewport.width * .72);
    if (!line) { line = { y: item.y, x: item.x, items: [] }; lines.push(line); }
    line.items.push(item);
  }
  return lines.map(line => {
    line.items.sort((a, b) => a.x - b.x);
    const x = Math.min(...line.items.map(item => item.x));
    const right = Math.max(...line.items.map(item => item.x + item.w));
    const y = Math.min(...line.items.map(item => item.y - item.h));
    const bottom = Math.max(...line.items.map(item => item.y + 3));
    return { text: line.items.map(item => item.text).join(' ').replace(/\s+/g, ' '), x, y, w: right - x, h: bottom - y };
  });
}

function captionCandidates(lines, viewport) {
  const out = [];
  for (const line of lines) {
    const figure = line.text.match(figurePattern);
    const table = line.text.match(tablePattern);
    const match = figure || table;
    if (!match) continue;
    const type = table ? 'table' : 'figure';
    const number = match[1] || '';
    const left = line.x < viewport.width * .44 ? 0 : viewport.width * .48;
    const right = line.x + line.w > viewport.width * .56 ? viewport.width : viewport.width * .52;
    const width = right - left;
    const maxHeight = viewport.height * .43;
    const rect = type === 'table'
      ? { x: left + 8, y: line.y + line.h + 3, w: width - 16, h: Math.min(maxHeight, viewport.height - line.y - line.h - 10) }
      : { x: left + 8, y: Math.max(0, line.y - maxHeight), w: width - 16, h: Math.min(maxHeight, line.y) };
    if (rect.h < 45) {
      out.push({ type, number, title: match[2]?.trim() || '', rect, failure: '图题附近没有足够的独立裁切区域' });
    } else out.push({ type, number, title: match[2]?.trim() || '', rect });
  }
  return out;
}

function waitForObject(page, id) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    try { page.objs.get(id, finish); } catch { finish(null); }
    setTimeout(() => finish(null), 2000);
  });
}

function imageCanvas(image) {
  if (!image?.width || !image?.height || image.width * image.height > 20_000_000) return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (image instanceof ImageBitmap || image instanceof HTMLImageElement || image instanceof HTMLCanvasElement) {
    context.drawImage(image, 0, 0); return canvas;
  }
  if (!image.data) return null;
  const pixels = context.createImageData(image.width, image.height);
  if (image.data.length === pixels.data.length) pixels.data.set(image.data);
  else if (image.data.length === image.width * image.height * 3) {
    for (let i = 0, j = 0; i < image.data.length; i += 3, j += 4) {
      pixels.data[j] = image.data[i]; pixels.data[j + 1] = image.data[i + 1]; pixels.data[j + 2] = image.data[i + 2]; pixels.data[j + 3] = 255;
    }
  } else return null;
  context.putImageData(pixels, 0, 0);
  return canvas;
}

function blobFromCanvas(canvas, type = 'image/png') {
  return new Promise(resolve => canvas.toBlob(resolve, type, .94));
}

function cropCanvas(source, rect, scale) {
  const x = Math.max(0, Math.floor(rect.x * scale));
  const y = Math.max(0, Math.floor(rect.y * scale));
  const w = Math.min(source.width - x, Math.ceil(rect.w * scale));
  const h = Math.min(source.height - y, Math.ceil(rect.h * scale));
  if (w < 40 || h < 40) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(source, x, y, w, h, 0, 0, w, h);
  return canvas;
}

export async function extractPdfVisuals(pdf, onProgress = () => {}) {
  const visuals = [];
  const failures = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    onProgress(pageNumber, pdf.numPages);
    let page;
    try {
      page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const [content, ops] = await Promise.all([page.getTextContent(), page.getOperatorList()]);
      ops.fnArray.forEach((fn, index) => {
        if (unsupportedImageOps.has(fn)) failures.push({ id: `pdf-${pageNumber}-unsupported-${index}`, page: pageNumber,
          title: `第 ${pageNumber} 页图像操作 ${index + 1}`, type: 'image', status: 'failed', reason: '重复或分组图像无法可靠拆分，请手动检查该页' });
      });
      const captions = captionCandidates(textLines(content, viewport), viewport);
      const images = imagePlacements(ops, viewport);
      const vectors = vectorPlacements(ops, viewport);
      const candidates = [];
      for (const caption of captions) {
        const overlap = images.find(image => intersection(image.rect, caption.rect) / Math.max(1, image.rect.w * image.rect.h) > .55);
        if (overlap && caption.type === 'figure') {
          candidates.push({ ...caption, rect: overlap.rect, image: overlap });
          overlap.used = true;
        } else candidates.push(caption);
      }
      for (const image of images) {
        if (!image.used && !candidates.some(candidate => intersection(candidate.rect, image.rect) / Math.max(1, image.rect.w * image.rect.h) > .65)) {
          candidates.push({ type: 'image', number: '', title: '', rect: image.rect, image });
        }
      }
      for (const rect of vectors) {
        const caption = candidates.find(candidate => intersection(candidate.rect, rect) / Math.max(1, rect.w * rect.h) > .7);
        if (caption && !caption.image) {
          caption.rect = clampRect({ x: rect.x - 5, y: rect.y - 5, w: rect.w + 10, h: rect.h + 10 }, viewport.width, viewport.height);
          continue;
        }
        if (!candidates.some(candidate => intersection(candidate.rect, rect) / Math.max(1, rect.w * rect.h) > .7)) {
          candidates.push({ type: 'chart', number: '', title: '', rect });
        }
      }
      let rendered;
      const scale = Math.min(2.4, 2400 / Math.max(viewport.width, viewport.height));
      async function pageCanvas() {
        if (!rendered) {
          const target = page.getViewport({ scale });
          rendered = document.createElement('canvas');
          rendered.width = Math.ceil(target.width); rendered.height = Math.ceil(target.height);
          await page.render({ canvasContext: rendered.getContext('2d'), viewport: target, background: 'white' }).promise;
        }
        return rendered;
      }
      for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index];
        const id = `pdf-${pageNumber}-${index + 1}`;
        const label = candidate.number ? `${candidate.type === 'table' ? '表' : '图'} ${candidate.number}` : `第 ${pageNumber} 页图表 ${index + 1}`;
        const title = candidate.title ? `${label} ${candidate.title}` : label;
        if (candidate.failure) { failures.push({ id, page: pageNumber, title, type: candidate.type, status: 'failed', reason: candidate.failure }); continue; }
        try {
          let canvas;
          let source = 'page-crop';
          if (candidate.image?.objectId) {
            canvas = imageCanvas(await waitForObject(page, candidate.image.objectId));
            if (canvas) source = 'embedded-image';
          } else if (candidate.image?.inline) {
            canvas = imageCanvas(candidate.image.inline);
            if (canvas) source = 'embedded-image';
          }
          if (!canvas) canvas = cropCanvas(await pageCanvas(), candidate.rect, scale);
          if (!canvas) throw new Error('定位区域过小或超出页面');
          const blob = await blobFromCanvas(canvas);
          if (!blob) throw new Error('图像编码失败');
          visuals.push({ id, page: pageNumber, number: candidate.number, title, type: candidate.type,
            status: 'ok', source, rect: candidate.rect, width: canvas.width, height: canvas.height, blob });
        } catch (error) { failures.push({ id, page: pageNumber, title, type: candidate.type, status: 'failed', reason: error.message }); }
      }
    } catch (error) {
      failures.push({ id: `pdf-${pageNumber}-page`, page: pageNumber, title: `第 ${pageNumber} 页`, type: 'page', status: 'failed', reason: `该页图表扫描失败：${error.message}` });
    }
  }
  return { visuals, failures };
}
