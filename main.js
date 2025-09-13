// main.js - Pascal Whiteboard (MVP)

window.addEventListener("DOMContentLoaded", () => {
  const fileInput    = document.getElementById("file-input");
  const pdfContainer = document.getElementById("pdf-container");
  const drawCanvas   = document.getElementById("draw-layer");
  const ctx          = drawCanvas.getContext("2d");

  const penBtn       = document.getElementById("pen");
  const eraserBtn    = document.getElementById("eraser");
  const clearBtn     = document.getElementById("clear");
  const colorPicker  = document.getElementById("color-picker");
  const sizePicker   = document.getElementById("size-picker");
  const exportBtn    = document.getElementById("export");

  const menuToggle   = document.getElementById("menu-toggle");
  const edgeToggle   = document.getElementById("edge-toggle");
  const sidebar      = document.getElementById("sidebar");

  // ===== 描画制御 =====
  let drawing = false;
  let mode = "pen";
  ctx.lineCap = "round";

  drawCanvas.addEventListener("mousedown", startDraw);
  drawCanvas.addEventListener("mousemove", draw);
  drawCanvas.addEventListener("mouseup", stopDraw);
  drawCanvas.addEventListener("mouseleave", stopDraw);

  function startDraw(e) {
    drawing = true;
    ctx.beginPath();
    ctx.moveTo(e.offsetX, e.offsetY);
  }
  function draw(e) {
    if (!drawing) return;
    ctx.lineWidth = sizePicker.value;
    ctx.strokeStyle = (mode === "pen") ? colorPicker.value : "#fff";
    ctx.lineTo(e.offsetX, e.offsetY);
    ctx.stroke();
  }
  function stopDraw() {
    drawing = false;
    ctx.closePath();
  }

  penBtn.addEventListener("click", () => mode = "pen");
  eraserBtn.addEventListener("click", () => mode = "eraser");
  clearBtn.addEventListener("click", () => ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height));

  exportBtn.addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = drawCanvas.toDataURL("image/png");
    link.download = "whiteboard.png";
    link.click();
  });

  // ===== PDF表示 =====
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);

    const pdf = await pdfjsLib.getDocument(url).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });

    const pdfCanvas = document.createElement("canvas");
    const pdfCtx = pdfCanvas.getContext("2d");
    pdfCanvas.width = viewport.width;
    pdfCanvas.height = viewport.height;
    pdfContainer.innerHTML = "";
    pdfContainer.appendChild(pdfCanvas);

    await page.render({ canvasContext: pdfCtx, viewport }).promise;

    // 手書きキャンバスを重ねる
    drawCanvas.width = viewport.width;
    drawCanvas.height = viewport.height;
  });

  // ===== メニュー開閉 =====
  function setSidebar(open) {
    sidebar.classList.toggle("open", open);
    document.body.classList.toggle("sidebar-open", open);
    if (edgeToggle) edgeToggle.textContent = open ? "▶" : "◀";
  }

  menuToggle?.addEventListener("click", () => {
    setSidebar(!sidebar.classList.contains("open"));
  });
  edgeToggle?.addEventListener("click", () => {
    setSidebar(!sidebar.classList.contains("open"));
  });

  setSidebar(false);
});
