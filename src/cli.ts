#!/usr/bin/env node
/**
 * `free-subs` command line interface.
 *
 * Progress and diagnostics go to stderr; subtitles and the summary go to
 * stdout, so `--stdout` can be piped safely.
 */
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { Command } from 'commander';
import {
  DEFAULT_EXPORT_STYLE,
  serializeAss,
  serializeSrt,
  serializeVtt,
  styleForLanguage,
  wrapLines,
  type LanguageCode,
  type ModelId,
  type SubtitleCue,
} from './core';
import { transcribeFile } from './pipeline/transcribe';
import { OpusMtTranslator } from './pipeline/translator';
import { exportVideo } from './server/exporter';

const LANGUAGES: readonly LanguageCode[] = ['auto', 'es', 'en', 'zh'];
const MODELS: readonly ModelId[] = ['tiny', 'base', 'small'];
const FORMATS = ['srt', 'vtt', 'ass'] as const;
const TRANSLATION_TARGETS = ['es', 'en', 'zh'] as const;

type SubtitleFormat = (typeof FORMATS)[number];
type TranslationTarget = (typeof TRANSLATION_TARGETS)[number];

interface CliOptions {
  language: string;
  model: string;
  format: string;
  output?: string;
  stdout?: boolean;
  translate?: string;
  burn?: string;
}

function assertChoice<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Invalid ${label} "${value}". Expected one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = durationMs / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = seconds.toFixed(1).padStart(4, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

async function run(file: string, options: CliOptions): Promise<void> {
  const language = assertChoice(options.language, LANGUAGES, 'language');
  const model = assertChoice(options.model, MODELS, 'model');
  const format: SubtitleFormat = assertChoice(options.format, FORMATS, 'format');

  const result = await transcribeFile(file, parse(file).base, {
    language,
    model,
    onProgress: (progress) => {
      process.stderr.write(`[${progress.percent}%] ${progress.stage}\n`);
    },
  });

  let cues: SubtitleCue[] = result.cues;
  let contentLanguage = result.language;

  if (options.translate !== undefined) {
    const to: TranslationTarget = assertChoice(options.translate, TRANSLATION_TARGETS, 'translate');
    if (to === result.language) {
      throw new Error(`Subtitles are already in "${to}".`);
    }
    const translator = new OpusMtTranslator();
    const texts = cues.map((cue) => cue.lines.join(' '));
    const translated = await translator.translate(texts, {
      from: result.language,
      to,
      onProgress: (percent) => {
        process.stderr.write(`[${Math.round(percent)}%] translating\n`);
      },
    });
    const style = styleForLanguage(to);
    cues = cues.map((cue, index) => ({
      index: index + 1,
      startMs: cue.startMs,
      endMs: cue.endMs,
      lines: wrapLines((translated[index] ?? cue.lines.join(' ')).trim(), style, to),
    }));
    contentLanguage = to;
  }

  const content =
    format === 'srt'
      ? serializeSrt(cues)
      : format === 'vtt'
        ? serializeVtt(cues)
        : serializeAss(cues, DEFAULT_EXPORT_STYLE, { width: 1920, height: 1080 });

  const summary =
    `Language: ${contentLanguage}\n` +
    `Cues: ${cues.length}\n` +
    `Duration: ${formatDuration(result.durationMs)}\n`;

  if (options.stdout === true) {
    process.stdout.write(content);
    process.stderr.write(summary);
  } else {
    const input = parse(file);
    const suffix = options.translate !== undefined ? `.${contentLanguage}` : '';
    const outputPath = options.output ?? join(dirname(file), `${input.name}${suffix}.${format}`);
    await writeFile(outputPath, content, 'utf8');
    process.stdout.write(`Saved ${outputPath}\n`);
    process.stdout.write(summary);
  }

  if (options.burn !== undefined) {
    const assPath = join(tmpdir(), `free-subs-cli-${Date.now()}.ass`);
    try {
      await writeFile(assPath, serializeAss(cues, DEFAULT_EXPORT_STYLE, { width: 1920, height: 1080 }), 'utf8');
      await exportVideo(file, assPath, options.burn, result.durationMs, (percent) => {
        process.stderr.write(`[${percent}%] exporting\n`);
      });
      process.stdout.write(`Saved video ${options.burn}\n`);
    } finally {
      await rm(assPath, { force: true }).catch(() => undefined);
    }
  }
}

const program = new Command();

program
  .name('free-subs')
  .description('Generate SRT/VTT/ASS subtitles locally with Whisper, translate them and burn them into video.')
  .version('0.2.0')
  .argument('<file>', 'audio or video file to transcribe')
  .option('-l, --language <lang>', `source language (${LANGUAGES.join('|')})`, 'auto')
  .option('-m, --model <model>', `Whisper model (${MODELS.join('|')})`, 'base')
  .option('-f, --format <format>', `subtitle format (${FORMATS.join('|')})`, 'srt')
  .option('-o, --output <path>', 'output file path')
  .option('-t, --translate <lang>', `translate subtitles (${TRANSLATION_TARGETS.join('|')})`)
  .option('--burn <output>', 'burn subtitles into the video (mp4)')
  .option('--stdout', 'write subtitles to stdout instead of a file')
  .action(async (file: string, options: CliOptions) => {
    try {
      await run(file, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Error: ${message}\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
