# Generates speech fixtures for the E2E tests using Windows SAPI (offline TTS).
# Requires Windows + PowerShell. Run: npm run fixtures
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'tests\e2e\fixtures'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

function New-Fixture {
    param([string]$VoicePattern, [string]$Text, [string]$File)
    $voice = $synth.GetInstalledVoices() |
        Where-Object { $_.VoiceInfo.Name -match $VoicePattern } |
        Select-Object -First 1
    if ($voice) {
        $synth.SelectVoice($voice.VoiceInfo.Name)
    } else {
        Write-Warning "No voice matching '$VoicePattern'; using default voice."
    }
    $path = Join-Path $outDir $File
    $synth.SetOutputToWaveFile($path)
    $synth.Speak($Text)
    $synth.SetOutputToNull()
    Write-Host "wrote $path"
}

New-Fixture 'Zira|David|Mark|en-US' 'Hello world. This is a subtitle test for Free Subs. It works offline.' 'hello-en.wav'
New-Fixture 'Helena|Laura|Pablo|es-ES' 'Hola mundo. Esta es una prueba para Free Subs. Funciona sin internet.' 'hola-es.wav'

$synth.Dispose()

# Downsample fixtures to 16 kHz mono (smaller files, faster ASR) when ffmpeg exists.
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ffmpeg) {
    Get-ChildItem $outDir -Filter *.wav | ForEach-Object {
        $tmp = "$($_.FullName).16k.wav"
        & $ffmpeg.Source -y -loglevel error -i $_.FullName -ar 16000 -ac 1 $tmp
        if (Test-Path $tmp) { Move-Item -Force $tmp $_.FullName }
    }
    Write-Host 'resampled fixtures to 16 kHz mono'
} else {
    Write-Warning 'ffmpeg not found; fixtures keep their original sample rate.'
}
