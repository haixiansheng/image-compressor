/* 图片压缩工具 —— 纯浏览器端 · 单张模式
 * 输入一张图 → 压缩 → 输出一张图。图片不上传，全部本地处理。
 *
 * 两种模式：
 *  - quality  质量优先：固定质量值（1-100）
 *  - target   目标大小：二分搜索质量，逼近用户指定 KB
 */
'use strict';

const $ = id => document.getElementById(id);

/* ---------- i18n ---------- */
const I18N = {
  zh: {
    pickImage: '请选择一张图片',
    single: '一次只能处理一张图片（如需批量请分批处理）',
    compressing: '压缩中…',
    done: '压缩完成',
    original: '原图',
    compressed: '压缩后',
    saved: '省了',
    larger: '反而变大',
    largerHint: '（原图已高度优化，建议直接用原图）',
    download: '⬇ 下载图片',
    pickAnother: '换一张图片',
    failed: '处理失败，请换一张图试试',
    quality: '质量',
    targetKb: '目标大小 (KB)',
    format: '输出格式',
    maxDim: '最大边长 (px)',
    keepOriginal: '0 = 保持原尺寸',
    dims: '尺寸',
    format_unchanged: '不变',
  },
  en: {
    pickImage: 'Please select an image',
    single: 'One image at a time (process larger sets in batches)',
    compressing: 'Compressing…',
    done: 'Done',
    original: 'Original',
    compressed: 'Compressed',
    saved: 'Saved',
    larger: 'Larger',
    largerHint: '(original already optimised — you may prefer to keep it)',
    download: '⬇ Download image',
    pickAnother: 'Choose another image',
    failed: 'Failed — try a different image',
    quality: 'Quality',
    targetKb: 'Target size (KB)',
    format: 'Output format',
    maxDim: 'Max dimension (px)',
    keepOriginal: '0 = keep original',
    dims: 'Dimensions',
    format_unchanged: 'unchanged',
  },
};
const LANG = (document.documentElement.lang || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
const T = I18N[LANG];

const els = {
  dropZone: $('dropZone'), fileInput: $('fileInput'),
  uploadPanel: $('uploadPanel'), workPanel: $('workPanel'),
  origImg: $('origImg'), resultImg: $('resultImg'),
  origSize: $('origSize'), resultSize: $('resultSize'),
  origDims: $('origDims'), resultDims: $('resultDims'),
  savings: $('savings'),
  mode: $('mode'), quality: $('quality'), qualityVal: $('qualityVal'),
  qualityRow: $('qualityRow'), targetRow: $('targetRow'), targetKb: $('targetKb'),
  format: $('format'), maxDim: $('maxDim'),
  downloadBtn: $('downloadBtn'), resetBtn: $('resetBtn'), status: $('status'),
};

const state = {
  img: null,          // 原始 Image
  file: null,
  name: 'image',
  blob: null,
  url: null,          // 当前压缩结果 URL
  gen: 0,             // 参数版本号：变更时作废进行中的结果
  busy: false,
};

const KB = 1024;
const fmtSize = b => b < KB ? `${b} B` : b < KB * KB ? `${(b / KB).toFixed(1)} KB` : `${(b / KB / KB).toFixed(2)} MB`;

/* ---------- 文件导入（严格单张） ---------- */
els.dropZone.addEventListener('click', () => els.fileInput.click());
els.dropZone.addEventListener('dragover', e => { e.preventDefault(); els.dropZone.classList.add('dragover'); });
els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragover'));
els.dropZone.addEventListener('drop', e => {
  e.preventDefault(); els.dropZone.classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
});
els.fileInput.addEventListener('change', e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) handleFile(f);
});

/* 粘贴 */
document.addEventListener('paste', e => {
  const items = (e.clipboardData || {}).items || [];
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) { handleFile(f); e.preventDefault(); return; }
    }
  }
});

function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) { alert(T.pickImage); return; }
  state.name = (file.name || 'image').replace(/\.[^.]+$/, '');
  state.file = file;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.img = img;
    els.origImg.src = url;
    els.origSize.textContent = fmtSize(file.size);
    els.origDims.textContent = `${img.naturalWidth}×${img.naturalHeight}`;
    els.uploadPanel.classList.add('hidden');
    els.workPanel.classList.remove('hidden');
    recompress(true);
  };
  img.onerror = () => alert('图片加载失败 / Failed to load image');
  img.src = url;
}

/* ---------- 参数变化 → 重新压缩 ---------- */
let debounce = null;
function scheduleRecompress() {
  clearTimeout(debounce);
  debounce = setTimeout(() => recompress(false), 200);
}
els.quality.addEventListener('input', () => { els.qualityVal.textContent = els.quality.value; scheduleRecompress(); });
els.targetKb.addEventListener('input', scheduleRecompress);
els.maxDim.addEventListener('input', scheduleRecompress);
els.format.addEventListener('change', scheduleRecompress);
els.mode.addEventListener('change', () => {
  const t = els.mode.value === 'target';
  els.qualityRow.classList.toggle('hidden', t);
  els.targetRow.classList.toggle('hidden', !t);
  recompress(false);
});
els.resetBtn.addEventListener('click', resetAll);

/* ---------- 编码 ---------- */
function supportsType(mime) {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  return c.toDataURL(mime).startsWith(`data:${mime}`);
}

function drawToCanvas(img, maxDim) {
  let w = img.naturalWidth, h = img.naturalHeight;
  const cap = parseInt(maxDim, 10) || 0;
  if (cap > 0 && Math.max(w, h) > cap) {
    const s = cap / Math.max(w, h);
    w = Math.round(w * s); h = Math.round(h * s);
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { alpha: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas: c, w, h };
}

function canvasToBlob(canvas, mime, q) {
  return new Promise(res => {
    if (mime === 'image/jpeg') {
      // JPEG 不支持透明，铺白底
      const c2 = document.createElement('canvas');
      c2.width = canvas.width; c2.height = canvas.height;
      const x = c2.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, c2.width, c2.height);
      x.drawImage(canvas, 0, 0);
      canvas = c2;
    }
    canvas.toBlob(b => res(b), mime, q);
  });
}

function pickMime(fmtPref) {
  let mime = fmtPref === 'webp' ? 'image/webp'
           : fmtPref === 'jpeg' ? 'image/jpeg'
           : fmtPref === 'png' ? 'image/png'
           : 'image/webp';                       // auto
  if (mime === 'image/webp' && !supportsType('image/webp')) mime = 'image/jpeg';
  // 目标大小模式无法作用于 PNG（无损，忽略质量参数）
  if (els.mode.value === 'target' && mime === 'image/png') mime = 'image/jpeg';
  return mime;
}

async function compress() {
  const img = state.img;
  const { canvas, w, h } = drawToCanvas(img, els.maxDim.value);
  const mime = pickMime(els.format.value);

  if (mime === 'image/png') {
    // PNG 无损：质量参数无效，只能靠缩放
    return { blob: await canvasToBlob(canvas, 'image/png', 1), w, h };
  }

  if (els.mode.value === 'target') {
    const targetBytes = Math.max(1, parseInt(els.targetKb.value, 10) || 200) * KB;
    let lo = 0.05, hi = 1.0, best = null;
    for (let i = 0; i < 8; i++) {
      const q = (lo + hi) / 2;
      const b = await canvasToBlob(canvas, mime, q);
      if (!b) break;
      if (b.size <= targetBytes) { best = b; lo = q; } else { hi = q; }
      if (best && b.size > targetBytes * 0.85) break;   // 够接近了就停
    }
    const blob = best || await canvasToBlob(canvas, mime, 0.05);
    return { blob, w, h };
  }

  const q = Math.max(1, Math.min(100, parseInt(els.quality.value, 10))) / 100;
  return { blob: await canvasToBlob(canvas, mime, q), w, h };
}

async function recompress(isNewFile) {
  if (!state.img || state.busy) return;
  state.busy = true;
  const gen = state.gen;
  els.status.textContent = T.compressing;
  els.downloadBtn.disabled = true;

  try {
    const { blob, w, h } = await compress();
    if (!blob) throw new Error('no blob');
    if (gen !== state.gen) { state.busy = false; return; }   // 参数已变，丢弃

    if (state.url) URL.revokeObjectURL(state.url);
    state.blob = blob;
    state.url = URL.createObjectURL(blob);
    els.resultImg.src = state.url;
    els.resultSize.textContent = fmtSize(blob.size);
    els.resultDims.textContent = `${w}×${h}`;

    // 体积对比
    const orig = state.file.size;
    const diff = orig - blob.size;
    const pct = orig ? (diff / orig) * 100 : 0;
    if (diff >= 0) {
      els.savings.innerHTML = `<span class="good">省了 ${pct.toFixed(0)}%</span>`;
    } else {
      els.savings.innerHTML = `<span class="bad">反而变大 ${Math.abs(pct).toFixed(0)}%</span> <span class="muted">${T.largerHint}</span>`;
    }

    els.downloadBtn.href = state.url;
    els.downloadBtn.download = outName(blob.type);
    els.downloadBtn.disabled = false;
    els.status.textContent = T.done;
  } catch (e) {
    console.warn('[compress]', e);
    if (gen === state.gen) els.status.textContent = T.failed;
  }
  state.busy = false;
}

function outName(mime) {
  const ext = mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg';
  return `${state.name}_min.${ext}`;
}

function resetAll() {
  if (state.url) URL.revokeObjectURL(state.url);
  state.img = null; state.file = null; state.blob = null; state.url = null;
  state.gen++;
  els.fileInput.value = '';
  els.workPanel.classList.add('hidden');
  els.uploadPanel.classList.remove('hidden');
  els.status.textContent = '';
}

/* ---------- init ---------- */
els.qualityVal.textContent = els.quality.value;
