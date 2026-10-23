/**
 * PathGuide Pro - Real-Time Computer Vision & Assistive Mobility Guidance
 * Powered by TensorFlow.js COCO-SSD & Low-Light Adaptive Photon Enhancement
 * 100% Live Vision Stream — Zero Edge-Density Heuristics or Fabricated Clearances
 */

// DOM Elements
const video = document.getElementById('videoInput');
const canvas = document.getElementById('canvasOutput');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusMsg = document.getElementById('status-message');
const loadingOverlay = document.getElementById('loading-overlay');
const nightVisionIndicator = document.getElementById('night-vision-indicator');
const voiceToggle = document.getElementById('voice-toggle');

// Core Vision & Model State
let model = null;
let stream = null;
let isStreaming = false;
let isCameraRunning = false;
let isDetecting = false;
let isOpenCvReady = false;
let animationFrameId = null;

// Reusable Night Vision Engine (AUTO / ON / OFF, Hysteresis, Adaptive Gamma)
const nightVision = (typeof NightVisionCore !== 'undefined')
    ? new NightVisionCore({
        mode: 'AUTO',
        lowLightEnter: 40.0,
        lowLightExit: 52.0,
        nearDarknessThreshold: 8.0,
        onSpeechAnnounce: (msg) => speakGuidance(msg)
    })
    : null;

// Navigational & Obstacle Awareness State
let navState = {
    status: 'uncertain',            // 'stop', 'warn_left', 'warn_right', 'open_path', 'uncertain'
    primaryHazard: null,           // { class, sector, proximity }
    detectedObstacles: [],
    leftObstacles: [],
    centerObstacles: [],
    rightObstacles: [],
    meanPixelLuminance: 128.0,
    isLowLight: false,
    isNearDarkness: false,
    isEnhancementActive: false,
    recommendedAction: 'STANDBY'
};

// Temporal Obstacle Memory (IoU-smoothed across frames to eliminate flickering)
let obstacleMemory = [];
const MAX_OBSTACLE_MISSES = 4;

// Audio & Speech State
const synth = window.speechSynthesis;
let lastSpokenTime = 0;
let lastSpokenCommand = "";
const SPEECH_COOLDOWN_MS = 4000;

// High-Priority Relevant Obstacle Classes (Physical objects on walking surface)
const RELEVANT_OBSTACLES = new Set([
    'person', 'chair', 'couch', 'bed', 'dining table',
    'backpack', 'suitcase', 'handbag', 'umbrella',
    'bottle', 'sports ball', 'skateboard',
    'bicycle', 'motorcycle', 'car', 'bus', 'truck',
    'dog', 'cat', 'tv', 'laptop'
]);

// 1. Model & Vision Engine Initialization
async function initVisionEngine() {
    try {
        console.log("Loading TensorFlow COCO-SSD Obstacle Detection Model...");
        if (typeof cocoSsd !== 'undefined') {
            model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
            console.log("✓ COCO-SSD Neural Obstacle Detector Ready");
        } else {
            throw new Error("COCO-SSD library not available");
        }

        finishLoading("PathGuide Pro Ready (AI Obstacle Vision)");

    } catch (err) {
        console.error("Neural model loading failed:", err);
        finishLoading("Detector Load Error - Check connection", true);
    }
}

// OpenCV Background Listener (Optional Night-Vision Enhancer)
function onOpenCvReady() {
    console.log("✓ OpenCV.js core loaded");
    isOpenCvReady = true;
}

function finishLoading(msg, isError = false) {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
    if (statusMsg) {
        statusMsg.innerText = msg;
        statusMsg.style.color = isError ? "#FF1744" : "#00E676";
    }
}

// 2. Real-Time Speech Dispatcher
function speakGuidance(command, priority = false) {
    if (!synth || !voiceToggle || !voiceToggle.checked) return;
    const now = Date.now();

    if (!priority && (now - lastSpokenTime < SPEECH_COOLDOWN_MS || command === lastSpokenCommand)) {
        return;
    }

    if (synth.speaking) {
        if (priority) synth.cancel();
        else return;
    }

    const cleanText = command.replace(/[*#_~`]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onend = () => {
        lastSpokenTime = Date.now();
    };

    synth.speak(utterance);
    lastSpokenTime = now;
    lastSpokenCommand = command;
}

// 3. Camera Setup & Lifecycle
async function startCamera() {
    try {
        if (isCameraRunning && stream) return;

        statusMsg.innerText = "Requesting live camera feed...";
        statusMsg.style.color = "#00F2FE";

        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: "environment"
            },
            audio: false
        };

        const fallbackConstraints = { video: true, audio: false };

        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            console.warn("High-res camera unavailable, using fallback:", e);
            stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
        }

        video.srcObject = stream;

        await new Promise((resolve) => {
            video.onloadedmetadata = () => resolve();
            if (video.videoWidth > 0 && video.videoHeight > 0) resolve();
            setTimeout(resolve, 800);
        });

        await video.play();

        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;

        isCameraRunning = true;
        isStreaming = true;

        startBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        statusMsg.innerText = "PathGuide Active — Scanning Obstacles";
        statusMsg.style.color = "#00E676";
        speakGuidance("PathGuide online. Monitoring walking path for obstacles.", true);

        requestAnimationFrame(processLiveFrame);

    } catch (err) {
        console.error("Camera access error:", err);
        let errorMsg = "Camera access denied. Please grant camera permission.";
        if (err.name === 'NotFoundError') errorMsg = "No camera hardware detected.";
        statusMsg.innerText = errorMsg;
        statusMsg.style.color = "#FF1744";
        speakGuidance(errorMsg, true);
    }
}

function stopCamera() {
    isStreaming = false;
    isCameraRunning = false;

    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }

    if (video) {
        video.pause();
        video.srcObject = null;
    }

    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    startBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    statusMsg.innerText = "Guidance Paused";
    statusMsg.style.color = "#ffffff";
    if (nightVisionIndicator) nightVisionIndicator.style.display = 'none';
}

// 4. Continuous Live Frame Processing Loop
let frameSkip = 0;
async function processLiveFrame() {
    if (!isStreaming) return;

    const w = canvas.width;
    const h = canvas.height;

    // Sync dimensions with live video
    if (video.videoWidth > 0 && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }

    // 1. Draw raw live frame
    ctx.drawImage(video, 0, 0, w, h);

    // 2. Measure mean pixel luminance and apply adaptive enhancement via NightVisionCore
    if (nightVision) {
        const nvReport = nightVision.processFrame(video, canvas);
        navState.meanPixelLuminance = nvReport.meanPixelLuminance;
        navState.isLowLight = nvReport.isLowLight;
        navState.isNearDarkness = nvReport.isNearDarkness;
        navState.isEnhancementActive = nvReport.isEnhancementActive;

        if (nightVisionIndicator) {
            if (nvReport.isNearDarkness) {
                nightVisionIndicator.style.display = 'block';
                nightVisionIndicator.style.borderColor = '#FF1744';
                nightVisionIndicator.style.color = '#FF1744';
                nightVisionIndicator.innerText = `👁️ Near Darkness (Luma: ${nvReport.meanPixelLuminance}) — Unreliable`;
            } else if (nvReport.isEnhancementActive) {
                nightVisionIndicator.style.display = 'block';
                nightVisionIndicator.style.borderColor = '#00F2FE';
                nightVisionIndicator.style.color = '#00F2FE';
                nightVisionIndicator.innerText = `👁️ Night Vision Active [${nvReport.mode}] (Luma: ${nvReport.meanPixelLuminance})`;
            } else if (nightVision.mode === 'ON') {
                nightVisionIndicator.style.display = 'block';
                nightVisionIndicator.style.borderColor = '#00E676';
                nightVisionIndicator.style.color = '#00E676';
                nightVisionIndicator.innerText = `👁️ Night Vision Forced ON (Luma: ${nvReport.meanPixelLuminance})`;
            } else {
                nightVisionIndicator.style.display = 'none';
            }
        }
    }

    // 3. Run neural obstacle detection every 3 frames (~18-20 FPS)
    frameSkip++;
    if (model && video.readyState >= 2 && !isDetecting && frameSkip % 3 === 0) {
        runObstacleInference();
    }

    // 4. Draw HUD overlays, obstacle tags, and guidance vectors
    drawPathGuideHUD(w, h);

    animationFrameId = requestAnimationFrame(processLiveFrame);
}

// 5. Neural Obstacle Detection & Spatial Classification
async function runObstacleInference() {
    isDetecting = true;
    try {
        const rawDetections = await model.detect(canvas);
        const w = canvas.width || 640;
        const h = canvas.height || 480;

        // Ground walking corridor: lower 65% of screen (Y > 0.35 * h)
        const corridorTop = h * 0.35;

        // Filter for physical ground obstacles with >= 40% confidence
        const groundObstacles = (rawDetections || [])
            .filter(d => {
                const [x, y, bw, bh] = d.bbox;
                const groundY = y + bh;
                const isRelevant = RELEVANT_OBSTACLES.has(d.class.toLowerCase());
                return isRelevant && d.score >= 0.40 && groundY >= corridorTop;
            })
            .map(d => {
                const [x, y, bw, bh] = d.bbox;
                const cx = x + bw / 2;
                const groundY = y + bh;

                // Sector Mapping
                let sector = 'CENTER';
                if (cx < w * 0.35) sector = 'LEFT';
                else if (cx > w * 0.65) sector = 'RIGHT';

                // Proximity Mapping based on ground contact and vertical size
                let proximity = 'FAR';
                const normGround = groundY / h;
                const normHeight = bh / h;

                if (normGround > 0.75 || normHeight > 0.45) proximity = 'NEAR';
                else if (normGround >= 0.48) proximity = 'MID';

                return {
                    class: d.class.toLowerCase(),
                    score: d.score,
                    bbox: d.bbox,
                    sector,
                    proximity,
                    groundY
                };
            });

        // Update temporal obstacle memory
        updateObstacleMemory(groundObstacles);

        // Evaluate conservative guidance decision
        evaluateGuidanceDecision(w, h);

    } catch (err) {
        console.warn("Obstacle inference frame skip:", err);
    } finally {
        isDetecting = false;
    }
}

// IoU Temporal Tracker for Obstacles
function updateObstacleMemory(newObstacles) {
    const matched = new Set();

    newObstacles.forEach(obs => {
        let bestMatch = -1;
        let bestIoU = 0;

        for (let i = 0; i < obstacleMemory.length; i++) {
            if (matched.has(i)) continue;
            const iou = computeIoU(obs.bbox, obstacleMemory[i].bbox);
            if (iou > bestIoU) {
                bestIoU = iou;
                bestMatch = i;
            }
        }

        if (bestIoU >= 0.30 && bestMatch !== -1) {
            // Update matched obstacle
            const mem = obstacleMemory[bestMatch];
            mem.bbox = obs.bbox;
            mem.sector = obs.sector;
            mem.proximity = obs.proximity;
            mem.score = obs.score;
            mem.class = obs.class;
            mem.hits++;
            mem.misses = 0;
            matched.add(bestMatch);
        } else {
            // Spawn new obstacle candidate
            obstacleMemory.push({ ...obs, hits: 1, misses: 0 });
        }
    });

    // Age unmatched obstacles
    for (let i = 0; i < obstacleMemory.length; i++) {
        if (!matched.has(i)) obstacleMemory[i].misses++;
    }

    obstacleMemory = obstacleMemory.filter(o => o.misses <= MAX_OBSTACLE_MISSES);
}

function computeIoU(boxA, boxB) {
    const [ax, ay, aw, ah] = boxA;
    const [bx, by, bw, bh] = boxB;
    const xLeft = Math.max(ax, bx);
    const yTop = Math.max(ay, by);
    const xRight = Math.min(ax + aw, bx + bw);
    const yBottom = Math.min(ay + ah, by + bh);
    if (xRight <= xLeft || yBottom <= yTop) return 0.0;
    const inter = (xRight - xLeft) * (yBottom - yTop);
    const union = aw * ah + bw * bh - inter;
    return union > 0 ? (inter / union) : 0.0;
}

// 6. Conservative Navigational Guidance State Machine
function evaluateGuidanceDecision(w, h) {
    // Only confirmed obstacles (hits >= 2) trigger guidance
    const confirmed = obstacleMemory.filter(o => o.hits >= 2 && o.misses === 0);

    const leftObs = confirmed.filter(o => o.sector === 'LEFT');
    const centerObs = confirmed.filter(o => o.sector === 'CENTER');
    const rightObs = confirmed.filter(o => o.sector === 'RIGHT');

    navState.detectedObstacles = confirmed;
    navState.leftObstacles = leftObs;
    navState.centerObstacles = centerObs;
    navState.rightObstacles = rightObs;

    // Check for extreme darkness or lens occlusion first
    if (navState.isNearDarkness || navState.meanPixelLuminance < 8.0) {
        navState.status = 'uncertain';
        navState.recommendedAction = 'MOVE CAUTIOUSLY';
        navState.primaryHazard = null;
        updateStatusDisplay("Near Darkness — Sensor signal insufficient. Move cautiously.", "#FF1744");
        speakGuidance("Scene in near darkness. Visual detection unreliable. Use mobility cane.", true);
        return;
    }

    // Condition 1: Obstacle directly ahead in center corridor
    const centerNearOrMid = centerObs.find(o => o.proximity === 'NEAR' || o.proximity === 'MID');
    if (centerNearOrMid) {
        navState.status = 'stop';
        navState.primaryHazard = centerNearOrMid;
        navState.recommendedAction = 'STOP / CHECK AHEAD';

        const cls = centerNearOrMid.class.toUpperCase();
        const prox = centerNearOrMid.proximity;
        updateStatusDisplay(`STOP — ${cls} Directly Ahead [${prox}]`, "#FF1744");
        speakGuidance(`Stop. ${centerNearOrMid.class} directly ahead. Check path before stepping.`, true);
        return;
    }

    // Condition 2: Obstacle on Left
    const leftNear = leftObs.find(o => o.proximity === 'NEAR' || o.proximity === 'MID');
    // Condition 3: Obstacle on Right
    const rightNear = rightObs.find(o => o.proximity === 'NEAR' || o.proximity === 'MID');

    if (leftNear && !rightNear) {
        navState.status = 'warn_left';
        navState.primaryHazard = leftNear;
        navState.recommendedAction = 'CAUTION LEFT';

        const cls = leftNear.class.toUpperCase();
        updateStatusDisplay(`Caution — ${cls} on Left`, "#FF9100");
        speakGuidance(`Caution. ${leftNear.class} on your left.`);
        return;
    }

    if (rightNear && !leftNear) {
        navState.status = 'warn_right';
        navState.primaryHazard = rightNear;
        navState.recommendedAction = 'CAUTION RIGHT';

        const cls = rightNear.class.toUpperCase();
        updateStatusDisplay(`Caution — ${cls} on Right`, "#FF9100");
        speakGuidance(`Caution. ${rightNear.class} on your right.`);
        return;
    }

    if (leftNear && rightNear) {
        navState.status = 'stop';
        navState.recommendedAction = 'NARROW PASSAGE';
        updateStatusDisplay("Narrow Passage — Obstacles on Both Sides", "#FF1744");
        speakGuidance("Narrow passage. Obstacles on both left and right. Proceed with caution.", true);
        return;
    }

    // Condition 4: No detected ground obstacles in walking corridor
    navState.status = 'open_path';
    navState.primaryHazard = null;
    navState.recommendedAction = 'PROCEED WITH CAUTION';
    updateStatusDisplay("Possible Open Path (Move Cautiously)", "#00E676");
    speakGuidance("Possible open path ahead. Move cautiously.");
}

function updateStatusDisplay(text, color) {
    if (statusMsg) {
        statusMsg.innerText = text;
        statusMsg.style.color = color;
    }
}

// 7. Render Augmented Visual HUD, Sectors & Obstacle Boxes
function drawPathGuideHUD(w, h) {
    const colW = w / 3;
    const horizonY = h * 0.38;

    // 1. Draw Sector Boundary Lasers
    ctx.strokeStyle = "rgba(0, 242, 254, 0.30)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);

    // Left/Center boundary
    ctx.beginPath();
    ctx.moveTo(w * 0.35, horizonY);
    ctx.lineTo(w * 0.35, h);
    ctx.stroke();

    // Center/Right boundary
    ctx.beginPath();
    ctx.moveTo(w * 0.65, horizonY);
    ctx.lineTo(w * 0.65, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Draw Walking Corridor Trajectory Vector
    const centerStatus = navState.status;
    let corridorColor = "rgba(0, 230, 118, 0.25)";
    let borderLineColor = "#00E676";

    if (centerStatus === 'stop') {
        corridorColor = "rgba(255, 23, 68, 0.35)";
        borderLineColor = "#FF1744";
    } else if (centerStatus === 'warn_left' || centerStatus === 'warn_right') {
        corridorColor = "rgba(255, 145, 0, 0.25)";
        borderLineColor = "#FF9100";
    } else if (centerStatus === 'uncertain') {
        corridorColor = "rgba(255, 214, 0, 0.20)";
        borderLineColor = "#FFD600";
    }

    const corridorBaseW = w * 0.50;
    const corridorTopW = w * 0.16;
    const pLeftBottom = { x: (w / 2) - corridorBaseW / 2, y: h };
    const pRightBottom = { x: (w / 2) + corridorBaseW / 2, y: h };
    const pRightTop = { x: (w / 2) + corridorTopW / 2, y: horizonY };
    const pLeftTop = { x: (w / 2) - corridorTopW / 2, y: horizonY };

    ctx.beginPath();
    ctx.moveTo(pLeftBottom.x, pLeftBottom.y);
    ctx.lineTo(pRightBottom.x, pRightBottom.y);
    ctx.lineTo(pRightTop.x, pRightTop.y);
    ctx.lineTo(pLeftTop.x, pLeftTop.y);
    ctx.closePath();
    ctx.fillStyle = corridorColor;
    ctx.fill();

    ctx.lineWidth = 2.5;
    ctx.strokeStyle = borderLineColor;
    ctx.stroke();

    // 3. Draw Confirmed Obstacles
    const confirmed = navState.detectedObstacles;
    confirmed.forEach(obs => {
        const [x, y, bw, bh] = obs.bbox;
        const isHazard = (obs === navState.primaryHazard);

        let boxColor = "#FFD600"; // Yellow default
        if (obs.proximity === 'NEAR') boxColor = "#FF1744"; // Red for near
        else if (obs.proximity === 'MID') boxColor = "#FF9100"; // Orange for mid

        ctx.strokeStyle = boxColor;
        ctx.lineWidth = isHazard ? 3.5 : 2;
        ctx.strokeRect(x, y, bw, bh);

        // Ground Contact Dot
        ctx.fillStyle = boxColor;
        ctx.beginPath();
        ctx.arc(x + bw / 2, y + bh, 5, 0, Math.PI * 2);
        ctx.fill();

        // Obstacle Tag Badge
        const badgeText = `${obs.class.toUpperCase()} [${obs.sector}] [${obs.proximity}]`;
        ctx.font = "bold 12px 'Inter', Arial, sans-serif";
        const textW = ctx.measureText(badgeText).width;
        const badgeY = Math.max(0, y - 24);

        ctx.fillStyle = "rgba(10, 15, 25, 0.88)";
        ctx.fillRect(x, badgeY, textW + 12, 22);
        ctx.strokeStyle = boxColor;
        ctx.strokeRect(x, badgeY, textW + 12, 22);

        ctx.fillStyle = boxColor;
        ctx.fillText(badgeText, x + 6, badgeY + 15);
    });

    // 4. Sector Status Pills at top
    drawSectorBar(w);

    // 5. Action Recommendation Directive Banner at bottom
    const badgeW = 280;
    const badgeH = 44;
    const badgeX = (w - badgeW) / 2;
    const badgeY = h - 90;

    ctx.fillStyle = "rgba(10, 15, 25, 0.90)";
    ctx.strokeStyle = borderLineColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 22);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = borderLineColor;
    ctx.font = "bold 15px 'Inter', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`STATUS: ${navState.recommendedAction}`, w / 2, badgeY + 27);
}

function drawSectorBar(w) {
    const colW = w / 3;
    const y = 60;
    const h = 5;

    // Left Sector
    ctx.fillStyle = navState.leftObstacles.length > 0 ? "rgba(255, 145, 0, 0.8)" : "rgba(0, 230, 118, 0.7)";
    ctx.fillRect(20, y, colW - 30, h);

    // Center Sector
    ctx.fillStyle = navState.centerObstacles.length > 0 ? "rgba(255, 23, 68, 0.9)" : "rgba(0, 230, 118, 0.7)";
    ctx.fillRect(colW + 10, y, colW - 20, h);

    // Right Sector
    ctx.fillStyle = navState.rightObstacles.length > 0 ? "rgba(255, 145, 0, 0.8)" : "rgba(0, 230, 118, 0.7)";
    ctx.fillRect(colW * 2 + 10, y, colW - 30, h);
}

// 8. Event Listeners & Lifecycle
startBtn.addEventListener('click', startCamera);
stopBtn.addEventListener('click', stopCamera);

document.addEventListener('visibilitychange', () => {
    if (document.hidden && isStreaming) {
        stopCamera();
    }
});

window.addEventListener('beforeunload', stopCamera);

// Night Vision Mode Toggle Handlers (AUTO / ON / OFF)
const nvModeBtns = document.querySelectorAll('.nv-mode-btn');
nvModeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        nvModeBtns.forEach(b => {
            b.classList.remove('active');
            b.style.background = 'transparent';
            b.style.color = '#fff';
            b.setAttribute('aria-checked', 'false');
        });
        btn.classList.add('active');
        btn.style.background = '#00E676';
        btn.style.color = '#000';
        btn.setAttribute('aria-checked', 'true');
        const chosenMode = btn.dataset.mode;
        if (nightVision) {
            nightVision.setMode(chosenMode);
        }
    });
});

// Initialize Vision Engine on Load
window.addEventListener('DOMContentLoaded', initVisionEngine);
