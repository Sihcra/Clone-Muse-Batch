/**
 * KỊCH BẢN — soạn kịch bản nhiều cảnh (hoặc từ ảnh), xếp hàng video, storyboard, ghép cảnh, nhạc nền.
 * Mỗi video = 1 "job" ở renderer; job gửi 1 hoặc nhiều task sang main rồi chờ kết quả.
 * LadiPage (ladi.js) dùng chung hàng đợi và cài đặt này qua App.script.
 */
(function () {
  'use strict';
  const { api, $, escapeHtml, fileUrl, mmss, toast, remember } = window.App;

  const inputScripts = $('input-scripts');
  const queueList = $('queue-list');
  const queueNotice = $('queue-notice');
  const btnStartRender = $('btn-start-render');
  const btnStopRender = $('btn-stop-render');
  const paramPrefix = $('param-prefix');
  const paramRatio = $('param-ratio');
  const paramDuration = $('param-duration');
  const paramMerge = $('param-merge');
  const paramMusic = $('param-music');
  const paramVoice = $('param-voice');
  const paramBoard = $('param-board');
  const paramHost = $('param-host');
  const paramChar = $('param-char');
  const paramCopies = $('param-copies');
  const sharedParams = $('shared-params');

  paramVoice.value = 'Chipper Tambourine';
  remember(paramVoice, 'voice');
  remember(paramDuration, 'duration');
  remember(paramBoard, 'board');
  remember(paramHost, 'host');
  remember(paramRatio, 'ratio');
  remember(paramMerge, 'merge');
  remember(paramMusic, 'music');
  remember(paramPrefix, 'prefix');

  // Nhân vật dẫn: ảnh lấy từ Tư liệu lúc chạy (đổi ảnh nhân vật thì video sau dùng ảnh mới)
  let charRemembered = false;
  window.App.onStudio(d => {
    const v = paramChar.value;
    paramChar.innerHTML = '<option value="">Không dùng</option>' + d.characters.filter(c => c.images.length)
      .map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${c.images.length} ảnh)</option>`).join('');
    paramChar.value = v;
    if (!paramChar.value) paramChar.value = '';
    if (!charRemembered) { charRemembered = true; remember(paramChar, 'char'); }
  });

  // Storyboard = ảnh mở đầu từng cảnh của 1 lệnh gộp; chế độ từng cảnh mỗi cảnh 1 chat riêng nên không dùng được
  const syncBoard = () => { paramBoard.disabled = paramDuration.value === 'each'; };
  paramDuration.addEventListener('change', syncBoard);
  syncBoard();

  // 1 bộ cài đặt cho cả Kịch bản và LadiPage: chuyển khối cài đặt sang tab đang mở
  document.addEventListener('app:tab', e => { document.querySelector(`#${e.detail} [data-params-slot]`)?.appendChild(sharedParams); });

  // =========================================================================
  // SOẠN CẢNH — Kịch bản / Từ ảnh dùng chung 1 ô chữ
  // =========================================================================
  const PLACEHOLDER = {
    script: 'VD:\n0-10s: Cô gái Việt giơ hộp giữa kho hàng đầy ắp, cận cảnh lung linh đèn Noel\n10-20s: Cả gia đình quây quần mở quà hộp lịch Giáng Sinh',
    image: 'Mô tả chuyển động cho ảnh, mỗi dòng 1 cảnh. Để trống = dùng gợi ý mặc định.\nVD: Cận cảnh zoom từ từ vào sản phẩm, ánh sáng studio lung linh'
  };
  const DEFAULT_MOTION = 'Sản phẩm chuyển động cinematic đẹp mắt';
  let composeMode = 'script';
  const segBtns = document.querySelectorAll('#tab-script .compose-modes .seg-btn');
  function setComposeMode(mode) {
    composeMode = mode;
    segBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    document.querySelectorAll('[data-mode-only]').forEach(el => { el.hidden = el.dataset.modeOnly !== mode; });
    inputScripts.placeholder = PLACEHOLDER[mode];
    syncImageRow();
  }
  segBtns.forEach(b => b.addEventListener('click', () => setComposeMode(b.dataset.mode)));

  const motionChips = document.querySelectorAll('.preset-chip[data-motion]');
  motionChips.forEach(chipEl => chipEl.addEventListener('click', () => {
    motionChips.forEach(c => c.classList.toggle('active', c === chipEl));
    inputScripts.value = chipEl.dataset.motion;
    updateComposeSummary();
  }));

  // Kho ảnh dùng chung cho hàng đợi: id → dataUrl/URL. Job chỉ giữ id → 20 bản cùng 1 ảnh không nhân 20 lần dữ liệu.
  let imagePool = {};
  function poolAdd(src) {
    if (!src) return '';
    const hit = Object.keys(imagePool).find(id => imagePool[id] === src);
    if (hit) return hit;
    const id = 'img' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    imagePool[id] = src;
    return id;
  }

  const deckCommonImage = $('deck-common-image');
  const composeImagesBox = $('compose-images');
  const composeSummary = $('compose-summary');
  const btnAddToQueue = $('btn-add-to-queue');
  let composeImages = []; // [{ id, name }]

  function syncImageRow() {
    const n = composeImages.length;
    $('common-img-title').textContent = n ? `${n} ảnh sản phẩm${n > 1 ? ' · mỗi ảnh 1 bộ video' : ''}`
      : composeMode === 'image' ? 'Ảnh sản phẩm (bắt buộc)' : 'Ảnh sản phẩm (tuỳ chọn)';
    composeImagesBox.hidden = !n;
    $('btn-remove-common-img').hidden = !n;
    composeImagesBox.innerHTML = composeImages.map((img, k) => `
      <div class="thumb-wrap" title="${escapeHtml(img.name)}">
        <img src="${escapeHtml(imagePool[img.id])}" class="queue-item-thumb" alt="">
        <button type="button" class="thumb-x" data-img-k="${k}" title="Bỏ ảnh này">✕</button>
      </div>`).join('');
    updateComposeSummary();
  }
  function addComposeImages(files) {
    files.forEach(f => {
      const id = poolAdd(f.dataUrl);
      if (!composeImages.some(img => img.id === id)) composeImages.push({ id, name: f.filename });
    });
    syncImageRow();
  }
  $('btn-pick-common-img').addEventListener('click', async () => addComposeImages((await api.selectImageFile(true)) || []));
  $('btn-remove-common-img').addEventListener('click', () => { composeImages = []; syncImageRow(); });
  composeImagesBox.addEventListener('click', e => {
    const k = e.target.closest('[data-img-k]')?.dataset.imgK;
    if (k === undefined) return;
    composeImages.splice(Number(k), 1);
    syncImageRow();
  });
  deckCommonImage.addEventListener('dragover', () => deckCommonImage.classList.add('dragover'));
  deckCommonImage.addEventListener('dragleave', () => deckCommonImage.classList.remove('dragover'));
  deckCommonImage.addEventListener('drop', async e => {
    deckCommonImage.classList.remove('dragover');
    const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith('image/'));
    if (!files.length) return toast('Chỉ nhận file ảnh (JPG, PNG, WebP).', 'warn');
    addComposeImages(await Promise.all(files.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve({ dataUrl: reader.result, filename: file.name });
      reader.readAsDataURL(file);
    }))));
  });

  // "__self" = nhân vật trong video tự nói tiếng Việt (khớp môi), không lồng giọng TTS
  const SELF_VOICE = '__self';
  // Giới tính người dẫn: chọn tay, hoặc theo nhãn giọng đọc ("— Nam ·" / "— Nữ ·")
  const voiceGender = () => (/— (Nam|Nữ) ·/.exec(paramVoice.selectedOptions[0]?.textContent || '')?.[1] || '').toLowerCase();
  const hostOf = () => paramHost.value || voiceGender();
  paramHost.addEventListener('change', () => {
    const g = paramHost.value;
    const v = voiceGender();
    if (!g || !v || g === v) return;
    const opt = [...paramVoice.options].find(o => o.textContent.includes(`— ${g === 'nam' ? 'Nam' : 'Nữ'} ·`));
    if (!opt) return;
    paramVoice.value = opt.value;
    paramVoice.dispatchEvent(new Event('change'));
    toast(`Đổi giọng đọc sang ${opt.value} (${g}) cho khớp người dẫn.`);
  });
  paramVoice.addEventListener('change', () => {
    const v = voiceGender();
    if (v && paramHost.value && paramHost.value !== v) { paramHost.value = ''; paramHost.dispatchEvent(new Event('change')); }
  });

  // Cài đặt lúc bấm "Đưa vào hàng đợi" chụp vào từng video → đổi cài đặt sau không ảnh hưởng video đã xếp
  const currentCfg = () => ({
    prefix: paramPrefix.value, ratio: paramRatio.value, duration: paramDuration.value,
    voice: paramVoice.value, host: hostOf(), char: paramChar.value, merge: paramMerge.checked, music: paramMusic.checked,
    board: paramDuration.value === 'each' ? '' : paramBoard.value
  });
  const SCENE_SECS = 10;
  const cfgSecs = cfg => (cfg.duration === 'each' ? SCENE_SECS : parseInt(cfg.duration, 10) || SCENE_SECS);
  // Ước lượng thô: 1 cảnh 10s ≈ 2,3 phút; lệnh gộp ≈ 1 phút + 0,13 phút/giây video; storyboard thêm ~3 phút
  const estMin = (cfg, nScenes) => (cfg.duration === 'each' ? nScenes * 2.3 : 1 + cfgSecs(cfg) * 0.13 + (cfg.board ? 3 : 0));

  // Ô chữ: đoạn cách nhau 1 dòng trống = 1 video; mỗi dòng trong đoạn = 1 cảnh
  function composeBlocks() {
    const blocks = inputScripts.value.split(/\n\s*\n/)
      .map(b => b.split('\n').map(l => l.trim()).filter(l => l.length > 2))
      .filter(b => b.length);
    if (composeMode === 'image' && !blocks.length) blocks.push([DEFAULT_MOTION]);
    return blocks;
  }
  const copiesValue = () => Math.min(Math.max(parseInt(paramCopies.value, 10) || 1, 1), 20);

  function updateComposeSummary() {
    const blocks = composeBlocks();
    const imgs = Math.max(composeImages.length, 1);
    const n = blocks.length * imgs * copiesValue();
    if (!blocks.length) { composeSummary.textContent = ''; btnAddToQueue.textContent = 'Đưa vào hàng đợi'; return; }
    const cfg = currentCfg();
    const mins = Math.round(blocks.reduce((s, b) => s + estMin(cfg, b.length), 0) * imgs * copiesValue());
    composeSummary.textContent = `${blocks.length} kịch bản × ${imgs} ảnh × ${copiesValue()} bản = ${n} video · ước tính ~${mins >= 90 ? `${(mins / 60).toFixed(1)} giờ` : `${mins} phút`} (làm lần lượt)`;
    btnAddToQueue.textContent = `Đưa ${n} video vào hàng đợi`;
  }
  [inputScripts, paramCopies].forEach(el => el.addEventListener('input', updateComposeSummary));
  [paramDuration, paramCopies, paramBoard].forEach(el => el.addEventListener('change', updateComposeSummary));

  // Gõ "@" trong ô kịch bản: dropdown dưới ô liệt kê nhân vật dẫn (cùng nguồn với "Nhân vật dẫn"), chọn để chèn @tên tại con trỏ
  const atPop = $('input-at');
  let atState = null; // { start, items, idx }
  const leadChars = () => (window.App.studioData()?.characters || []).filter(c => c.images.length);
  function closeAt() { atState = null; atPop.hidden = true; }
  function renderAt() {
    atPop.hidden = !atState.items.length;
    atPop.innerHTML = atState.items.map((c, i) => `<button type="button" class="at-opt${i === atState.idx ? ' active' : ''}" data-i="${i}" role="option">${escapeHtml(c.name)}<span class="muted small">${c.images.length} ảnh</span></button>`).join('');
  }
  function openAt() {
    const at = window.Compose.atQuery(inputScripts.value, inputScripts.selectionStart);
    if (!at) return closeAt();
    const q = at.query.trim().toLowerCase();
    atState = { start: at.start, items: leadChars().filter(c => c.name.toLowerCase().includes(q)), idx: 0 };
    renderAt();
  }
  function pickAt(i) {
    const tag = `@${atState.items[i].name} `;
    const caret = inputScripts.selectionStart;
    inputScripts.value = inputScripts.value.slice(0, atState.start) + tag + inputScripts.value.slice(caret);
    inputScripts.setSelectionRange(atState.start + tag.length, atState.start + tag.length);
    closeAt();
    updateComposeSummary();
  }
  inputScripts.addEventListener('input', openAt);
  inputScripts.addEventListener('blur', closeAt);
  inputScripts.addEventListener('keydown', e => {
    if (!atState || atPop.hidden) return;
    const n = atState.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); atState.idx = (atState.idx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; renderAt(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickAt(atState.idx); }
    else if (e.key === 'Escape') { e.preventDefault(); closeAt(); }
  });
  // mousedown thay vì click: chọn xong không làm ô kịch bản mất focus
  atPop.addEventListener('mousedown', e => {
    const opt = e.target.closest('.at-opt');
    if (!opt) return;
    e.preventDefault();
    pickAt(+opt.dataset.i);
  });

  btnAddToQueue.addEventListener('click', () => {
    const blocks = composeBlocks();
    if (composeMode === 'image' && !composeImages.length) return toast('Chế độ Từ ảnh cần ít nhất 1 ảnh sản phẩm.', 'warn');
    if (!blocks.length) return toast('Hãy nhập ít nhất 1 cảnh, mỗi dòng một cảnh.', 'warn');
    const imgs = composeImages.length ? composeImages : [null];
    const copies = copiesValue();
    const total = blocks.length * imgs.length * copies;
    if (total > 30 && !confirm(`Sẽ xếp ${total} video vào hàng đợi, mỗi video tốn 1 lượt Muse. Tiếp tục?`)) return;
    const cfg = currentCfg();
    const newJobs = [];
    imgs.forEach((img, i) => blocks.forEach((lines, b) => {
      for (let c = 1; c <= copies; c++) {
        const tags = [blocks.length > 1 && `kịch bản ${b + 1}`, imgs.length > 1 && `ảnh ${i + 1}`, copies > 1 && `bản ${c}`].filter(Boolean);
        newJobs.push(makeJob({
          title: lines[0].slice(0, 50) + (tags.length ? ` · ${tags.join(' · ')}` : ''),
          cfg,
          scenes: lines.map(text => ({ text: composeMode === 'image' ? `Từ ảnh sản phẩm đính kèm: ${text}` : text, img: img?.id || '' }))
        }));
      }
    }));
    addJobs(newJobs);
    inputScripts.value = '';
    motionChips.forEach(c => c.classList.remove('active'));
    updateComposeSummary();
  });

  setComposeMode('script');

  // =========================================================================
  // HÀNG ĐỢI VIDEO
  // job: { id, title, cfg, scenes:[{ text, voiceover, product, img }], refs[], status, step, part, since, error,
  //        taskId, taskPart, videos[], video, board[], thread, threadAcc, approved, withMusic }
  // Lỗi không tự chạy lại (mỗi lần thử = 1 lượt Muse); bấm "Thử lại" từng video.
  // =========================================================================
  let jobs = [];
  const isPending = j => j.status === 'queued' || j.status === 'stopped';

  function makeJob({ title, cfg, scenes, refs = [] }) {
    return {
      id: 'job' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title, cfg, scenes, refs, status: 'queued', step: '', part: '', since: 0, error: '', taskId: '', taskPart: 0,
      videos: [], video: '', board: [], thread: '', threadAcc: '', approved: false, withMusic: ''
    };
  }

  function addJobs(list) {
    // Lô trước đã xong hết → bắt đầu lô mới thay vì nối vào
    if (!running && jobs.length && jobs.every(j => j.status === 'done')) jobs = [];
    jobs.push(...list);
    renderQueue();
    toast(`Đã thêm ${list.length} video vào hàng đợi.`, 'ok');
    failStreak = 0;
    showNotice('');
    runQueue();
  }

  // Lưu hàng đợi ra file (main) để tắt app không mất lô đang làm
  let saveTimer = null;
  let queueLoaded = false; // chưa đọc xong file thì không ghi (tránh đè hàng đợi cũ bằng rỗng)
  function saveQueue() {
    if (!api?.queueSave || !queueLoaded) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const used = new Set(jobs.flatMap(j => j.scenes.map(s => s.img).concat(j.refs || [])).concat(composeImages.map(i => i.id)));
      Object.keys(imagePool).forEach(id => { if (!used.has(id)) delete imagePool[id]; });
      api.queueSave({ jobs, imagePool });
    }, 500);
  }

  async function loadQueue() {
    const saved = api?.queueLoad && await api.queueLoad().catch(e => ({ error: e.message }));
    if (saved?.error) return toast(`Không đọc được hàng đợi đã lưu (${saved.error}). Tạm không lưu để khỏi ghi đè.`, 'danger');
    queueLoaded = true;
    if (!saved?.jobs?.length) return renderQueue();
    imagePool = { ...saved.imagePool, ...imagePool };
    jobs = saved.jobs.concat(jobs);
    const { tasks: all } = await api.listTasks().catch(() => ({ tasks: [] }));
    for (const j of saved.jobs) {
      if (j.status !== 'running') continue;
      // Đang làm dở khi tắt app: task đã xong thì nhận kết quả; chưa gửi Muse thì huỷ để không chạy ngầm.
      // Đã gửi Muse (đã tốn lượt) thì để Muse làm nốt, file tự tải về thư mục lưu.
      const t = all.find(x => x.id === j.taskId);
      const sent = t?.status === 'processing' && t.sessionId;
      if (t?.status === 'succeeded' && t.kind === 'image') Object.assign(j, { board: t.files, thread: t.thread || '', threadAcc: t.accountId || '' });
      else if (t?.status === 'succeeded') j.videos[j.taskPart] = t.files[0];
      else if (j.taskId && !sent) api.cancelTask(j.taskId);
      Object.assign(j, {
        status: 'stopped', taskId: '', step: '',
        error: sent ? 'Tắt app khi Muse đang làm: Muse vẫn làm nốt, file tự tải về thư mục lưu (xem ở Studio)' : j.error
      });
    }
    renderQueue();
  }

  const QUEUE_STATUS = {
    queued: ['info', 'Chờ'], running: ['live', 'Đang làm'], done: ['ok', 'Xong'],
    error: ['danger', 'Lỗi'], stopped: ['muted', 'Đã dừng'], review: ['warn', 'Chờ duyệt storyboard']
  };
  const stChip = status => {
    const [tone, text] = QUEUE_STATUS[status] || QUEUE_STATUS.queued;
    return `<span class="st-chip" data-tone="${tone}"><span class="st-dot"></span>${text}</span>`;
  };

  // Ảnh nhân vật dẫn gắn SAU ảnh sản phẩm/cảnh → số "dùng ảnh k" của cảnh không đổi
  const CHAR_IMGS = 4;
  const charOf = cfg => (cfg.char && window.App.studioData()?.characters.find(c => c.id === cfg.char)) || null;
  const charImgs = cfg => (charOf(cfg)?.images || []).slice(0, CHAR_IMGS);
  const hostLine = cfg => {
    const c = charOf(cfg);
    const n = charImgs(cfg).length;
    const sex = cfg.host ? `1 ${cfg.host === 'nữ' ? 'phụ nữ' : 'người đàn ông'} Việt Nam (giới tính ${cfg.host})` : '';
    if (c && n) return `Người dẫn: ${c.name}${sex ? `, ${sex}` : ''} — đúng người trong ${n > 1 ? `${n} ảnh cuối` : 'ảnh cuối'} đính kèm, giữ nguyên gương mặt, kiểu tóc, vóc dáng; cùng một người xuyên suốt`;
    return sex ? `Người dẫn: ${sex}, cùng một người xuyên suốt` : '';
  };
  // Đọc tự nhiên; lời ngắn hơn cảnh thì để nhạc nền, không kéo giãn giọng cho đủ thời lượng
  const PACE = 'Đọc tốc độ tự nhiên như người thật nói chuyện (khoảng 4–5 chữ mỗi giây), không kéo giãn chữ, không ngắt nghỉ dài giữa câu; lời ngắn hơn cảnh thì phần còn lại để nhạc nền hoặc tiếng động nhẹ, không kéo dài giọng cho đủ thời lượng.';
  const voiceText = v => (v === SELF_VOICE ? 'Nhân vật tự nói' : v ? `Giọng ${v}` : 'Không lồng tiếng');
  const cfgText = (cfg, n) => [
    `${n} cảnh`,
    cfg.duration === 'each' ? `từng cảnh ${SCENE_SECS}s${cfg.merge && n > 1 ? ', tự ghép' : ''}` : `${cfgSecs(cfg)}s gộp 1 lệnh`,
    cfg.ratio, voiceText(cfg.voice).toLowerCase(), cfg.host && `người dẫn ${cfg.host}`, charOf(cfg) && `dẫn: ${charOf(cfg).name}`,
    cfg.board && (cfg.board === 'review' ? 'storyboard, chờ duyệt' : 'storyboard'), cfg.music && 'nhạc nền ngẫu nhiên'
  ].filter(Boolean).join(' · ');
  const stepText = j => [j.part, j.step].filter(Boolean).join(' · ');

  function progressText() {
    const total = jobs.length;
    const done = jobs.filter(j => j.status === 'done').length;
    const err = jobs.filter(j => j.status === 'error').length;
    if (running) return `Đang làm ${running} video · ${done}/${total} xong${err ? ` · ${err} lỗi` : ''} · ${mmss(Date.now() - runStartedAt)}`;
    return total ? `${done}/${total} video xong${err ? ` · ${err} lỗi` : ''}` : 'Chưa chạy';
  }

  const queueWrap = $('queue-wrap');
  const queuePreview = $('queue-preview');
  const queueFilters = $('queue-filters');
  const btnRemoveChecked = $('btn-remove-checked');
  const FILTERS = [
    ['all', 'Tất cả', () => true],
    ['queued', 'Chờ', j => j.status === 'queued' || j.status === 'stopped'],
    ['running', 'Đang làm', j => j.status === 'running'],
    ['review', 'Chờ duyệt', j => j.status === 'review'],
    ['done', 'Xong', j => j.status === 'done'],
    ['error', 'Lỗi', j => j.status === 'error']
  ];
  let queueFilter = 'all';
  let selectedId = '';
  let previewSig = null;
  const checked = new Set();

  const jobThumb = (j, idx) => {
    const imgId = j.refs?.[0] || j.scenes.find(s => s.img)?.img;
    if (imgId) return `<img src="${escapeHtml(imagePool[imgId] || '')}" class="queue-item-thumb" alt="" onerror="this.style.opacity='0.3'">`;
    if (j.board?.[0]) return `<img src="${escapeHtml(fileUrl(j.board[0]))}" class="queue-item-thumb" alt="">`;
    return `<div class="job-no">${idx + 1}</div>`;
  };
  const timerHtml = j => (j.status === 'running' ? `<span class="muted small timer" data-since="${j.since}">${mmss(Date.now() - j.since)}</span>` : '');
  const iconBtn = (act, j, title, icon, cls = 'btn-ghost') =>
    `<button type="button" class="${cls} btn-icon" data-act="${act}" data-job="${j.id}" ${act === 'reveal' ? `data-path="${escapeHtml(j.video)}"` : ''} title="${title}" aria-label="${title}">${icon}</button>`;

  function renderQueue() {
    $('count-queue').textContent = jobs.length;
    $('queue-progress').textContent = progressText();
    saveQueue();
    for (const id of checked) if (!jobs.some(j => j.id === id)) checked.delete(id);
    if (!jobs.some(j => j.id === selectedId)) selectedId = (jobs.find(j => j.status === 'running') || jobs[0])?.id || '';

    queueFilters.innerHTML = FILTERS.map(([key, label, fn]) => {
      const n = jobs.filter(fn).length;
      return key === 'review' && !n ? '' : `<button type="button" class="filter-tab${queueFilter === key ? ' active' : ''}" data-filter="${key}">${label} <span>${n}</span></button>`;
    }).join('');
    btnRemoveChecked.textContent = `Xoá đã chọn (${checked.size})`;
    btnRemoveChecked.disabled = !checked.size;

    const show = FILTERS.find(f => f[0] === queueFilter)[2];
    const rows = jobs.map((j, idx) => [j, idx]).filter(([j]) => show(j));
    queueList.innerHTML = !jobs.length
      ? '<div class="queue-empty"><strong>Chưa có video nào</strong>Soạn kịch bản ở trên rồi bấm "Đưa vào hàng đợi".</div>'
      : !rows.length ? '<div class="queue-empty">Không có video nào ở mục này.</div>'
      : rows.map(([j, idx]) => {
        const sub = j.status === 'running' ? `<div class="job-step" data-step="${j.id}">${escapeHtml(stepText(j))}</div>`
          : j.status === 'error' || (j.error && j.status === 'stopped') ? `<div class="queue-err">${escapeHtml(j.error)}</div>`
          : `<div class="muted small ellipsis">${escapeHtml(cfgText(j.cfg, j.scenes.length))}</div>`;
        const acts = [
          j.status === 'review' && iconBtn('approve', j, 'Duyệt storyboard, làm video', '✓', 'btn'),
          (j.status === 'error' || j.status === 'stopped') && iconBtn('retry', j, j.status === 'error' ? 'Thử lại' : 'Chạy tiếp', '↻'),
          j.video && iconBtn('reveal', j, 'Mở thư mục', '📂'),
          j.status !== 'running' && iconBtn('remove', j, 'Bỏ khỏi hàng đợi', '✕', 'btn-danger')
        ].filter(Boolean).join('');
        return `
          <div class="q-row${j.id === selectedId ? ' selected' : ''}" data-act="select" data-job="${j.id}">
            <input type="checkbox" data-act="check" data-job="${j.id}" ${checked.has(j.id) ? 'checked' : ''} ${j.status === 'running' ? 'disabled' : ''} aria-label="Chọn video ${idx + 1}">
            <span class="muted small">${idx + 1}</span>
            ${jobThumb(j, idx)}
            <div class="q-main">
              <strong class="job-title" title="${escapeHtml(j.title)}">${escapeHtml(j.title)}</strong>
              ${sub}
            </div>
            <span class="row q-status">${timerHtml(j)}${stChip(j.status)}</span>
            <span class="row q-acts">${acts}</span>
          </div>`;
      }).join('');
    renderPreview();
  }

  // Chỉ vẽ lại khung xem trước khi job đang chọn đổi trạng thái/kết quả (video đang xem không bị tải lại)
  function renderPreview() {
    const j = jobs.find(x => x.id === selectedId);
    const sig = j ? JSON.stringify([j.id, j.status, j.video, j.board, j.videos, j.error]) : '';
    if (sig === previewSig) return;
    previewSig = sig;
    if (!j) { queuePreview.innerHTML = '<div class="preview-empty">Chọn 1 video trong danh sách để xem trước và chi tiết.</div>'; return; }
    const cfg = j.cfg;
    const hasBoard = j.board?.length > 0;
    const media = j.video
      ? `<video class="queue-video" src="${escapeHtml(fileUrl(j.video))}" controls preload="metadata"></video>`
      : `<div class="preview-empty">${j.status === 'running' ? `<span class="job-step" data-step="${j.id}">${escapeHtml(stepText(j))}</span>${timerHtml(j)}`
        : j.status === 'error' ? 'Video lỗi, chưa có kết quả.' : 'Video sẽ hiện ở đây khi làm xong.'}</div>`;
    const details = [
      ['Cách làm', cfg.board === 'review' ? 'Storyboard, chờ duyệt' : cfg.board ? 'Storyboard → video' : 'Làm thẳng'],
      ['Tỉ lệ', cfg.ratio],
      ['Thời lượng', cfg.duration === 'each' ? `Từng cảnh ${SCENE_SECS}s${cfg.merge && j.scenes.length > 1 ? ' · tự ghép' : ''}` : `${cfgSecs(cfg)}s · gộp 1 lệnh`],
      ['Giọng đọc', voiceText(cfg.voice)],
      ['Số cảnh', j.scenes.length]
    ];
    const doneVideos = j.videos.filter(Boolean);
    const acts = [
      j.status === 'review' && `<button type="button" class="btn btn-sm" data-act="approve" data-job="${j.id}">Duyệt, làm video</button>`,
      (j.status === 'error' || j.status === 'stopped') && `<button type="button" class="btn btn-sm" data-act="retry" data-job="${j.id}">${j.status === 'error' ? 'Thử lại' : 'Chạy tiếp'}</button>`,
      hasBoard && !j.video && j.status !== 'running' && `<button type="button" class="btn-ghost btn-sm" data-act="reboard" data-job="${j.id}">Vẽ lại storyboard</button>`,
      j.video && `<button type="button" class="btn-ghost btn-sm" data-act="reveal" data-path="${escapeHtml(j.video)}">Mở thư mục</button>`,
      j.status !== 'running' && `<button type="button" class="btn-danger btn-sm" data-act="remove" data-job="${j.id}">Bỏ</button>`
    ].filter(Boolean).join('');
    queuePreview.innerHTML = `
      <div class="row-between"><strong>Xem trước & chi tiết</strong>${stChip(j.status)}</div>
      ${media}
      <strong class="job-title" title="${escapeHtml(j.title)}">#${jobs.indexOf(j) + 1} ${escapeHtml(j.title)}</strong>
      ${j.status === 'error' || (j.error && j.status === 'stopped') ? `<div class="queue-err">${escapeHtml(j.error)}</div>` : ''}
      ${hasBoard ? `<div class="img-strip board-strip" title="Storyboard: ảnh mở đầu từng cảnh · bấm để xem lớn">${j.board.map(f => `<img src="${escapeHtml(fileUrl(f))}" class="queue-item-thumb" alt="" data-act="zoom" data-path="${escapeHtml(f)}">`).join('')}</div>` : ''}
      <dl class="preview-details">${details.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl>
      ${doneVideos.length && !j.video ? `<div class="queue-item-actions">${doneVideos.map((v, k) => `<button type="button" class="btn-ghost btn-sm" data-act="reveal" data-path="${escapeHtml(v)}">Cảnh ${k + 1}</button>`).join('')}</div>` : ''}
      <details class="job-scenes"><summary>Xem ${j.scenes.length} cảnh</summary>
        ${j.scenes.map((s, k) => `<p><b>Cảnh ${k + 1}:</b> ${escapeHtml(s.text)}${s.voiceover ? `<br><i>Lời: ${escapeHtml(s.voiceover)}</i>` : ''}</p>`).join('')}
      </details>
      ${acts ? `<div class="queue-item-actions">${acts}</div>` : ''}`;
  }

  queueWrap.addEventListener('click', e => {
    const tab = e.target.closest('[data-filter]');
    if (tab) { queueFilter = tab.dataset.filter; renderQueue(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const job = jobs.find(j => j.id === btn.dataset.job);
    switch (btn.dataset.act) {
      case 'select':
        selectedId = job.id;
        renderQueue();
        break;
      case 'check':
        if (btn.checked) checked.add(job.id); else checked.delete(job.id);
        renderQueue();
        break;
      case 'retry':
        Object.assign(job, { status: 'queued', error: '' });
        failStreak = 0;
        showNotice('');
        renderQueue();
        runQueue();
        break;
      case 'approve':
        Object.assign(job, { status: 'queued', approved: true });
        renderQueue();
        runQueue();
        break;
      case 'reboard': // tốn thêm 1 lượt vẽ ảnh
        Object.assign(job, { status: 'queued', board: [], thread: '', threadAcc: '', approved: false, error: '' });
        renderQueue();
        runQueue();
        break;
      case 'remove':
        jobs = jobs.filter(j => j !== job);
        renderQueue();
        break;
      case 'reveal':
        api.revealFile(btn.dataset.path);
        break;
      case 'zoom':
        window.App.openMediaPreview?.(btn.dataset.path, 'Storyboard', btn.dataset.path);
        break;
    }
  });

  $('btn-check-all').addEventListener('click', () => {
    const show = FILTERS.find(f => f[0] === queueFilter)[2];
    jobs.filter(j => show(j) && j.status !== 'running').forEach(j => checked.add(j.id));
    renderQueue();
  });
  $('btn-check-none').addEventListener('click', () => { checked.clear(); renderQueue(); });
  btnRemoveChecked.addEventListener('click', () => {
    if (!confirm(`Xoá ${checked.size} video đã chọn khỏi hàng đợi? Video đã tải về vẫn còn trong Thư viện.`)) return;
    jobs = jobs.filter(j => !checked.has(j.id) || j.status === 'running');
    checked.clear();
    renderQueue();
  });
  $('btn-queue-folder').addEventListener('click', () => api.openOutputFolder());
  $('btn-clear-queue').addEventListener('click', () => {
    if (running) return toast('Đang render. Bấm Dừng trước khi xoá hàng đợi.', 'warn');
    if (jobs.length && !confirm(`Xoá ${jobs.length} video khỏi hàng đợi? Video đã tải về vẫn còn trong Thư viện.`)) return;
    jobs = [];
    renderQueue();
  });
  $('btn-clear-done').addEventListener('click', () => { jobs = jobs.filter(j => j.status !== 'done'); renderQueue(); });

  // =========================================================================
  // LỆNH GỬI MUSE
  // =========================================================================
  // Ảnh khác nhau chỉ gắn 1 lần (anh_1, anh_2...), cảnh nào dùng ảnh nào thì ghi trong lệnh
  const uniqueImgs = (scenes, refs = []) => [...new Set(refs.concat(scenes.map(s => s.img)).filter(Boolean))];
  const taskImages = ids => ids.map(id => {
    const src = imagePool[id] || '';
    return src.startsWith('data:') ? { imageBase64: src, imageUrl: '' } : { imageBase64: '', imageUrl: src };
  });

  // Mỗi cảnh tách "Hình" (để dựng) và "Lời" (để lồng tiếng); không phụ đề
  function buildPrompt(items, cfg, refs = []) {
    const secs = cfgSecs(cfg);
    const voice = (cfg.voice || '').trim();
    const self = voice === SELF_VOICE;
    const prefix = (cfg.prefix || '').trim().replace(/[:.\s]+$/, '') || 'Tạo video chân thực';
    const n = items.length;
    const keys = uniqueImgs(items, refs);
    const product = items.find(it => it.product)?.product;
    const at = k => Math.round(k * secs / n);

    const head = `${prefix}. ${cfg.ratio ? `Tỉ lệ ${cfg.ratio}, ` : ''}${n > 1 ? `tổng ${secs}s, gồm ${n} cảnh` : `thời lượng ${secs}s`}${cfg.style ? `, phong cách ${cfg.style}` : ''}.`;
    const subject = [
      product ? `Sản phẩm: ${product}${keys.length ? ' (giống ảnh đính kèm)' : ''}.` : keys.length ? 'Giữ đúng chủ thể trong ảnh đính kèm.' : '',
      hostLine(cfg) && `${hostLine(cfg)}${cfg.host ? `; giọng nói/lồng tiếng cũng là giọng ${cfg.host}, khớp với người dẫn` : ''}.`
    ].filter(Boolean).join('\n');

    const scenes = items.map((it, k) => {
      const img = keys.length > 1 && it.img ? `, dùng ảnh ${keys.indexOf(it.img) + 1}` : '';
      const lines = [`Cảnh ${k + 1} (${at(k)}–${at(k + 1)}s${img})`, `Hình: ${it.text}`];
      if (voice) {
        lines.push(it.voiceover
          ? `${self ? 'Nhân vật nói vào máy' : 'Lời'}: "${it.voiceover}"`
          : `${self ? 'Nhân vật nói' : 'Lời'}: tự viết lời hợp cảnh, khoảng ${Math.round(secs / n * 4.4)} chữ để nói kín ${Math.round(secs / n)}s.`);
      }
      return lines.join('\n');
    });

    const tail = [
      self && `Âm thanh: Người dẫn trong video tự nói tiếng Việt${cfg.host ? ` bằng giọng ${cfg.host}` : ''} vào máy, khẩu hình khớp từng lời (lip-sync), giọng tự nhiên như người thật quay review, cùng một giọng xuyên suốt; cảnh không thấy mặt người nói thì vẫn giọng đó nói tiếp. Nói đúng và đủ lời từng cảnh, không cắt bớt. ${PACE} Giữ tiếng động thật nhỏ của cảnh phía sau, không nhạc to át giọng.`,
      voice && !self && `Âm thanh: Tắt tiếng gốc. Lồng tiếng tiếng Việt giọng "${voice}" đọc liền mạch cả video như một bài thuyết minh: đọc đúng và đủ lời từng cảnh, không cắt bớt hay rút gọn, chuyển cảnh thì nối giọng sang lời cảnh sau ngay. ${PACE}`,
      !voice && cfg.audio && `Âm thanh: ${cfg.audio}`,
      'Không chèn phụ đề, chữ hay logo lên video.',
      'Yêu cầu: video MỚI hoàn toàn, không gửi lại video cũ, làm ngay không hỏi lại.' + (n > 1 ? ' Tự ghép các cảnh thành 1 video, chỉ gửi 1 video cuối cùng.' : '')
    ].filter(Boolean).join('\n');

    return [[head, subject].filter(Boolean).join('\n'), ...scenes, tail].join('\n\n');
  }

  // Storyboard: Muse vẽ trước ảnh mở đầu từng cảnh rồi làm video tiếp trong cùng chat → người, bối cảnh, sản phẩm đồng nhất hơn
  const BOARD_MAX = 6;
  function buildBoardPrompt(items, cfg, refs = []) {
    const n = Math.min(items.length, BOARD_MAX);
    const product = items.find(it => it.product)?.product;
    return [
      `Tạo ${n} ảnh storyboard tỉ lệ ${cfg.ratio || '9:16'}, chân thực như ảnh chụp điện thoại, mỗi ảnh là khung hình mở đầu của 1 cảnh trong video ${cfgSecs(cfg)}s${cfg.style ? `, phong cách ${cfg.style}` : ''}.`,
      product && `Sản phẩm: ${product}.`,
      uniqueImgs(items, refs).length && 'Sản phẩm phải giữ ĐÚNG như ảnh đính kèm — không vẽ lại, không đổi chữ, màu hay chi tiết sản phẩm.',
      hostLine(cfg) ? `${hostLine(cfg)}, cùng trang phục, có mặt trong cả ${n} ảnh; cùng bối cảnh xuyên suốt ${n} ảnh.` : `Nếu có người thì cùng 1 người, cùng trang phục; cùng bối cảnh xuyên suốt ${n} ảnh.`,
      ...items.slice(0, n).map((it, k) => `Ảnh ${k + 1}: ${it.text}`),
      `Chỉ tạo ${n} ảnh, chưa làm video. Không chèn thêm chữ, phụ đề hay logo.`
    ].filter(Boolean).join('\n');
  }
  // Lệnh video sau khi có storyboard (ảnh storyboard gắn lại → bỏ "dùng ảnh k" của từng cảnh)
  const boardVideoPrompt = (items, cfg, m, inThread) =>
    `Dùng đúng ${m} ảnh storyboard ${inThread ? 'vừa tạo (gửi kèm lại)' : 'đính kèm'} làm khung hình mở đầu của ${m} cảnh, theo thứ tự ảnh 1 đến ${m}. Giữ nguyên người, trang phục, bối cảnh và sản phẩm như trong ảnh.\n\n`
    + buildPrompt(items.map(s => ({ ...s, img: '' })), cfg);

  // =========================================================================
  // VÒNG RENDER — chạy song song tới số luồng (tab Tài khoản); main chia task cho các tài khoản
  // Gộp 1 lệnh: cả video = 1 task. Từng cảnh: mỗi cảnh 1 task, đủ cảnh thì ghép.
  // 2 video lỗi liên tiếp → ngừng nhận video mới (thường là lỗi chung: hết lượt, bị đăng xuất...).
  // =========================================================================
  let runId = 0;
  let running = 0;
  let failStreak = 0;
  let runStartedAt = 0;
  let ticker = null;
  const taskWaiters = new Map(); // task id → resolve(task) khi task kết thúc
  const waitTask = id => new Promise(resolve => taskWaiters.set(id, resolve));

  function showNotice(text) {
    queueNotice.textContent = text;
    queueNotice.hidden = !text;
  }
  function tick() {
    $('queue-progress').textContent = progressText();
    queueWrap.querySelectorAll('[data-since]').forEach(el => { el.textContent = mmss(Date.now() - Number(el.dataset.since)); });
  }
  function syncRunning() {
    btnStopRender.disabled = !running;
    clearInterval(ticker);
    if (running) ticker = setInterval(tick, 1000);
    renderQueue();
  }

  // Bước Muse của task đang chạy → chỉ sửa dòng bước, không vẽ lại cả hàng đợi
  function onJobTaskStep(task) {
    const job = jobs.find(j => j.taskId === task.id);
    if (!job) return;
    job.step = task.status === 'queued' ? task.error || 'Chờ Muse rảnh' : task.step || job.step;
    queueWrap.querySelectorAll(`[data-step="${job.id}"]`).forEach(el => { el.textContent = stepText(job); });
  }

  // Làm 1 video từ đầu đến cuối. true = xong, false = lỗi/dừng, 'review' = dừng chờ duyệt storyboard
  async function runJob(job, alive) {
    const each = job.cfg.duration === 'each';
    const groups = each ? job.scenes.map(s => [s]) : [job.scenes];
    const timeoutMin = each ? 10 : 10 + Math.ceil(cfgSecs(job.cfg) / 3);
    Object.assign(job, { status: 'running', error: '', since: Date.now(), step: 'Chuẩn bị', part: '' });
    renderQueue();

    const fail = msg => { Object.assign(job, { status: 'error', error: msg, step: '', part: '' }); renderQueue(); return false; };
    const refs = job.refs || [];
    const hostImgs = charImgs(job.cfg).map(p => ({ imageLocalPath: p }));
    if (job.cfg.char && !hostImgs.length) return fail('Nhân vật dẫn không còn trong Tư liệu (hoặc hết ảnh). Thêm lại ảnh nhân vật rồi bấm Thử lại.');

    // Gửi task, chờ xong. null = đã bấm Dừng
    const runTask = async input => {
      const task = await api.submitTask(input);
      Object.assign(job, { taskId: task.id, step: 'Chờ Muse rảnh' });
      renderQueue();
      if (!alive()) { api.cancelTask(task.id); return null; }
      const done = await waitTask(task.id);
      job.taskId = '';
      return alive() ? done : null;
    };

    const board = Boolean(job.cfg.board) && !each;
    if (board && !job.board?.length) {
      job.part = 'Storyboard';
      const done = await runTask({
        kind: 'image', expect: Math.min(job.scenes.length, BOARD_MAX), timeoutMin: 10, ratio: job.cfg.ratio,
        prompt: buildBoardPrompt(job.scenes, job.cfg, refs),
        label: job.title + ' · storyboard',
        images: taskImages(uniqueImgs(job.scenes, refs)).concat(hostImgs)
      });
      if (!done) return false;
      if (done.status !== 'succeeded') return fail(done.error || 'Vẽ storyboard không thành công. Xem chi tiết ở Studio.');
      Object.assign(job, { board: done.files, thread: done.thread || '', threadAcc: done.accountId || '', approved: false });
    }
    if (board && job.cfg.board === 'review' && !job.approved) {
      Object.assign(job, { status: 'review', step: '', part: '' });
      renderQueue();
      return 'review';
    }

    for (let k = 0; k < groups.length; k++) {
      if (job.videos[k]) continue; // cảnh đã có video từ lần chạy trước
      job.part = each && groups.length > 1 ? `Cảnh ${k + 1}/${groups.length}` : '';
      job.taskPart = k;
      // Có storyboard: làm tiếp trong chat đã vẽ (cùng tài khoản), vẫn gắn lại ảnh storyboard
      const m = job.board?.length || 0;
      const useBoard = board && m;
      const done = await runTask({
        prompt: useBoard ? boardVideoPrompt(groups[k], job.cfg, m, job.thread) : buildPrompt(groups[k], job.cfg, refs),
        timeoutMin,
        ratio: job.cfg.ratio,
        thread: useBoard ? job.thread : '',
        account: useBoard ? job.threadAcc || '' : '',
        label: job.title + (job.part ? ` · ${job.part.toLowerCase()}` : ''),
        images: useBoard ? job.board.map(f => ({ imageLocalPath: f })) : taskImages(uniqueImgs(groups[k], refs)).concat(hostImgs)
      });
      if (!done) return false;
      if (done.status !== 'succeeded') return fail(done.error || 'Task không thành công. Xem chi tiết ở Studio.');
      if (done.threadError) toast(`${job.title}: ${done.threadError}`, 'warn');
      job.videos[k] = done.files[0];
      renderQueue();
    }

    if (groups.length > 1 && job.cfg.merge) {
      Object.assign(job, { part: '', step: 'Đang ghép các cảnh' });
      renderQueue();
      const merged = await api.mergeVideos(job.videos, job.title);
      if (!merged.success) return fail(`Đủ ${job.videos.length} cảnh nhưng ghép lỗi: ${merged.error}. Bấm "Thử lại" để ghép lại (không tốn lượt).`);
      job.video = merged.path;
    } else if (groups.length === 1) {
      job.video = job.videos[0];
    }
    if (job.cfg.music && job.video && !job.withMusic) {
      Object.assign(job, { part: '', step: 'Đang ghép nhạc nền' });
      renderQueue();
      const r = await api.addMusic(job.video);
      if (!r.success) return fail(`Video đã xong nhưng ghép nhạc lỗi: ${r.error}`);
      Object.assign(job, { video: r.path, withMusic: r.path });
    }
    Object.assign(job, { status: 'done', step: '', part: '' });
    renderQueue();
    return true;
  }

  // Nhận thêm video tới khi đủ số luồng. Gọi lại mỗi khi 1 video xong hoặc có video mới.
  async function runQueue() {
    if (failStreak >= 2) return;
    let limit = 1;
    try {
      const { accounts, settings } = await api.listAccounts();
      limit = Math.max(1, Math.min(settings.totalThreads || 1, settings.maxAccounts || 1, accounts.filter(a => a.enabled).length));
    } catch (e) {}
    const run = runId;
    while (running < limit && run === runId) {
      const job = jobs.find(isPending);
      if (!job) break;
      if (!running) runStartedAt = Date.now();
      running++;
      runOne(job, run);
    }
    syncRunning();
  }

  async function runOne(job, run) {
    let r = false;
    try {
      r = await runJob(job, () => run === runId);
    } catch (err) {
      Object.assign(job, { status: 'error', error: err.message, step: '', part: '' });
    } finally {
      if (run === runId) running--;
    }
    if (run !== runId) return; // bấm Dừng: nút Dừng đã dọn trạng thái
    if (r) failStreak = 0;
    else if (job.status === 'error') {
      toast(`Lỗi: ${job.title} — ${job.error}`, 'danger');
      if (++failStreak >= 2) showNotice('2 video lỗi liên tiếp nên đã ngừng nhận video mới để không tốn lượt. Xem lỗi, sửa rồi bấm Bắt đầu.');
    }
    if (!running && !jobs.some(isPending)) {
      const err = jobs.filter(j => j.status === 'error').length;
      const review = jobs.filter(j => j.status === 'review').length;
      toast(`Xong lô: ${jobs.filter(j => j.status === 'done').length} video${err ? `, ${err} lỗi` : ''}${review ? `, ${review} storyboard chờ duyệt` : ''}.`, err || review ? 'warn' : 'ok');
    }
    runQueue();
  }

  $('btn-music-folder').addEventListener('click', async () => {
    const n = await api.openMusicFolder();
    toast(n ? `Thư mục nhạc có ${n} bài, mỗi video bốc ngẫu nhiên 1 bài.` : 'Bỏ file nhạc (mp3, m4a, wav) vào thư mục vừa mở.', n ? 'ok' : 'warn');
  });
  btnStartRender.addEventListener('click', () => {
    if (!jobs.some(isPending)) return toast('Hàng đợi chưa có video nào cần làm.', 'warn');
    failStreak = 0;
    showNotice('');
    runQueue();
  });
  btnStopRender.addEventListener('click', () => {
    runId++;
    running = 0;
    jobs.forEach(j => {
      if (j.status !== 'running') return;
      if (j.taskId) api.cancelTask(j.taskId);
      Object.assign(j, { status: 'stopped', step: '', part: '', taskId: '' });
    });
    syncRunning();
  });

  if (api) {
    api.onTaskUpdate(({ task }) => {
      const resolve = taskWaiters.get(task.id);
      if (resolve && (task.removed || ['succeeded', 'failed', 'cancelled'].includes(task.status))) {
        taskWaiters.delete(task.id);
        resolve(task.removed ? { status: 'cancelled', error: 'Task đã bị xoá' } : task);
      }
      if (!task.removed) onJobTaskStep(task);
    });
  }

  window.App.script = { currentCfg, cfgText, estMin, copiesValue, poolAdd, makeJob, addJobs, buildPrompt, buildBoardPrompt, boardVideoPrompt, SCENE_SECS, BOARD_MAX };
  renderQueue();
  loadQueue();
})();
