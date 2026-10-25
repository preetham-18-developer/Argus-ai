(function () {
    'use strict';

    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    const context = canvas.getContext('2d');
    const stage = document.getElementById('camera-stage');
    const placeholder = document.getElementById('camera-placeholder');
    const status = document.getElementById('detection-status');
    const health = document.getElementById('detector-health');
    const startButton = document.getElementById('start-detection');
    const stopButton = document.getElementById('stop-detection');
    const voiceButton = document.getElementById('voice-command');
    const voiceGuidance = document.getElementById('voice-guidance');
    const featureEnabled = !window.ARGUS_FEATURES || window.ARGUS_FEATURES.staircaseMode !== false;

    let stream = null;
    let isActive = false;
    let isStarting = false;
    let isHealthy = false;
    let hasResponse = false;
    let cameraErrorMessage = '';
    let requestInFlight = false;
    let activeRequestToken = null;
    let requestController = null;
    let pollTimer = null;
    let renderFrame = null;
    let generation = 0;
    let detections = [];
    let frameSize = { width: 416, height: 312 };
    let decision = null;
    let captureCanvas = null;
    const cameraSession = new window.ArgusCameraSession.CameraSession(
        navigator.mediaDevices || null,
        {
            timeoutMs: 15000,
            onPendingChange: updateControls
        }
    );

    function setStatus(message) {
        status.textContent = message;
    }

    function speak(message) {
        if (!voiceGuidance.checked || !message) return;
        const service = window.argusCompanion && window.argusCompanion.speechService;
        if (service && typeof service.speak === 'function') {
            service.speak(message);
        } else if (window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') {
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(message));
        }
    }

    function updateControls() {
        startButton.disabled = isStarting || isActive || cameraSession.isPending || !featureEnabled;
        stopButton.disabled = !(isStarting || isActive || cameraSession.isPending);
        voiceButton.disabled = !featureEnabled;
        startButton.setAttribute('aria-pressed', String(isActive || isStarting));
        if (cameraErrorMessage) {
            health.textContent = cameraErrorMessage;
        } else if (isActive && isHealthy) {
            health.textContent = 'Detector responding. Results are not safety-validated.';
        } else if (isActive && hasResponse) {
            health.textContent = 'Staircase detection unavailable. Do not rely on it.';
        } else if (isStarting) {
            health.textContent = 'Waiting for camera permission and a live camera frame.';
        } else if (cameraSession.isPending) {
            health.textContent = 'Camera request is still pending. Dismiss the browser prompt before retrying.';
        } else if (isActive) {
            health.textContent = 'Connecting to the staircase detector.';
        } else if (!featureEnabled) {
            health.textContent = 'Staircase Detection is disabled by the feature flag.';
        } else {
            health.textContent = 'Detector has not been checked.';
        }
    }

    function drawFrame() {
        if (!isActive || !video.videoWidth || !video.videoHeight) return;
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        drawDetections();
        renderFrame = requestAnimationFrame(drawFrame);
    }

    function drawDetections() {
        const scaleX = canvas.width / frameSize.width;
        const scaleY = canvas.height / frameSize.height;
        context.save();
        context.font = `bold ${Math.max(16, canvas.width / 55)}px Arial, sans-serif`;
        context.lineWidth = Math.max(3, canvas.width / 320);
        detections.forEach((detection) => {
            if (!detection || !Array.isArray(detection.box) || detection.box.length !== 4) return;
            const [x1, y1, x2, y2] = detection.box;
            if (![x1, y1, x2, y2].every(Number.isFinite)) return;
            const x = x1 * scaleX;
            const y = y1 * scaleY;
            const boxWidth = Math.max(0, (x2 - x1) * scaleX);
            const boxHeight = Math.max(0, (y2 - y1) * scaleY);
            const color = detection.label === 'downstairs' ? '#ff6b6b' : '#ffe066';
            const label = `${String(detection.label).toUpperCase()} ${(detection.confidence * 100).toFixed(0)}%`;
            const labelWidth = context.measureText(label).width;
            const labelY = Math.max(24, y - 10);

            context.strokeStyle = color;
            context.strokeRect(x, y, boxWidth, boxHeight);
            context.fillStyle = 'rgba(2, 6, 23, 0.9)';
            context.fillRect(x, labelY - 26, labelWidth + 16, 28);
            context.fillStyle = color;
            context.fillText(label, x + 8, labelY - 6);
        });
        context.restore();
    }

    function captureFrame() {
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
            !video.videoWidth || !video.videoHeight) {
            throw new Error('Camera frame is not ready.');
        }
        if (!captureCanvas) captureCanvas = document.createElement('canvas');
        captureCanvas.width = 416;
        captureCanvas.height = Math.max(1, Math.round(416 * video.videoHeight / video.videoWidth));
        captureCanvas.getContext('2d', { alpha: false }).drawImage(
            video,
            0,
            0,
            captureCanvas.width,
            captureCanvas.height
        );
        frameSize = { width: captureCanvas.width, height: captureCanvas.height };

        return new Promise((resolve, reject) => {
            captureCanvas.toBlob((blob) => {
                if (blob && blob.size > 0 && blob.type === 'image/jpeg') resolve(blob);
                else reject(new Error('Could not encode a valid JPEG camera frame.'));
            }, 'image/jpeg', 0.78);
        });
    }

    function isValidInferencePayload(payload) {
        if (!payload || !['detected', 'ambiguous', 'none'].includes(payload.status) ||
            !Array.isArray(payload.detections)) {
            return false;
        }
        return payload.detections.every((detection) =>
            detection &&
            ['downstairs', 'upstairs'].includes(detection.label) &&
            Number.isFinite(detection.confidence) &&
            detection.confidence >= 0 &&
            detection.confidence <= 1 &&
            Array.isArray(detection.box) &&
            detection.box.length === 4 &&
            detection.box.every(Number.isFinite) &&
            detection.box[2] >= detection.box[0] &&
            detection.box[3] >= detection.box[1]
        );
    }

    function waitForVideoFrame(timeoutMs) {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
            video.videoWidth > 0 && video.videoHeight > 0) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            let timer;
            const cleanup = () => {
                clearTimeout(timer);
                video.removeEventListener('loadeddata', checkReady);
                video.removeEventListener('error', handleError);
            };
            const checkReady = () => {
                if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
                    video.videoWidth > 0 && video.videoHeight > 0) {
                    cleanup();
                    resolve();
                }
            };
            const handleError = () => {
                cleanup();
                reject(new Error('Camera stream failed before producing a frame.'));
            };
            video.addEventListener('loadeddata', checkReady);
            video.addEventListener('error', handleError);
            timer = setTimeout(() => {
                cleanup();
                reject(new Error('Camera stream did not produce a frame in time.'));
            }, timeoutMs);
            checkReady();
        });
    }

    function renderResult(payload) {
        detections = Array.isArray(payload.detections) ? payload.detections : [];
        isHealthy = true;
        hasResponse = true;

        if (payload.status === 'detected' && detections.length) {
            const strongest = detections[0];
            setStatus(`Stairs detected: ${strongest.label} (model score ${(strongest.confidence * 100).toFixed(0)}%; not a calibrated probability).`);
        } else if (payload.status === 'ambiguous') {
            setStatus(detections.length
                ? 'Ambiguous result. Stair direction is uncertain.'
                : 'Camera view is unclear. Staircase detection may be unreliable.');
        } else {
            setStatus('No stairs detected in this view.');
        }
        updateControls();
        const result = decision.update(payload);
        if (result.announcement) speak(result.announcement);
    }

    function scheduleFrame(delay) {
        if (!isActive || pollTimer || requestInFlight) return;
        pollTimer = setTimeout(() => {
            pollTimer = null;
            runInference();
        }, delay);
    }

    async function runInference() {
        if (!isActive || requestInFlight) return;
        const currentGeneration = generation;
        const requestToken = {};
        const startedAt = performance.now();
        activeRequestToken = requestToken;
        requestInFlight = true;
        try {
            const frame = await captureFrame();
            if (!isActive || currentGeneration !== generation) return;

            const controller = new AbortController();
            requestController = controller;
            const timeout = setTimeout(() => controller.abort(), 3000);
            let response;
            let payload;
            try {
                response = await fetch('/api/staircase/detect', {
                    method: 'POST',
                    headers: { 'Content-Type': 'image/jpeg' },
                    body: frame,
                    signal: controller.signal
                });
                payload = await response.json();
            } finally {
                clearTimeout(timeout);
                if (requestController === controller) requestController = null;
            }
            if (!response.ok || !isValidInferencePayload(payload)) {
                throw new Error(payload && payload.message ? payload.message : 'Staircase API request failed.');
            }
            if (!isActive || currentGeneration !== generation) return;
            renderResult(payload);
        } catch (error) {
            if (!isActive || currentGeneration !== generation) return;
            detections = [];
            isHealthy = false;
            hasResponse = true;
            setStatus('Staircase detection unavailable. Do not rely on it.');
            updateControls();
            console.error('[Staircase Detection] Inference request failed:', error);
            const result = decision.update(null, { unavailable: true });
            if (result.announcement) speak(result.announcement);
        } finally {
            if (activeRequestToken === requestToken) {
                activeRequestToken = null;
                requestInFlight = false;
            }
            if (activeRequestToken === null && isActive) {
                const elapsed = performance.now() - startedAt;
                const targetFps = elapsed < 250 ? 4 : elapsed < 500 ? 3 : 2;
                scheduleFrame(isHealthy ? Math.max(0, 1000 / targetFps - elapsed) : 1000);
            }
        }
    }

    async function startDetection() {
        if (!featureEnabled) return 'Staircase Detection is disabled.';
        if (isActive || isStarting) return 'Staircase detection is already on.';
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            setStatus('Camera access is unavailable in this browser.');
            health.textContent = 'Use a supported browser on localhost or HTTPS and check camera permissions.';
            return 'Staircase detection is unavailable because camera access is not supported.';
        }
        if (cameraSession.isPending) {
            const message = 'A camera permission request is still pending. Dismiss its browser prompt before retrying.';
            cameraErrorMessage = message;
            setStatus(message);
            updateControls();
            return message;
        }
        if (typeof window.StaircaseDecision !== 'function') {
            throw new Error('Staircase decision module is unavailable.');
        }

        isStarting = true;
        isHealthy = false;
        hasResponse = false;
        cameraErrorMessage = '';
        detections = [];
        const startGeneration = ++generation;
        if (!decision) decision = new window.StaircaseDecision();
        setStatus('Waiting for camera permission...');
        placeholder.hidden = false;
        placeholder.textContent = 'Allow camera access in your browser to start detection.';
        updateControls();
        try {
            const cameraStream = await cameraSession.start({
                video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
                audio: false
            });
            if (!isStarting || startGeneration !== generation) {
                cameraSession.stop();
                return 'Staircase mode is off.';
            }
            stream = cameraStream;
            video.srcObject = stream;
            await video.play();
            await waitForVideoFrame(5000);
            if (!isStarting || startGeneration !== generation) {
                cameraSession.stop();
                stopStream();
                return 'Staircase mode is off.';
            }
            isStarting = false;
            isActive = true;
            placeholder.hidden = true;
            drawFrame();
            setStatus('Staircase Detection is on. Checking this camera view.');
            scheduleFrame(0);
            updateControls();
            return 'Staircase mode on.';
        } catch (error) {
            if (!isStarting || startGeneration !== generation) return 'Staircase mode is off.';
            console.error('[Staircase Detection] Camera startup failed:', error);
            cameraSession.stop();
            isStarting = false;
            isActive = false;
            if (error && error.code === 'permission-denied') {
                cameraErrorMessage = 'Camera permission denied. Allow camera access in browser settings, then retry.';
            } else if (error && error.code === 'timeout') {
                cameraErrorMessage = 'Camera permission request timed out. Allow or dismiss the browser prompt; any late camera stream will be stopped.';
            } else if (error && error.code === 'pending') {
                cameraErrorMessage = 'Camera permission is still pending. Dismiss the browser prompt before retrying.';
            } else if (error && error.code === 'unavailable') {
                cameraErrorMessage = 'Camera unavailable. Check that a camera is connected and not in use by another app.';
            } else if (error && /did not produce a frame|failed before producing a frame/i.test(error.message)) {
                cameraErrorMessage = 'Camera started but did not provide a usable frame. Check the camera and retry.';
            } else {
                cameraErrorMessage = 'Camera could not be started. Check browser permissions and camera availability.';
            }
            const message = cameraErrorMessage;
            stopStream();
            setStatus(message);
            updateControls();
            return message;
        }
    }

    function stopStream() {
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            stream = null;
        }
        video.pause();
        video.srcObject = null;
        if (renderFrame) cancelAnimationFrame(renderFrame);
        renderFrame = null;
        context.clearRect(0, 0, canvas.width, canvas.height);
        placeholder.hidden = false;
        placeholder.textContent = 'Start detection to show the camera view.';
    }

    function stopDetection() {
        if (!isActive && !isStarting && !cameraSession.isPending) {
            return 'Staircase mode is already off.';
        }
        const wasWaitingForPermission = isStarting || cameraSession.isPending;
        isActive = false;
        isStarting = false;
        generation += 1;
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = null;
        if (requestController) requestController.abort();
        requestController = null;
        detections = [];
        if (decision) decision.reset();
        cameraSession.stop();
        stopStream();
        isHealthy = false;
        hasResponse = false;
        cameraErrorMessage = '';
        setStatus(wasWaitingForPermission
            ? 'Camera startup canceled. Dismiss the browser prompt; any late stream will be stopped.'
            : 'Staircase Detection is off.');
        updateControls();
        return wasWaitingForPermission ? 'Camera startup canceled.' : 'Staircase mode off.';
    }

    async function handleVoiceCommand(action) {
        if (action === 'on') return startDetection();
        if (action === 'off') return stopDetection();
        if (action === 'status') {
            const detector = isHealthy ? 'healthy' : hasResponse ? 'unavailable' : 'not checked';
            return `Staircase detection is ${isActive ? 'on' : 'off'}. The detector is ${detector}.`;
        }
        throw new TypeError(`Unknown Staircase Detection action: ${action}`);
    }

    startButton.addEventListener('click', async () => {
        try {
            const message = await startDetection();
            if (!isActive) speak(message);
        } catch (error) {
            console.error('[Staircase Detection] Could not start feature:', error);
            setStatus('Staircase detection unavailable. Do not rely on it.');
            health.textContent = 'The feature could not be initialized.';
        }
    });
    stopButton.addEventListener('click', () => speak(stopDetection()));
    voiceButton.addEventListener('click', () => {
        if (!window.argusCompanion ||
            typeof window.argusCompanion.startStaircaseVoiceCommand !== 'function') {
            setStatus('Voice commands are unavailable. Use the Start or Stop Detection buttons.');
            return;
        }
        window.argusCompanion.startStaircaseVoiceCommand();
    });

    if (featureEnabled && window.argusCompanion &&
        typeof window.argusCompanion.registerStaircaseCommandHandler === 'function') {
        window.argusCompanion.registerStaircaseCommandHandler(handleVoiceCommand);
    }

    updateControls();
    if (!featureEnabled) {
        startButton.hidden = true;
        stopButton.hidden = true;
        voiceButton.hidden = true;
        setStatus('Staircase Detection is disabled.');
    }

    try {
        const currentUrl = new URL(window.location.href);
        const command = currentUrl.searchParams.get('staircaseCommand');
        if (command && ['on', 'off', 'status'].includes(command)) {
            currentUrl.searchParams.delete('staircaseCommand');
            window.history.replaceState({}, '', currentUrl);
            handleVoiceCommand(command).then(speak).catch((error) => {
                console.error('[Staircase Detection] Voice command failed:', error);
                setStatus('Staircase detection unavailable. Do not rely on it.');
                speak('Staircase detection is unavailable. Do not rely on it.');
            });
        }
    } catch (error) {
        console.error('[Staircase Detection] Could not read the voice command:', error);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden && isActive) {
            stopDetection();
        }
    });
    window.addEventListener('beforeunload', stopDetection);
})();
