/*************************************************************************
 * Argus AI Queue Assistant - Multi-Person Tracking & Personal Distance Guidance
 * Powered by TensorFlow.js (COCO-SSD / MoveNet) & Multi-Object IoU Tracker
 * 100% Live Computer Vision Stream — Zero Fabricated Wait Times or Metres
 *
 * Distinct Subsystems:
 * 1. Queue Analysis: IN QUEUE, TOTAL VISIBLE, QUEUE FLOW (CLEAR, HOLDING, ADVANCING)
 * 2. Personal Distance Guidance: Target Person Tracking with Hysteresis
 *    (TOO CLOSE -> Step Back | OPTIMAL -> Hold Position | TOO FAR -> Step Forward)
 *************************************************************************/

// DOM Elements
const video = document.getElementById('webcam');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const statusText = document.getElementById('status-text');
const debugText = document.getElementById('debug-info');
const startBtn = document.getElementById('start-btn');
const startScreen = document.getElementById('start-screen');
const queueCountVal = document.getElementById('queue-count-val');
const totalCountVal = document.getElementById('total-count-val');
const flowStatusVal = document.getElementById('flow-status-val');
const distancePill = document.getElementById('distance-pill');
const distanceStatusVal = document.getElementById('distance-status-val');
const guidanceBanner = document.getElementById('guidance-banner');
const guidanceActionIcon = document.getElementById('guidance-action-icon');
const guidanceActionText = document.getElementById('guidance-action-text');
const roiToggleBtn = document.getElementById('roi-toggle-btn');
const voiceToggle = document.getElementById('voice-toggle');
const serviceNotice = document.getElementById('service-notice');

// System & Model State
let detector = null;
let detectorType = 'COCO-SSD'; // 'COCO-SSD' or 'MoveNet'
let isRunning = false;
let isDetecting = false;
let currentStream = null;
let animationFrameId = null;

// Multi-Person Tracker State
let activeTracks = [];
let nextTrackId = 1;
const MATCH_THRESHOLD = 0.28;
const MAX_MISSES = 6; // Retain track across brief occlusions (~400ms)
const MIN_HITS = 2;   // Require 2 consecutive detections to confirm person

// Queue Analysis & ROI Configuration
let roiMode = 'center'; // 'center' or 'full'
let currentQueueFlowState = "CLEAR"; // "CLEAR", "HOLDING", "ADVANCING"
let frontPersonHistory = []; // stores recent Y positions of front-most person

// Personal-Distance Guidance State Machine with Hysteresis
let currentDistanceState = "CLEAR"; // "CLEAR", "TOO_CLOSE", "OPTIMAL", "TOO_FAR"
let smoothedProximity = 0.50; // Exponentially smoothed apparent proximity index
const PROXIMITY_ALPHA = 0.40;  // Smoothing factor (0.40 new + 0.60 prev)

// Hysteresis Thresholds (Schmitt-Trigger)
const THRESHOLDS = {
    CLOSE_ENTRY: 0.64, // Enter TOO_CLOSE when proximity exceeds 64%
    CLOSE_EXIT:  0.57, // Must drop below 57% to return to OPTIMAL
    FAR_ENTRY:   0.33, // Enter TOO_FAR when proximity drops below 33%
    FAR_EXIT:    0.38  // Must rise above 38% to return to OPTIMAL
};

// Speech Dispatcher & Cooldowns
let lastSpokenGuidanceState = "";
let lastSpokenQueueCount = -1;
let lastSpokenTime = 0;
const SPEECH_COOLDOWN_MS = 4000;

// Telemetry FPS
let frameCount = 0;
let lastFpsTime = performance.now();
let currentFps = 0;
let lastUpdateTime = "Just now";

// Text-to-Speech Engine
const synth = window.speechSynthesis;

function speak(text, priority = false) {
    if (!synth || !voiceToggle || !voiceToggle.checked) return;
    const now = Date.now();

    if (!priority && (now - lastSpokenTime < SPEECH_COOLDOWN_MS)) {
        return;
    }

    const cleanText = text.replace(/[*#_~`]/g, '');
    const doSpeak = () => {
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.rate = 1.05;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        utterance.onend = () => {
            lastSpokenTime = Date.now();
            window._queueUtterance = null;
        };
        utterance.onerror = () => {
            lastSpokenTime = Date.now();
            window._queueUtterance = null;
        };
        window._queueUtterance = utterance;

        try {
            if (synth.paused) synth.resume();
        } catch (e) {}

        synth.speak(utterance);
        lastSpokenTime = now;
    };

    if (synth.speaking) {
        if (priority) {
            synth.cancel();
            setTimeout(doSpeak, 50);
        }
        return;
    }

    doSpeak();
}

// 1. System Initialization
async function initSystem() {
    try {
        if (startScreen) startScreen.style.display = "none";
        statusText.innerText = "Requesting live camera feed...";
        statusText.style.color = "#00F2FE";

        // Unlock audio context on mobile
        if (synth) {
            const unlockUtter = new SpeechSynthesisUtterance("");
            synth.speak(unlockUtter);
        }

        const camOk = await setupCamera();
        if (!camOk) return;

        statusText.innerText = "Loading AI Multi-Person Detector...";

        // Initialize Primary Detector: COCO-SSD (Multi-Person Bounding Boxes)
        if (typeof cocoSsd !== 'undefined') {
            detector = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
            detectorType = 'COCO-SSD';
            console.log("✓ COCO-SSD Multi-Person Model Loaded");
        } else if (typeof poseDetection !== 'undefined') {
            // Fallback to MoveNet MultiPose or SinglePose
            const modelType = (poseDetection.movenet && poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING)
                ? poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING
                : 'SinglePose.Lightning';
            detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, { modelType });
            detectorType = 'MoveNet';
            console.log("✓ MoveNet Pose Model Loaded as Fallback");
        } else {
            throw new Error("No computer vision detection library available.");
        }

        isRunning = true;
        statusText.innerText = "Queue Assistant Online";
        statusText.style.color = "#00E676";
        speak("Queue assistant online. Monitoring personal distance and queue line.", true);

        // Start Inference & Render Loop
        requestAnimationFrame(processQueueLoop);

    } catch (err) {
        console.error("Queue assistant initialization failed:", err);
        statusText.innerText = `Initialization Error: ${err.message || 'Check camera access'}`;
        statusText.style.color = "#FF1744";
        debugText.innerText = "Please grant camera permission and refresh.";
    }
}

// 2. Camera Setup with Resolution Fallbacks
async function setupCamera() {
    try {
        if (currentStream && currentStream.active) return true;

        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: "environment"
            },
            audio: false
        };

        const fallback = { video: true, audio: false };

        try {
            currentStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            console.warn("High-res camera unavailable, using fallback:", e);
            currentStream = await navigator.mediaDevices.getUserMedia(fallback);
        }

        video.srcObject = currentStream;

        await new Promise((resolve) => {
            if (video.videoWidth > 0 && video.videoHeight > 0) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                return resolve();
            }
            video.onloadedmetadata = () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                resolve();
            };
            setTimeout(() => {
                canvas.width = video.videoWidth || 640;
                canvas.height = video.videoHeight || 480;
                resolve();
            }, 800);
        });

        await video.play();
        return true;

    } catch (err) {
        console.error("Camera setup error:", err);
        statusText.innerText = "Camera Access Denied or Unavailable";
        statusText.style.color = "#FF1744";
        debugText.innerText = "Please allow camera access in browser permissions.";
        return false;
    }
}

function stopCamera() {
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
        currentStream = null;
    }
    if (video) {
        video.pause();
        video.srcObject = null;
    }
    isRunning = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

// 3. Continuous Video & Multi-Person Inference Loop
async function processQueueLoop() {
    if (!isRunning) return;

    // Sync canvas dimensions
    if (video.videoWidth > 0 && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
    }

    // Telemetry FPS Calculation
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
        currentFps = Math.round((frameCount * 1000) / (now - lastFpsTime));
        frameCount = 0;
        lastFpsTime = now;
        const d = new Date();
        lastUpdateTime = d.toTimeString().split(' ')[0];
    }

    // Run inference every 3 frames (~18-20 FPS)
    if (detector && video.readyState >= 2 && !isDetecting && frameCount % 3 === 0) {
        runDetectionAndTracking();
    }

    // Draw overlays: Queue Region of Interest, bounding boxes, target distance reticle
    drawQueueScene();

    animationFrameId = requestAnimationFrame(processQueueLoop);
}

// 4. Multi-Person Detection & Tracker Update
async function runDetectionAndTracking() {
    isDetecting = true;
    try {
        let rawDetections = [];
        const frameW = canvas.width || 640;
        const frameH = canvas.height || 480;

        if (detectorType === 'COCO-SSD') {
            const predictions = await detector.detect(video);
            // Filter strictly for people with >= 40% confidence and exclude self-detection artifacts
            rawDetections = (predictions || [])
                .filter(p => p.class === 'person' && p.score >= 0.40 && !isSelfDetection(p.bbox, frameW, frameH))
                .map(p => ({
                    bbox: p.bbox,
                    score: p.score
                }));
        } else if (detectorType === 'MoveNet') {
            const poses = await detector.estimatePoses(video);
            rawDetections = (poses || [])
                .filter(p => p.keypoints && p.keypoints.length > 0)
                .map(pose => {
                    const xs = pose.keypoints.map(k => k.x);
                    const ys = pose.keypoints.map(k => k.y);
                    const minX = Math.min(...xs);
                    const maxX = Math.max(...xs);
                    const minY = Math.min(...ys);
                    const maxY = Math.max(...ys);
                    return {
                        bbox: [minX, minY, Math.max(20, maxX - minX), Math.max(20, maxY - minY)],
                        score: pose.score || 0.5
                    };
                })
                .filter(d => !isSelfDetection(d.bbox, frameW, frameH));
        }

        // Update Multi-Person IoU & Centroid Tracker
        updateMultiPersonTracker(rawDetections);

        // Analyze Queue Region and Flow
        evaluateQueueAndDistance();

    } catch (err) {
        console.warn("Queue detection frame skip:", err);
    } finally {
        isDetecting = false;
    }
}

// Guard against user's own body / hands at bottom edge of camera
function isSelfDetection(bbox, frameW, frameH) {
    const [x, y, w, h] = bbox;
    // Bottom sliver occupying bottom 25% of frame with wide width
    return (y > frameH * 0.72 && h < frameH * 0.28 && w > frameW * 0.65);
}

// 5. Multi-Object Tracker (IoU + Centroid Composite Metric)
function updateMultiPersonTracker(rawDetections) {
    const diag = Math.sqrt(canvas.width * canvas.width + canvas.height * canvas.height) || 1;
    const matchedTrackIndices = new Set();
    const matchedDetectionIndices = new Set();

    // Step A: Associate incoming detections with existing tracks
    for (let dIdx = 0; dIdx < rawDetections.length; dIdx++) {
        const det = rawDetections[dIdx];
        const [dx, dy, dw, dh] = det.bbox;
        const detCx = dx + dw / 2;
        const detCy = dy + dh * 0.90; // Feet / Ground plane contact point

        let bestSimilarity = 0;
        let bestTrackIdx = -1;

        for (let tIdx = 0; tIdx < activeTracks.length; tIdx++) {
            if (matchedTrackIndices.has(tIdx)) continue;

            const track = activeTracks[tIdx];
            const [tx, ty, tw, th] = track.bbox;
            const trackCx = tx + tw / 2;
            const trackCy = ty + th * 0.90;

            // 1. Compute IoU
            const iou = computeIoU(det.bbox, track.bbox);

            // 2. Compute Centroid Proximity
            const cDist = Math.sqrt((detCx - trackCx) ** 2 + (detCy - trackCy) ** 2);
            const prox = Math.max(0, 1 - cDist / (diag * 0.4));

            // Composite similarity metric
            const similarity = 0.65 * iou + 0.35 * prox;

            if (similarity > bestSimilarity) {
                bestSimilarity = similarity;
                bestTrackIdx = tIdx;
            }
        }

        if (bestSimilarity >= MATCH_THRESHOLD && bestTrackIdx !== -1) {
            // Matched: Smooth bounding box with Exponential Moving Average (EMA)
            const track = activeTracks[bestTrackIdx];
            const alpha = 0.65;

            track.bbox = [
                alpha * det.bbox[0] + (1 - alpha) * track.bbox[0],
                alpha * det.bbox[1] + (1 - alpha) * track.bbox[1],
                alpha * det.bbox[2] + (1 - alpha) * track.bbox[2],
                alpha * det.bbox[3] + (1 - alpha) * track.bbox[3]
            ];
            track.centroid = [
                track.bbox[0] + track.bbox[2] / 2,
                track.bbox[1] + track.bbox[3] * 0.90
            ];
            track.score = alpha * det.score + (1 - alpha) * track.score;
            track.hits++;
            track.misses = 0;

            matchedTrackIndices.add(bestTrackIdx);
            matchedDetectionIndices.add(dIdx);
        }
    }

    // Step B: Spawn new tracks for unmatched detections
    for (let dIdx = 0; dIdx < rawDetections.length; dIdx++) {
        if (matchedDetectionIndices.has(dIdx)) continue;
        const det = rawDetections[dIdx];

        activeTracks.push({
            id: nextTrackId++,
            bbox: [...det.bbox],
            centroid: [det.bbox[0] + det.bbox[2] / 2, det.bbox[1] + det.bbox[3] * 0.90],
            score: det.score,
            hits: 1,
            misses: 0,
            inQueue: false,
            groundY: det.bbox[1] + det.bbox[3],
            isTarget: false
        });
    }

    // Step C: Age unmatched tracks and purge dead ones
    for (let tIdx = 0; tIdx < activeTracks.length; tIdx++) {
        if (!matchedTrackIndices.has(tIdx)) {
            activeTracks[tIdx].misses++;
        }
    }

    activeTracks = activeTracks.filter(track => track.misses <= MAX_MISSES);
}

// 6. Intersection over Union (IoU) Helper
function computeIoU(boxA, boxB) {
    const [ax, ay, aw, ah] = boxA;
    const [bx, by, bw, bh] = boxB;

    const xLeft = Math.max(ax, bx);
    const yTop = Math.max(ay, by);
    const xRight = Math.min(ax + aw, bx + bw);
    const yBottom = Math.min(ay + ah, by + bh);

    if (xRight <= xLeft || yBottom <= yTop) return 0.0;

    const intersection = (xRight - xLeft) * (yBottom - yTop);
    const areaA = aw * ah;
    const areaB = bw * bh;
    const union = areaA + areaB - intersection;

    return union > 0 ? (intersection / union) : 0.0;
}

// 7. Get Configured Queue Region of Interest (ROI)
function getQueueROI() {
    const w = canvas.width || 640;
    const h = canvas.height || 480;

    if (roiMode === 'full') {
        return { x: 0, y: Math.floor(h * 0.10), width: w, height: Math.floor(h * 0.88) };
    }

    // Default 'center': Central walking corridor where queues form
    return {
        x: Math.floor(w * 0.22),
        y: Math.floor(h * 0.15),
        width: Math.floor(w * 0.56),
        height: Math.floor(h * 0.82)
    };
}

// 8. Dual Evaluation: Queue Flow Metrics & Personal Distance Guidance
function evaluateQueueAndDistance() {
    const roi = getQueueROI();
    const frameH = canvas.height || 480;

    // Filter confirmed tracks (hits >= 2)
    const confirmedTracks = activeTracks.filter(t => t.hits >= MIN_HITS && t.misses === 0);

    // Identify people inside vs outside queue region
    const peopleInQueue = [];
    const peopleOutsideQueue = [];

    confirmedTracks.forEach(t => {
        const [cx, cy] = t.centroid;
        const inside = (
            cx >= roi.x &&
            cx <= roi.x + roi.width &&
            cy >= roi.y &&
            cy <= roi.y + roi.height
        );
        t.inQueue = inside;
        t.groundY = t.bbox[1] + t.bbox[3];
        t.isTarget = false;

        if (inside) {
            peopleInQueue.push(t);
        } else {
            peopleOutsideQueue.push(t);
        }
    });

    // Sort people in queue by groundY descending (highest Y is closest to camera / front of queue)
    peopleInQueue.sort((a, b) => b.groundY - a.groundY);

    const totalVisible = confirmedTracks.length;
    const queueCount = peopleInQueue.length;

    // Update Queue Count Badges
    if (queueCountVal) queueCountVal.innerText = queueCount;
    if (totalCountVal) totalCountVal.innerText = totalVisible;

    // ─────────────────────────────────────────────────────────────────────────
    // Subsystem 1: Queue Flow Dynamics (Whole Queue Movement: Clear / Holding / Advancing)
    // ─────────────────────────────────────────────────────────────────────────
    const now = performance.now();
    let flowState = "CLEAR";
    let statusMessage = "";
    let statusColor = "#00E676";

    if (queueCount === 0) {
        flowState = "CLEAR";
        currentQueueFlowState = "CLEAR";
        frontPersonHistory = [];
        if (totalVisible === 0) {
            statusMessage = "Queue corridor clear. No people detected.";
        } else {
            statusMessage = `Queue corridor clear (${totalVisible} person outside corridor).`;
        }
        statusColor = "#00E676";
    } else {
        const frontPerson = peopleInQueue[0];
        frontPerson.isTarget = true; // Mark as the person ahead for distance guidance
        frontPersonHistory.push({ time: now, y: frontPerson.groundY });
        frontPersonHistory = frontPersonHistory.filter(h => now - h.time <= 2500);

        if (frontPersonHistory.length >= 4) {
            const oldest = frontPersonHistory[0];
            const newest = frontPersonHistory[frontPersonHistory.length - 1];
            const deltaY = oldest.y - newest.y;

            if (deltaY > 35) {
                flowState = "ADVANCING";
                currentQueueFlowState = "ADVANCING";
                statusMessage = `${queueCount} in queue line. Queue advancing forward.`;
                statusColor = "#00E5FF";
            } else {
                flowState = "HOLDING";
                currentQueueFlowState = "HOLDING";
                statusMessage = `${queueCount} in queue line. Queue line holding.`;
                statusColor = queueCount >= 3 ? "#FFD600" : "#00E676";
            }
        } else {
            flowState = "HOLDING";
            currentQueueFlowState = "HOLDING";
            statusMessage = `${queueCount} in queue line. Queue line holding.`;
            statusColor = "#00E676";
        }
    }

    if (flowStatusVal) flowStatusVal.innerText = flowState;
    if (statusText) {
        statusText.innerText = statusMessage;
        statusText.style.color = statusColor;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Subsystem 2: Personal Distance Guidance (Relative Optical Proximity with Hysteresis)
    // ─────────────────────────────────────────────────────────────────────────
    let distanceState = "CLEAR";
    let targetPersonId = "None";
    let proximityPct = 0;

    if (queueCount > 0) {
        const targetPerson = peopleInQueue[0];
        targetPersonId = `#${targetPerson.id}`;
        const [tx, ty, tw, th] = targetPerson.bbox;

        // Normalized apparent size & ground plane proximity index (0.0 to 1.0)
        const normH = Math.min(1.0, th / frameH);
        const normGround = Math.min(1.0, (ty + th) / frameH);
        const rawProximity = 0.65 * normH + 0.35 * normGround;

        // Smooth proximity temporally with EMA to reject camera jitter
        smoothedProximity = PROXIMITY_ALPHA * rawProximity + (1 - PROXIMITY_ALPHA) * smoothedProximity;
        proximityPct = Math.round(smoothedProximity * 100);

        // Apply Schmitt-Trigger Hysteresis State Machine
        if (currentDistanceState === "OPTIMAL") {
            if (smoothedProximity >= THRESHOLDS.CLOSE_ENTRY) {
                distanceState = "TOO_CLOSE";
            } else if (smoothedProximity <= THRESHOLDS.FAR_ENTRY) {
                distanceState = "TOO_FAR";
            } else {
                distanceState = "OPTIMAL";
            }
        } else if (currentDistanceState === "TOO_CLOSE") {
            // Must drop below CLOSE_EXIT to recover to OPTIMAL
            if (smoothedProximity <= THRESHOLDS.CLOSE_EXIT) {
                distanceState = "OPTIMAL";
            } else {
                distanceState = "TOO_CLOSE";
            }
        } else if (currentDistanceState === "TOO_FAR") {
            // Must rise above FAR_EXIT to recover to OPTIMAL
            if (smoothedProximity >= THRESHOLDS.FAR_EXIT) {
                distanceState = "OPTIMAL";
            } else {
                distanceState = "TOO_FAR";
            }
        } else {
            // Transitioning from CLEAR
            if (smoothedProximity >= THRESHOLDS.CLOSE_ENTRY) {
                distanceState = "TOO_CLOSE";
            } else if (smoothedProximity <= THRESHOLDS.FAR_ENTRY) {
                distanceState = "TOO_FAR";
            } else {
                distanceState = "OPTIMAL";
            }
        }
    } else {
        distanceState = "CLEAR";
        smoothedProximity = 0.50; // Reset baseline
    }

    currentDistanceState = distanceState;

    // Update Distance Guidance UI Components
    updateDistanceUI(distanceState, proximityPct, targetPersonId);

    // Update Telemetry Bar
    if (debugText) {
        const idList = confirmedTracks.map(t => `#${t.id}`).join(', ') || 'None';
        const proxStr = distanceState !== "CLEAR" ? ` | Target: ${targetPersonId} (${proximityPct}%)` : "";
        debugText.innerText = `Tracked IDs: ${idList}${proxStr} | Rate: ${currentFps} FPS | Updated: ${lastUpdateTime}`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Subsystem 3: Assistive Spoken Guidance Dispatcher
    // Prioritizes Personal Distance Safety First, Queue Count Second
    // ─────────────────────────────────────────────────────────────────────────
    dispatchVoiceGuidance(distanceState, queueCount, flowState);
}

// Update Distance Guidance Banner & Pill
function updateDistanceUI(state, proximityPct, targetPersonId) {
    if (!guidanceBanner || !guidanceActionIcon || !guidanceActionText) return;

    guidanceBanner.classList.remove('state-close', 'state-optimal', 'state-far', 'state-clear');
    if (distancePill) {
        distancePill.classList.remove('state-close', 'state-optimal', 'state-far', 'state-clear');
    }

    if (state === "TOO_CLOSE") {
        guidanceBanner.classList.add('state-close');
        guidanceActionIcon.innerText = "⚠️";
        guidanceActionText.innerText = "TOO CLOSE — MOVE BACK SLIGHTLY";
        if (distanceStatusVal) distanceStatusVal.innerText = "TOO CLOSE";
        if (distancePill) distancePill.classList.add('state-close');

    } else if (state === "OPTIMAL") {
        guidanceBanner.classList.add('state-optimal');
        guidanceActionIcon.innerText = "🟢";
        guidanceActionText.innerText = "CORRECT DISTANCE — HOLD POSITION";
        if (distanceStatusVal) distanceStatusVal.innerText = "OPTIMAL";
        if (distancePill) distancePill.classList.add('state-optimal');

    } else if (state === "TOO_FAR") {
        guidanceBanner.classList.add('state-far');
        guidanceActionIcon.innerText = "🔷";
        guidanceActionText.innerText = "TOO FAR — MOVE FORWARD SLIGHTLY";
        if (distanceStatusVal) distanceStatusVal.innerText = "TOO FAR";
        if (distancePill) distancePill.classList.add('state-far');

    } else {
        guidanceBanner.classList.add('state-clear');
        guidanceActionIcon.innerText = "🎯";
        guidanceActionText.innerText = "PATH CLEAR — NO PERSON AHEAD";
        if (distanceStatusVal) distanceStatusVal.innerText = "CLEAR";
        if (distancePill) distancePill.classList.add('state-clear');
    }
}

// Spoken Guidance Logic with Event Throttling
function dispatchVoiceGuidance(distState, queueCount, flowState) {
    const distStateChanged = distState !== lastSpokenGuidanceState;
    const countChanged = queueCount !== lastSpokenQueueCount;

    if (!distStateChanged && !countChanged) return;

    if (distState === "TOO_CLOSE" && distStateChanged) {
        speak("Too close. Step back slightly.", true);
        lastSpokenGuidanceState = distState;
    } else if (distState === "TOO_FAR" && distStateChanged) {
        speak("Gap ahead. Move forward slightly.", true);
        lastSpokenGuidanceState = distState;
    } else if (distState === "OPTIMAL" && distStateChanged) {
        speak("Correct distance. Hold position.");
        lastSpokenGuidanceState = distState;
    } else if (distState === "CLEAR" && lastSpokenGuidanceState !== "CLEAR") {
        speak("Queue path is clear ahead.");
        lastSpokenGuidanceState = distState;
    } else if (countChanged && queueCount > 0) {
        const personWord = queueCount === 1 ? "person" : "people";
        speak(`${queueCount} ${personWord} in queue line ahead.`);
    }

    lastSpokenQueueCount = queueCount;
}

// 9. Render Live Visual HUD, Queue Corridor & Target Distance Reticle
function drawQueueScene() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const roi = getQueueROI();

    // 1. Draw Queue Region of Interest (Corridor)
    ctx.save();
    ctx.strokeStyle = "rgba(0, 242, 254, 0.55)";
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(roi.x, roi.y, roi.width, roi.height);

    // Corridor Label Badge
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(10, 15, 25, 0.75)";
    ctx.fillRect(roi.x + 8, roi.y + 8, 160, 24);
    ctx.font = "bold 11px 'Inter', Arial, sans-serif";
    ctx.fillStyle = "#00F2FE";
    ctx.fillText(`QUEUE CORRIDOR [${roiMode.toUpperCase()}]`, roi.x + 14, roi.y + 24);
    ctx.restore();

    // 2. Draw Tracked People
    const confirmedTracks = activeTracks.filter(t => t.hits >= MIN_HITS && t.misses === 0);
    if (confirmedTracks.length === 0) return;

    const inQueueTracks = confirmedTracks.filter(t => t.inQueue).sort((a, b) => b.groundY - a.groundY);

    confirmedTracks.forEach(track => {
        const [x, y, width, height] = track.bbox;
        const inQueue = track.inQueue;
        const isTargetAhead = track.isTarget;
        const queueRank = inQueueTracks.findIndex(t => t.id === track.id);

        let color = inQueue ? "#00E676" : "#94a3b8"; // Default: Green for queue, grey for bystander

        // Color override based on Personal Distance state for target person ahead
        if (isTargetAhead) {
            if (currentDistanceState === "TOO_CLOSE") color = "#FF1744"; // Red
            else if (currentDistanceState === "TOO_FAR") color = "#00E5FF"; // Cyan
            else color = "#00E676"; // Vibrant Green
        }

        // Draw Bounding Box
        ctx.strokeStyle = color;
        ctx.lineWidth = isTargetAhead ? 4 : (inQueue ? 2.5 : 1.5);
        ctx.strokeRect(x, y, width, height);

        // Ground Contact Centroid Ring
        const [cx, cy] = track.centroid;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, isTargetAhead ? 7 : 5, 0, Math.PI * 2);
        ctx.fill();

        // Target Distance Reticle for the person directly ahead
        if (isTargetAhead) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, cy, 22, 0, Math.PI * 2);
            ctx.stroke();

            // Guidance Tag above Target Person
            let distTag = "OPTIMAL DISTANCE";
            if (currentDistanceState === "TOO_CLOSE") distTag = "TOO CLOSE [STEP BACK]";
            else if (currentDistanceState === "TOO_FAR") distTag = "TOO FAR [STEP FORWARD]";

            const targetBadgeText = `🎯 TARGET AHEAD [${distTag}]`;
            ctx.font = "bold 12px 'Inter', Arial, sans-serif";
            const badgeW = ctx.measureText(targetBadgeText).width;
            const badgeY = Math.max(0, y - 48);

            ctx.fillStyle = "rgba(10, 15, 25, 0.90)";
            ctx.fillRect(x, badgeY, badgeW + 16, 22);
            ctx.strokeStyle = color;
            ctx.strokeRect(x, badgeY, badgeW + 16, 22);
            ctx.fillStyle = color;
            ctx.fillText(targetBadgeText, x + 8, badgeY + 15);
        }

        // Person ID & Rank Label
        let labelText = `PERSON #${track.id} (${Math.round(track.score * 100)}%)`;
        if (inQueue) {
            labelText = (queueRank === 0)
                ? `QUEUE #1 (FRONT) [#${track.id}]`
                : `QUEUE #${queueRank + 1} [#${track.id}]`;
        }

        ctx.font = "bold 12px 'Inter', Arial, sans-serif";
        const textWidth = ctx.measureText(labelText).width;
        const labelHeight = 22;
        const labelY = Math.max(0, y - labelHeight);

        ctx.fillStyle = "rgba(10, 15, 25, 0.85)";
        ctx.fillRect(x, labelY, textWidth + 12, labelHeight);

        ctx.fillStyle = color;
        ctx.fillText(labelText, x + 6, labelY + 15);
    });
}

// 10. User Controls & ROI Toggle
if (roiToggleBtn) {
    roiToggleBtn.addEventListener('click', () => {
        if (roiMode === 'center') {
            roiMode = 'full';
            roiToggleBtn.innerText = "Corridor: Full View";
            speak("Queue region set to full camera view.");
        } else {
            roiMode = 'center';
            roiToggleBtn.innerText = "Corridor: Center";
            speak("Queue region set to center corridor.");
        }
    });
}

// Start Button Handler
if (startBtn) {
    startBtn.addEventListener('click', initSystem);
}

// Page Lifecycle
document.addEventListener('visibilitychange', () => {
    if (document.hidden && isRunning) {
        stopCamera();
    }
});

window.addEventListener('beforeunload', stopCamera);