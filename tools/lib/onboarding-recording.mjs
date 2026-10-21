import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Encode real compositor frames at their captured intervals; never invent intermediate motion. */
export async function recordScreencast(page, out, name, performActions) {
  const session = await page.context().newCDPSession(page);
  const captured = [], acknowledgments = [];
  const onFrame = event => {
    captured.push({ timestamp: event.metadata.timestamp, metadata: event.metadata, data: Buffer.from(event.data, 'base64') });
    acknowledgments.push(session.send('Page.screencastFrameAck', { sessionId: event.sessionId }));
  };
  const raw = mkdtempSync(join(tmpdir(), 'onethu-tour-recording-'));
  try {
    await session.send('Page.enable');
    // Headless Chrome's outer window includes browser chrome even with an emulated CSS viewport.
    // Calibrate from real compositor metadata so recordings include the fixed footer.
    let calibrationTimer;
    const calibration = new Promise((resolve, reject) => {
      const listener = event => {
        session.send('Page.screencastFrameAck', { sessionId: event.sessionId });
        clearTimeout(calibrationTimer); session.off('Page.screencastFrame', listener); resolve(event.metadata);
      };
      session.on('Page.screencastFrame', listener);
      calibrationTimer = setTimeout(() => { session.off('Page.screencastFrame', listener); reject(new Error('No screencast calibration frame')); }, 5000);
    });
    await session.send('Page.startScreencast', { format: 'jpeg', quality: 40, everyNthFrame: 1 });
    const metadata = await calibration;
    await session.send('Page.stopScreencast');
    const viewport = page.viewportSize(), { windowId, bounds } = await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds', { windowId, bounds: { width: bounds.width + viewport.width - metadata.deviceWidth, height: bounds.height + viewport.height - metadata.deviceHeight } });
    assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), viewport, 'Recording calibration must preserve the tested CSS viewport');
    session.on('Page.screencastFrame', onFrame);
    await session.send('Page.startScreencast' , { format: 'jpeg', quality: 88, maxWidth: 1280, maxHeight: 860, everyNthFrame: 2 });
    await performActions();
    await session.send('Page.stopScreencast');
    await Promise.all(acknowledgments);
    assert.ok(captured.length > 4, 'Screencast must contain actual compositor frames');
    assert.ok(captured.every(frame => frame.metadata.deviceWidth >= viewport.width && frame.metadata.deviceHeight >= viewport.height && frame.metadata.deviceWidth <= 1280 && frame.metadata.deviceHeight <= 860), 'Every unscaled recording frame must cover the full tested CSS viewport');
    const manifest = [];
    captured.forEach((frame, index) => {
      const filename = join(raw, `${String(index).padStart(5, '0')}.jpg`);
      writeFileSync(filename, frame.data);
      manifest.push(`file '${filename}'`, 'option framerate 1000');
      if (index + 1 < captured.length) manifest.push(`duration ${Math.max(0.001, captured[index + 1].timestamp - frame.timestamp).toFixed(6)}`);
    });
    const listing = join(raw, 'frames.ffconcat');
    writeFileSync(listing, manifest.join('\n') + '\n');
    mkdirSync(`${out}/recordings`, { recursive: true });
    const video = `${out}/recordings/${name}.mp4`;
    execFileSync(process.env.FFMPEG_BIN ?? 'ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listing, '-fps_mode', 'vfr', '-vf', `crop=${viewport.width}:${viewport.height}:0:0,pad=ceil(iw/2)*2:ceil(ih/2)*2`, '-c:v', 'libx264', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], { stdio: 'pipe' });
    const first = captured[0].timestamp, last = captured.at(-1).timestamp;
    const filmstrip = [0, .2, .4, .6, .8, 1].map((fraction, index) => {
      const target = first + (last - first) * fraction;
      const frame = captured.reduce((nearest, candidate) => Math.abs(candidate.timestamp - target) < Math.abs(nearest.timestamp - target) ? candidate : nearest);
      const path = `${out}/frames/${name}-${index}.jpg`;
      writeFileSync(path, frame.data);
      return { path, capturedAtSeconds: frame.timestamp - first };
    });
    return { video, viewport, crop: { x: 0, y: 0, ...viewport }, compositorViewport: { width: captured[0].metadata.deviceWidth, height: captured[0].metadata.deviceHeight }, frameCount: captured.length, durationSeconds: last - first, capturedFrameOffsetsSeconds: captured.map(frame => frame.timestamp - first), filmstrip, note: 'CDP compositor captures with original frame intervals; only the outer window area beyond the CSS viewport is cropped, no page content removed. Recording adds overhead and is not a frame-rate benchmark.' };
  } finally {
    session.off('Page.screencastFrame', onFrame);
    await session.send('Page.stopScreencast').catch(() => {});
    await Promise.allSettled(acknowledgments);
    await session.detach();
    rmSync(raw, { recursive: true, force: true });
  }
}
