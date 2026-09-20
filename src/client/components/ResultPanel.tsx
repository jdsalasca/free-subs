import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import type { JobRecord } from '../../core/types';
import { downloadUrl } from '../api';
import { formatDuration, formatTimestamp } from '../format';

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path below.
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

interface ResultPanelProps {
  job: JobRecord;
  file: File | null;
}

export function ResultPanel({ job, file }: ResultPanelProps) {
  const result = job.result;
  const cues = useMemo(() => result?.cues ?? [], [result]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const mediaUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    return () => {
      if (mediaUrl) {
        URL.revokeObjectURL(mediaUrl);
      }
    };
  }, [mediaUrl]);

  const isVideo = useMemo(() => {
    if (!file) {
      return false;
    }
    if (file.type.startsWith('video/')) {
      return true;
    }
    if (file.type.startsWith('audio/')) {
      return false;
    }
    return /\.(mp4|mkv|mov|webm|avi|m4v)$/i.test(file.name);
  }, [file]);

  if (!result) {
    return null;
  }

  const transcriptText =
    cues.length > 0
      ? cues.map((cue) => cue.lines.join(' ')).join(' ')
      : result.segments.map((segment) => segment.text).join(' ');

  const stats = result.stats;
  const durationMs = stats?.durationMs ?? result.durationMs;
  const cueCount = stats?.cueCount ?? cues.length;
  const avgCps = stats?.avgCps ?? 0;
  const maxCps = stats?.maxCps ?? 0;

  const handleTimeUpdate = (event: SyntheticEvent<HTMLMediaElement>) => {
    const currentMs = event.currentTarget.currentTime * 1000;
    const index = cues.findIndex(
      (cue) => currentMs >= cue.startMs && currentMs <= cue.endMs,
    );
    setActiveIndex(index >= 0 ? index : null);
  };

  const handleCopy = async () => {
    const ok = await copyText(result.srt);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const mediaProps = {
    'data-testid': 'media-player',
    className: 'media-player',
    controls: true,
    src: mediaUrl ?? undefined,
    onTimeUpdate: handleTimeUpdate,
    onSeeked: handleTimeUpdate,
  };

  return (
    <div className="result">
      <div className="result-stats" role="group" aria-label="Transcription statistics">
        <div className="stat">
          <span className="stat-label">Language</span>
          <span className="stat-value">{result.language.toUpperCase()}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Duration</span>
          <span className="stat-value">{formatDuration(durationMs)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Cues</span>
          <span className="stat-value">{cueCount}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Avg CPS</span>
          <span className="stat-value">{avgCps.toFixed(1)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Max CPS</span>
          <span className="stat-value">{maxCps.toFixed(1)}</span>
        </div>
      </div>

      {mediaUrl ? (
        isVideo ? (
          <video {...mediaProps} />
        ) : (
          <audio {...mediaProps} />
        )
      ) : null}

      <div className="result-actions">
        <a
          data-testid="download-srt"
          className="btn btn-download"
          href={downloadUrl(job.id, 'srt')}
          download
        >
          Download SRT
        </a>
        <a
          data-testid="download-vtt"
          className="btn btn-download"
          href={downloadUrl(job.id, 'vtt')}
          download
        >
          Download VTT
        </a>
        <button
          data-testid="copy-srt"
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            void handleCopy();
          }}
        >
          Copy SRT
        </button>
        {copied ? (
          <span className="copied-hint" role="status">
            Copied!
          </span>
        ) : null}
      </div>

      <div className="transcript-block">
        <h3 className="block-title">Transcript</h3>
        <div data-testid="transcript" className="transcript">
          {transcriptText}
        </div>
      </div>

      <div className="cues-block">
        <h3 className="block-title">Cues</h3>
        <ol className="cue-list">
          {cues.map((cue, index) => (
            <li
              key={`${cue.index}-${cue.startMs}`}
              data-testid={index === activeIndex ? 'active-cue' : undefined}
              className={`cue${index === activeIndex ? ' is-active' : ''}`}
            >
              <span className="cue-time">
                {formatTimestamp(cue.startMs)} – {formatTimestamp(cue.endMs)}
              </span>
              <span className="cue-text">
                {cue.lines.map((line, lineIndex) => (
                  <span className="cue-line" key={lineIndex}>
                    {line}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
