/* 图片压缩工具 —— 纯浏览器端
 * 批量压缩：Canvas 重绘 + toBlob 编码，全部本地完成，图片不上传。
 *
 * 两种模式：
 *  - quality  质量优先：固定质量值（1-100）
 *  - target   目标大小：二分搜索质量，逼近用户指定 KB（可设上限）
 */
'use strict';

const $ = id => document.getElementById(id);

/* ---------- i18n ---------- */
const I18N = {
  zh: {
    pickImage: '请选择图片文件',
    empty: '还没有添加图片',
    compressing: '压缩中…',
    done: '压缩完成',
    original: '原始',
    compressed: '压缩后',
    saved: '省了',
    larger: '变大',
    download: '下载',
    downloadAll: '下载全部',
    downloadOne: '⬇ 下载图片',
    downloadAllZip: n => `📦 打包下载 ${n} 张（ZIP）`,
    totalOriginal: '原始总计',
    totalCompressed: '压缩后总计',
    totalSaved: '共省下',
    clear: '清空列表',
    addMore: '继续添加图片',
    failed: '处理失败',
    unreachable: '无法达到目标大小',
    quality: '质量',
    targetKb: '目标大小 (KB)',
    noGain: '(已是最优)',
    images: n => `${n} 张图片`,
    processing: (i, n) => `处理中 ${i}/${n}…`,
  },
  en: {
    pickImage: 'Please select image files',
    empty: 'No images added yet',
    compressing: 'Compressing…',
    done: 'Done',
    original: 'Original',
    compressed: 'Compressed',
    saved: 'Saved',
    larger: 'Larger',
    download: 'Download',
    downloadAll: 'Download all',
    downloadOne: '⬇ Download image',
    downloadAllZip: n => `📦 Download all ${n} (ZIP)`,
    totalOriginal: 'Original total',
    totalCompressed: 'Compressed total',
    totalSaved: 'Total saved',
    clear: 'Clear list',
    addMore: 'Add more images',
    failed: 'Failed',
    unreachable: 'Could not reach target size',
    quality: 'Quality',
    targetKb: 'Target size (KB)',
    noGain: '(already optimal)',
    images: n => `${n} image(s)`,
    processing: (i, n) => `Processing ${i}/${n}…`,
  },
};
const LANG = (document.documentElement.lang || 'zh').toLowerCase().startsWith('en') ? 'en' : 'zh';
const T = I18N[LANG];

const els = {
  dropZone: $('dropZone'), fileInput: $('fileInput'),
  uploadPanel: $('uploadPanel'), workPanel: $('workPanel'),
  listBody: $('listBody'), summary: $('summary'), status: $('status'),
  format: $('format'), quality: $('quality'), qualityVal: $('qualityVal'),
  mode: $('mode'), qualityRow: $('qualityRow'), targetRow: $('targetRow'),
  targetKb: $('targetKb'), maxDim: $('maxDim'),
  downloadAllBtn: $('downloadAllBtn'), clearBtn: $('clearBtn'), addMoreBtn: $('addMoreBtn'),
};

const state = {
  items: [],        // {id, file, name, origSize, blob, outSize, status, url, w, h, outW, outH}
  seq: 0,
  gen: 0,           // 参数版本号：变更时作废进行中的结果，避免旧设置覆盖新结果
};

const KB = 1024;
const fmtSize = b => b < KB ? `${b} B` : b < KB * KB ? `${(b / KB).toFixed(1)} KB` : `${(b / KB / KB).toFixed(2)} MB`;

/* ---------- 文件导入 ---------- */
els.dropZone.addEventListener('click', () => els.fileInput.click());
els.dropZone.addEventListener('dragover', e => { e.preventDefault(); els.dropZone.classList.add('dragover'); });
els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragover'));
els.dropZone.addEventListener('drop', e => {
  e.preventDefault(); els.dropZone.classList.remove('dragover');
  addFiles([...e.dataTransfer.files]);
});
els.fileInput.addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });

/* 粘贴 */
document.addEventListener('paste', e => {
  const items = (e.clipboardData || {}).items || [];
  const files = [];
  for (const it of items) {
    if (it.type && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) { addFiles(files); e.preventDefault(); }
});

function addFiles(files) {
  const imgs = files.filter(f => f.type.startsWith('image/'));
  if (!imgs.length) { alert(T.pickImage); return; }
  for (const f of imgs) {
    state.items.push({
      id: ++state.seq,
      file: f,
      name: f.name || `image_${state.seq}`,
      origSize: f.size,
      blob: null, outSize: 0, status: 'pending', url: null,
    });
  }
  els.uploadPanel.classList.add('hidden');
  els.workPanel.classList.remove('hidden');
  render();
  runQueue();
}

/* ---------- 参数变化 → 全部重压 ---------- */
['input', 'change'].forEach(ev => {
  els.quality.addEventListener(ev, () => { els.qualityVal.textContent = els.quality.value; restartAll(); });
  els.targetKb.addEventListener(ev, restartAll);
  els.maxDim.addEventListener(ev, restartAll);
  els.format.addEventListener(ev, restartAll);
});
els.mode.addEventListener('change', () => {
  const t = els.mode.value === 'target';
  els.qualityRow.classList.toggle('hidden', t);
  els.targetRow.classList.toggle('hidden', !t);
  restartAll();
});

let restartTimer = null;
function restartAll() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    state.gen++;                       // 作废进行中的结果
    for (const it of state.items) {
      if (it.url) { URL.revokeObjectURL(it.url); it.url = null; }
      it.blob = null; it.outSize = 0; it.status = 'pending';
    }
    render();
    runQueue();
  }, 200);
}

/* ---------- 核心：单张压缩 ---------- */
function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode failed')); };
    img.src = url;
  });
}

function targetMime(pref, fallbackType) {
  if (pref === 'webp') return 'image/webp';
  if (pref === 'jpeg') return 'image/jpeg';
  if (pref === 'png') return 'image/png';
  // auto: WebP 优先（同质量体积小 25-35%），不支持则回退 JPEG
  return 'image/webp';
}

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
  // PNG 保持透明；JPEG 需白底
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas: c, w, h };
}

function canvasToBlob(canvas, mime, q) {
  return new Promise(res => {
    // PNG 忽略 q；JPEG 不支持透明，需要铺白底
    if (mime === 'image/jpeg') {
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

async function compressOne(item, settings) {
  const img = await loadImage(item.file);
  const { canvas, w, h } = drawToCanvas(img, settings.maxDim);
  item.w = img.naturalWidth; item.h = img.naturalHeight;
  item.outW = w; item.outH = h;

  let mime = targetMime(settings.format, item.file.type);
  if (mime === 'image/webp' && !supportsType('image/webp')) mime = 'image/jpeg';

  // 目标大小模式无法作用于 PNG（PNG 无损，质量参数被忽略）
  if (settings.mode === 'target' && mime === 'image/png') mime = 'image/jpeg';

  if (mime === 'image/png') {
    // PNG 无损：质量滑块无效，只能靠缩放
    return await canvasToBlob(canvas, 'image/png', 1);
  }

  if (settings.mode === 'target') {
    // 二分搜索质量，逼近目标大小
    const targetBytes = Math.max(1, settings.targetKb) * KB;
    let lo = 0.05, hi = 1.0, best = null, bestQ = 0.8;
    for (let i = 0; i < 8; i++) {
      const q = (lo + hi) / 2;
      const b = await canvasToBlob(canvas, mime, q);
      if (!b) break;
      if (b.size <= targetBytes) { best = b; bestQ = q; lo = q; }
      else { hi = q; }
      if (best && b.size > targetBytes * 0.85 && b.size <= targetBytes) break;
    }
    if (best) return best;
    // 达不到目标：返回最低质量的尽力结果
    return await canvasToBlob(canvas, mime, 0.05);
  }

  const q = Math.max(1, Math.min(100, parseInt(settings.quality, 10))) / 100;
  return await canvasToBlob(canvas, mime, q);
}

function currentSettings() {
  return {
    format: els.format.value,
    quality: els.quality.value,
    mode: els.mode.value,
    targetKb: parseInt(els.targetKb.value, 10) || 200,
    maxDim: parseInt(els.maxDim.value, 10) || 0,
  };
}

/* ---------- 队列 ---------- */
let running = false;
async function runQueue() {
  if (running) return;
  running = true;
  let done = 0;
  const totalAtStart = state.items.filter(i => i.status === 'pending').length;
  while (true) {
    const it = state.items.find(i => i.status === 'pending');
    if (!it) break;
    const gen = state.gen;                 // 记录本次处理所用的参数版本
    const settings = currentSettings();
    it.status = 'working';
    els.status.textContent = T.processing(Math.min(++done, totalAtStart), totalAtStart);
    render();
    try {
      const blob = await compressOne(it, settings);
      if (!blob) throw new Error('no blob');
      if (gen !== state.gen) {
        // 参数在处理期间被改了 → 丢弃这次结果，重新排队
        it.status = 'pending';
        continue;
      }
      it.blob = blob;
      it.outSize = blob.size;
      it.mime = blob.type;
      it.status = 'done';
      if (it.url) URL.revokeObjectURL(it.url);
      it.url = URL.createObjectURL(blob);
    } catch (e) {
      console.warn('[compress]', e);
      if (gen !== state.gen) { it.status = 'pending'; continue; }
      it.status = 'failed';
    }
    render();
  }
  running = false;
  if (state.items.length && state.items.every(i => i.status === 'done')) {
    els.status.textContent = T.done;
  } else {
    els.status.textContent = '';
  }
}

/* ---------- 渲染 ---------- */
function render() {
  if (!state.items.length) { els.listBody.innerHTML = `<tr><td colspan="6" class="empty">${T.empty}</td></tr>`; }
  else {
    const rows = state.items.map(it => {
      const saved = it.origSize && it.outSize ? it.origSize - it.outSize : 0;
      const pct = it.origSize && it.outSize ? (saved / it.origSize) * 100 : 0;
      const grew = saved < 0;
      let sizeCell = '—';
      if (it.status === 'working') sizeCell = `<span class="muted">${T.compressing}</span>`;
      else if (it.status === 'failed') sizeCell = `<span class="bad">${T.failed}</span>`;
      else if (it.status === 'done') {
        const tag = grew
          ? `<span class="bad">+${Math.abs(pct).toFixed(0)}%</span>`
          : `<span class="good">−${pct.toFixed(0)}%</span>`;
        sizeCell = `${fmtSize(it.origSize)} → <b>${fmtSize(it.outSize)}</b> ${tag}`;
      }
      const dims = it.outW ? `${it.w}×${it.h}${it.outW !== it.w || it.outH !== it.h ? ` → ${it.outW}×${it.outH}` : ''}` : '—';
      const dl = it.status === 'done'
        ? `<a class="btn tiny" href="${it.url}" download="${outName(it)}">${T.download}</a>`
        : '';
      return `<tr>
        <td class="thumb">${it.url ? `<img src="${it.url}" alt="">` : '<span class="ph"></span>'}</td>
        <td class="fname" title="${it.name}">${it.name}</td>
        <td class="dims">${dims}</td>
        <td class="sizes">${sizeCell}</td>
        <td class="act">${dl}</td>
      </tr>`;
    });
    els.listBody.innerHTML = rows.join('');
  }

  // 汇总
  const ok = state.items.filter(i => i.status === 'done');
  const oSum = ok.reduce((a, b) => a + b.origSize, 0);
  const cSum = ok.reduce((a, b) => a + b.outSize, 0);
  const diff = oSum - cSum;
  const pct = oSum ? (diff / oSum) * 100 : 0;
  if (!ok.length) {
    els.summary.innerHTML = '';
  } else {
    els.summary.innerHTML = `
      <div class="sum-item"><span>${T.totalOriginal}</span><b>${fmtSize(oSum)}</b></div>
      <div class="sum-item"><span>${T.totalCompressed}</span><b>${fmtSize(cSum)}</b></div>
      <div class="sum-item hl"><span>${T.totalSaved}</span><b>${fmtSize(Math.max(0, diff))} (${pct.toFixed(0)}%)</b></div>
      <div class="sum-item"><span>${T.images(ok.length)}</span><b></b></div>`;
  }

  // 单张 → 直接下载单张图；多张 → ZIP 打包
  if (ok.length === 0) {
    els.downloadAllBtn.textContent = T.downloadAll;
  } else if (ok.length === 1) {
    els.downloadAllBtn.textContent = T.downloadOne;
  } else {
    els.downloadAllBtn.textContent = T.downloadAllZip(ok.length);
  }
  els.downloadAllBtn.disabled = ok.length < 1;
}

function outName(it) {
  const ext = it.mime === 'image/webp' ? 'webp' : it.mime === 'image/png' ? 'png' : 'jpg';
  const base = (it.name || 'image').replace(/\.[^.]+$/, '');
  return `${base}_min.${ext}`;
}

/* ---------- 下载 ---------- */
els.downloadAllBtn.addEventListener('click', async () => {
  const ok = state.items.filter(i => i.status === 'done' && i.blob);
  if (!ok.length) return;
  // 单张输入 → 单张输出（绝不打包成 ZIP）
  if (ok.length === 1 || typeof JSZip === 'undefined') {
    // 单张 或 JSZip 不可用 → 逐张下载
    ok.forEach((it, i) => setTimeout(() => {
      const a = document.createElement('a');
      a.href = it.url; a.download = outName(it);
      document.body.appendChild(a); a.click(); a.remove();
    }, i * 350));
    return;
  }
  els.downloadAllBtn.disabled = true;
  const old = els.downloadAllBtn.textContent;
  els.downloadAllBtn.textContent = '...';
  try {
    const zip = new JSZip();
    const used = {};
    for (const it of ok) {
      let n = outName(it);
      if (used[n]) { n = n.replace(/(\.[^.]+)$/, `_${used[n]++}$1`); } else { used[n] = 1; }
      zip.file(n, it.blob);
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'compressed_images.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {
    console.warn(e);
    alert('ZIP failed / 打包失败');
  }
  els.downloadAllBtn.disabled = false;
  els.downloadAllBtn.textContent = old;
});

els.clearBtn.addEventListener('click', () => {
  for (const it of state.items) if (it.url) URL.revokeObjectURL(it.url);
  state.items = [];
  els.fileInput.value = '';
  els.workPanel.classList.add('hidden');
  els.uploadPanel.classList.remove('hidden');
  render();
});
els.addMoreBtn.addEventListener('click', () => els.fileInput.click());

/* ---------- init ---------- */
render();
