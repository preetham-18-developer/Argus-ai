(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.ArgusVisibility = api;
        if (root.navigator && root.document) {
            api.installVisibilityGate(root.navigator, root.document, root);
        }
    }
})(typeof window !== 'undefined' ? window : null, function () {
    'use strict';

    const DEFAULT_THRESHOLDS = Object.freeze({
        minBrightness: 25,
        maxBrightness: 240,
        maxDarkPixelRatio: 0.85,
        maxClippedPixelRatio: 0.4,
        minSharpness: 35,
        sampleWidth: 160,
        sampleHeight: 120,
        sampleCount: 3,
        frameTimeoutMs: 10000,
        cameraTimeoutMs: 15000
    });

    const VISIBILITY_MESSAGE =
        'Visibility is not clear. Please improve the lighting, clean the camera lens, and ensure the area is clearly visible before continuing.';

    function makeError(name, message) {
        const error = new Error(message);
        error.name = name;
        return error;
    }

    function evaluateMetrics(metrics, thresholds) {
        if (metrics.brightness < thresholds.minBrightness ||
            metrics.darkPixelRatio > thresholds.maxDarkPixelRatio) {
            return { usable: false, reason: 'too-dark', metrics };
        }
        if (metrics.brightness > thresholds.maxBrightness ||
            metrics.clippedPixelRatio > thresholds.maxClippedPixelRatio) {
            return { usable: false, reason: 'overexposed', metrics };
        }
        if (metrics.sharpness < thresholds.minSharpness) {
            return { usable: false, reason: 'too-blurry', metrics };
        }
        return { usable: true, reason: 'clear', metrics };
    }

    function stopTracks(stream) {
        if (stream && typeof stream.getTracks === 'function') {
            stream.getTracks().forEach((track) => track.stop());
        }
    }

    function analyzeImageData(imageData, options = {}) {
        const thresholds = Object.assign({}, DEFAULT_THRESHOLDS, options);
        const width = imageData && imageData.width;
        const height = imageData && imageData.height;
        const data = imageData && imageData.data;

        if (!Number.isInteger(width) || !Number.isInteger(height) ||
            width < 3 || height < 3 || !data ||
            data.length < width * height * 4) {
            return { usable: false, reason: 'invalid-frame', metrics: null };
        }

        const grayscale = new Float64Array(width * height);
        let brightnessTotal = 0;
        let darkPixels = 0;
        let clippedPixels = 0;

        for (let pixel = 0; pixel < width * height; pixel += 1) {
            const offset = pixel * 4;
            const luminance = 0.2126 * data[offset] +
                0.7152 * data[offset + 1] +
                0.0722 * data[offset + 2];
            grayscale[pixel] = luminance;
            brightnessTotal += luminance;
            if (luminance < 20) darkPixels += 1;
            if (luminance > 250) clippedPixels += 1;
        }

        let laplacianTotal = 0;
        let laplacianSquaredTotal = 0;
        let samples = 0;
        for (let y = 1; y < height - 1; y += 1) {
            for (let x = 1; x < width - 1; x += 1) {
                const index = y * width + x;
                const laplacian = 4 * grayscale[index] -
                    grayscale[index - 1] -
                    grayscale[index + 1] -
                    grayscale[index - width] -
                    grayscale[index + width];
                laplacianTotal += laplacian;
                laplacianSquaredTotal += laplacian * laplacian;
                samples += 1;
            }
        }

        const metrics = {
            brightness: brightnessTotal / (width * height),
            darkPixelRatio: darkPixels / (width * height),
            clippedPixelRatio: clippedPixels / (width * height),
            sharpness: laplacianSquaredTotal / samples -
                (laplacianTotal / samples) ** 2
        };

        return evaluateMetrics(metrics, thresholds);
    }

    function median(values) {
        const sorted = values.slice().sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2
            ? sorted[middle]
            : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    function frameSignature(data) {
        let hash = 2166136261;
        for (let index = 0; index < data.length; index += 32) {
            hash ^= data[index];
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    function wait(milliseconds) {
        return new Promise((resolve) => setTimeout(resolve, milliseconds));
    }

    async function waitForVideoFrame(video, timeoutMs) {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
                return;
            }
            await wait(50);
        }
        throw makeError('FrameUnavailableError', 'The camera did not provide a usable video frame.');
    }

    async function waitForNextVideoFrame(video) {
        if (typeof video.requestVideoFrameCallback === 'function') {
            await new Promise((resolve) => {
                let settled = false;
                let callbackId;
                const timeoutId = setTimeout(finish, 1000);

                function finish() {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeoutId);
                    if (callbackId !== undefined &&
                        typeof video.cancelVideoFrameCallback === 'function') {
                        video.cancelVideoFrameCallback(callbackId);
                    }
                    resolve();
                }

                callbackId = video.requestVideoFrameCallback(finish);
            });
            return;
        }
        await wait(100);
    }

    async function checkVideoVisibility(stream, options = {}) {
        const thresholds = Object.assign({}, DEFAULT_THRESHOLDS, options);
        const documentRef = options.document || (typeof document !== 'undefined' ? document : null);
        if (!documentRef || typeof documentRef.createElement !== 'function') {
            throw makeError('VisibilityCheckError', 'The camera visibility checker is unavailable.');
        }

        const video = documentRef.createElement('video');
        const canvas = documentRef.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
            throw makeError('VisibilityCheckError', 'The camera visibility checker is unavailable.');
        }

        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        video.style.position = 'fixed';
        video.style.width = '1px';
        video.style.height = '1px';
        video.style.opacity = '0';
        video.style.pointerEvents = 'none';
        video.setAttribute('aria-hidden', 'true');
        video.srcObject = stream;
        documentRef.body.appendChild(video);

        try {
            await video.play();
            await waitForVideoFrame(video, thresholds.frameTimeoutMs);
            canvas.width = thresholds.sampleWidth;
            canvas.height = thresholds.sampleHeight;

            const results = [];
            const signatures = [];
            const mediaTimes = [];
            for (let index = 0; index < thresholds.sampleCount; index += 1) {
                if (index > 0) await waitForNextVideoFrame(video);
                if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
                    throw makeError('FrameUnavailableError', 'The camera frame became unavailable.');
                }
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                const result = analyzeImageData(imageData, thresholds);
                if (result.reason === 'invalid-frame') {
                    throw makeError('FrameUnavailableError', 'The camera returned an invalid frame.');
                }
                results.push(result);
                signatures.push(frameSignature(imageData.data));
                mediaTimes.push(Number.isFinite(video.currentTime) ? video.currentTime : null);
            }

            const frozen = signatures.length > 1 &&
                signatures.every((signature) => signature === signatures[0]) &&
                mediaTimes[0] !== null &&
                mediaTimes.every((mediaTime) => mediaTime === mediaTimes[0]);
            if (frozen) {
                return { usable: false, reason: 'frozen-frame', metrics: results[0].metrics };
            }

            const metrics = {
                brightness: median(results.map((result) => result.metrics.brightness)),
                darkPixelRatio: median(results.map((result) => result.metrics.darkPixelRatio)),
                clippedPixelRatio: median(results.map((result) => result.metrics.clippedPixelRatio)),
                sharpness: median(results.map((result) => result.metrics.sharpness))
            };
            return evaluateMetrics(metrics, thresholds);
        } finally {
            video.pause();
            video.srcObject = null;
            video.remove();
        }
    }

    function cameraErrorMessage(error) {
        if (error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
            return 'Camera permission was denied. Allow camera access in your browser settings, then retry.';
        }
        if (error && (error.name === 'NotFoundError' || error.name === 'NotReadableError' ||
            error.name === 'OverconstrainedError')) {
            return 'Camera is unavailable or in use by another app. Check the camera and retry.';
        }
        if (error && error.name === 'CameraTimeoutError') {
            return 'Camera startup timed out. Check camera permission and retry.';
        }
        if (error && error.name === 'FrameUnavailableError') {
            return 'The camera did not provide a usable live frame. Check the camera and retry.';
        }
        if (error && error.name === 'AbortError') return 'Visibility check canceled.';
        return VISIBILITY_MESSAGE;
    }

    class VisibilityGate {
        constructor(mediaDevices, options = {}) {
            this.mediaDevices = mediaDevices;
            this.nativeGetUserMedia = mediaDevices &&
                typeof mediaDevices.getUserMedia === 'function'
                ? mediaDevices.getUserMedia
                : null;
            this.checker = options.checker || checkVideoVisibility;
            this.ui = options.ui || null;
            this.timeoutMs = options.timeoutMs || DEFAULT_THRESHOLDS.cameraTimeoutMs;
            this.checkOptions = options.checkOptions || {};
            this.pendingRequest = null;
            this.cameraRequest = null;
            this.activeStream = null;
            this.cancelled = false;
            this.cancelReject = null;
        }

        getUserMedia(constraints) {
            if (this.cancelled) {
                return Promise.reject(makeError('AbortError', 'Visibility check canceled.'));
            }
            if (this.activeStream &&
                this.activeStream.getTracks().some((track) => track.readyState !== 'ended')) {
                return Promise.resolve(this.activeStream);
            }
            this.activeStream = null;
            if (this.pendingRequest) return this.pendingRequest;
            if (!this.nativeGetUserMedia) {
                return Promise.reject(makeError(
                    'NotSupportedError',
                    'Camera access is not available in this browser or page context.'
                ));
            }

            this.pendingRequest = this._run(constraints).finally(() => {
                this.pendingRequest = null;
            });
            return this.pendingRequest;
        }

        async _run(constraints) {
            let cancelReject;
            const canceled = new Promise((_, reject) => {
                cancelReject = reject;
            });
            canceled.catch(() => {});
            this.cancelReject = cancelReject;

            try {
                while (!this.cancelled) {
                    this.ui?.showChecking('Requesting camera access and checking visibility…', () => this.cancel());
                    let stream;
                    try {
                        stream = await this._requestStream(constraints, canceled);
                        const result = await Promise.race([
                            this.checker(stream, this.checkOptions),
                            canceled
                        ]);
                        if (!result || typeof result.usable !== 'boolean') {
                            throw makeError('VisibilityCheckError', 'The camera visibility checker returned an invalid result.');
                        }
                        if (result.usable) {
                            this.activeStream = stream;
                            this.ui?.hide();
                            return stream;
                        }
                        stopTracks(stream);
                        stream = null;
                        await this._waitForRetry(this._visibilityMessage(result.reason), canceled);
                    } catch (error) {
                        stopTracks(stream);
                        if (this.cancelled || (error && error.name === 'AbortError')) {
                            throw makeError('AbortError', 'Visibility check canceled.');
                        }
                        await this._waitForRetry(cameraErrorMessage(error), canceled);
                    }
                }
                throw makeError('AbortError', 'Visibility check canceled.');
            } finally {
                this.cancelReject = null;
            }
        }

        async _requestStream(constraints, canceled) {
            let request = this.cameraRequest;
            if (!request) {
                request = { stream: null, promise: null };
                request.promise = Promise.resolve().then(() =>
                    this.nativeGetUserMedia.call(this.mediaDevices, constraints)
                );
                this.cameraRequest = request;
                request.promise.then((stream) => {
                    if (this.cancelled || this.cameraRequest !== request) {
                        stopTracks(stream);
                    } else {
                        request.stream = stream;
                    }
                }, () => {
                    if (this.cameraRequest === request) this.cameraRequest = null;
                });
            }

            let timeoutId;
            const timeout = new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(makeError('CameraTimeoutError', 'Camera startup timed out.'));
                }, this.timeoutMs);
            });
            try {
                const stream = await Promise.race([request.promise, timeout, canceled]);
                if (this.cameraRequest === request) this.cameraRequest = null;
                return stream;
            } finally {
                clearTimeout(timeoutId);
            }
        }

        _waitForRetry(message, canceled) {
            if (!this.ui) {
                throw makeError('VisibilityCheckError', message);
            }
            return Promise.race([
                new Promise((resolve) => {
                    this.ui.showRetry(message, resolve, () => this.cancel());
                }),
                canceled
            ]);
        }

        _visibilityMessage(reason) {
            if (reason === 'too-dark') {
                return 'The camera view is too dark. Improve the lighting, clean the camera lens, and retry.';
            }
            if (reason === 'overexposed') {
                return 'The camera view is overexposed. Reduce glare or point the camera away from direct light, then retry.';
            }
            if (reason === 'too-blurry') {
                return 'The camera view is too blurry. Clean the lens and hold the camera steady, then retry.';
            }
            if (reason === 'frozen-frame') {
                return 'The camera is not providing fresh frames. Check the camera and retry.';
            }
            return VISIBILITY_MESSAGE;
        }

        cancel() {
            if (this.cancelled) return;
            this.cancelled = true;
            this.cancelReject?.(makeError('AbortError', 'Visibility check canceled.'));
            if (this.cameraRequest) {
                stopTracks(this.cameraRequest.stream);
                this.cameraRequest = null;
            }
            this.ui?.hide();
        }

        dispose() {
            this.cancel();
            stopTracks(this.activeStream);
            this.activeStream = null;
        }
    }

    function createBrowserUI(documentRef, windowRef) {
        let overlay;
        let message;
        let retryButton;
        let cancelButton;
        let retryHandler = null;
        let cancelHandler = null;

        function ensureOverlay() {
            if (overlay) return;
            overlay = documentRef.createElement('section');
            overlay.setAttribute('role', 'dialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-labelledby', 'argus-visibility-title');
            overlay.hidden = true;
            overlay.innerHTML = `
                <div class="argus-visibility-card">
                    <h2 id="argus-visibility-title">Camera visibility check</h2>
                    <p class="argus-visibility-status" role="status" aria-live="polite"></p>
                    <div class="argus-visibility-actions">
                        <button type="button" class="argus-visibility-retry">Retry check</button>
                        <button type="button" class="argus-visibility-cancel">Cancel and return to dashboard</button>
                    </div>
                </div>`;
            const style = documentRef.createElement('style');
            style.textContent = `
                .argus-visibility-overlay {
                    position: fixed; inset: 0; z-index: 2147483647; display: grid;
                    place-items: center; padding: 24px; background: rgba(2, 6, 23, .92);
                    color: #f8fafc; font: 16px/1.5 system-ui, sans-serif;
                }
                .argus-visibility-overlay[hidden] { display: none; }
                .argus-visibility-card { width: min(100%, 520px); padding: 24px;
                    border: 1px solid rgba(148, 163, 184, .45); border-radius: 16px;
                    background: #111827; box-shadow: 0 20px 60px rgba(0, 0, 0, .45); }
                .argus-visibility-card h2 { margin: 0 0 12px; font-size: 1.25rem; }
                .argus-visibility-status { min-height: 3em; margin: 0 0 20px; }
                .argus-visibility-actions { display: flex; flex-wrap: wrap; gap: 10px; }
                .argus-visibility-actions button { min-height: 44px; padding: 10px 14px;
                    border: 1px solid #38bdf8; border-radius: 8px; background: #0c4a6e;
                    color: #fff; font: inherit; cursor: pointer; }
                .argus-visibility-actions button:disabled { opacity: .6; cursor: wait; }
                .argus-visibility-cancel { border-color: #94a3b8 !important;
                    background: #1f2937 !important; }`;
            style.dataset.argusVisibilityStyle = 'true';
            overlay.className = 'argus-visibility-overlay';
            message = overlay.querySelector('.argus-visibility-status');
            retryButton = overlay.querySelector('.argus-visibility-retry');
            cancelButton = overlay.querySelector('.argus-visibility-cancel');
            retryButton.addEventListener('click', () => retryHandler?.());
            cancelButton.addEventListener('click', () => {
                cancelHandler?.();
                windowRef.location.assign('/');
            });
            (documentRef.head || documentRef.documentElement).appendChild(style);
            (documentRef.body || documentRef.documentElement).appendChild(overlay);
        }

        return {
            showChecking(text, onCancel) {
                ensureOverlay();
                overlay.hidden = false;
                message.textContent = text;
                retryButton.hidden = true;
                retryButton.disabled = true;
                cancelButton.hidden = false;
                cancelHandler = onCancel;
            },
            showRetry(text, onRetry, onCancel) {
                ensureOverlay();
                overlay.hidden = false;
                message.textContent = text;
                retryHandler = onRetry;
                cancelHandler = onCancel;
                retryButton.hidden = false;
                retryButton.disabled = false;
                cancelButton.hidden = false;
            },
            hide() {
                if (overlay) overlay.hidden = true;
                retryHandler = null;
                cancelHandler = null;
            }
        };
    }

    function installVisibilityGate(navigatorRef, documentRef, windowRef, options = {}) {
        if (!navigatorRef || !documentRef || !windowRef) return null;
        if (windowRef.ArgusVisibilityGate) return windowRef.ArgusVisibilityGate;

        const mediaDevices = navigatorRef.mediaDevices;
        const ui = options.ui || createBrowserUI(documentRef, windowRef);
        const gate = new VisibilityGate(mediaDevices, Object.assign({}, options, { ui }));
        windowRef.ArgusVisibilityGate = gate;

        if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
            ui.showRetry(
                'Camera access is unavailable in this browser or page context. Use a secure HTTPS page, then retry.',
                () => windowRef.location.reload(),
                () => windowRef.location.assign('/')
            );
            return gate;
        }

        try {
            Object.defineProperty(mediaDevices, 'getUserMedia', {
                configurable: true,
                writable: true,
                value: gate.getUserMedia.bind(gate)
            });
        } catch (error) {
            console.error('[ArgusVisibility] Could not protect camera access:', error);
            ui.showRetry(
                'The camera visibility gate could not be installed. Feature startup is blocked.',
                () => windowRef.location.reload(),
                () => windowRef.location.assign('/')
            );
            return gate;
        }

        windowRef.addEventListener('pagehide', () => gate.dispose(), { once: true });
        return gate;
    }

    return {
        DEFAULT_THRESHOLDS,
        VISIBILITY_MESSAGE,
        analyzeImageData,
        checkVideoVisibility,
        VisibilityGate,
        installVisibilityGate
    };
});
