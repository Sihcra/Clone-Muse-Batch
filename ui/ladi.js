/**
 * LADIPAGE — dán link trang bán hàng → lấy thông tin + ảnh → chọn kịch bản → đưa vào hàng đợi Kịch bản.
 * Dùng chung cài đặt và hàng đợi của tab Kịch bản (App.script).
 */
(function () {
  'use strict';
  const { api, $, escapeHtml, toast, goTab } = window.App;
  const { currentCfg, cfgText, estMin, copiesValue, poolAdd, makeJob, addJobs, buildPrompt, buildBoardPrompt, boardVideoPrompt, SCENE_SECS, BOARD_MAX } = window.App.script;
  const [paramDuration, paramRatio, paramVoice, paramPrefix, paramBoard] = ['param-duration', 'param-ratio', 'param-voice', 'param-prefix', 'param-board'].map($);

  const inputUrl = $('input-ladi-url');
  const btnScrape = $('btn-scrape-ladi');
  const scriptTabs = $('ladi-script-tabs');
  const scenesBox = $('ladi-script-scenes-container');
  const promptPreview = $('ladi-prompt-preview');
  const imagesGrid = $('res-images-grid');
  const btnImport = $('btn-import-to-muse');
  const btnImportAll = $('btn-import-all');
  const noPriceEl = $('ladi-no-price');
  const steps = [...document.querySelectorAll('#ladi-steps .step')];

  let data = null;          // kết quả sinh kịch bản
  let selected = 0;         // kịch bản đang xem
  let picked = new Set([0]); // kịch bản đã tích để đưa vào hàng đợi
  let images = [];          // kho ảnh sản phẩm (link hoặc data URL)
  // Ảnh gửi kèm cả video: 2–3 ảnh rõ sản phẩm cho kết quả tốt; nhiều quá Muse dễ lẫn
  const REFS_MAX = 3;
  let refs = [];

  const currentScript = () => data && data.scripts[selected];
  // 16s = 2 cảnh × 8s, 24s = 3 cảnh × 8s; còn lại 3 cảnh × 10s
  const layout = () => ({ '16s': { scenes: 2, sceneSecs: 8 }, '24s': { scenes: 3, sceneSecs: 8 } })[paramDuration.value] || { scenes: 3, sceneSecs: SCENE_SECS };
  let genLayout = '';
  const totalSecs = n => Math.min(60, n * layout().sceneSecs);

  function updateSteps() {
    const state = !currentScript() ? ['active', '', '', ''] : refs.length ? ['done', 'done', 'active', ''] : ['done', 'active', '', ''];
    steps.forEach((el, i) => { el.className = 'step ' + state[i]; });
  }

  const itemsOf = script => script.scenes.map(s => ({
    text: String(s.musePrompt || '').trim(),
    voiceover: String(s.voiceover || '').trim(),
    product: data.facts?.name || data.productName || '',
    img: ''
  }));
  // Gộp 1 lệnh: thời lượng = số cảnh × độ dài cảnh để lời vừa khít. Kịch bản không lời: bỏ giọng + người dẫn, dùng nhạc nền.
  const cfgOf = script => {
    const cfg = { ...currentCfg(), style: script.style || data?.style || '', ...(script.silent ? { voice: '', host: '', char: '', audio: script.audio } : {}) };
    return cfg.duration === 'each' ? cfg : { ...cfg, duration: `${totalSecs(script.scenes.length)}s` };
  };

  function updateSummary() {
    const script = currentScript();
    if (!script) return;
    const n = script.scenes.length;
    const cfg = cfgOf(script);
    $('ladi-summary').textContent = `${cfgText(cfg, n)} · ${refs.length ? `gửi kèm ${refs.length} ảnh sản phẩm` : 'không gửi ảnh sản phẩm'} · ước tính ~${Math.round(estMin(cfg, n))} phút/video`;
    if (!promptPreview.open) return;
    const items = itemsOf(script);
    const refIds = refs.map(poolAdd);
    const video = cfg.duration === 'each' ? items.map(it => buildPrompt([it], cfg, refIds)).join('\n\n———\n\n') : buildPrompt(items, cfg, refIds);
    $('ladi-prompt-text').textContent = cfg.board
      ? `① Vẽ storyboard:\n${buildBoardPrompt(items, cfg, refIds)}\n\n② Làm video (gắn lại ảnh storyboard):\n${boardVideoPrompt(items, cfg, Math.min(items.length, BOARD_MAX), true)}`
      : video;
  }
  promptPreview.addEventListener('toggle', updateSummary);
  [paramDuration, paramRatio, paramVoice, paramPrefix, paramBoard].forEach(el => el.addEventListener('change', updateSummary));
  paramDuration.addEventListener('change', () => { if (data && JSON.stringify(layout()) !== genLayout) scrape(true); });

  // Giọng Muse đọc ~4,6 chữ/giây: ít hơn ~3,6 chữ/giây thì cuối cảnh chỉ còn nhạc, quá ~4,8 chữ/giây Muse cắt bớt lời
  function wordCount(text) {
    const n = String(text || '').trim().split(/\s+/).filter(Boolean).length;
    const secs = layout().sceneSecs;
    const max = Math.round(secs * 4.8);
    const min = Math.round(secs * 3.6);
    const tone = n > max ? 'danger' : n < min ? 'warn' : '';
    const note = n > max ? ' · dài, Muse sẽ cắt bớt' : n < min ? ' · ngắn, cuối cảnh chỉ còn nhạc nền' : '';
    return { tone, text: `${n} chữ ≈ ${Math.round(n / 4.6)}s / ${secs}s${note}` };
  }

  function renderGallery() {
    imagesGrid.innerHTML = images.map((img, i) => {
      const k = refs.indexOf(img);
      return `<div class="ladi-img-card${k >= 0 ? ' selected' : ''}" data-img-idx="${i}" title="${k >= 0 ? 'Bỏ chọn ảnh này' : 'Gửi kèm ảnh này'}">
        <img src="${escapeHtml(img)}" alt="Ảnh ${i + 1}" loading="lazy" onerror="this.style.display='none'; this.parentElement.classList.add('img-error');">
        <span class="ladi-img-badge">${k >= 0 ? k + 1 : ''}</span>
      </div>`;
    }).join('');
    $('res-img-count').textContent = images.length;
    updateSteps();
    updateSummary();
  }
  function toggleRef(img) {
    if (refs.includes(img)) refs = refs.filter(x => x !== img);
    else if (refs.length >= REFS_MAX) return toast(`Chọn tối đa ${REFS_MAX} ảnh. Bỏ bớt 1 ảnh rồi chọn lại.`, 'warn');
    else refs.push(img);
    renderGallery();
  }
  imagesGrid.addEventListener('click', e => {
    const card = e.target.closest('[data-img-idx]');
    if (card) toggleRef(images[Number(card.dataset.imgIdx)]);
  });
  $('btn-upload-custom-ladi-img').addEventListener('click', async () => {
    const res = await api.selectImageFile(false);
    if (!res?.dataUrl) return;
    images.unshift(res.dataUrl);
    toggleRef(res.dataUrl);
  });

  // reuse: chỉ sinh lại kịch bản từ trang đã quét (khi đổi tuỳ chọn), không tải lại trang
  async function scrape(reuse) {
    const url = inputUrl.value.trim();
    if (!/^https?:\/\//.test(url)) return toast('Link LadiPage chưa hợp lệ (phải bắt đầu bằng https://).', 'warn');
    btnScrape.disabled = true;
    $('ladi-loading').hidden = false;
    $('ladi-skeleton').hidden = false;
    $('ladi-results').hidden = true;
    try {
      const lay = layout();
      const res = await api.scrapeAndAnalyzeLadi(url, { noPrice: noPriceEl.checked, reuse, ...lay });
      if (!res?.success) throw new Error(res?.error || 'Không thể lấy dữ liệu từ đường link này');
      const keep = reuse && data ? { idx: selected, refs, imgs: images, picked } : null;
      data = res.data;
      genLayout = JSON.stringify(lay);
      renderResults();
      if (keep) { // sinh lại: giữ ảnh đã chọn và kịch bản đang xem
        refs = keep.refs;
        images = keep.imgs;
        setPicked(keep.picked);
        (scriptTabs.querySelector(`[data-script-idx="${keep.idx}"]`) || scriptTabs.querySelector('[data-script-idx]')).click();
      }
    } catch (err) {
      toast('Lỗi khi phân tích LadiPage: ' + err.message, 'danger');
      if (data) $('ladi-results').hidden = false;
    } finally {
      btnScrape.disabled = false;
      $('ladi-loading').hidden = true;
      $('ladi-skeleton').hidden = true;
    }
  }
  btnScrape.addEventListener('click', () => scrape(false));
  inputUrl.addEventListener('keydown', e => { if (e.key === 'Enter') scrape(false); });
  noPriceEl.addEventListener('change', () => { if (data) scrape(true); });

  function renderResults() {
    const facts = data.facts || {};
    $('ladi-results').hidden = false;
    $('res-product-name').textContent = facts.name || data.productName;
    $('res-product-facts').innerHTML = [
      facts.price && `<span class="fact-chip price">${escapeHtml(facts.price)}</span>`,
      facts.original && `<span class="fact-chip">Giá gốc ${escapeHtml(facts.original)}</span>`,
      facts.discount && `<span class="fact-chip">-${facts.discount}%</span>`,
      ...(facts.offers || []).map(o => `<span class="fact-chip">${escapeHtml(o)}</span>`),
      facts.season && `<span class="fact-chip">Mùa: ${escapeHtml(facts.season)}</span>`
    ].filter(Boolean).join('') || '<span class="muted small">Không tìm thấy giá / ưu đãi trên trang.</span>';
    $('res-product-usp').textContent = facts.highlights?.length ? 'Điểm nổi bật: ' + facts.highlights.join(' · ') : '';
    $('res-product-raw').innerHTML = (data.rawLines || []).map(l => `<li>${escapeHtml(l)}</li>`).join('') || '<li>Không có</li>';

    images = [...(data.images || [])];
    refs = images.slice(0, 2); // 2 ảnh đầu thường là ảnh chính của trang
    btnImportAll.hidden = data.scripts.length < 2;
    scriptTabs.innerHTML = data.scripts.map((sc, i) =>
      `<span class="pick-chip"><input type="checkbox" data-pick="${i}" title="Tích để đưa vào hàng đợi"><button type="button" class="preset-chip${i ? '' : ' active'}" data-script-idx="${i}">#${i + 1} ${escapeHtml(sc.name)}</button></span>`).join('');
    selected = 0;
    setPicked(new Set([0]));
    renderScenes(data.scripts[0]);
  }

  // Tích nhiều kịch bản → mỗi kịch bản thành 1 video, hàng đợi làm lần lượt
  function setPicked(set) {
    const n = data.scripts.length;
    picked = new Set([...set].filter(i => i < n));
    scriptTabs.querySelectorAll('[data-pick]').forEach(cb => { cb.checked = picked.has(Number(cb.dataset.pick)); });
    btnImport.disabled = !picked.size;
    btnImport.textContent = picked.size ? `Đưa ${picked.size} kịch bản đã tích vào hàng đợi` : 'Tích ít nhất 1 kịch bản';
    btnImportAll.textContent = picked.size === n ? 'Bỏ tích hết' : `Tích cả ${n}`;
  }
  scriptTabs.addEventListener('change', e => {
    const i = Number(e.target.dataset.pick);
    if (!data || Number.isNaN(i)) return;
    const next = new Set(picked);
    if (e.target.checked) next.add(i); else next.delete(i);
    setPicked(next);
  });
  scriptTabs.addEventListener('click', e => {
    const btn = e.target.closest('[data-script-idx]');
    if (!btn || !data) return;
    scriptTabs.querySelectorAll('.preset-chip').forEach(b => b.classList.toggle('active', b === btn));
    selected = Number(btn.dataset.scriptIdx);
    renderScenes(currentScript());
  });

  function renderScenes(script) {
    if (!script) return;
    scenesBox.innerHTML = script.scenes.map(s => {
      const wc = wordCount(s.voiceover);
      return `
        <div class="scene-card">
          <div class="row-between"><strong>${escapeHtml(s.time)}</strong><span class="muted small">Cảnh ${s.index}</span></div>
          ${script.silent ? '<div class="muted small">Không lời — chỉ nhạc nền (bỏ qua giọng và người dẫn đã chọn)</div>' : `
          <label class="label">Lời đọc (giọng chọn ở phần cài đặt bên dưới, không hiện chữ trên video)</label>
          <textarea class="textarea" rows="3" data-scene="${s.index}" data-field="voiceover">${escapeHtml(s.voiceover || '')}</textarea>
          <div class="word-count" data-wc="${s.index}" data-tone="${wc.tone}">${escapeHtml(wc.text)}</div>`}
          <label class="label">Hình ảnh (mô tả cho Muse dựng)</label>
          <textarea class="textarea" rows="3" data-scene="${s.index}" data-field="musePrompt">${escapeHtml(s.musePrompt || '')}</textarea>
        </div>`;
    }).join('');
    renderGallery();
  }

  // Sửa lời / prompt ghi thẳng vào kịch bản → đổi tab kịch bản hay đổi ảnh không mất chữ đã sửa
  scenesBox.addEventListener('input', e => {
    const field = e.target.dataset.field;
    if (!field || !data) return;
    const scene = currentScript().scenes.find(sc => String(sc.index) === e.target.dataset.scene);
    if (!scene) return;
    scene[field] = e.target.value;
    if (field === 'voiceover') {
      const el = scenesBox.querySelector(`[data-wc="${scene.index}"]`);
      const wc = wordCount(scene.voiceover);
      el.dataset.tone = wc.tone;
      el.textContent = wc.text;
    }
    updateSummary();
  });

  // Kịch bản → video trong hàng đợi (theo "Số bản / video"). null nếu còn cảnh trống
  function jobsOf(script) {
    const items = itemsOf(script);
    if (items.some(it => !it.text)) { toast(`${script.name}: còn cảnh chưa có mô tả hình ảnh, điền vào rồi đưa vào hàng đợi.`, 'warn'); return null; }
    const cfg = cfgOf(script);
    const refIds = refs.map(poolAdd);
    const copies = copiesValue();
    return Array.from({ length: copies }, (_, c) => makeJob({
      title: `${items[0].product || items[0].text.slice(0, 40)} · ${script.name}${copies > 1 ? ` · bản ${c + 1}` : ''}`,
      cfg, refs: refIds, scenes: items.map(it => ({ ...it }))
    }));
  }
  btnImport.addEventListener('click', () => {
    if (!data || !picked.size) return;
    const list = [...picked].sort((a, b) => a - b).map(i => jobsOf(data.scripts[i]));
    if (list.some(l => !l)) return;
    addJobs(list.flat());
    goTab('tab-script');
  });
  btnImportAll.addEventListener('click', () => {
    if (!data) return;
    const n = data.scripts.length;
    setPicked(picked.size === n ? new Set() : new Set(data.scripts.map((_, i) => i)));
  });
})();
