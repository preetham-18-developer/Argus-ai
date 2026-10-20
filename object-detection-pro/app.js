/**
 * Object Detection Pro - AI Neural Engine
 * Powered by TensorFlow.js & COCO-SSD
 */

// DOM Elements
const video = document.getElementById('webcam');
const canvas = document.getElementById('overlay');
const ctx = canvas.getContext('2d');
const modelStatus = document.getElementById('model-status');
const loadingScreen = document.getElementById('loading-screen');
const objectList = document.getElementById('object-list');
const voiceToggle = document.getElementById('voice-toggle');
const threshRange = document.getElementById('threshold-range');
const threshVal = document.getElementById('threshold-val');

// Global Vars
let model = null;
let lastSpokenObjects = new Set();
let speechCooldown = 0;
let minConfidence = 0.6;
let currentStream = null;
let isPageVisible = true;
let isCameraRunning = false;
let isInitializing = false;

// Color mapping for classes
const classColors = {
    'person': '#FF00FF',    // Pink
    'car': '#00FF00',       // Green
    'dog': '#00FFFF',       // Cyan
    'cat': '#00FFFF',
    'traffic light': '#FFFF00', // Yellow
    'stop sign': '#0000FF',  // Blue
    'street sign': '#0000FF',
    'sign': '#0000FF',
    'bottle': '#FFA500',
    'backpack': '#800080',
    'laptop': '#C0C0C0',
    'bus': '#00FF00',
    'truck': '#00FF00',
    'bicycle': '#00FF00',
    'motorcycle': '#00FF00',
    'chair': '#FFA500',     // Orange
    'default': '#00E676'    // Greenish
};

function getColor(className) {
    return classColors[className] || classColors['default'];
}

// TTS Setup
const synth = window.speechSynthesis;

// 1. Initialize System
async function init() {
    try {
        console.log("Loading AI Model...");
        modelStatus.innerText = "LOADING COCO-SSD...";

        model = await cocoSsd.load({
            base: 'lite_mobilenet_v2'
        });

        console.log("Model Loaded.");
        modelStatus.innerText = "MODEL READY";
        modelStatus.style.color = "#00E676";

        // Setup Camera with longer delay to avoid hardware contention
        let retryCount = 0;
        const maxRetries = 3;
        
        async function tryCamera() {
            try {
                // 2 second delay is safer for browser hardware release
                await new Promise(r => setTimeout(r, 2000));
                const success = await setupCamera();
                if (!success && retryCount < maxRetries) {
                    retryCount++;
                    console.warn(`Camera failed, retrying (${retryCount}/${maxRetries})...`);
                    modelStatus.innerText = `RETRYING CAMERA (${retryCount})...`;
                    return await tryCamera();
                }
                return success;
            } catch (err) {
                if (retryCount < maxRetries) {
                    retryCount++;
                    return await tryCamera();
                }
                throw err;
            }
        }

        const isCamOk = await tryCamera();
        
        loadingScreen.classList.add('hide');
        if (isCamOk) {
            detectFrame();
        } else {
            modelStatus.innerText = "CAMERA OFF";
        }

    } catch (err) {
        console.error("Initialization failed:", err);
        modelStatus.innerText = "CAMERA BUSY";
        modelStatus.style.color = "#ff3c3c";
        
        // Remove the alert as requested, use a UI message instead
        const errorMsg = document.createElement('div');
        errorMsg.style = "position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); background:rgba(0,0,0,0.9); padding:20px; border-radius:10px; color:white; z-index:10000; text-align:center; border:2px solid #ff3c3c;";
        errorMsg.innerHTML = `<h3>Camera Access Error</h3><p>Could not start video. Please ensure no other apps are using the camera and refresh.</p><button onclick="location.reload()" style="background:#00E676; border:none; padding:10px 20px; border-radius:5px; cursor:pointer;">Retry Now</button>`;
        document.body.appendChild(errorMsg);
    }
}

/// 2. Camera Setup (Standardized Robust Pattern)
async function setupCamera() {
    if (isInitializing) return;
    isInitializing = true;
    
    try {
        if (isCameraRunning && currentStream) {
            console.log("Camera already running");
            isInitializing = false;
            return;
        }

        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: "environment" // Optimized for vision aid
            },
            audio: false
        };

        const fallback = { video: true, audio: false };

        try {
            currentStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            console.warn("High quality failed, using fallback...");
            currentStream = await navigator.mediaDevices.getUserMedia(fallback);
        }

        video.srcObject = currentStream;
        await video.play();
        isCameraRunning = true;

        console.log("Camera started");
        monitorStream(currentStream);

        isInitializing = false;
        return true; // Success

    } catch (err) {
        isInitializing = false;
        handleCameraError(err);
        return false; // Failed
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
        if (isPageVisible) setupCamera();
    }, 1000);
}

function handleCameraError(err) {
    console.error("Camera error:", err);
    let msg = "Camera Access Error";
    if (err.name === 'NotAllowedError') msg = "Permission Denied. Please allow camera.";
    else if (err.name === 'NotFoundError') msg = "No camera found.";
    
    // Security alert removed as requested.
    
    modelStatus.innerText = "CAMERA BUSY";
    modelStatus.style.color = "#FF3D00";
}

function stopCamera() {
    if (!currentStream) return;
    currentStream.getTracks().forEach(track => {
        track.onended = null;
        track.onmute = null;
        track.oninactive = null;
        track.stop();
    });
    video.pause();
    video.srcObject = null;
    currentStream = null;
    isCameraRunning = false;
    console.log("Camera stopped");
}
let frameCount = 0;
// 3. Detection Loop
async function detectFrame() {
    if (!model || !isPageVisible) {
        requestAnimationFrame(detectFrame);
        return;
    }

    // Step 5: Frame Skipping Optimization (Step 5)
    frameCount++;
    if (frameCount % 10 !== 0) {
        requestAnimationFrame(detectFrame);
        return;
    }

    try {
        if (video.readyState >= 2) { // HAVE_CURRENT_DATA
            if (video.videoWidth > 0 && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
            }

            const predictions = await model.detect(video);

            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Process results
            const currentObjects = new Set();

            predictions.forEach(prediction => {
                const score = prediction.score;
                if (score < minConfidence) return;

                const className = prediction.class;
                currentObjects.add(className);
                const boxColor = getColor(className);

                // Draw Box
                const [x, y, width, height] = prediction.bbox;

                // Simple Clean Box Style from Image
                ctx.strokeStyle = boxColor;
                ctx.lineWidth = 3;
                ctx.strokeRect(x, y, width, height);

                // Label Background (on top of the box)
                ctx.fillStyle = boxColor;
                const text = className; // Just the name, similar to image
                ctx.font = 'bold 16px Roboto, Arial';
                const textWidth = ctx.measureText(text).width;
                
                // Position label above the box
                const labelHeight = 25;
                const labelY = y - labelHeight > 0 ? y - labelHeight : y;
                ctx.fillRect(x, labelY, textWidth + 15, labelHeight);

                // Label Text
                ctx.fillStyle = '#000000';
                ctx.fillText(text, x + 7, labelY + 18);
            });

            updateObjectUI(currentObjects);
            handleVoiceFeedback(currentObjects);
        }
    } catch (err) {
        console.warn("Detection skipped this frame:", err);
    }

    requestAnimationFrame(detectFrame);
}

// 4. UI Update
function updateObjectUI(objects) {
    if (objects.size === 0) {
        objectList.innerHTML = '<span class="object-tag" style="background:transparent; border-style:dashed;">Scanning...</span>';
        return;
    }

    objectList.innerHTML = '';
    objects.forEach(obj => {
        const span = document.createElement('span');
        span.className = 'object-tag';
        span.innerText = obj.toUpperCase();
        objectList.appendChild(span);
    });
}

// 5. Voice Feedback
function handleVoiceFeedback(objects) {
    if (!voiceToggle.checked) return;

    // Check if anything NEW appeared
    const newItems = [...objects].filter(x => !lastSpokenObjects.has(x));
    const now = Date.now();

    if (newItems.length > 0 && now > speechCooldown) {
        const text = "I see " + newItems.join(", ");
        speak(text);
        lastSpokenObjects = new Set(objects);
        speechCooldown = now + 4000; // 4 second gap between announcements
    } else if (objects.size === 0) {
        lastSpokenObjects = new Set();
    }
}

function speak(text) {
    if (synth.speaking) synth.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.0;
    utter.pitch = 1.0;
    synth.speak(utter);
}

// Event Listeners
threshRange.addEventListener('input', (e) => {
    minConfidence = e.target.value / 100;
    threshVal.innerText = e.target.value + "%";
});

// 6. Resource Management
function stopCamera() {
    if (currentStream) {
        console.log("Shutting down camera tracks...");
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
        console.log("Tab hidden, releasing camera...");
        isPageVisible = false;
        stopCamera();
    } else {
        console.log("Tab visible, checking camera recovery...");
        isPageVisible = true;
        // Don't auto-restart instantly, use a delay to avoid contention
        setTimeout(() => {
            if (isPageVisible && !isCameraRunning) {
                setupCamera();
            }
        }, 2000);
    }
});

window.addEventListener('beforeunload', stopCamera);

// Start
window.onload = init;
