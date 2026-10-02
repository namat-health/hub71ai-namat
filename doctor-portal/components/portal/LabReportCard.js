import dynamic from "next/dynamic";
import { useState } from "react";
import styles from "./LabReport.module.css";
import ParsedValues from "./ParsedValues";

// pdf.js runs only in the browser. Keeping it out of the server bundle also
// keeps the Azure package's server aliases unchanged.
const ReportViewer = dynamic(() => import("./ReportViewer"), {
  ssr: false,
  loading: () => (
    <div className={styles.status}>
      <p>Loading report…</p>
    </div>
  ),
});

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.4;

function stepZoom(value, delta) {
  return Math.min(
    ZOOM_MAX,
    Math.max(ZOOM_MIN, Math.round((value + delta) * 10) / 10),
  );
}

export default function LabReportCard({
  reports,
  extractions,
  labs,
  labView,
  onLabView,
  pages,
  onPages,
  pageIndex,
  onPageIndex,
  zoom,
  onZoom,
  focus,
  toConfirm,
  onConfirm,
  onLocate,
  onSaveValue,
  rowFocus,
  pageNumber,
}) {
  const [fit, setFit] = useState(1);
  const original = labView === "original";
  const total = pages?.length || 0;
  const current = pages?.[pageIndex];
  const currentReport =
    reports.find((report) => report.id === current?.reportId) || reports[0];
  const isPdf = currentReport?.mime === "application/pdf";

  return (
    <section className={styles.card} aria-label="Lab report">
      <header className={styles.header}>
        <div
          className={styles.tabs}
          role="tablist"
          aria-label="Lab report view"
        >
          <button
            type="button"
            role="tab"
            id="tab-original"
            aria-selected={original}
            aria-controls="lab-original"
            className={`${styles.tab} ${original ? styles.tabActive : ""}`}
            onClick={() => onLabView("original")}
          >
            Lab report
          </button>
          <button
            type="button"
            role="tab"
            id="tab-parsed"
            aria-selected={!original}
            aria-controls="lab-parsed"
            className={`${styles.tab} ${!original ? styles.tabActive : ""}`}
            onClick={() => onLabView("parsed")}
          >
            What Namat read
          </button>
        </div>
        {original && reports.length > 0 && (
          <div className={styles.tools}>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Previous page"
              disabled={pageIndex <= 0}
              onClick={() => onPageIndex(pageIndex - 1)}
            >
              ‹
            </button>
            <span
              className={styles.pageLabel}
              title={
                current && reports.length > 1
                  ? `${currentReport?.name}, page ${current.page}`
                  : undefined
              }
            >
              {total ? `${pageIndex + 1} / ${total}` : "– / –"}
            </span>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Next page"
              disabled={pageIndex >= total - 1}
              onClick={() => onPageIndex(pageIndex + 1)}
            >
              ›
            </button>
            <span className={styles.divider} aria-hidden="true" />
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Zoom out"
              onClick={() => onZoom(stepZoom(zoom, -0.2))}
            >
              −
            </button>
            <button
              type="button"
              className={styles.zoomLabel}
              aria-label="Fit page"
              onClick={() => onZoom(1)}
            >
              {zoom === 1 ? "Fit" : `${Math.round(fit * zoom * 100)}%`}
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Zoom in"
              onClick={() => onZoom(stepZoom(zoom, 0.2))}
            >
              +
            </button>
            <span className={styles.divider} aria-hidden="true" />
            {currentReport && (
              <a
                className={`${styles.iconButton} ${styles.download}`}
                href={`${currentReport.sourceUrl}?download=1`}
                download={currentReport.name}
                aria-label={isPdf ? "Download PDF" : "Download report"}
                title={isPdf ? "Download PDF" : "Download report"}
              >
                ↓
              </a>
            )}
          </div>
        )}
        {!original && toConfirm > 0 && (
          <button type="button" className={styles.confirm} onClick={onConfirm}>
            <span className={styles.confirmDot} aria-hidden="true" />
            {toConfirm} {toConfirm === 1 ? "value" : "values"} to confirm
          </button>
        )}
      </header>
      <div className={styles.body}>
        <div
          id="lab-original"
          role="tabpanel"
          aria-labelledby="tab-original"
          className={styles.panel}
          hidden={!original}
        >
          {reports.length ? (
            <ReportViewer
              reports={reports}
              pages={pages}
              onPages={onPages}
              pageIndex={pageIndex}
              zoom={zoom}
              onFit={setFit}
              focus={focus}
              visible={original}
            />
          ) : (
            <div className={styles.status}>
              <p>No lab report was uploaded.</p>
            </div>
          )}
        </div>
        <div
          id="lab-parsed"
          role="tabpanel"
          aria-labelledby="tab-parsed"
          className={styles.panel}
          hidden={original}
        >
          <ParsedValues
            reports={reports}
            extractions={extractions}
            labs={labs}
            pageNumber={pageNumber}
            onLocate={onLocate}
            onSaveValue={onSaveValue}
            rowFocus={rowFocus}
          />
        </div>
      </div>
    </section>
  );
}
