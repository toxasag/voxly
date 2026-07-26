/**
 * Extract an audio track from a video container for Whisper ASR.
 * Requires ffmpeg on PATH (installed in worker Docker images).
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ExtractedAudio = { buffer: Buffer; format: 'ogg' | 'mp3' };

async function runFfmpeg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 2000) stderr = stderr.slice(-2000);
    });
    child.on('error', () => resolve(false));
    child.on('close', (code) => {
      if (code !== 0) {
        console.warn(
          '[ai-core] ffmpeg exit',
          code,
          stderr.slice(-400),
        );
      }
      resolve(code === 0);
    });
  });
}

/**
 * Demux audio from video bytes → compact ogg/opus (fallback mp3).
 * Returns null if ffmpeg missing or extract fails (caller may try raw video).
 */
export async function extractAudioFromVideo(
  videoBuffer: Buffer,
  inputExt = 'mp4',
): Promise<ExtractedAudio | null> {
  if (!videoBuffer.length) return null;
  const id = randomBytes(8).toString('hex');
  const tmpDir = os.tmpdir();
  const inPath = path.join(tmpDir, `voxly-vid-${id}.${inputExt.replace(/^\./, '')}`);
  const oggPath = path.join(tmpDir, `voxly-aud-${id}.ogg`);
  const mp3Path = path.join(tmpDir, `voxly-aud-${id}.mp3`);

  try {
    await fs.writeFile(inPath, videoBuffer);

    const oggOk = await runFfmpeg([
      '-y',
      '-i',
      inPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'libopus',
      '-b:a',
      '32k',
      oggPath,
    ]);
    if (oggOk) {
      const buffer = await fs.readFile(oggPath);
      if (buffer.length > 0) return { buffer, format: 'ogg' };
    }

    const mp3Ok = await runFfmpeg([
      '-y',
      '-i',
      inPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '48k',
      mp3Path,
    ]);
    if (mp3Ok) {
      const buffer = await fs.readFile(mp3Path);
      if (buffer.length > 0) return { buffer, format: 'mp3' };
    }
    return null;
  } catch (err) {
    console.warn('[ai-core] extractAudioFromVideo failed', err);
    return null;
  } finally {
    await Promise.all([
      fs.unlink(inPath).catch(() => undefined),
      fs.unlink(oggPath).catch(() => undefined),
      fs.unlink(mp3Path).catch(() => undefined),
    ]);
  }
}
