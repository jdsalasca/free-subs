#!/usr/bin/env node
/**
 * `free-subs` command line interface.
 *
 * Progress and diagnostics go to stderr; subtitles and the summary go to
 * stdout, so `--stdout` can be piped safely.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import { Command } from 'commander';
import type { LanguageCode, ModelId } from './core';
import { transcribeFile } from './pipeline/transcribe';

const LANGUAGES: readonly LanguageCode[] = ['auto', 'es', 'en', 'zh'];
const MODELS: readonly ModelId[] = ['tiny', 'base', 'small'];
const FORMATS = ['srt', 'vtt'] as const;

type SubtitleFormat = (typeof FORMATS)[number];

interface CliOptions {
  language: string;
  model: string;
  format: string;
  output?: string;
  stdout?: boolean;
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

  const content = format === 'srt' ? result.srt : result.vtt;
  const summary =
    `Language: ${result.language}\n` +
    `Cues: ${result.stats.cueCount}\n` +
    `Words: ${result.stats.wordCount}\n` +
    `Duration: ${formatDuration(result.durationMs)}\n`;

  if (options.stdout === true) {
    process.stdout.write(content);
    process.stderr.write(summary);
    return;
  }

  const input = parse(file);
  const outputPath = options.output ?? join(dirname(file), `${input.name}.${format}`);
  await writeFile(outputPath, content, 'utf8');
  process.stdout.write(`Saved ${outputPath}\n`);
  process.stdout.write(summary);
}

const program = new Command();

program
  .name('free-subs')
  .description('Generate SRT/VTT subtitles locally with Whisper.')
  .version('0.1.0')
  .argument('<file>', 'audio or video file to transcribe')
  .option('-l, --language <lang>', `source language (${LANGUAGES.join('|')})`, 'auto')
  .option('-m, --model <model>', `Whisper model (${MODELS.join('|')})`, 'base')
  .option('-f, --format <format>', `subtitle format (${FORMATS.join('|')})`, 'srt')
  .option('-o, --output <path>', 'output file path')
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
