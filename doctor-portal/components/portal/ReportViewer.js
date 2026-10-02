"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ReportViewer.module.css";

// Images are laid out as a page this many points wide, so PDFs and scans
// share the same fit and zoom maths.
const IMAGE_WIDTH = 612;
const FIT_MIN = 0.4;
const MAX_CANVAS_PIXELS = 16_000_000;

let pdfjsLoading = null;
function loadPdfjs() {
  // The package's bundler entry starts pdf.js in its own module worker.
  pdfjsLoading ??= import("pdfjs-dist/webpack.mjs").catch((error) => {
    pdfjsLoading = null;
    throw error;
  });
  return pdfjsLoading;
}

function release(file) {
  file?.task?.destroy();
  if (file?.url) URL.revokeObjectURL(file.url);
}

// Reads the protected original through the same-origin source route.
async function openReport(report, signal) {
  const response = await fetch(report.sourceUrl, {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "manual",
    signal,
  });
  if (
    response.status === 401 ||
    response.type === "opaqueredirect" ||
    (response.status >= 300 && response.status < 400)
  )
    return { state: "expired" };
  if (!response.ok)
    return {
      state: "error",
      message: [404, 410].includes(response.status)
        ? "This report is no longer available."
        : "This report couldn’t be loaded.",
    };
  const blob = await response.blob();
  const type = blob.type.split(";")[0].trim().toLowerCase();
  if (type === "application/pdf") {
    const pdfjs = await loadPdfjs();
    const task = pdfjs.getDocument({
      data: new Uint8Array(await blob.arrayBuffer()),
      isEvalSupported: false,
      enableXfa: false,
      disableAutoFetch: true,
      disableStream: true,
      disableRange: true,
    });
    try {
      const doc = await task.promise;
      const sizes = [];
      for (let number = 1; number <= doc.numPages; number += 1) {
        const viewport = (await doc.getPage(number)).getViewport({ scale: 1 });
        sizes.push({ width: viewport.width, height: viewport.height, unit: 1 });
      }
      return { state: "ready", kind: "pdf", task, doc, sizes };
    } catch (error) {
      task.destroy();
      throw error;
    }
  }
  if (type === "image/png" || type === "image/jpeg") {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const unit = IMAGE_WIDTH / image.naturalWidth;
      return {
        state: "ready",
        kind: "image",
        url,
        sizes: [
          { width: IMAGE_WIDTH, height: image.naturalHeight * unit, unit },
        ],
      };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  }
  return { state: "error", message: "This file type can’t be shown." };
}

// Renders off screen, then copies, so zooming never flashes a blank page.
function PdfCanvas({ doc, number, scale }) {
  const canvasRef = useRef(null);
  const drawn = useRef(false);
  useEffect(() => {
    let cancelled = false;
    let task = null;
    const timer = setTimeout(
      async () => {
        try {
          const page = await doc.getPage(number);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          let renderScale = scale * Math.min(window.devicePixelRatio || 1, 3);
          const pixels = base.width * base.height * renderScale ** 2;
          if (pixels > MAX_CANVAS_PIXELS)
            renderScale *= Math.sqrt(MAX_CANVAS_PIXELS / pixels);
          const viewport = page.getViewport({ scale: renderScale });
          const scratch = document.createElement("canvas");
          scratch.width = Math.ceil(viewport.width);
          scratch.height = Math.ceil(viewport.height);
          task = page.render({ canvas: scratch, viewport });
          await task.promise;
          const canvas = canvasRef.current;
          if (cancelled || !canvas) return;
          canvas.width = scratch.width;
          canvas.height = scratch.height;
          canvas.getContext("2d").drawImage(scratch, 0, 0);
          drawn.current = true;
        } catch {
          // Cancelled by a newer render, or unreadable: keep the last bitmap.
        }
      },
      drawn.current ? 90 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [doc, number, scale]);
  return <canvas ref={canvasRef} className={styles.canvas} />;
}

function Status({ children }) {
  return <div className={styles.status}>{children}</div>;
}

export default function ReportViewer({
  reports,
  pages,
  onPages,
  pageIndex,
  zoom,
  onFit,
  focus,
}) {
  const [documents, setDocuments] = useState({});
  const [attempt, setAttempt] = useState(0);
  const [box, setBox] = useState(null);
  const viewerRef = useRef(null);
  const highlightRef = useRef(null);

  useEffect(() => {
    // Opening again after "Try again".
    void attempt;
    const controller = new AbortController();
    const opened = [];
    setDocuments({});
    for (const report of reports) {
      openReport(report, controller.signal)
        .then((file) => {
          if (controller.signal.aborted) return release(file);
          opened.push(file);
          setDocuments((current) => ({ ...current, [report.id]: file }));
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setDocuments((current) => ({
            ...current,
            [report.id]: {
              state: "error",
              message: "This report couldn’t be loaded.",
            },
          }));
        });
    }
    return () => {
      controller.abort();
      for (const file of opened) release(file);
    };
  }, [reports, attempt]);

  // Once every report has settled, publish the page list. A report that
  // failed still takes one page so its error can be reached.
  useEffect(() => {
    if (!reports.every((report) => documents[report.id])) return;
    onPages(
      reports.flatMap((report) => {
        const file = documents[report.id];
        if (file.state !== "ready")
          return [
            {
              reportId: report.id,
              page: 1,
              width: IMAGE_WIDTH,
              height: 792,
              unit: 1,
            },
          ];
        return file.sizes.map((size, index) => ({
          reportId: report.id,
          page: index + 1,
          ...size,
        }));
      }),
    );
  }, [reports, documents, onPages]);

  // The border box ignores this element's own scrollbars, so zooming in
  // cannot change the fit it is measured against.
  useEffect(() => {
    const element = viewerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const size = entry.borderBoxSize?.[0];
      const width = size ? size.inlineSize : element.offsetWidth;
      const height = size ? size.blockSize : element.offsetHeight;
      if (width < 1 || height < 1) return;
      setBox((current) =>
        current &&
        Math.abs(current.width - width) < 1 &&
        Math.abs(current.height - height) < 1
          ? current
          : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const page = pages?.length
    ? pages[Math.min(Math.max(pageIndex, 0), pages.length - 1)]
    : null;
  const file = page ? documents[page.reportId] : null;
  const fit =
    page && box
      ? Math.max(
          FIT_MIN,
          Math.min(
            (box.width - 40) / page.width,
            (box.height - 40) / page.height,
          ),
        )
      : null;
  const scale = fit ? Math.round(fit * zoom * 1000) / 1000 : null;

  useEffect(() => {
    if (fit) onFit(fit);
  }, [fit, onFit]);

  const target =
    focus?.bbox &&
    page &&
    focus.reportId === page.reportId &&
    focus.page === page.page
      ? focus
      : null;
  const pageKey = page ? `${page.reportId}:${page.page}` : "";
  const targetAt = target && !target.fading ? target.at : null;

  useEffect(() => {
    if (pageKey) viewerRef.current?.scrollTo({ top: 0, left: 0 });
  }, [pageKey]);

  // At fit the whole page is visible; zoomed in, bring the value into view.
  useEffect(() => {
    const viewer = viewerRef.current;
    const element = highlightRef.current;
    if (!targetAt || zoom <= 1 || !viewer || !element) return;
    const frame = requestAnimationFrame(() => {
      const top =
        element.getBoundingClientRect().top -
        viewer.getBoundingClientRect().top +
        viewer.scrollTop -
        viewer.clientHeight / 2;
      viewer.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [targetAt, zoom]);

  let highlight = null;
  if (target && scale) {
    // Widen the parsed line to the full table row, as printed.
    const [x, y, width, height] = target.bbox.map((value) => value * page.unit);
    const padX = page.width * 0.012;
    const padY = Math.max(height * 0.35, 3);
    const left = Math.max(0, Math.min(x - padX, page.width * 0.06));
    const right = Math.min(
      page.width,
      Math.max(x + width + padX, page.width * 0.94),
    );
    highlight = (
      <span
        ref={highlightRef}
        className={`${styles.highlight} ${target.fading ? styles.faded : ""}`}
        style={{
          left: left * scale,
          top: (y - padY) * scale,
          width: (right - left) * scale,
          height: (height + padY * 2) * scale,
        }}
        aria-hidden="true"
      />
    );
  }

  return (
    <div ref={viewerRef} className={styles.viewer}>
      {!page || !file ? (
        <Status>
          <p>Loading report…</p>
        </Status>
      ) : file.state === "expired" ? (
        <Status>
          <p>Your session has expired. Sign in again to see this report.</p>
          <button
            type="button"
            className={styles.retry}
            onClick={() => window.location.reload()}
          >
            Sign in again
          </button>
        </Status>
      ) : file.state === "error" ? (
        <Status>
          <p>{file.message}</p>
          <button
            type="button"
            className={styles.retry}
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try again
          </button>
        </Status>
      ) : scale ? (
        <div
          className={styles.page}
          style={{ width: page.width * scale, height: page.height * scale }}
        >
          {file.kind === "pdf" ? (
            <PdfCanvas
              key={pageKey}
              doc={file.doc}
              number={page.page}
              scale={scale}
            />
          ) : (
            // A private blob URL in this browser only: it must not pass
            // through Next's image optimiser or any other service.
            // biome-ignore lint/performance/noImgElement: authenticated blob URL, never a public image.
            <img
              className={styles.image}
              src={file.url}
              alt="Uploaded lab report"
            />
          )}
          {highlight}
        </div>
      ) : null}
    </div>
  );
}
