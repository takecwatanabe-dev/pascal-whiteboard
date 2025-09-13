// Pascal Whiteboard (MVP) v0.4.0
// 追加: 手のひらパン / ピンチズーム / スワイプページ送り / ズームUIサイズ統一

window.addEventListener("DOMContentLoaded", () => {
  // 要素
  const fileInput    = document.getElementById("file-input");
  const pdfContainer = document.getElementById("pdf-container");
  const drawCanvas   = document.getElementById("draw-layer");
  const dctx         = drawCanvas.getContext("2d");

  const penBtn       = document.getElementById("pen");
  const eraserBtn    = document.getElementById("eraser");
  const clearBtn     = document.getElementById("clear");
  const colorPicker  = document.getElementById("color-picker");
  const sizePicker   = document.getElementById("size-picker");
  const exportBtn    = document.getElementById("export");

  const menuToggle   = document.getElementById("menu-toggle");
  const edgeToggle   = document.getElementById("edge-toggle");
  const sidebar      = document.getElementById("sidebar");

  const prevBtn      = document.getElementById("prev-page");
  const nextBtn      = document.getElementById("next-page");
  const pageInfo     = document.getElementById("page-info");

  const zoomInBtn    = document.getElementById("zoom-in");
  const zoomOutBtn   = document.getElementById("zoom-out");
  const zoomLabel    = document.getElementById("zoom-label");

  const handToggle   = document.getElementById("hand-toggle");
  const stage        = document.getElementById("stage");
  const body         = document.body;

  // pdf.js worker
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  } else {
    alert("pdf.js の読み込みに失敗しています。index.html の <script> を確認してください。");
    return;
  }

  // 状態
  let pdfDoc = null;
  let currentPage = 1;
  let totalPages = 0;

  const BASE_SCALE = 1.0;         // PDFの元倍率
  let zoom = 1.0;                  // ユーザー操作倍率（0.5〜3.0想定）
  const ZOOM_STEP = 0.1;
  const ZOOM_MIN  = 0.5;
  const ZOOM_MAX  = 3.0;

  // 手書き設定
  let drawing = false;
  let mode = "pen";
  function applyStrokeStyle() {
    dctx.lineCap = "round";
    dctx.lineJoin = "round";
    dctx.globalCompositeOperation = (mode === "pen") ? "source-over" : "destination-out";
    dctx.strokeStyle = (mode === "pen") ? colorPicker.value : "#000000";
    dctx.lineWidth = Number(sizePicker.value) * (mode === "eraser" ? 2 : 1);
  }
  applyStrokeStyle();

  // ===== PDF レンダリング =====
  async function renderPage(pageNum, keepDrawingImage) {
    if (!pdfDoc) return;
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: BASE_SCALE * zoom });

    // 描画保持
    let drawingImage = null;
    if (keepDrawingImage) {
      drawingImage = new Image();
      drawingImage.src = drawCanvas.toDataURL("image/png");
      await imageLoaded(drawingImage);
    }

    // PDFキャンバス
    pdfContainer.innerHTML = "";
    const pdfCanvas = document.createElement("canvas");
    const pctx = pdfCanvas.getContext("2d");
    pdfCanvas.width = Math.floor(viewport.width);
    pdfCanvas.height = Math.floor(viewport.height);
    pdfCanvas.style.display = "block";
    pdfContainer.appendChild(pdfCanvas);

    // 手書きキャンバスサイズ
    drawCanvas.width = pdfCanvas.width;
    drawCanvas.height = pdfCanvas.height;

    await page.render({ canvasContext: pctx, viewport }).promise;

    if (drawingImage) {
      dctx.drawImage(drawingImage, 0, 0, drawingImage.width, drawingImage.height, 0, 0, drawCanvas.width, drawCanvas.height);
    } else {
      dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    }

    // UI更新
    pageInfo.textContent = `${pageNum} / ${totalPages}`;
    prevBtn.disabled = (pageNum <= 1);
    nextBtn.disabled = (pageNum >= totalPages);
    zoomLabel.textContent = Math.round(zoom * 100) + "%";
    zoomOutBtn.disabled = (zoom <= ZOOM_MIN);
    zoomInBtn.disabled  = (zoom >= ZOOM_MAX);
  }

  function imageLoaded(img){
    return new Promise(res => {
      if (img.complete) return res();
      img.onload = () => res();
    });
  }

  // ===== PDF ファイル選択 =====
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    try {
      pdfDoc = await pdfjsLib.getDocument(url).promise;
      totalPages = pdfDoc.numPages;
      currentPage = 1;
      zoom = 1.0;
      await renderPage(currentPage, false);
      // 先頭にスクロール
      stage.scrollTo({left:0, top:0, behavior:"instant"});
    } catch (err) {
      console.error(err);
      alert("PDFの読み込みに失敗しました。別のPDFでお試しください。");
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  // ===== ページ送り =====
  prevBtn.addEventListener("click", async () => {
    if (!pdfDoc || currentPage <= 1) return;
    currentPage--;
    await renderPage(currentPage, false);
    stage.scrollTo({left:0, top:0, behavior:"instant"});
  });
  nextBtn.addEventListener("click", async () => {
    if (!pdfDoc || currentPage >= totalPages) return;
    currentPage++;
    await renderPage(currentPage, false);
    stage.scrollTo({left:0, top:0, behavior:"instant"});
  });

  // ===== 拡大縮小（ボタン） =====
  zoomOutBtn.addEventListener("click", async () => {
    if (!pdfDoc) return;
    zoom = Math.max(ZOOM_MIN, Math.round((zoom - ZOOM_STEP) * 10) / 10);
    await renderPage(currentPage, true);
  });
  zoomInBtn.addEventListener("click", async () => {
    if (!pdfDoc) return;
    zoom = Math.min(ZOOM_MAX, Math.round((zoom + ZOOM_STEP) * 10) / 10);
    await renderPage(currentPage, true);
  });

  // ===== 手書き（マウス/タッチ） =====
  function getPoint(ev) {
    const rect = drawCanvas.getBoundingClientRect();
    const t = ev.touches?.[0];
    const x = (t ? t.clientX : ev.clientX) - rect.left;
    const y = (t ? t.clientY : ev.clientY) - rect.top;
    return { x, y };
  }
  function startDraw(ev) {
    if (!pdfDoc || body.classList.contains("hand-mode")) return; // 手のひら中は描かない
    drawing = true;
    applyStrokeStyle();
    const p = getPoint(ev);
    dctx.beginPath();
    dctx.moveTo(p.x, p.y);
    ev.preventDefault?.();
  }
  function moveDraw(ev) {
    if (!drawing) return;
    const p = getPoint(ev);
    dctx.lineTo(p.x, p.y);
    dctx.stroke();
    ev.preventDefault?.();
  }
  function endDraw() { drawing = false; dctx.closePath(); }

  drawCanvas.addEventListener("mousedown", startDraw);
  drawCanvas.addEventListener("mousemove", moveDraw);
  window.addEventListener("mouseup", endDraw);
  drawCanvas.addEventListener("touchstart", startDraw, { passive: false });
  drawCanvas.addEventListener("touchmove",  moveDraw,   { passive: false });
  drawCanvas.addEventListener("touchend",   endDraw);

  penBtn?.addEventListener("click",   () => { mode = "pen";    applyStrokeStyle(); });
  eraserBtn?.addEventListener("click",() => { mode = "eraser"; applyStrokeStyle(); });
  clearBtn?.addEventListener("click", () => dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height));
  colorPicker?.addEventListener("change", applyStrokeStyle);
  sizePicker?.addEventListener("input",   applyStrokeStyle);

  // ===== PNG書き出し（PDF+手書き合成） =====
  exportBtn?.addEventListener("click", () => {
    if (!pdfDoc) { alert("先にPDFを表示してください。"); return; }
    const pdfCanvas = pdfContainer.querySelector("canvas");
    if (!pdfCanvas) return;

    const out = document.createElement("canvas");
    out.width = pdfCanvas.width;
    out.height = pdfCanvas.height;
    const octx = out.getContext("2d");
    octx.drawImage(pdfCanvas, 0, 0);
    octx.drawImage(drawCanvas, 0, 0);

    const a = document.createElement("a");
    a.download = `pascal-whiteboard-page${currentPage}.png`;
    a.href = out.toDataURL("image/png");
    a.click();
  });

  // ===== サイドバー開閉（PDFは動かさない） =====
  function setSidebar(open){
    sidebar.classList.toggle("open", open);
    if (edgeToggle) edgeToggle.textContent = open ? "▶" : "◀";
  }
  menuToggle?.addEventListener("click", () => setSidebar(!sidebar.classList.contains("open")));
  edgeToggle?.addEventListener("click", () => setSidebar(!sidebar.classList.contains("open")));
  setSidebar(false);

  // ===== 手のひら（パン） =====
  let handEnabled = false;
  let panState = { active:false, startX:0, startY:0, startLeft:0, startTop:0 };

  function setHandMode(on){
    handEnabled = on;
    body.classList.toggle("hand-mode", on);
    handToggle.classList.toggle("active", on);
  }
  handToggle.addEventListener("click", () => setHandMode(!handEnabled));

  // ドラッグで stage.scroll を動かす
  function panStart(ev){
    if (!handEnabled) return;
    panState.active = true;
    body.classList.add("hand-dragging");
    const t = ev.touches?.[0] ?? ev;
    panState.startX = t.clientX;
    panState.startY = t.clientY;
    panState.startLeft = stage.scrollLeft;
    panState.startTop  = stage.scrollTop;
    ev.preventDefault?.();
  }
  function panMove(ev){
    if (!panState.active) return;
    const t = ev.touches?.[0] ?? ev;
    const dx = t.clientX - panState.startX;
    const dy = t.clientY - panState.startY;
    stage.scrollLeft = panState.startLeft - dx;
    stage.scrollTop  = panState.startTop  - dy;
    ev.preventDefault?.();
  }
  function panEnd(){ panState.active = false; body.classList.remove("hand-dragging"); }

  // ハンドラを stage に付与（キャンバス無効化済み）
  stage.addEventListener("mousedown", panStart);
  stage.addEventListener("mousemove", panMove);
  window.addEventListener("mouseup", panEnd);
  stage.addEventListener("touchstart", panStart, {passive:false});
  stage.addEventListener("touchmove",  panMove,  {passive:false});
  stage.addEventListener("touchend",   panEnd);

  // ===== ピンチズーム（2本指） =====
  let pinch = { active:false, startDist:0, startZoom:1 };
  function dist2(touches){
    const [a,b] = touches;
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.hypot(dx,dy);
  }
  stage.addEventListener("touchstart", async (ev) => {
    if (ev.touches.length === 2){
      pinch.active = true;
      pinch.startDist = dist2(ev.touches);
      pinch.startZoom = zoom;
      ev.preventDefault();
    }
  }, {passive:false});
  stage.addEventListener("touchmove", async (ev) => {
    if (pinch.active && ev.touches.length === 2){
      const ratio = dist2(ev.touches) / (pinch.startDist || 1);
      zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(pinch.startZoom * ratio).toFixed(2)));
      await renderPage(currentPage, true);
      ev.preventDefault();
    }
  }, {passive:false});
  stage.addEventListener("touchend", () => { pinch.active = false; });

  // ===== スワイプでページ送り（1本指・ズーム ~1.05 のときのみ） =====
  let swipe = {x0:0, y0:0, tracking:false};
  stage.addEventListener("touchstart", (ev) => {
    if (ev.touches.length === 1 && zoom <= 1.05 && !handEnabled){
      swipe.tracking = true;
      swipe.x0 = ev.touches[0].clientX;
      swipe.y0 = ev.touches[0].clientY;
    } else {
      swipe.tracking = false;
    }
  }, {passive:true});
  stage.addEventListener("touchend", async (ev) => {
    if (!swipe.tracking) return;
    const t = ev.changedTouches?.[0];
    if (!t) return;
    const dx = t.clientX - swipe.x0;
    const dy = t.clientY - swipe.y0;
    // 横方向に大きいスワイプのみ
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy)*1.5){
      if (dx < 0) { // 左へ → 次ページ
        if (currentPage < totalPages){ currentPage++; await renderPage(currentPage, false); }
      } else {     // 右へ → 前ページ
        if (currentPage > 1){ currentPage--; await renderPage(currentPage, false); }
      }
      stage.scrollTo({left:0, top:0, behavior:"instant"});
    }
  }, {passive:true});
});