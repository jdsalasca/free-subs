import { useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from 'react';
import { formatBytes } from '../format';

const ACCEPT = 'audio/*,video/*,.wav,.mp3,.mp4,.mkv,.mov,.m4a';

interface DropzoneProps {
  file: File | null;
  onFile: (file: File) => void;
  disabled?: boolean;
}

function UploadIcon() {
  return (
    <svg
      className="dropzone-icon"
      viewBox="0 0 24 24"
      width="34"
      height="34"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

function MediaIcon() {
  return (
    <svg
      className="dropzone-icon"
      viewBox="0 0 24 24"
      width="34"
      height="34"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 18V6l10-2v12" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="16" cy="16" r="3" />
    </svg>
  );
}

export function Dropzone({ file, onFile, disabled = false }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const openPicker = () => {
    if (disabled) {
      return;
    }
    inputRef.current?.click();
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) {
      onFile(selected);
    }
    // Reset so the same file can be picked again.
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) {
      return;
    }
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) {
      onFile(dropped);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (disabled) {
      return;
    }
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openPicker();
    }
  };

  const className = [
    'dropzone',
    dragging ? 'is-dragging' : '',
    file ? 'has-file' : '',
    disabled ? 'is-disabled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      data-testid="dropzone"
      className={className}
      onClick={openPicker}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label="Upload an audio or video file"
    >
      <input
        ref={inputRef}
        data-testid="file-input"
        className="file-input"
        type="file"
        accept={ACCEPT}
        onChange={handleChange}
        disabled={disabled}
        hidden
      />

      {file ? (
        <>
          <MediaIcon />
          <div className="dropzone-file">
            <span className="dropzone-file-name">{file.name}</span>
            <span className="dropzone-file-size">{formatBytes(file.size)}</span>
          </div>
          <span className="dropzone-hint">Click or drop another file to replace it</span>
        </>
      ) : (
        <>
          <UploadIcon />
          <span className="dropzone-title">Drop an audio or video file here</span>
          <span className="dropzone-hint">
            or click to browse — WAV, MP3, MP4, MKV, MOV, M4A
          </span>
        </>
      )}
    </div>
  );
}
