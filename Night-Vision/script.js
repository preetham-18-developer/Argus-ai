const video = document.getElementById('videoInput');
const canvas = document.getElementById('canvasOutput');
const ctx = canvas.getContext('2d');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusMsg = document.getElementById('status-message');
const loadingOverlay = document.getElementById('loading-overlay');

let stream = null;
let isStreaming = false; // logic flow flag
let isCameraRunning = false; // hardware state flag
let matSrc, matGray, matBlur, matEdge, matLines, srcClahe, matRoi;

// Vision Constants
const RHO = 1;
const THETA = Math.PI / 180;
const THRESHOLD = 30; // Sensitive detection
const MIN_LINE_LENGTH = 30;
const MAX_LINE_GAP = 20;

// State needed for temporal smoothing
const SMOOTHING_FACTOR = 0.15; // Lower = Smoother, Slower. 0.15 is a good balance for walking.

// --- VISION STATE ---
let visionMode = 'NORMAL'; // NORMAL, LOW_LIGHT, PHOTON_STARVATION
let accumMat = null;
let lastFpsTime = Date.now();
let framesInLastSecond = 0;
let currentFps = 30;
let enhancementIntensity = 1.0;
let gammaLut = null;
let currentGamma = 1.0;
let cannyThresh1 = 50;
let cannyThresh2 = 150;
// --------------------------

// Navigation State (Vanishing Point Model)
// Path is defined by:
// 1. Vanishing Point (vx, vy) - where all lines converge (Horizon)
// 2. Left Spread (angle or x-intercept)
// 3. Right Spread
let navState = {
    vx: 0, vy: 0, // Vanishing Point
    lx: 0, rx: 0, // X-intercepts at bottom
    valid: false
};

// Audio / Guidance State
let lastPathFoundTime = Date.now();
let synthesis = window.speechSynthesis;
let audioState = {
    lastSpokenTime: 0,
    commandCooldowns: { 'left': 0, 'right': 0, 'straight': 0, 'searching': 0, 'mode': 0 },
    currentPriority: -1,
    directionBuffer: [],
    lastCommand: ""
};

// Check for Secure Context
if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    console.warn("Warning: Camera access requires HTTPS or localhost.");
    statusMsg.innerText = "Error: Unsafe Context (Use HTTPS)";
}

function onOpenCvReady() {
    console.log('OpenCV.js loaded. Waiting for Runtime initialization...');
    const loadTimeout = setTimeout(() => {
        if (loadingOverlay.style.display !== 'none') {
            loadingOverlay.innerHTML = '<h1>Connect Failed</h1><p>OpenCV.js timed out.</p>';
        }
    }, 15000);

    if (cv.getBuildInformation) {
        finishLoading(loadTimeout);
    } else {
        cv['onRuntimeInitialized'] = () => {
            finishLoading(loadTimeout);
        };
    }
}

function finishLoading(timeoutId) {
    clearTimeout(timeoutId);
    console.log('OpenCV.js is ready');
    loadingOverlay.style.display = 'none';
    statusMsg.innerText = "PathGuide Pro Ready";
}

function speakAdvanced(text, priority, type) {
    const now = Date.now();

    // Silence = Success. No need to speak "Straight".
    if (type === 'straight') return;

    // Cooldown check per command type
    let cooldownDuration = 0;
    if (type === 'left' || type === 'right') cooldownDuration = 3000;
    else if (type === 'searching') cooldownDuration = 4000;
    else if (type === 'mode') cooldownDuration = 5000;

    if (now - (audioState.commandCooldowns[type] || 0) < cooldownDuration) {
        return; // Still in cooldown
    }

    // Global gap (except for High priority interrupting)
    let globalGap = 2500;
    if (priority < 2 && (now - audioState.lastSpokenTime) < globalGap) {
        return;
    }

    if (synthesis.speaking) {
        if (priority > audioState.currentPriority) {
            synthesis.cancel(); // High priority interrupts Low/Medium
        } else {
            return; // Medium waits/drops
        }
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = 1.0;
    utterance.rate = 1.1;

    utterance.onend = () => {
        audioState.currentPriority = -1;
    };

    synthesis.speak(utterance);

    audioState.lastSpokenTime = now;
    audioState.commandCooldowns[type] = now;
    audioState.currentPriority = priority;
    audioState.lastCommand = text;

    statusMsg.innerText = text; // Sync UI
}

function processDirectionWithStability(dirCmd) {
    audioState.directionBuffer.push(dirCmd);
    if (audioState.directionBuffer.length > 5) {
        audioState.directionBuffer.shift();
    }

    // Stable if all recent frames agree
    let isStable = audioState.directionBuffer.every(val => val === dirCmd);
    if (isStable) {
        if (dirCmd === 'left') speakAdvanced("Move Left", 1, 'left');
        else if (dirCmd === 'right') speakAdvanced("Move Right", 1, 'right');
        else if (dirCmd === 'straight') speakAdvanced("Straight", 0, 'straight'); // Handled as silence
        else if (dirCmd === 'searching') speakAdvanced("Searching", 0, 'searching');
    }
}

// Retrofit speak to use speakAdvanced default
function speak(text) {
    // Basic fallback for old speak calls
    if (text === "Camera access failed.") speakAdvanced(text, 2, 'mode');
    else if (text === "Guidance started.") speakAdvanced(text, 2, 'mode');
}

// --- REFINED WEBCAM CONTROLLER (Based on Snippet) ---
async function startCamera() {
    try {
        if (isCameraRunning && stream) {
            console.log("Camera already running");
            return;
        }

        console.log("Initializing camera stream...");
        
        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: "environment" // Optimized for forward path guidance
            },
            audio: false
        };

        const simpleConstraints = { video: true, audio: false };

        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            console.warn("Advanced constraints failed, using fallback...", e);
            stream = await navigator.mediaDevices.getUserMedia(simpleConstraints);
        }

        video.srcObject = stream;
        
        video.onloadedmetadata = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            initOpenCVObjects();
            startProcessing();
        };

        await video.play();
        isCameraRunning = true;
        isStreaming = true;

        console.log("Camera started");
        monitorStream(stream);

        // UI Updates
        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        speak("Guidance started.");
        statusMsg.innerText = "Camera Active";

    } catch (err) {
        handleCameraError(err);
    }
}

function monitorStream(stream) {
    const track = stream.getVideoTracks()[0];
    if (!track) return;

    track.onended = () => {
        console.log("Camera track ended. Restarting...");
        restartCamera();
    };

    track.onmute = () => {
        console.log("Camera muted. Restarting...");
        restartCamera();
    };

    track.oninactive = () => {
        console.log("Camera inactive. Restarting...");
        restartCamera();
    };
}

async function restartCamera() {
    if (!isCameraRunning) return;
    stopCamera();
    setTimeout(() => {
        if (!document.hidden) startCamera();
    }, 2000); // 2s delay for safer release
}

function handleCameraError(err) {
    console.error("Camera Error:", err);
    
    let userMsg = "Camera access failed.";
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        userMsg = "Permission denied. Please allow camera access.";
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        userMsg = "No camera found on this device.";
    }

    // Security alert removed as requested.

    statusMsg.innerText = userMsg;
    speak(userMsg);
}

function stopCamera() {
    isStreaming = false; 
    isCameraRunning = false;

    if (stream) {
        console.log("Stopping all camera tracks...");
        stream.getTracks().forEach(track => {
            track.onended = null;
            track.onmute = null;
            track.oninactive = null;
            track.stop();
        });
        stream = null;
    }
    
    video.pause();
    video.srcObject = null;

    if (startBtn && stopBtn) {
        startBtn.style.display = 'block';
        stopBtn.style.display = 'none';
    }
    if (statusMsg) statusMsg.innerText = "Stopped";
    cleanupOpenCVObjects();
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log("Tab hidden, releasing camera...");
        stopCamera();
    } else {
        // Only restart if it was actually streaming before
        // Here we can just let focus be enough, but for a mobility app, 
        // we might want it to resume automatically if started.
    }
});

// Add Hub link
const hubLink = document.createElement('a');
hubLink.href = "/";
hubLink.innerText = "← BACK TO HUB";
hubLink.style = `
    position:fixed;
    top:20px;
    left:20px;
    color:white;
    text-decoration:none;
    background:rgba(0,0,0,0.6);
    padding:8px 15px;
    border-radius:20px;
    font-size:12px;
    font-weight:600;
    z-index:3000;
    border:1px solid rgba(255,255,255,0.2);
`;
document.body.appendChild(hubLink);

function initOpenCVObjects() {
    matSrc = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
    matGray = new cv.Mat();
    matBlur = new cv.Mat();
    matEdge = new cv.Mat();
    matLines = new cv.Mat();
    srcClahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
    // Initialize Night Vision structures
    gammaLut = new cv.Mat(1, 256, cv.CV_8U);
    updateGammaLut(1.0);
}

function cleanupOpenCVObjects() {
    if (matSrc) matSrc.delete();
    if (matGray) matGray.delete();
    if (matBlur) matBlur.delete();
    if (matEdge) matEdge.delete();
    if (matLines) matLines.delete();
    if (srcClahe) srcClahe.delete();
    if (gammaLut) gammaLut.delete();
    if (accumMat) { accumMat.delete(); accumMat = null; }
    matSrc = null;
}

function startProcessing() {
    if (!matSrc) return;
    isStreaming = true;
    requestAnimationFrame(processFrame);
}

let frameCount = 0;
function processFrame() {
    if (!isStreaming) return;

    // Step 5: Frame Skipping Optimization
    frameCount++;
    if (frameCount % 10 !== 0) {
        requestAnimationFrame(processFrame);
        return;
    }

    const begin = Date.now();

    try {
        // 1. Capture & Preprocess
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        matSrc.data.set(imageData.data);

        cv.cvtColor(matSrc, matGray, cv.COLOR_RGBA2GRAY);

        // --- VISION EXTENSION ---
        trackFPS();
        let meanObj = new cv.Mat();
        let stddevObj = new cv.Mat();
        cv.meanStdDev(matGray, meanObj, stddevObj);
        let meanBrightness = meanObj.data64F[0];
        let variance = stddevObj.data64F[0] * stddevObj.data64F[0];
        meanObj.delete(); stddevObj.delete();

        checkVisionTrigger(meanBrightness, variance);

        if (visionMode === 'PHOTON_STARVATION') {
            applyPhotonStarvation(matGray);
            cv.imshow('canvasOutput', matGray); // Show pseudo-depth map
        } else if (visionMode === 'LOW_LIGHT') {
            applyNightVisionEnhancement(meanBrightness);
            cv.imshow('canvasOutput', matGray); // Show night vision map too if preferred, or leave as CSS?
            // Original code used CSS, but let's show the enhanced gray so we see the structure and CLAHE
        } else {
            srcClahe.clipLimit = 2.0;
            srcClahe.apply(matGray, matGray);
            cannyThresh1 = 50;
            cannyThresh2 = 150;
        }
        // ------------------------------

        // 2. Focused ROI (Ignore top 40% sky, ignore very bottom 10% car hood/feet)
        // Analyzing effectively the middle-ground
        let roiY = Math.floor(matSrc.rows * 0.35);
        let roiH = Math.floor(matSrc.rows * 0.55);
        let rect = new cv.Rect(0, roiY, matSrc.cols, roiH);
        let matRoi = matGray.roi(rect);

        // 3. Edge Detection
        // Dynamically adjust blur size based on Night Vision stress
        let blurSize = (visionMode !== 'NORMAL') && enhancementIntensity > 0.7 ? 7 : 5;
        let ksize = new cv.Size(blurSize, blurSize);
        cv.GaussianBlur(matRoi, matBlur, ksize, 0, 0, cv.BORDER_DEFAULT);

        if (visionMode === 'PHOTON_STARVATION') {
            cv.Canny(matBlur, matEdge, 10, 50, 3, false);
        } else {
            cv.Canny(matBlur, matEdge, cannyThresh1, cannyThresh2, 3, false);
        }

        // 4. Hough Lines
        cv.HoughLinesP(matEdge, matLines, RHO, THETA, THRESHOLD, MIN_LINE_LENGTH, MAX_LINE_GAP);

        // 5. Advanced Vanishing Point Logic
        updateNavigationState(matLines, matSrc.rows, matSrc.cols, roiY);

        matRoi.delete(); // cleanup ROI

        // 6. Draw Premium Overlay
        drawPremiumOverlay(navState, matSrc.rows, matSrc.cols);

    } catch (err) {
        console.error(err);
    }

    const delay = 1000 / 30 - (Date.now() - begin);
    setTimeout(() => { requestAnimationFrame(processFrame); }, Math.max(0, delay));
}

// --- NIGHT VISION FUNCTIONS ---
function updateGammaLut(gamma) {
    if (Math.abs(currentGamma - gamma) < 0.05) return;
    currentGamma = gamma;
    for (let i = 0; i < 256; i++) {
        let val = Math.pow(i / 255.0, gamma) * 255.0;
        gammaLut.data[i] = Math.min(255, val);
    }
}

function trackFPS() {
    let now = Date.now();
    framesInLastSecond++;
    if (now - lastFpsTime >= 1000) {
        currentFps = framesInLastSecond;
        framesInLastSecond = 0;
        lastFpsTime = now;

        if (currentFps < 25) {
            enhancementIntensity = Math.max(0.4, enhancementIntensity - 0.2);
        } else if (currentFps >= 28) {
            enhancementIntensity = Math.min(1.0, enhancementIntensity + 0.1);
        }
    }
}

function checkVisionTrigger(meanBrightness, variance) {
    let nvIndicator = document.getElementById('night-vision-indicator');

    if (meanBrightness < 15 && variance < 25) {
        if (visionMode !== 'PHOTON_STARVATION') {
            visionMode = 'PHOTON_STARVATION';
            speakAdvanced("Very dark. Using assisted navigation.", 2, 'mode');
            if (nvIndicator) nvIndicator.style.display = 'block';
            document.body.classList.add('night-glow');
        }
    } else if (meanBrightness < 60) {
        if (visionMode !== 'LOW_LIGHT') {
            let prevMode = visionMode;
            visionMode = 'LOW_LIGHT';
            if (prevMode === 'PHOTON_STARVATION') {
                speakAdvanced("Light detected. Vision restored.", 2, 'mode');
            }
            if (nvIndicator) nvIndicator.style.display = 'block';
            document.body.classList.add('night-glow');
        }
    } else {
        if (visionMode !== 'NORMAL') {
            if (visionMode === 'PHOTON_STARVATION') {
                speakAdvanced("Light detected. Vision restored.", 2, 'mode');
            }
            visionMode = 'NORMAL';
            if (nvIndicator) nvIndicator.style.display = 'none';
            document.body.classList.remove('night-glow');
        }
    }
}

function applyPhotonStarvation(mGray) {
    let tempMat = new cv.Mat();
    // A. Temporal Frame Accumulation
    if (!accumMat) {
        accumMat = new cv.Mat(mGray.rows, mGray.cols, cv.CV_32F);
        mGray.convertTo(accumMat, cv.CV_32F);
    }

    let alpha = (currentFps < 20) ? 1.0 : 0.2;
    mGray.convertTo(tempMat, cv.CV_32F);
    if (alpha === 1.0) {
        accumMat.data32F.set(tempMat.data32F);
    } else {
        cv.addWeighted(accumMat, 1.0 - alpha, tempMat, alpha, 0.0, accumMat);
    }
    accumMat.convertTo(mGray, cv.CV_8U);

    // B. Structure-First Enhancement
    updateGammaLut(0.4);
    cv.LUT(mGray, gammaLut, mGray);

    let claheSmall = new cv.CLAHE(3.0, new cv.Size(4, 4));
    claheSmall.apply(mGray, mGray);
    claheSmall.apply(mGray, mGray);
    claheSmall.delete();

    cv.normalize(mGray, mGray, 0, 255, cv.NORM_MINMAX);

    // C. Noise-Tolerant Edge Recovery
    let gradX = new cv.Mat(), gradY = new cv.Mat();
    let absGradX = new cv.Mat(), absGradY = new cv.Mat();

    cv.Sobel(mGray, gradX, cv.CV_16S, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT);
    cv.convertScaleAbs(gradX, absGradX);
    cv.Sobel(mGray, gradY, cv.CV_16S, 0, 1, 3, 1, 0, cv.BORDER_DEFAULT);
    cv.convertScaleAbs(gradY, absGradY);

    let sobelEdges = new cv.Mat();
    cv.addWeighted(absGradX, 0.5, absGradY, 0.5, 0, sobelEdges);

    let laplace = new cv.Mat(), absLaplace = new cv.Mat();
    cv.Laplacian(mGray, laplace, cv.CV_16S, 3, 1, 0, cv.BORDER_DEFAULT);
    cv.convertScaleAbs(laplace, absLaplace);

    cv.addWeighted(sobelEdges, 0.7, absLaplace, 0.3, 0, mGray);
    cv.convertScaleAbs(mGray, mGray, 2.0, 0);

    // D. Binary Structural Boost
    let binaryImg = new cv.Mat();
    cv.adaptiveThreshold(mGray, binaryImg, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 11, 2);

    let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.morphologyEx(binaryImg, binaryImg, cv.MORPH_CLOSE, kernel);

    // E. Pseudo-Depth
    cv.bitwise_and(mGray, binaryImg, mGray);

    tempMat.delete(); gradX.delete(); gradY.delete(); absGradX.delete(); absGradY.delete();
    sobelEdges.delete(); laplace.delete(); absLaplace.delete(); binaryImg.delete(); kernel.delete();
}

function applyNightVisionEnhancement(meanBrightness) {
    // 1: Gamma Correction (make darks visible)
    let targetGamma = Math.max(0.3, meanBrightness / 100);
    updateGammaLut(targetGamma);
    cv.LUT(matGray, gammaLut, matGray);

    // 2: Adaptive CLAHE
    srcClahe.clipLimit = Math.max(1.0, 3.0 * enhancementIntensity);
    srcClahe.apply(matGray, matGray);

    // 3: Fast Noise Reduction (Gaussian is much faster than Bilateral)
    if (enhancementIntensity > 0.6) {
        cv.GaussianBlur(matGray, matGray, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    }

    // 4: Contrast Stretching
    cv.normalize(matGray, matGray, 0, 255, cv.NORM_MINMAX);

    // 5: Edge Amplification state updates
    cannyThresh1 = 20;
    cannyThresh2 = 80;
}
// ------------------------------

// --- The Core "Gravity" Engine (Slope-Based Logic) ---
function updateNavigationState(lines, height, width, roiOffset) {
    let leftLines = [];
    let rightLines = [];

    // Dynamic Lane Width tracking
    if (!navState.estimatedWidth) {
        navState.estimatedWidth = width * 0.6; // Initial default
    }

    // 1. Classify Lines by SLOPE and POSITION
    // This is critical: if you cross the center, the Left wall is now on your Right.
    // Position-based logic fails there. 
    // Pure slope-based logic fails at edges when lines become vertical.
    // Hybrid approaches handle edges smoothly.
    const data32S = lines.data32S;
    for (let i = 0; i < lines.rows; i++) {
        let x1 = data32S[i * 4];
        let y1 = data32S[i * 4 + 1] + roiOffset;
        let x2 = data32S[i * 4 + 2];
        let y2 = data32S[i * 4 + 3] + roiOffset;

        let dx = x2 - x1;
        let dy = y2 - y1;
        if (dy === 0) continue; // Horizontal (ignore)

        let m = dx / dy; // Inverse Slope

        // Filter valid perspective lines (avoid near-horizontal)
        // |m| < 4.0 implies vertical enough context
        if (Math.abs(m) > 4.0) continue;

        let bottomX = x1 + (height - y1) * m;
        let isLeftLine = false;

        if (navState.valid) {
            // When user is at the edge of the path, lines might appear vertical (m ~ 0)
            // or switch slopes completely. We use spatial proximity to the known lane boundaries.
            let distLeft = Math.abs(bottomX - navState.lx);
            let distRight = Math.abs(bottomX - navState.rx);

            if (m < -0.3 && bottomX < navState.rx) {
                isLeftLine = true;
            } else if (m > 0.3 && bottomX > navState.lx) {
                isLeftLine = false;
            } else {
                // Ambiguous near-vertical line: classify by closest inferred boundary
                isLeftLine = distLeft < distRight;
            }
        } else {
            // Bootstrapping
            if (m < -0.15) {
                isLeftLine = true;
            } else if (m > 0.15) {
                isLeftLine = false;
            } else {
                isLeftLine = bottomX < (width / 2);
            }
        }

        if (isLeftLine) {
            leftLines.push({ x1, y1, x2, y2, m });
        } else {
            rightLines.push({ x1, y1, x2, y2, m });
        }
    }

    // 2. Weighted Average "Best Fit"
    let cLeft = getWeightedX(leftLines, height);
    let cRight = getWeightedX(rightLines, height);

    // 3. Estimate Path State
    let valid = false;

    if (cLeft !== null && cRight !== null) {
        // Both sides seen - Perfect
        navState.lx = lerp(navState.lx, cLeft, SMOOTHING_FACTOR);
        navState.rx = lerp(navState.rx, cRight, SMOOTHING_FACTOR);

        let currentW = navState.rx - navState.lx;
        if (currentW > width * 0.2 && currentW < width * 2.0) {
            // Gradually adopt the real width
            navState.estimatedWidth = lerp(navState.estimatedWidth, currentW, SMOOTHING_FACTOR * 0.1);
        }
        valid = true;
    } else if (cLeft !== null) {
        // Only Left Wall seen - typically user is walking near Right Edge and Right Wall is cut off
        navState.lx = lerp(navState.lx, cLeft, SMOOTHING_FACTOR);
        navState.rx = navState.lx + navState.estimatedWidth; // Rigid lock prevents lane center wandering
        valid = true;
    } else if (cRight !== null) {
        // Only Right Wall seen - typically user is walking near Left Edge
        navState.rx = lerp(navState.rx, cRight, SMOOTHING_FACTOR);
        navState.lx = navState.rx - navState.estimatedWidth; // Rigid lock prevents lane center wandering
        valid = true;
    }

    navState.valid = valid;

    if (valid) {
        let pathCenterBottom = (navState.lx + navState.rx) / 2;
        let laneWidth = Math.max(navState.rx - navState.lx, width * 0.2); // avoid div by zero

        // Deviation: Center - PathCenter
        let pathX = pathCenterBottom;
        let screenX = width / 2;

        // Positive = Path is on Right -> Move Right
        // Negative = Path is on Left -> Move Left
        let devPercent = (pathX - screenX) / laneWidth;

        // Thresholds
        if (devPercent < -0.15) {
            navState.status = 'warn_left'; // Path is Left -> guide user left
            processDirectionWithStability('left');
        } else if (devPercent > 0.15) {
            navState.status = 'warn_right'; // Path is Right -> guide user right
            processDirectionWithStability('right');
        } else {
            navState.status = 'safe';
            processDirectionWithStability('straight');
        }
        lastPathFoundTime = Date.now();

    } else {
        handleNoPath();
    }
}

function getWeightedX(lines, targetY) {
    if (lines.length === 0) return null;
    let totalX = 0, totalW = 0;
    for (let l of lines) {
        let dx = l.x2 - l.x1;
        let dy = l.y2 - l.y1;
        if (dy === 0) continue;
        let m = dx / dy;
        // project to targetY
        let x = l.x1 + (targetY - l.y1) * m;

        let len = Math.sqrt(dx * dx + dy * dy);
        totalX += x * len;
        totalW += len;
    }
    return totalW > 0 ? totalX / totalW : null;
}

function lerp(start, end, amt) {
    // Check NaN
    if (isNaN(start)) return end;
    return (1 - amt) * start + amt * end;
}

// --- Premium Visualization ---
function drawPremiumOverlay(state, height, width) {
    if (!state.valid) {
        drawFailsafeGuidance(height, width);
        return;
    }

    const vpY = height * 0.35;
    const vpX = width / 2;

    let p1 = { x: state.lx, y: height };
    let p2 = { x: state.rx, y: height };
    let p3 = { x: vpX + (state.rx - vpX) * 0.1, y: vpY };
    let p4 = { x: vpX + (state.lx - vpX) * 0.1, y: vpY };

    // Fill
    let grad = ctx.createLinearGradient(0, vpY, 0, height);
    if (state.status === 'safe') {
        grad.addColorStop(0, "rgba(0, 255, 100, 0.2)"); // Mint Green
        grad.addColorStop(1, "rgba(0, 255, 100, 0.5)");
    } else {
        grad.addColorStop(0, "rgba(255, 50, 0, 0.2)"); // Orange/Red
        grad.addColorStop(1, "rgba(255, 50, 0, 0.5)");
    }

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Edges
    ctx.lineWidth = 6;
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'white';
    ctx.strokeStyle = 'white'; // Clean white edges

    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p4.x, p4.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.stroke();
    ctx.shadowBlur = 0;

    // Text Labels for Debug confidence
    ctx.fillStyle = "white";
    ctx.font = "20px Arial";
    ctx.fillText("L", p1.x, height - 20);
    ctx.fillText("R", p2.x, height - 20);

    // Dynamic Arrows
    if (state.status === 'warn_left') {
        drawBigArrow(width / 2, height / 2, 'left');
    } else if (state.status === 'warn_right') {
        drawBigArrow(width / 2, height / 2, 'right');
    } else {
        // Draw Target Circle when straight
        drawTarget(vpX, vpY);
    }
}

function drawTarget(x, y) {
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.fillStyle = '#00FF00'; ctx.fill();
}

function drawBigArrow(x, y, dir) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = (dir === 'left' || dir === 'right') ? '#FF9900' : '#00E676';
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 4;

    const s = 40;
    ctx.beginPath();
    if (dir === 'left') {
        ctx.moveTo(s, -s); ctx.lineTo(-s * 1.5, 0); ctx.lineTo(s, s);
    } else if (dir === 'right') {
        ctx.moveTo(-s, -s); ctx.lineTo(s * 1.5, 0); ctx.lineTo(-s, s);
    } else if (dir === 'straight') {
        ctx.moveTo(-s, s); ctx.lineTo(0, -s * 1.5); ctx.lineTo(s, s); ctx.lineTo(0, 0);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "white";
    ctx.font = "bold 24px Arial";
    ctx.textAlign = "center";
    let textOut = dir === 'left' ? "MOVE LEFT" : (dir === 'right' ? "MOVE RIGHT" : "FORWARD");
    ctx.fillText(textOut, 0, s + 30);

    ctx.restore();
}

function drawFailsafeGuidance(height, width) {
    const vpY = height * 0.35;
    const vpX = width / 2;

    ctx.strokeStyle = "rgba(0, 255, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, vpY);
    ctx.lineTo(width, vpY);
    ctx.stroke();

    let p1 = { x: vpX - width * 0.3, y: height };
    let p2 = { x: vpX + width * 0.3, y: height };
    let p3 = { x: vpX + width * 0.05, y: vpY };
    let p4 = { x: vpX - width * 0.05, y: vpY };

    let grad = ctx.createLinearGradient(0, vpY, 0, height);
    grad.addColorStop(0, "rgba(0, 150, 255, 0.2)");
    grad.addColorStop(1, "rgba(0, 150, 255, 0.5)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 4;
    ctx.setLineDash([15, 15]);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p4.x, p4.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.stroke();
    ctx.setLineDash([]);

    drawBigArrow(vpX, height / 2, 'straight');

    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.font = "bold 24px Arial";
    ctx.textAlign = "center";
    ctx.fillText("ASSISTED MODE ALIVE", vpX, height - 30);
}

// ... helper functions (fitLine removed as we use getWeightedX) ...
function handleNoPath() {
    if (Date.now() - lastPathFoundTime > 3000) {
        processDirectionWithStability('searching');
        statusMsg.innerText = "Searching for path...";
        // Decay
        navState.valid = false;
    }
}

// Event Listeners
startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);



