#!/usr/bin/env node
/**
 * `free-subs` command line interface.
 *
 * Progress and diagnostics go to stderr; subtitles and the summary go to
 * stdout, so `--stdout` can be piped safely.
 *
 * Two modes share the same pipeline:
 * - single file: `free-subs <file> [options]`
 * - batch:      `free-subs <directory> --batch [options]`
 *
 * The batch loop itself lives in `./pipeline/batch` so it stays testable
 * without spawning a process; this module only wires options, I/O and files.
 */
import { statSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
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
import { listMediaFiles, runBatch } from './pipeline/batch';
import { buildStudyDocument, serializeStudy } from './pipeline/study';
import { transcribeFile } from './pipeline/transcribe';
import { OpusMtTranslator, translateCueTexts } from './pipeline/translator';
import { exportVideo } from './server/exporter';

const LANGUAGES: readonly LanguageCode[] = ['auto', 'es', 'en', 'zh'];
const MODELS: readonly ModelId[] = ['tiny', 'base', 'small'];
const FORMATS = ['srt', 'vtt', 'ass', 'json'] as const;
const TRANSLATION_TARGETS = ['es', 'en', 'zh'] as const;

type SubtitleFormat = (typeof FORMATS)[number];
type SubtitleOnlyFormat = Exclude<SubtitleFormat, 'json'>;
type TranslationTarget = (typeof TRANSLATION_TARGETS)[number];

interface CliOptions {
  language: string;
  model: string;
  format: string;
  output?: string;
  stdout?: boolean;
  translate?: string;
  burn?: string;
  vocals?: boolean;
  batch?: boolean;
}

function assertChoice<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`Invalid ${label} "${value}". Expected one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

/** Parse `--translate es,en,zh`, keeping the first occurrence of each language. */
function parseTranslationTargets(value: string): TranslationTarget[] {
  const targets: TranslationTarget[] = [];
  for (const raw of value.split(',')) {
    const code = raw.trim();
    if (code === '') {
      continue;
    }
    const target = assertChoice(code, TRANSLATION_TARGETS, 'translate');
    if (!targets.includes(target)) {
      targets.push(target);
    }
  }
  if (targets.length === 0) {
    throw new Error('No translation languages given. Expected a comma-separated list of: es, en, zh.');
  }
  return targets;
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

function serializeCues(cues: SubtitleCue[], format: SubtitleOnlyFormat): string {
  if (format === 'srt') {
    return serializeSrt(cues);
  }
  if (format === 'vtt') {
    return serializeVtt(cues);
  }
  return serializeAss(cues, DEFAULT_EXPORT_STYLE, { width: 1920, height: 1080 });
}

function buildTranslatedCues(
  cues: SubtitleCue[],
  translated: string[],
  to: TranslationTarget,
): SubtitleCue[] {
  const style = styleForLanguage(to);
  return cues.map((cue, index) => ({
    index: index + 1,
    startMs: cue.startMs,
    endMs: cue.endMs,
    lines: wrapLines((translated[index] ?? cue.lines.join(' ')).trim(), style, to),
  }));
}

interface TranslationResult {
  translations: Record<string, SubtitleCue[]>;
  activeTargets: TranslationTarget[];
}

/**
 * Translate cues into every requested language, in context, using
 * `translateCueTexts`. Languages equal to the source are skipped.
 */
async function buildTranslations(
  cues: SubtitleCue[],
  sourceLanguage: string,
  targets: TranslationTarget[],
  options: { throwIfAlreadyTranslated?: boolean } = {},
): Promise<TranslationResult> {
  const translations: Record<string, SubtitleCue[]> = {};
  const activeTargets: TranslationTarget[] = [];

  if (targets.length === 0) {
    return { translations, activeTargets };
  }

  if (
    options.throwIfAlreadyTranslated === true &&
    targets.length === 1 &&
    targets[0] === sourceLanguage
  ) {
    throw new Error(`Subtitles are already in "${targets[0]}".`);
  }

  const translator = new OpusMtTranslator();
  const texts = cues.map((cue) => cue.lines.join(' '));

  for (const to of targets) {
    if (to === sourceLanguage) {
      continue;
    }
    const translated = await translateCueTexts(translator, texts, {
      from: sourceLanguage,
      to,
      onProgress: (percent) => {
        process.stderr.write(`[${Math.round(percent)}%] translating ${to}\n`);
      },
    });
    translations[to] = buildTranslatedCues(cues, translated, to);
    activeTargets.push(to);
  }

  return { translations, activeTargets };
}

/** Insert a suffix before the extension of `path`, e.g. `a.srt` -> `a.es.srt`. */
function withSuffix(path: string, suffix: string): string {
  const parsed = parse(path);
  return join(parsed.dir, `${parsed.name}${suffix}${parsed.ext}`);
}

async function runSingle(file: string, options: CliOptions): Promise<void> {
  const language = assertChoice(options.language, LANGUAGES, 'language');
  const model = assertChoice(options.model, MODELS, 'model');
  const format: SubtitleFormat = assertChoice(options.format, FORMATS, 'format');
  const targets = options.translate === undefined ? [] : parseTranslationTargets(options.translate);

  const result = await transcribeFile(file, parse(file).base, {
    language,
    model,
    isolateVocals: options.vocals === true,
    onProgress: (progress) => {
      process.stderr.write(`[${progress.percent}%] ${progress.stage}\n`);
    },
  });

  const { translations, activeTargets } = await buildTranslations(
    result.cues,
    result.language,
    targets,
    { throwIfAlreadyTranslated: true },
  );

  const studyDocument = (): string =>
    serializeStudy(
      buildStudyDocument({
        language: result.language,
        durationMs: result.durationMs,
        cues: result.cues,
        translations,
      }),
    );

  const input = parse(file);

  if (format === 'json') {
    const content = studyDocument();
    if (options.stdout === true) {
      process.stdout.write(content);
    } else {
      const outputPath = options.output ?? join(dirname(file), `${input.name}.json`);
      await writeFile(outputPath, content, 'utf8');
      process.stdout.write(`Saved ${outputPath}\n`);
    }
    process.stderr.write(
      `Language: ${result.language}\nCues: ${result.cues.length}\nDuration: ${formatDuration(result.durationMs)}\n`,
    );
    return;
  }

  // Non-JSON: a single target replaces the base content (today's behaviour);
  // several targets write the base plus one suffixed file per language.
  const singleTarget = activeTargets.length === 1 ? activeTargets[0] : undefined;
  const primaryCues = singleTarget === undefined ? result.cues : translations[singleTarget] ?? result.cues;
  const contentLanguage = singleTarget ?? result.language;

  const writeOutputs = async (): Promise<void> => {
    const outputs: { path: string; cues: SubtitleCue[] }[] = [];
    if (activeTargets.length <= 1) {
      const suffix = singleTarget === undefined ? '' : `.${singleTarget}`;
      const outputPath =
        options.output !== undefined
          ? withSuffix(options.output, suffix)
          : join(dirname(file), `${input.name}${suffix}.${format}`);
      outputs.push({ path: outputPath, cues: primaryCues });
    } else {
      const basePath =
        options.output !== undefined
          ? options.output
          : join(dirname(file), `${input.name}.${format}`);
      outputs.push({ path: basePath, cues: result.cues });
      for (const to of activeTargets) {
        const translatedCues = translations[to];
        if (translatedCues === undefined) {
          continue;
        }
        const translatedPath =
          options.output !== undefined
            ? withSuffix(options.output, `.${to}`)
            : join(dirname(file), `${input.name}.${to}.${format}`);
        outputs.push({ path: translatedPath, cues: translatedCues });
      }
    }

    for (const output of outputs) {
      await writeFile(output.path, serializeCues(output.cues, format), 'utf8');
      process.stdout.write(`Saved ${output.path}\n`);
    }
  };

  if (options.stdout === true) {
    process.stdout.write(serializeCues(primaryCues, format));
  } else {
    await writeOutputs();
  }

  process.stderr.write(
    `Language: ${contentLanguage}\nCues: ${primaryCues.length}\nDuration: ${formatDuration(result.durationMs)}\n`,
  );

  if (options.burn !== undefined) {
    const assPath = join(tmpdir(), `free-subs-cli-${Date.now()}.ass`);
    try {
      await writeFile(
        assPath,
        serializeAss(primaryCues, DEFAULT_EXPORT_STYLE, { width: 1920, height: 1080 }),
        'utf8',
      );
      await exportVideo(file, assPath, options.burn, result.durationMs, (percent) => {
        process.stderr.write(`[${percent}%] exporting\n`);
      });
      process.stdout.write(`Saved video ${options.burn}\n`);
    } finally {
      await rm(assPath, { force: true }).catch(() => undefined);
    }
  }
}

async function runBatchMode(directory: string, options: CliOptions): Promise<void> {
  const language = assertChoice(options.language, LANGUAGES, 'language');
  const model = assertChoice(options.model, MODELS, 'model');
  const format: SubtitleFormat = assertChoice(options.format, FORMATS, 'format');
  const targets = options.translate === undefined ? [] : parseTranslationTargets(options.translate);
  const outputDir = options.output;

  if (outputDir !== undefined) {
    await mkdir(outputDir, { recursive: true });
  }

  const files = listMediaFiles(directory);
  if (files.length === 0) {
    process.stderr.write(`No media files found in ${directory}.\n`);
  }

  const processFile = async (file: string): Promise<void> => {
    const result = await transcribeFile(file, parse(file).base, {
      language,
      model,
      isolateVocals: options.vocals === true,
      onProgress: (progress) => {
        process.stderr.write(`[${progress.percent}%] ${progress.stage}\n`);
      },
    });

    const { translations, activeTargets } = await buildTranslations(
      result.cues,
      result.language,
      targets,
    );

    const input = parse(file);
    const outDir = outputDir ?? dirname(file);

    if (format === 'json') {
      const content = serializeStudy(
        buildStudyDocument({
          language: result.language,
          durationMs: result.durationMs,
          cues: result.cues,
          translations,
        }),
      );
      const outputPath = join(outDir, `${input.name}.json`);
      await writeFile(outputPath, content, 'utf8');
      process.stdout.write(`Saved ${outputPath}\n`);
      return;
    }

    const basePath = join(outDir, `${input.name}.${format}`);
    await writeFile(basePath, serializeCues(result.cues, format), 'utf8');
    process.stdout.write(`Saved ${basePath}\n`);

    for (const to of activeTargets) {
      const translatedCues = translations[to];
      if (translatedCues === undefined) {
        continue;
      }
      const translatedPath = join(outDir, `${input.name}.${to}.${format}`);
      await writeFile(translatedPath, serializeCues(translatedCues, format), 'utf8');
      process.stdout.write(`Saved ${translatedPath}\n`);
    }
  };

  process.stderr.write(`Batch: ${files.length} file(s) in ${directory}\n`);

  const summary = await runBatch(files, processFile, {
    onEvent: (event) => {
      if (event.type === 'start') {
        process.stderr.write(`-> ${event.file}\n`);
      } else if (event.type === 'error') {
        process.stderr.write(`Error (${event.file}): ${event.error}\n`);
      }
    },
  });

  process.stdout.write(
    `Summary: ${summary.succeeded} succeeded, ${summary.failed} failed (${summary.total} total)\n`,
  );
  if (summary.failed > 0) {
    process.exitCode = 1;
  }
}

async function run(path: string, options: CliOptions): Promise<void> {
  if (options.batch === true) {
    let isDirectory = false;
    try {
      isDirectory = statSync(path).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (!isDirectory) {
      throw new Error(`--batch requires a directory, but "${path}" is not a directory.`);
    }
    await runBatchMode(path, options);
    return;
  }

  await runSingle(path, options);
}

const program = new Command();

program
  .name('free-subs')
  .description(
    'Generate SRT/VTT/ASS/JSON subtitles locally with Whisper, translate them and burn them into video.',
  )
  .version('0.2.0')
  .argument('<path>', 'audio/video file to transcribe, or a directory with --batch')
  .option('-l, --language <lang>', `source language (${LANGUAGES.join('|')})`, 'auto')
  .option('-m, --model <model>', `Whisper model (${MODELS.join('|')})`, 'base')
  .option(
    '-f, --format <format>',
    `subtitle format (${FORMATS.join('|')}); json writes the full study document`,
    'srt',
  )
  .option('-o, --output <path>', 'output file, or output directory with --batch')
  .option(
    '-t, --translate <langs>',
    `translate subtitles, comma-separated (${TRANSLATION_TARGETS.join(',')})`,
  )
  .option('--batch', 'process every media file in the given directory')
  .option('--vocals', 'isolate the centre channel (music mode: songs with loud backing tracks)')
  .option('--burn <output>', 'burn subtitles into the video (mp4)')
  .option('--stdout', 'write subtitles to stdout instead of a file')
  .action(async (path: string, options: CliOptions) => {
    try {
      await run(path, options);
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
