/* Builds the site visit report as a Word file, entirely in the browser.
   Depends on docx.umd.js being loaded first. */

const D = () => window.docx;

const TW_PAGE  = 10080;  /* usable width in twips: letter 12240 less the 0.75in margins */
const TW_PHOTO = 4100;
const TW_TEXT  = TW_PAGE - TW_PHOTO;
const PHOTO_PX = 264;    /* 2.75in at 96dpi */

const RED = "A12B2A";
const GREY = "6B6560";

const NONE = { style: "none", size: 0, color: "FFFFFF" };
const noBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE,
                    insideHorizontal: NONE, insideVertical: NONE };

function p(text, opts = {}) {
  const { Paragraph, TextRun } = D();
  return new Paragraph({
    spacing: { after: opts.after == null ? 60 : opts.after, before: opts.before || 0 },
    alignment: opts.align,
    children: [ new TextRun({
      text: text == null ? "" : String(text),
      bold: !!opts.bold,
      size: opts.size || 20,          /* half points, so 20 = 10pt */
      color: opts.color || "101010",
      font: "Calibri",
      allCaps: !!opts.caps
    }) ]
  });
}

/* Word and LibreOffice merge consecutive paragraphs that carry an identical border
   into one box, which collapsed four writing lines into a single rule. Nudging the
   colour by one step per line keeps them separate and is invisible on paper. */
function ruledLines(n) {
  const { Paragraph, TextRun } = D();
  const shades = ["C9C4BD", "C9C4BE", "C9C4BF", "C9C4C0", "C9C4C1", "C9C4C2"];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(new Paragraph({
      spacing: { after: 230 },
      border: { bottom: { style: "single", size: 4, color: shades[i % shades.length] } },
      children: [ new TextRun({ text: " ", size: 20, font: "Calibri" }) ]
    }));
  }
  return out;
}

function measure(blob) {
  return new Promise(res => {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload  = () => { res({ w: im.naturalWidth, h: im.naturalHeight }); URL.revokeObjectURL(url); };
    im.onerror = () => { res(null); URL.revokeObjectURL(url); };
    im.src = url;
  });
}

async function imageBits(blob) {
  // A report-sized copy keeps Word files small. Stored photos are never changed.
  const url = URL.createObjectURL(blob);
  try {
    const im = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Photo cannot be decoded"));
      image.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(im.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(im.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Photo conversion unavailable");
    ctx.drawImage(im, 0, 0, canvas.width, canvas.height);
    const copy = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (!copy || !copy.size) throw new Error("Photo conversion failed");
    return { buf: await copy.arrayBuffer(), w: PHOTO_PX,
      h: Math.round(PHOTO_PX * im.naturalHeight / im.naturalWidth) };
  } finally { URL.revokeObjectURL(url); }
}

/* Uses logo.png from the app folder if it is there, otherwise falls back to type. */
async function logoBits() {
  try {
    const r = await fetch("logo.png", { cache: "no-cache" });
    if (!r.ok) return null;
    const blob = await r.blob();
    if (!blob || blob.size < 100) return null;
    const buf = await blob.arrayBuffer();
    /* the mark is a tall stacked lockup, so drive it off height, not width.
       96px at 96dpi is 1in, which matches how it prints on the letterhead. */
    const H = 96;
    let ratio = 1.36;
    const d = await measure(blob);
    if (d && d.h && d.w) ratio = d.h / d.w;
    return { buf, w: Math.round(H / ratio), h: H };
  } catch (e) { return null; }
}

const ADDRESS = "925 Tuckaseegee Road, Suite 110, Charlotte, NC 28208     704.377.2990     redlinedg.com";

/* title on the left, the Redline mark on the right, the way the letterhead sits */
function mastheadTable(logo) {
  const { Table, TableRow, TableCell, WidthType, Paragraph, ImageRun,
          AlignmentType, VerticalAlign } = D();
  const RIGHT = 1500;

  const left = [
    p("SITE VISIT REPORT", { bold: true, size: 32, after: 60 }),
    p(ADDRESS, { size: 15, color: GREY, after: 0 })
  ];
  const right = logo
    ? [ new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 0 }, children: [
          new ImageRun({ data: logo.buf, transformation: { width: logo.w, height: logo.h } }) ] }) ]
    : [ p("REDLINE", { bold: true, size: 24, color: RED, align: AlignmentType.RIGHT, after: 0 }),
        p("DESIGN GROUP", { bold: true, size: 15, color: RED, align: AlignmentType.RIGHT, after: 0 }) ];

  return new Table({
    width: { size: TW_PAGE, type: WidthType.DXA },
    columnWidths: [TW_PAGE - RIGHT, RIGHT],
    borders: noBorders,
    rows: [ new TableRow({ children: [
      new TableCell({ width: { size: TW_PAGE - RIGHT, type: WidthType.DXA }, borders: noBorders,
        margins: { top: 0, bottom: 0 }, verticalAlign: VerticalAlign.BOTTOM, children: left }),
      new TableCell({ width: { size: RIGHT, type: WidthType.DXA }, borders: noBorders,
        margins: { top: 0, bottom: 0 }, verticalAlign: VerticalAlign.TOP, children: right })
    ]}) ]
  });
}

function redRule(after) {
  const { Paragraph } = D();
  return new Paragraph({
    spacing: { before: 90, after: after == null ? 220 : after },
    border: { bottom: { style: "single", size: 10, color: RED } },
    children: []
  });
}

function headerTable(visit, times) {
  const { Table, TableRow, TableCell, WidthType } = D();
  const rows = [
    ["Project",      visit.project || ""],
    ["Project No.",  visit.projNum || ""],
    ["Report No.",   "SVR " + String(visit.num).padStart(3, "0")],
    ["Date",         new Date(visit.date).toLocaleDateString([], { weekday:"long", year:"numeric", month:"long", day:"numeric" })],
    ["Photo Time Range", times],
    ["Weather",      [visit.weather, visit.temp].filter(Boolean).join(", ")],
    ["Present",      visit.attendees || ""],
    ["Prepared By",  visit.preparedBy || ""]
  ];
  const KEY = 1900;
  return new Table({
    width: { size: TW_PAGE, type: WidthType.DXA },
    columnWidths: [KEY, TW_PAGE - KEY],
    borders: noBorders,
    rows: rows.map(([k, v]) => new TableRow({ children: [
      new TableCell({ width: { size: KEY, type: WidthType.DXA }, borders: noBorders,
        margins: { top: 30, bottom: 30 }, children: [ p(k, { bold: true, size: 18, color: GREY, caps: true }) ] }),
      new TableCell({ width: { size: TW_PAGE - KEY, type: WidthType.DXA }, borders: noBorders,
        margins: { top: 30, bottom: 30 }, children: [ p(v, { size: 20 }) ] })
    ]}))
  });
}

async function observationTable(recs) {
  const { Table, TableRow, TableCell, WidthType, Paragraph, ImageRun, VerticalAlign } = D();
  const rows = [];

  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const n = String(r.observationNumber || i + 1).padStart(3, "0");
    let img;
    try {
      img = await imageBits(r.blob);
    } catch (e) {
      throw new Error("could not read photo " + n + " (" + (e && e.message ? e.message : "unknown") + ")");
    }

    const right = [ p("OBSERVATION " + n + (r.tag ? "   |   " + r.tag.toUpperCase() : ""),
                      { bold: true, size: 20, color: RED }) ];

    const loc = [r.area, r.sheet].filter(Boolean).join("   |   ");
    if (loc) right.push(p(loc, { size: 17, color: r.tag === "Safety" ? RED : GREY, bold: r.tag === "Safety", caps: true }));

    if (r.itemRef) right.push(p("Tracked item: " + r.itemRef, { size: 18, bold: true }));
    if (r.note) {
      right.push(p(r.note, { size: 20, after: 120, bold: r.tag === "Safety", color: r.tag === "Safety" ? RED : "101010" }));
    } else {
      right.push(p("", { after: 40 }));
      ruledLines(4).forEach(l => right.push(l));
    }

    if (r.owner || r.due) {
      right.push(p([r.owner ? "Owner: " + r.owner : "", r.due ? "Due: " + r.due : ""]
                   .filter(Boolean).join("     "), { size: 18, bold: true, color: r.tag === "Safety" ? RED : GREY }));
    }

    rows.push(new TableRow({
      cantSplit: false,
      children: [
        new TableCell({
          width: { size: TW_PHOTO, type: WidthType.DXA },
          borders: noBorders,
          margins: { top: 120, bottom: 240, right: 200 },
          children: [
            new Paragraph({ spacing: { after: 40 }, children: [
              new ImageRun({ data: img.buf, transformation: { width: img.w, height: img.h } })
            ]}),
            p(new Date(r.ts).toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" }),
              { size: 15, color: GREY })
          ]
        }),
        new TableCell({
          width: { size: TW_TEXT, type: WidthType.DXA },
          borders: noBorders,
          margins: { top: 120, bottom: 240 },
          verticalAlign: VerticalAlign.TOP,
          children: right
        })
      ]
    }));
  }

  return new Table({ width: { size: TW_PAGE, type: WidthType.DXA },
    columnWidths: [TW_PHOTO, TW_TEXT], borders: noBorders, rows });
}

function openItemsTable(items) {
  const { Table, TableRow, TableCell, WidthType } = D();
  const line = { style: "single", size: 4, color: "C9C4BD" };
  const b = { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line };
  const head = ["Item", "Description", "First Noted", "Owner", "Due", "Status"];
  const widths = [900, 3450, 1450, 1450, 1200, 1630];   /* sums to TW_PAGE */

  const rows = [ new TableRow({ tableHeader: true, children: head.map((h, i) =>
    new TableCell({ width: { size: widths[i], type: WidthType.DXA }, borders: b,
      shading: { fill: "EFEDEA" }, margins: { top: 60, bottom: 60, left: 80, right: 80 },
      children: [ p(h, { bold: true, size: 17, caps: true, color: GREY }) ] })) }) ];

  items.forEach((it, i) => {
    const cells = [
      it.ref,
      (it.note || "Photo item with no description") + (it.area ? "\nArea: " + it.area : "") + (it.update ? "\nThis visit: " + it.update : ""),
      "SVR " + String(it.firstVisitNum).padStart(3,"0") + "\n" + new Date(it.firstNoted).toLocaleDateString(),
      it.owner || "",
      it.due || "",
      it.status === "Not reviewed" ? "Open; not reviewed this visit" : it.status
    ];
    rows.push(new TableRow({ children: cells.map((c, j) =>
      new TableCell({ width: { size: widths[j], type: WidthType.DXA }, borders: b,
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        shading: it.tag === "Safety" ? { fill: "FFF1F0" } : undefined,
        children: [ p(c, { size: 18, bold: it.tag === "Safety", color: it.tag === "Safety" ? RED : "101010" }) ] })) }));
  });

  return new Table({ width: { size: TW_PAGE, type: WidthType.DXA },
    columnWidths: widths, borders: b, rows });
}

const LIMITATIONS =
  "This report records observations made during a periodic visit to the site and does not constitute " +
  "an exhaustive or continuous inspection of the Work. The Architect is not responsible for construction " +
  "means, methods, techniques, sequences, or procedures, or for safety precautions and programs in " +
  "connection with the Work. Observations recorded here do not relieve the Contractor of the obligation " +
  "to perform the Work in accordance with the Contract Documents. Work not observed or not noted is " +
  "neither approved nor accepted. Photographs represent conditions at the time of the visit only. " +
  "[PLACEHOLDER. Confirm against RDG standard language before issue.]";

async function buildReport(visit, recs) {
  const { Document, Packer, Paragraph, TextRun, ImageRun, Footer, PageNumber, AlignmentType } = D();

  const sorted = recs.map(r => ({...r})).sort((a, b) => a.ts - b.ts);
  const times = sorted.length
    ? new Date(sorted[0].ts).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" }) + " to " +
      new Date(sorted[sorted.length - 1].ts).toLocaleTimeString([], { hour:"numeric", minute:"2-digit" })
    : "";

  const items = visit.legacyReportItems || visit.items || [];

  for (const r of sorted) { const item = items.find(it => it.photoId === r.id || (it.followupPhotoIds || []).includes(r.id)); if (item) r.itemRef = item.ref; }
  sorted.forEach((r,i) => r.observationNumber = i + 1);
  const safetyPhotos = sorted.filter(r => r.tag === "Safety");
  const safetyItems = items.filter(it => it.tag === "Safety" || safetyPhotos.some(r => r.id === it.photoId));
  const otherItems = items.filter(it => !safetyItems.includes(it));
  const otherPhotos = sorted.filter(r => r.tag !== "Safety");
  const logo = await logoBits();

  const body = [
    mastheadTable(logo),
    redRule(),
    headerTable(visit, times),
    p("", { after: 200 })
  ];
  if (safetyPhotos.length || safetyItems.length) {
    body.push(p("SAFETY ITEMS — PRIORITY REVIEW", {bold:true, color:RED, size:28, after:160}));
    if (safetyItems.length) body.push(openItemsTable(safetyItems.map(it => ({...it,tag:"Safety"}))));
    if (safetyPhotos.length) body.push(await observationTable(safetyPhotos));
    body.push(redRule());
  }
  body.push(p("OBSERVATIONS", {bold:true,size:20,color:GREY,after:160}));
  if (otherPhotos.length) body.push(await observationTable(otherPhotos));
  else body.push(p(sorted.length ? "All photographs are listed in the safety section above." : "No photographs recorded during this visit."));
  if (otherItems.length) {
    body.push(p("ITEM STATUS", {bold:true,size:20,color:GREY,before:240,after:160}));
    body.push(openItemsTable(otherItems));
  }

  body.push(p("", { after: 300 }));
  body.push(p("LIMITATIONS OF THIS REPORT", { bold: true, size: 17, color: GREY, caps: true, after: 80 }));
  body.push(p(LIMITATIONS, { size: 16, color: GREY, after: 200 }));
  body.push(p("DISTRIBUTION", { bold: true, size: 17, color: GREY, caps: true, after: 80 }));
  body.push(p("Owner, Contractor, File   [PLACEHOLDER]", { size: 16, color: GREY }));

  const doc = new Document({
    styles: { default: { document: { run: { font: "Calibri", size: 20 } } } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      footers: { default: new Footer({ children: [ new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [ new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES],
                                  size: 15, color: GREY, font: "Calibri" }) ]
      })]}) },
      children: body
    }]
  });

  return Packer.toBlob(doc);
}

function reportFileName(visit) {
  const d = new Date(visit.date);
  const pad = n => String(n).padStart(2, "0");
  const num = (visit.projNum || "PROJ").replace(/[^A-Za-z0-9._-]/g, "");
  return num + "_SVR-" + String(visit.num).padStart(3, "0") + "_" +
         d.getFullYear() + "." + pad(d.getMonth() + 1) + "." + pad(d.getDate()) + ".docx";
}

window.SVReport = { buildReport, reportFileName };
