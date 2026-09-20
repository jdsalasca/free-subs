import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ExportRecord, SubtitleExportStyle } from '../../core/types';
import { exportDownloadUrl } from '../api';
import { ProgressPanel } from './ProgressPanel';
import { StyleEditor } from './StyleEditor';
import type { RunPhase } from './TranslatePanel';

/** Tracks the rendered width of an element so the preview can scale to 1080p. */
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const update = () => setWidth(element.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => char + char)
          .join('')
      : normalized;
  const value = Number.parseInt(full, 16);

  if (!Number.isFinite(value) || full.length !== 6) {
    return `rgba(0, 0, 0, ${alpha})`;
  }

  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function buildTextShadow(color: string, outlineWidth: number, shadow: number): string {
  const parts: string[] = [];

  if (outlineWidth > 0) {
    const width = Math.max(outlineWidth, 0.5);
    for (let index = 0; index < 8; index += 1) {
      const angle = (Math.PI / 4) * index;
      const dx = (Math.cos(angle) * width).toFixed(2);
      const dy = (Math.sin(angle) * width).toFixed(2);
      parts.push(`${dx}px ${dy}px 0 ${color}`);
    }
  }

  if (shadow > 0) {
    parts.push(`0 ${shadow.toFixed(2)}px ${(shadow * 2).toFixed(2)}px rgba(0, 0, 0, 0.65)`);
  }

  return parts.length > 0 ? parts.join(', ') : 'none';
}

interface PreviewStageProps {
  style: SubtitleExportStyle;
  text: string;
  mediaUrl: string | null;
  isVideo: boolean;
}

/**
 * 16:9 preview surface. The overlay mirrors the ASS export scale
 * (`fontSize * previewWidth / 1920`) so the user sees the real result.
 */
function PreviewStage({ style, text, mediaUrl, isVideo }: PreviewStageProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const baseWidth = width > 0 ? width : 640;
  const scale = baseWidth / 1920;

  const fontSize = Math.max(10, style.fontSize * scale);
  const outlineWidth = style.outlineWidth * scale;
  const margin = style.marginV * scale;

  const alignItems =
    style.position === 'bottom'
      ? 'flex-end'
      : style.position === 'top'
        ? 'flex-start'
        : 'center';

  const layerStyle: CSSProperties = {
    alignItems,
    paddingTop: style.position === 'top' ? margin : 0,
    paddingBottom: style.position === 'bottom' ? margin : 0,
  };

  const textStyle: CSSProperties = {
    fontFamily: `${style.fontFamily}, sans-serif`,
    fontSize: `${fontSize}px`,
    fontWeight: style.bold ? 700 : 400,
    color: style.primaryColor,
    textShadow: buildTextShadow(style.outlineColor, outlineWidth, style.shadow * scale),
    lineHeight: 1.25,
    whiteSpace: 'pre-line',
    textAlign: 'center',
    ...(style.background
      ? {
          backgroundColor: hexToRgba(style.backgroundColor, style.backgroundOpacity),
          padding: '0.25em 0.6em',
          borderRadius: '0.15em',
        }
      : {}),
  };

  return (
    <div className="preview-stage" ref={ref}>
      {isVideo && mediaUrl ? (
        <video
          className="preview-video"
          src={mediaUrl}
          muted
          playsInline
          preload="metadata"
        />
      ) : (
        <div className="preview-placeholder" aria-hidden="true">
          <span>Vista previa</span>
        </div>
      )}

      <div className="preview-overlay-layer" style={layerStyle}>
        <div data-testid="preview-overlay" className="preview-overlay" style={textStyle}>
          {text}
        </div>
      </div>
    </div>
  );
}

interface ExportPanelProps {
  style: SubtitleExportStyle;
  fonts: string[];
  previewText: string;
  mediaUrl: string | null;
  isVideo: boolean;
  phase: RunPhase;
  error: string | null;
  exportRecord: ExportRecord | null;
  onStyleChange: (patch: Partial<SubtitleExportStyle>) => void;
  onExport: () => void;
}

export function ExportPanel({
  style,
  fonts,
  previewText,
  mediaUrl,
  isVideo,
  phase,
  error,
  exportRecord,
  onStyleChange,
  onExport,
}: ExportPanelProps) {
  const busy = phase === 'processing';

  return (
    <section className="card">
      <h2 className="card-title">
        <span className="step">4</span> Exportar video
      </h2>

      <div className="export-layout">
        <div className="export-editor">
          <StyleEditor style={style} fonts={fonts} onChange={onStyleChange} />
        </div>
        <div className="export-preview">
          <h3 className="block-title">Vista previa</h3>
          <PreviewStage
            style={style}
            text={previewText}
            mediaUrl={mediaUrl}
            isVideo={isVideo}
          />
        </div>
      </div>

      <button
        data-testid="export-button"
        type="button"
        className="btn btn-primary btn-big"
        onClick={onExport}
        disabled={busy}
      >
        {busy ? 'Exportando…' : 'Exportar video'}
      </button>

      {busy ? (
        <div className="panel-block">
          <ProgressPanel
            progress={exportRecord?.progress ?? { stage: 'exporting', percent: 0 }}
            statusTestId="export-status"
            progressTestId={null}
            label="Progreso de exportación"
          />
        </div>
      ) : null}

      {phase === 'error' && error ? (
        <div className="inline-error" role="alert">
          {error}
        </div>
      ) : null}

      {phase === 'done' && exportRecord ? (
        <>
          <div data-testid="export-done" className="status-done" role="status">
            <span className="status-done-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                focusable="false"
              >
                <path d="m5 12 5 5L20 7" />
              </svg>
            </span>
            Video listo
          </div>

          <div className="result-actions">
            <a
              data-testid="download-video"
              className="btn btn-primary"
              href={exportDownloadUrl(exportRecord.id)}
              download
            >
              Descargar video
            </a>
          </div>
        </>
      ) : null}
    </section>
  );
}
