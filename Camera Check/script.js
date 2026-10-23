let voiceOverlay, voiceText, pulse, videoElem, canvasElem, ctx;
let initialized = true;
let synth = window.speechSynthesis;
let activeStream = null;
let lastState = null;

document.addEventListener('DOMContentLoaded', () => {
    voiceOverlay = document.getElementById('voice-overlay');
    voiceText = document.getElementById('voice-text');
    pulse = document.querySelector('.pulse');
    videoElem = document.getElementById('webcam');
    canvasElem = document.getElementById('proc-canvas');
    if (canvasElem) ctx = canvasElem.getContext('2d');

    initCamera();

    // Add Hub Navigation Button
    const backBtn = document.createElement('a');
    backBtn.href = "../index.html";
    backBtn.innerText = "← BACK TO ARGUS HUB";
    backBtn.style = `
        position:fixed;
        top:20px;
        left:20px;
        color:white;
        text-decoration:none;
        background:rgba(10, 15, 25, 0.85);
        backdrop-filter:blur(10px);
        padding:10px 18px;
        border-radius:30px;
        font-size:12px;
        font-weight:700;
        letter-spacing:1px;
        z-index:3000;
        border:1px solid rgba(0, 242, 254, 0.4);
        box-shadow: 0 4px 15px rgba(0,0,0,0.4);
        transition: all 0.3s ease;
    `;
    backBtn.onmouseover = () => { backBtn.style.background = 'rgba(0, 242, 254, 0.3)'; };
    backBtn.onmouseout = () => { backBtn.style.background = 'rgba(10, 15, 25, 0.85)'; };
    document.body.appendChild(backBtn);

    // Voice activation hint
    setTimeout(() => {
        if (initialized) {
            const hint = document.createElement('div');
            hint.id = 'voice-hint';
            hint.innerText = "TAP SCREEN TO ENABLE VOICE GUIDANCE";
            hint.style = `
                position:fixed;
                bottom:30px;
                left:50%;
                transform:translateX(-50%);
                background:rgba(0,242,254,0.15);
                backdrop-filter:blur(10px);
                padding:12px 24px;
                border-radius:30px;
                font-size:12px;
                font-weight:700;
                letter-spacing:2px;
                z-index:2000;
                border:1px solid #00F2FE;
                pointer-events:none;
                color:#00F2FE;
                box-shadow:0 0 20px rgba(0,242,254,0.3);
            `;
            document.body.appendChild(hint);
        }
    }, 1200);

    document.body.addEventListener('click', () => {
        if (initialized) {
            const hint = document.getElementById('voice-hint');
            if (hint) hint.remove();
            speak("Optima Vision Active. Monitoring camera clarity...", "success");
            initialized = false;
        }
    }, { once: true });

    updateUIState('clear', 98, 'Optima Vision Monitoring Active');
});

// Update UI elements dynamically
function updateUIState(state, qualityScore, customMsg) {
    const badge = document.getElementById('status-badge');
    const qualityVal = document.getElementById('quality-val');
    const statusText = document.getElementById('status-text');
    const alertTitle = document.getElementById('alert-title');
    const alertDesc = document.getElementById('alert-desc');
    const monitorRing = document.getElementById('monitor-ring');

    document.body.classList.remove('state-red', 'state-yellow', 'state-green');

    if (qualityVal) qualityVal.innerText = `${qualityScore}%`;

    if (state === 'clear') {
        if (videoElem) videoElem.classList.add('active');
        document.body.classList.add('state-green');

        if (badge) {
            badge.className = 'status-badge safe';
            badge.innerText = 'OPTIMAL VISION';
        }
        if (statusText) {
            statusText.innerText = 'CLEAR';
            statusText.style.color = '#00ff88';
        }
        if (alertTitle) alertTitle.innerText = 'Camera Vision Clear & Safe';
        if (alertDesc) alertDesc.innerText = customMsg || 'Camera lens is clear and unobstructed. All AI modules operational.';
        if (monitorRing) monitorRing.style.borderColor = '#00ff88';
    } 
    else if (state === 'blurry') {
        if (videoElem) videoElem.classList.remove('active');
        document.body.classList.add('state-yellow');

        if (badge) {
            badge.className = 'status-badge warning';
            badge.innerText = 'UNCLEAR / BLURRY';
        }
        if (statusText) {
            statusText.innerText = 'BLURRY';
            statusText.style.color = '#ffcc00';
        }
        if (alertTitle) alertTitle.innerText = 'Warning: Lens Obstructed or Blurry';
        if (alertDesc) alertDesc.innerText = customMsg || 'Camera vision is unclear or partially covered. Please clean your lens.';
        if (monitorRing) monitorRing.style.borderColor = '#ffcc00';
    } 
    else {
        if (videoElem) videoElem.classList.remove('active');
        document.body.classList.add('state-red');

        if (badge) {
            badge.className = 'status-badge danger';
            badge.innerText = 'VISION BLOCKED';
        }
        if (statusText) {
            statusText.innerText = 'BLOCKED';
            statusText.style.color = '#ff4444';
        }
        if (alertTitle) alertTitle.innerText = 'Alert: Camera Vision Completely Blocked';
        if (alertDesc) alertDesc.innerText = customMsg || 'Camera vision is completely dark or blocked. Check if camera is covered.';
        if (monitorRing) monitorRing.style.borderColor = '#ff4444';
    }
}

// Initialize Camera
async function initCamera() {
    if (activeStream && activeStream.active) return;

    try {
        stopCamera();
        await new Promise(r => setTimeout(r, 400));

        const constraints = { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' } };

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        activeStream = stream;
        if (videoElem) {
            videoElem.srcObject = activeStream;
            await videoElem.play();
        }

        console.log("Optima Vision Camera Initialized");
        startAnalysisLoop();

    } catch (err) {
        handleCameraError(err);
    }
}

function handleCameraError(err) {
    console.error("Camera Access Error: ", err);
    let userMsg = "Unable to access camera. Please allow camera permissions.";
    updateUIState('black', 0, userMsg);
    speak(userMsg, "danger");
}

function stopCamera() {
    if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
        activeStream = null;
    }
    if (videoElem) {
        videoElem.pause();
        videoElem.srcObject = null;
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCamera();
    else initCamera();
});

window.addEventListener('beforeunload', stopCamera);

// Standalone Client-Side Optical Quality Analysis Loop
function startAnalysisLoop() {
    if (window.analysisInterval) clearInterval(window.analysisInterval);

    window.analysisInterval = setInterval(() => {
        if (!videoElem || !videoElem.videoWidth || !ctx || !activeStream) return;

        canvasElem.width = 160;
        canvasElem.height = 120;
        ctx.drawImage(videoElem, 0, 0, 160, 120);

        const imgData = ctx.getImageData(0, 0, 160, 120);
        const data = imgData.data;

        let totalBrightness = 0;
        let darkCellCount = 0;
        const totalPixels = data.length / 4;

        for (let i = 0; i < data.length; i += 4) {
            const b = (data[i] + data[i + 1] + data[i + 2]) / 3;
            totalBrightness += b;
            if (b < 35) darkCellCount++;
        }

        const avgBrightness = totalBrightness / totalPixels;
        const darkRatio = darkCellCount / totalPixels;

        let newState = 'clear';
        let qualityScore = 98;
        let customMsg = 'Camera optical clarity optimal for AI vision.';

        if (avgBrightness < 25 || darkRatio > 0.85) {
            newState = 'black';
            qualityScore = Math.max(5, Math.round(avgBrightness));
            customMsg = 'Alert. Camera vision blocked completely or dark.';
        } else if (darkRatio > 0.45 || avgBrightness < 50) {
            newState = 'blurry';
            qualityScore = Math.max(25, Math.round(avgBrightness * 1.2));
            customMsg = 'Warning. Lens partially obstructed or low light.';
        } else {
            newState = 'clear';
            qualityScore = Math.min(99, Math.round(75 + (avgBrightness / 255) * 24));
        }

        updateUIState(newState, qualityScore, customMsg);

        if (newState !== lastState) {
            if (newState === 'black') speak("Alert. Camera vision blocked completely.", "danger");
            else if (newState === 'blurry') speak("Warning. Camera vision is unclear.", "warning");
            else if (newState === 'clear' && lastState !== null) speak("Vision clear. All systems normal.", "success");
            lastState = newState;
        }

    }, 500);
}

function speak(text, type) {
    if (!synth) return;
    synth.cancel();

    if (voiceText) voiceText.innerText = text;
    if (voiceOverlay) voiceOverlay.classList.remove('hidden', 'danger');

    if (type === 'danger' && voiceOverlay) voiceOverlay.classList.add('danger');

    const colors = { success: '#00ff88', danger: '#ff4444', warning: '#ffcc00' };
    if (pulse) pulse.style.backgroundColor = colors[type] || colors['warning'];

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => {
        if (type === 'success' && voiceOverlay) {
            setTimeout(() => voiceOverlay.classList.add('hidden'), 2000);
        }
    };

    synth.speak(utterance);
}