const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  analyzeImageData,
  checkVideoVisibility,
  VisibilityGate
} = require('../assets/js/visibility-gate.js');

function makeImage(width, height, pixelAt) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = pixelAt(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

function createUI() {
  return {
    messages: [],
    showChecking(message, cancel) {
      this.messages.push({ state: 'checking', message, cancel });
    },
    showRetry(message, retry, cancel) {
      this.messages.push({ state: 'retry', message, retry, cancel });
    },
    hide() {
      this.messages.push({ state: 'hidden' });
    },
    retry() {
      const current = this.messages[this.messages.length - 1];
      assert.equal(current.state, 'retry');
      current.retry();
    },
    cancel() {
      const current = this.messages[this.messages.length - 1];
      current.cancel();
    }
  };
}

function createStream() {
  const track = {
    readyState: 'live',
    stopped: false,
    stop() {
      this.stopped = true;
      this.readyState = 'ended';
    }
  };
  return { stream: { getTracks: () => [track] }, track };
}

function waitFor(predicate, timeoutMs = 200) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started >= timeoutMs) {
        return reject(new Error('Timed out waiting for gate state.'));
      }
      setTimeout(check, 1);
    };
    check();
  });
}

describe('Visibility image quality checks', () => {
  test('accepts a clear, well-lit, sharp frame', () => {
    const frame = makeImage(32, 32, (x, y) => ((x + y) % 2 ? 180 : 90));
    const result = analyzeImageData(frame);

    assert.equal(result.usable, true);
    assert.equal(result.reason, 'clear');
    assert.ok(result.metrics.brightness >= 25);
    assert.ok(result.metrics.sharpness >= 35);
  });

  test('allows a borderline dim, low-contrast frame above the quality limits', () => {
    const frame = makeImage(32, 32, (x, y) => ((x + y) % 2 ? 42 : 40));
    const result = analyzeImageData(frame);

    assert.equal(result.usable, true);
    assert.ok(result.metrics.brightness < 50);
    assert.ok(result.metrics.sharpness >= 35);
  });

  test('rejects a very dark frame', () => {
    const result = analyzeImageData(makeImage(16, 16, () => 5));
    assert.equal(result.usable, false);
    assert.equal(result.reason, 'too-dark');
  });

  test('rejects an overexposed frame', () => {
    const result = analyzeImageData(makeImage(16, 16, () => 255));
    assert.equal(result.usable, false);
    assert.equal(result.reason, 'overexposed');
  });

  test('rejects a frame with significant highlight clipping', () => {
    const result = analyzeImageData(makeImage(16, 16, (x) => x < 8 ? 255 : 180));
    assert.equal(result.metrics.brightness, 217.5);
    assert.equal(result.usable, false);
    assert.equal(result.reason, 'overexposed');
  });

  test('rejects a significantly blurred frame', () => {
    const result = analyzeImageData(makeImage(16, 16, () => 120));
    assert.equal(result.usable, false);
    assert.equal(result.reason, 'too-blurry');
  });

  test('rejects an empty or malformed frame', () => {
    assert.equal(analyzeImageData(null).reason, 'invalid-frame');
    assert.equal(analyzeImageData({ width: 4, height: 4, data: [] }).reason, 'invalid-frame');
  });

  test('rejects repeated identical frames when the camera timestamp is frozen', async () => {
    const frame = makeImage(32, 32, (x, y) => ((x + y) % 2 ? 180 : 90));
    const video = {
      readyState: 2,
      videoWidth: 32,
      videoHeight: 32,
      currentTime: 1,
      style: {},
      setAttribute() {},
      async play() {},
      pause() {},
      remove() {},
      requestVideoFrameCallback(callback) {
        setTimeout(callback, 0);
        return 1;
      },
      cancelVideoFrameCallback() {}
    };
    const canvas = {
      getContext: () => ({
        drawImage() {},
        getImageData: () => frame
      })
    };
    const document = {
      createElement: (tag) => tag === 'video' ? video : canvas,
      body: { appendChild() {} }
    };

    const result = await checkVideoVisibility({}, {
      document,
      sampleWidth: 32,
      sampleHeight: 32,
      sampleCount: 3
    });
    assert.equal(result.usable, false);
    assert.equal(result.reason, 'frozen-frame');
  });
});

describe('Visibility feature-launch gate', () => {
  test('returns the checked stream when visibility is good', async () => {
    const { stream } = createStream();
    let cameraCalls = 0;
    let checks = 0;
    const gate = new VisibilityGate({ getUserMedia: async () => {
      cameraCalls += 1;
      return stream;
    } }, {
      ui: createUI(),
      checker: async () => {
        checks += 1;
        return { usable: true, reason: 'clear' };
      }
    });

    assert.equal(await gate.getUserMedia({ video: true }), stream);
    assert.equal(cameraCalls, 1);
    assert.equal(checks, 1);
  });

  test('blocks a dark frame and retries successfully after conditions improve', async () => {
    const first = createStream();
    const second = createStream();
    const ui = createUI();
    let cameraCalls = 0;
    let checks = 0;
    const gate = new VisibilityGate({ getUserMedia: async () =>
      (++cameraCalls === 1 ? first.stream : second.stream)
    }, {
      ui,
      checker: async () => (++checks === 1
        ? { usable: false, reason: 'too-dark' }
        : { usable: true, reason: 'clear' })
    });

    const opening = gate.getUserMedia({ video: true });
    await waitFor(() => ui.messages.some((entry) => entry.state === 'retry'));
    assert.match(ui.messages[ui.messages.length - 1].message, /too dark/i);
    assert.equal(first.track.stopped, true);
    ui.retry();
    assert.equal(await opening, second.stream);
    assert.equal(cameraCalls, 2);
  });

  test('permission denial blocks activation and offers retry', async () => {
    const ui = createUI();
    const { stream } = createStream();
    let cameraCalls = 0;
    const gate = new VisibilityGate({ getUserMedia: async () => {
      cameraCalls += 1;
      if (cameraCalls === 1) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      return stream;
    } }, { ui, checker: async () => ({ usable: true }) });

    const opening = gate.getUserMedia({ video: true });
    await waitFor(() => ui.messages.some((entry) => entry.state === 'retry'));
    assert.match(ui.messages[ui.messages.length - 1].message, /permission was denied/i);
    ui.retry();
    assert.equal(await opening, stream);
  });

  test('camera startup timeout blocks activation until a retry succeeds', async () => {
    const ui = createUI();
    const { stream } = createStream();
    let cameraCalls = 0;
    let resolveCamera;
    const gate = new VisibilityGate({ getUserMedia: async () => {
      cameraCalls += 1;
      if (cameraCalls === 1) {
        return new Promise((resolve) => {
          resolveCamera = resolve;
        });
      }
      return stream;
    } }, {
      ui,
      timeoutMs: 10,
      checker: async () => ({ usable: true })
    });

    const opening = gate.getUserMedia({ video: true });
    await waitFor(() => ui.messages.some((entry) => entry.state === 'retry'));
    assert.match(ui.messages[ui.messages.length - 1].message, /timed out/i);
    ui.retry();
    resolveCamera(stream);
    assert.equal(await opening, stream);
    assert.equal(cameraCalls, 1);
  });

  test('visibility-checking errors block activation and can be retried', async () => {
    const ui = createUI();
    const first = createStream();
    const second = createStream();
    let checks = 0;
    const gate = new VisibilityGate({ getUserMedia: async () =>
      checks === 0 ? first.stream : second.stream
    }, {
      ui,
      checker: async () => {
        checks += 1;
        if (checks === 1) throw new Error('checker failed');
        return { usable: true, reason: 'clear' };
      }
    });

    const opening = gate.getUserMedia({ video: true });
    await waitFor(() => ui.messages.some((entry) => entry.state === 'retry'));
    assert.equal(first.track.stopped, true);
    ui.retry();
    assert.equal(await opening, second.stream);
  });

  test('invalid visibility results remain closed', async () => {
    const ui = createUI();
    const { stream, track } = createStream();
    const gate = new VisibilityGate({ getUserMedia: async () => stream }, {
      ui,
      checker: async () => ({ usable: false, reason: 'invalid-frame' })
    });

    const opening = gate.getUserMedia({ video: true });
    await waitFor(() => ui.messages.some((entry) => entry.state === 'retry'));
    assert.equal(track.stopped, true);
    assert.equal(ui.messages[ui.messages.length - 1].state, 'retry');
    gate.cancel();
    await assert.rejects(opening, (error) => error.name === 'AbortError');
  });

  test('coalesces rapid camera requests and reuses the checked live stream', async () => {
    const { stream } = createStream();
    let cameraCalls = 0;
    let checks = 0;
    const gate = new VisibilityGate({ getUserMedia: async () => {
      cameraCalls += 1;
      return stream;
    } }, {
      ui: createUI(),
      checker: async () => {
        checks += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { usable: true, reason: 'clear' };
      }
    });

    const first = gate.getUserMedia({ video: true });
    const second = gate.getUserMedia({ video: true });
    assert.equal(await first, stream);
    assert.equal(await second, stream);
    assert.equal(cameraCalls, 1);
    assert.equal(checks, 1);
    assert.equal(await gate.getUserMedia({ video: true }), stream);
    assert.equal(cameraCalls, 1);
  });

  test('canceling a pending check blocks launch and stops any late camera stream', async () => {
    const ui = createUI();
    const { stream, track } = createStream();
    let resolveCamera;
    const gate = new VisibilityGate({ getUserMedia: () => new Promise((resolve) => {
      resolveCamera = resolve;
    }) }, {
      ui,
      checker: async () => ({ usable: true }),
      timeoutMs: 100
    });

    const opening = gate.getUserMedia({ video: true });
    await waitFor(() => typeof resolveCamera === 'function');
    ui.messages.find((entry) => entry.state === 'checking').cancel();
    await assert.rejects(opening, (error) => error.name === 'AbortError');
    resolveCamera(stream);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(track.stopped, true);
  });
});

describe('Visibility gate integration', () => {
  test('every existing camera feature loads the gate before its camera code', () => {
    const projectRoot = path.resolve(__dirname, '..');
    const pages = [
      ['Camera Check/index.html', 'src="script.js"'],
      ['Night-Vision/index.html', 'src="script.js"'],
      ['object-detection-pro/index.html', 'src="app.js"'],
      ['queue-detection/index.html', 'src="app.js"'],
      ['staircase-detection/index.html', 'src="camera-session.js"'],
      ['Visual Explanation/index.html', 'getUserMedia'],
      ['Visual Explanation/Visual Explanation/index.html', 'getUserMedia'],
      ['Visual Explanation/Visual Explanation/templates/index.html', 'getUserMedia']
    ];

    for (const [page, cameraCode] of pages) {
      const source = fs.readFileSync(path.join(projectRoot, page), 'utf8');
      const gateIndex = source.indexOf('visibility-gate.js');
      const cameraIndex = source.indexOf(cameraCode);
      assert.notEqual(gateIndex, -1, `${page} must load the shared gate`);
      assert.notEqual(cameraIndex, -1, `${page} must contain its camera entry point`);
      assert.ok(gateIndex < cameraIndex, `${page} must install the gate before camera code`);
    }
  });

  test('dashboard and voice routes target feature pages protected by the gate', () => {
    const projectRoot = path.resolve(__dirname, '..');
    const dashboard = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
    const voiceController = fs.readFileSync(
      path.join(projectRoot, 'assets/js/companion-controller.js'),
      'utf8'
    );
    const protectedPages = [
      'Night-Vision/index.html',
      'object-detection-pro/index.html',
      'staircase-detection/index.html',
      'Visual%20Explanation/index.html',
      'queue-detection/index.html',
      'Camera%20Check/index.html'
    ];

    for (const page of protectedPages) {
      const normalizedPage = page.replace(/%20/gi, ' ');
      const featurePage = normalizedPage.replace(/%20/gi, ' ');
      const htmlPath = path.join(projectRoot, featurePage);
      if (fs.existsSync(htmlPath)) {
        const source = fs.readFileSync(htmlPath, 'utf8');
        assert.ok(source.includes('visibility-gate.js'), `${featurePage} must be gated`);
      }
      assert.ok(
        dashboard.includes(page) || voiceController.includes(page) ||
          dashboard.includes(featurePage) || voiceController.includes(featurePage),
        `A dashboard or voice route should reference ${page}`
      );
    }
  });
});
