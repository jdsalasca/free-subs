/**
 * Serializers for the two supported subtitle formats: SRT and WebVTT.
 *
 * Output uses `\n` line endings only (never CRLF) and ends with exactly one
 * trailing newline when it is non-empty.
 */
import { formatSrtTimestamp, formatVttTimestamp } from './time';
import type { SubtitleCue, WordTiming } from './types';

function srtBlock(cue: SubtitleCue): string {
  const range = `${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(cue.endMs)}`;
  return `${cue.index}\n${range}\n${cue.lines.join('\n')}`;
}

/** Serialize cues as an SRT document. */
export function serializeSrt(cues: SubtitleCue[]): string {
  if (cues.length === 0) {
    return '';
  }
  return `${cues.map(srtBlock).join('\n\n')}\n`;
}

function karaokeLine(words: WordTiming[]): string {
  return words
    .map((word) => `<${formatVttTimestamp(word.startMs)}>${word.text}`)
    .join(' ');
}

function vttLines(cue: SubtitleCue, karaoke: boolean): string[] {
  if (!karaoke || cue.words === undefined || cue.words.length === 0) {
    return cue.lines;
  }

  const words = cue.words;
  const lines: string[] = [];
  let wordIndex = 0;

  for (const line of cue.lines) {
    const lineWords: WordTiming[] = [];
    let accumulated = '';
    while (wordIndex < words.length) {
      const word = words[wordIndex];
      if (word === undefined) {
        break;
      }
      const candidate = accumulated === '' ? word.text : `${accumulated} ${word.text}`;
      if (candidate.length <= line.length) {
        accumulated = candidate;
        lineWords.push(word);
        wordIndex++;
      } else {
        break;
      }
    }
    if (lineWords.length === 0 && wordIndex < words.length) {
      const word = words[wordIndex];
      if (word !== undefined) {
        lineWords.push(word);
        wordIndex++;
      }
    }
    lines.push(karaokeLine(lineWords));
  }

  if (wordIndex < words.length) {
    const leftover = karaokeLine(words.slice(wordIndex));
    if (lines.length === 0) {
      lines.push(leftover);
    } else {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${leftover}`;
    }
  }

  return lines;
}

/** Serialize cues as a WebVTT document, optionally with karaoke timestamps. */
export function serializeVtt(cues: SubtitleCue[], opts?: { karaoke?: boolean }): string {
  if (cues.length === 0) {
    return 'WEBVTT\n\n';
  }

  const karaoke = opts?.karaoke === true;
  const blocks = cues.map((cue) => {
    const range = `${formatVttTimestamp(cue.startMs)} --> ${formatVttTimestamp(cue.endMs)}`;
    return `${range}\n${vttLines(cue, karaoke).join('\n')}`;
  });

  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}
