// Pascal Whiteboard (MVP) v0.3.1
// PDF表示 / 前後ページ送り / 手書き描画 / PNG書き出し / サイドバー開閉

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

  // pdf.js worker (CDN)
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  } else {
    alert("pdf.js が読み込めていません。index.html の <script> をご確認ください。");
    return;
  }

  // 状態
  let pdfDoc = null;
  let currentPage = 1;
  let totalPages = 0;
  const SCALE = 1.5;          // 表示倍率（シンプルに固定）

  // ツール共通設定
  function applyStrokeStyle() {
    dctx.lineCap = "round";
    dctx.lineJoin = "round";
    dctx.globalCompositeOperation = (mode === "pen") ? "source-over" : "destination-out";
    dctx.strokeStyle = (mode === "pen") ? colorPicker.value : "#000";
    dctx.lineWidth = Number(sizePicker.value) * (mode === "eraser" ? 2 : 1);
  }
  let drawing = false;
  let mode = "pen";
  applyStrokeStyle();

  // ========== PDF レンダリング ==========
  async function renderPage(pageNum) {
    if (!pdfDoc) return;
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: SCALE });

    // PDF用キャンバスを作成
    pdfContainer.innerHTML = "";
    const pdfCanvas = document.createElement("canvas");
    const pctx = pdfCanvas.getContext("2d");
    pdfCanvas.width = Math.floor(viewport.width);
    pdfCanvas.height = Math.floor(viewport.height);
    pdfCanvas.style.display = "block";
    pdfContainer.appendChild(pdfCanvas);

    // 手書きレイヤーをPDFサイズに合わせる（※ページ切替時はクリア）
    drawCanvas.width = pdfCanvas.width;
    drawCanvas.height = pdfCanvas.height;
    dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);

    await page.render({ canvasContext: pctx, viewport }).promise;

    // ページ情報とボタン制御
    pageInfo.textContent = `${pageNum} / ${totalPages}`;
    prevBtn.disabled = (pageNum <= 1);
    nextBtn.disabled = (pageNum >= totalPages);
  }

  // ========== ファイル選択 ==========
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    try {
      pdfDoc = await pdfjsLib.getDocument(url).promise;
      totalPages = pdfDoc.numPages;
      currentPage = 1;
      await renderPage(currentPage);
    } catch (err) {
      console.error(err);
      alert("PDFの読み込みに失敗しました。別のファイルをお試しください。");
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  // ========== ページ送り ==========
  prevBtn.addEventListener("click", async () => {
    if (!pdfDoc || currentPage <= 1) return;
    currentPage--;
    await renderPage(currentPage);
  });
  nextBtn.addEventListener("click", async () => {
    if (!pdfDoc || currentPage >= totalPages) return;
    currentPage++;
    await renderPage(currentPage);
  });

  // ========== 手書き描画（マウス/タッチ） ==========
  function getPoint(ev) {
    const rect = drawCanvas.getBoundingClientRect();
    const t = ev.touches?.[0];
    const x = (t ? t.clientX : ev.clientX) - rect.left;
    const y = (t ? t.clientY : ev.clientY) - rect.top;
    return { x, y };
  }

  function startDraw(ev) {
    if (!pdfDoc) return; // PDF未表示時は描けない
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
  drawCanvas.addEventListener("touchmove", moveDraw,   { passive: false });
  drawCanvas.addEventListener("touchend",  endDraw);

  // ========== ツール ==========
  penBtn.addEventListener("click",   () => { mode = "pen";    applyStrokeStyle(); });
  eraserBtn.addEventListener("click",() => { mode = "eraser"; applyStrokeStyle(); });
  clearBtn.addEventListener("click", () => dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height));
  colorPicker.addEventListener("change", applyStrokeStyle);
  sizePicker.addEventListener("input",   applyStrokeStyle);

  // PNG書き出し（PDF+手書き合成）
  exportBtn.addEventListener("click", () => {
    if (!pdfDoc) { alert("先にPDFを表示してください。"); return; }
    const out = document.createElement("canvas");
    out.width = drawCanvas.width;
    out.height = drawCanvas.height;
    const octx = out.getContext("2d");

    // 直前に描いたPDF画面をもう一度描画して合成（簡易）
    // ここでは pdfContainer 内の <canvas> をそのまま使う
    const pdfCanvas = pdfContainer.querySelector("canvas");
    if (pdfCanvas) octx.drawImage(pdfCanvas, 0, 0);

    octx.drawImage(drawCanvas, 0, 0);

    const a = document.createElement("a");
    a.download = `pascal-whiteboard-page${currentPage}.png`;
    a.href = out.toDataURL("image/png");
    a.click();
  });

  // ========== サイドバー開閉 ==========
  function setSidebar(open){
    sidebar.classList.toggle("open", open);
    document.body.classList.toggle("sidebar-open", open);
    if (edgeToggle) edgeToggle.textContent = open ? "▶" : "◀";
  }
  document.getElementById("menu-toggle")?.addEventListener("click", () => {
    setSidebar(!sidebar.classList.contains("open"));
  });
  edgeToggle?.addEventListener("click", () => {
    setSidebar(!sidebar.classList.contains("open"));
  });
  setSidebar(false);
});