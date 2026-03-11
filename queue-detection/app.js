/*************************************************************************
 *  AI Queue Detection – Continuous Mode + Dynamic Shoulder Colors
 *************************************************************************/

// DOM Elements
const video = document.getElementById('webcam');
const canvas = document.getElementById('output');
const ctx = canvas.getContext('2d');
const statusText = document.getElementById('status-text');
const debugText = document.getElementById('debug-info');

// MoveNet Config
const DETECTOR_CONFIG = {
    modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING
};

// Real-world constants
const SHOULDER_WIDTH_M = 0.45; // 45 cm
let focalLength = 550;

// Continuous commands
const CMD_STOP = "Stop stop stop!";
const CMD_STAY = "Stay stay stay!";
const CMD_MOVE = "Move move move!";
const CMD_NOP = "No person detected.";

let currentCommand = "";
let isRunning = false;
let detector = null;

let distanceHistory = [];
const HISTORY_SIZE = 10;

// Continuous Speaking Loop (every 1 sec)
setInterval(() => {
    if (!isRunning || !currentCommand) return;

    const utter = new SpeechSynthesisUtterance(currentCommand);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
}, 1000);

// Vibrate helper
function vibrate(pattern) {
    if (navigator.vibrate) navigator.vibrate(pattern);
}

// INIT SYSTEM
async function init() {
    try {
        statusText.innerText = "Starting camera…";

        await setupCamera();
        focalLength = 0.9 * video.videoWidth;

        statusText.innerText = "Loading AI model…";

        detector = await poseDetection.createDetector(
            poseDetection.SupportedModels.MoveNet,
            DETECTOR_CONFIG
        );

        console.log("✓ MoveNet Loaded");
        statusText.innerText = "System Ready";

        isRunning = true;
        currentCommand = "System online.";

        detectPose();
    } catch (e) {
        console.error(e);
        statusText.innerText = "Camera error";
    }
}

let currentStream = null;

// CAMERA SETUP (Robust Production Pattern)
async function setupCamera() {
    // Prevent duplicate requests
    if (currentStream && currentStream.active) return;

    try {
        stopCamera();
        
        const constraints = {
            video: { width: 640, height: 480, facingMode: "environment" },
            audio: false
        };
        const fallback = { video: true, audio: false };

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            console.warn("Quality constraints failed, using fallback...");
            stream = await navigator.mediaDevices.getUserMedia(fallback);
        }

        currentStream = stream;
        video.srcObject = stream;
        
        // Monitor tracks for health
        stream.getVideoTracks().forEach(track => {
            track.onended = () => handleStreamInterruption("Track Ended");
            track.onmute = () => handleStreamInterruption("Track Muted");
            track.oninactive = () => handleStreamInterruption("Track Inactive");
        });

        await video.play();
        console.log("Queue Assistant Camera Ready");

        return new Promise(resolve => {
            video.onloadedmetadata = () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                resolve();
            };
            if (video.videoWidth > 0) resolve();
        });

    } catch (err) {
        handleCameraError(err);
        throw err;
    }
}

function handleStreamInterruption(reason) {
    if (!isRunning) return; // Ignore if user intentionally stopped
    console.warn(`Camera stream interrupted: ${reason}. Restarting...`);
    
    setTimeout(() => {
        if (isRunning) setupCamera().catch(e => console.error("Recovery failed", e));
    }, 1500);
}

function handleCameraError(err) {
    console.error("Camera Error:", err);
    let msg = "Camera Error";
    if (err.name === 'NotAllowedError') msg = "Permission Denied.";
    else if (err.name === 'NotFoundError') msg = "No camera found.";
    
    statusText.innerText = msg;
    statusText.style.color = "red";
}

function stopCamera() {
    if (currentStream) {
        console.log("Shutting down Queue Assistant tracks...");
        currentStream.getTracks().forEach(track => {
            track.onended = null;
            track.onmute = null;
            track.oninactive = null;
            track.stop();
        });
        currentStream = null;
    }
    video.pause();
    video.srcObject = null;
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        isRunning = false;
        stopCamera();
    } else {
        init(); // Re-initialize
    }
});

let frameCount = 0;
// MAIN LOOP
async function detectPose() {
    if (!isRunning) return;

    // Step 5: Frame Skipping Optimization
    frameCount++;
    if (frameCount % 10 !== 0) {
        requestAnimationFrame(detectPose);
        return;
    }

    const poses = await detector.estimatePoses(video);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let hasPerson = false;

    if (poses && poses[0] && isValidPerson(poses[0])) {
        hasPerson = true;
        processPose(poses[0]);
    }

    if (!hasPerson) {
        currentCommand = CMD_NOP;
    }

    requestAnimationFrame(detectPose);
}

// PERSON VALIDATION
function isValidPerson(pose) {
    const kp = pose.keypoints;
    const ls = kp.find(k => k.name === "left_shoulder");
    const rs = kp.find(k => k.name === "right_shoulder");
    const nose = kp.find(k => k.name === "nose");

    return (
        ls && rs && nose &&
        ls.score >= 0.45 &&
        rs.score >= 0.45 &&
        nose.score >= 0.3
    );
}

// COMPUTE DISTANCE
function processPose(pose) {
    const kp = pose.keypoints;

    const ls = kp.find(k => k.name === "left_shoulder");
    const rs = kp.find(k => k.name === "right_shoulder");

    const dx = ls.x - rs.x;
    const dy = ls.y - rs.y;

    const shoulderPx = Math.sqrt(dx * dx + dy * dy);

    if (shoulderPx < 10) return;

    const dist = (SHOULDER_WIDTH_M * focalLength) / shoulderPx;

    updateLogic(dist, ls, rs);
}

// LOGIC + SHOULDER DRAWING
function updateLogic(dist, ls, rs) {
    distanceHistory.push(dist);
    if (distanceHistory.length > HISTORY_SIZE) distanceHistory.shift();

    const avg = distanceHistory.reduce((a, b) => a + b) / distanceHistory.length;

    debugText.innerText = `Distance: ${avg.toFixed(2)} m`;

    // Choose color based on distance
    let lineColor = "green";  // default
    if (avg < 0.25) lineColor = "red";
    else if (avg < 0.7) lineColor = "yellow";

    drawShoulderLine(ls, rs, lineColor);

    // < 0.25 → STOP
    if (avg < 0.25) {
        currentCommand = CMD_STOP;
        vibrate([300, 150, 300]);
        return;
    }

    // < 0.7 → STAY
    if (avg < 0.7) {
        currentCommand = CMD_STAY;
        vibrate([120, 120, 120]);
        return;
    }

    // > 0.7 → MOVE
    currentCommand = CMD_MOVE;
    vibrate([80]);
}

// DRAW SHOULDERS ONLY (GREEN LINE + RED POINTS)
function drawShoulderLine(ls, rs, color) {
    // Shoulder line
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;

    ctx.beginPath();
    ctx.moveTo(ls.x, ls.y);
    ctx.lineTo(rs.x, rs.y);
    ctx.stroke();

    // Points red
    ctx.fillStyle = "red";
    ctx.beginPath();
    ctx.arc(ls.x, ls.y, 8, 0, Math.PI * 2);
    ctx.arc(rs.x, rs.y, 8, 0, Math.PI * 2);
    ctx.fill();
}

// START SYSTEM
window.onload = init;