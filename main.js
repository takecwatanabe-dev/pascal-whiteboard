// Pascal Whiteboard (MVP)
// PDF表示 + 手書き描画 + PNG書き出し + メニュー開閉 + 拡大縮小

window.addEventListener("DOMContentLoaded", () => {
  // ---- 要素 ----
  const fileInput = document.getElementById("file-input");
  const pdfContainer = document.getElementById("pdf-container");
  const drawCanvas = document.getElementById("draw-layer");
  const dctx = drawCanvas.getContext("2d");

  const penBtn = document.getElementById("pen");
  const eraserBtn = document.getElementById("eraser");
  const clearBtn = document.getElementById("clear");
  const colorPicker = document.getElementById("color-picker");
  const sizePicker = document.getElementById("size-picker");
  const exportBtn = document.getElementById("export");

  const menuToggle = document.getElementById("menu-toggle");
  const sidebar = document.getElementById("sidebar");

  const zoomInBtn = document.getElementById("zoom-in");
  const zoomOutBtn = document.getElementById("zoom-out");
  const zoomDisplay = document.getElementById("zoom-display");

  // ---- pdf.js 設定 ----
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  } else {
    alert("pdf.js の読み込みに失敗しています。index.html の <script> を確認してください。");
    return;
  }

  // ---- 状態 ----
  let pdfDoc = null;       // PDFドキュメント
  let pdfCanvas = null;    // PDF描画用キャンバス
  let scale = 1.0;         // 表示倍率
  let drawing = false;
  let mode = "pen";        // "pen" or "eraser"
  const MIN_SCALE = 0.4;
  const MAX_SCALE = 3.0;
  const SCALE_STEP = 0.2;

  // ---- 共通: 手書きスタイル ----
  function applyStrokeStyle() {
    dctx.lineCap = "round";
    dctx.lineJoin = "round";
    dctx.strokeStyle = mode === "pen" ? colorPicker.value : "#000000";
    dctx.globalCompositeOperation = mode === "pen" ? "source-over" : "destination-out";
    dctx.lineWidth = Number(sizePicker.value) * (mode === "eraser" ? 2 : 1);
  }

  // ---- PDFを1ページ表示 ----
  async function renderPage(pageNumber = 1) {
    if (!pdfDoc) return;

    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    // 既存をクリア
    pdfContainer.innerHTML = "";

    // PDF用キャンバス
    pdfCanvas = document.createElement("canvas");
    pdfCanvas.width = Math.floor(viewport.width);
    pdfCanvas.height = Math.floor(viewport.height);
    pdfCanvas.style.display = "block";
    pdfContainer.appendChild(pdfCanvas);

    // 手書きキャンバスの内容を保全してスケールに追従（簡易）
    let snapshot = null;
    if (drawCanvas.width > 0 && drawCanvas.height > 0) {
      snapshot = document.createElement("canvas");
      snapshot.width = drawCanvas.width;
      snapshot.height = drawCanvas.height;
      snapshot.getContext("2d").drawImage(drawCanvas, 0, 0);
    }

    // 手書きキャンバスをPDFサイズに合わせる
    drawCanvas.width = pdfCanvas.width;
    drawCanvas.height = pdfCanvas.height;

    // スナップショットを拡縮して戻す（拡大縮小しても描画をなるべく保持）
    if (snapshot) {
      dctx.drawImage(snapshot, 0, 0, snapshot.width, snapshot.height, 0, 0, drawCanvas.width, drawCanvas.height);
    }

    // PDF描画
    const pctx = pdfCanvas.getContext("2d");
    await page.render({ canvasContext: pctx, viewport }).promise;

    // 手書きスタイル
    applyStrokeStyle();

    // 表示倍率の表記
    zoomDisplay.textContent = Math.round(scale * 100) + "%";
  }

  // ---- ファイル選択：PDF読み込み ----
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const blobUrl = URL.createObjectURL(file);
    try {
      pdfDoc = await pdfjsLib.getDocument(blobUrl).promise;
      scale = 1.0;
      await renderPage(1);
    } catch (err) {
      console.error(err);
      alert("PDFの読み込みに失敗しました。別のPDFでお試しください。");
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  });

  // ---- 手書きイベント（マウス/タッチ/ペン）----
  function getPoint(ev) {
    const rect = drawCanvas.getBoundingClientRect();
    const t = ev.touches && ev.touches[0];
    const x = (t ? t.clientX : ev.clientX) - rect.left;
    const y = (t ? t.clientY : ev.clientY) - rect.top;
    return { x, y };
  }

  function startDraw(ev) {
    if (!pdfCanvas) return;
    drawing = true;
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

  function endDraw() {
    drawing = false;
    dctx.closePath();
  }

  drawCanvas.addEventListener("mousedown", startDraw);
  drawCanvas.addEventListener("mousemove", moveDraw);
  window.addEventListener("mouseup", endDraw);
  drawCanvas.addEventListener("touchstart", startDraw, { passive: false });
  drawCanvas.addEventListener("touchmove", moveDraw, { passive: false });
  drawCanvas.addEventListener("touchend", endDraw);

  // ---- ツール ----
  penBtn.addEventListener("click", () => {
    mode = "pen";
    applyStrokeStyle();
  });
  eraserBtn.addEventListener("click", () => {
    mode = "eraser";
    applyStrokeStyle();
  });
  clearBtn.addEventListener("click", () => {
    dctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  });
  colorPicker.addEventListener("change", applyStrokeStyle);
  sizePicker.addEventListener("input", applyStrokeStyle);

  // ---- PNG書き出し（PDF+手書き合成）----
  exportBtn.addEventListener("click", () => {
    if (!pdfCanvas) {
      alert("先にPDFを表示してください。");
      return;
    }
    const out = document.createElement("canvas");
    out.width = pdfCanvas.width;
    out.height = pdfCanvas.height;
    const octx = out.getContext("2d");
    octx.drawImage(pdfCanvas, 0, 0);
    octx.drawImage(drawCanvas, 0, 0);
    const a = document.createElement("a");
    a.download = "pascal-whiteboard.png";
    a.href = out.toDataURL("image/png");
    a.click();
  });

  // ---- メニュー開閉 ----
  menuToggle.addEventListener("click", () => {
    sidebar.classList.toggle("open"); // style.css の #sidebar.open { left:0 } を利用
  });

  // ---- 拡大縮小 ----
  async function zoom(delta) {
    if (!pdfDoc) return;
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale + delta));
    if (next === scale) return;
    scale = next;
    await renderPage(1);
  }
  zoomInBtn.addEventListener("click", () => zoom(+SCALE_STEP));
  zoomOutBtn.addEventListener("click", () => zoom(-SCALE_STEP));

  // ---- 画面サイズ変更時（位置合わせ程度）----
  window.addEventListener("resize", () => {
    // ここではPDFの再レンダリングはせず、ズレたら手動で＋/－してください
  });

  // 初期ツールはペン
  applyStrokeStyle();
});
