const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { CameraSession } = require('../staircase-detection/camera-session.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function fakeStream() {
  const track = { stopped: false, stop() { this.stopped = true; } };
  return {
    track,
    stream: { getTracks: () => [track] }
  };
}

describe('Staircase camera session', () => {
  test('maps permission denial to an explicit error', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const session = new CameraSession({ getUserMedia: () => Promise.reject(denied) });

    await assert.rejects(session.start({ video: true }), (error) =>
      error.code === 'permission-denied'
    );
    assert.equal(session.isPending, false);
  });

  test('reports missing or unavailable camera hardware', async () => {
    const missing = Object.assign(new Error('missing'), { name: 'NotFoundError' });
    const session = new CameraSession({ getUserMedia: () => Promise.reject(missing) });

    await assert.rejects(session.start({ video: true }), (error) =>
      error.code === 'unavailable'
    );
    await assert.rejects(new CameraSession(null).start({ video: true }), (error) =>
      error.code === 'unavailable'
    );
  });

  test('bounds pending permission and stops a stream granted after timeout', async () => {
    const request = deferred();
    const { stream, track } = fakeStream();
    const session = new CameraSession({ getUserMedia: () => request.promise }, { timeoutMs: 10 });

    await assert.rejects(session.start({ video: true }), (error) => error.code === 'timeout');
    assert.equal(session.isPending, true);
    await assert.rejects(session.start({ video: true }), (error) => error.code === 'pending');

    request.resolve(stream);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(track.stopped, true);
    assert.equal(session.isPending, false);
    assert.equal(session.stream, null);
  });

  test('stopping cancels a pending permission request and releases a late stream', async () => {
    const request = deferred();
    const { stream, track } = fakeStream();
    const session = new CameraSession({ getUserMedia: () => request.promise }, { timeoutMs: 100 });
    const starting = session.start({ video: true });
    session.stop();

    request.resolve(stream);
    await assert.rejects(starting, (error) => error.code === 'cancelled');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(track.stopped, true);
    assert.equal(session.stream, null);
    assert.equal(session.isPending, false);
  });

  test('does not duplicate an active stream and stops all tracks', async () => {
    const { stream, track } = fakeStream();
    let calls = 0;
    const session = new CameraSession({
      getUserMedia: async () => {
        calls += 1;
        return stream;
      }
    });

    assert.equal(await session.start({ video: true }), stream);
    assert.equal(await session.start({ video: true }), stream);
    assert.equal(calls, 1);
    session.stop();
    assert.equal(track.stopped, true);
    assert.equal(session.stream, null);
  });
});
