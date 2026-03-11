let socket, voiceOverlay, voiceText, pulse, videoElem, canvasElem, ctx;
let initialized = true;
let synth = window.speechSynthesis;
let isLocked = true;
let isProcessing = false;
let activeStream = null;

document.addEventListener('DOMContentLoaded', () => {
    socket = io('http://127.0.0.1:5001');

    voiceOverlay = document.getElementById('voice-overlay');
    voiceText = document.getElementById('voice-text');
    pulse = document.querySelector('.pulse');
    videoElem = document.getElementById('webcam');
    canvasElem = document.getElementById('proc-canvas');
    ctx = canvasElem.getContext('2d');

    initCamera();

    // Add Hub link
    const backBtn = document.createElement('a');
    backBtn.href = "/";
    backBtn.innerText = "← BACK TO HUB";
    backBtn.style = `
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
    document.body.appendChild(backBtn);

    // 2. When Connected
    socket.on('connect', () => {
        console.log('Connected to Vision Engine');

        // Voice activation hint
        setTimeout(() => {
            if (initialized) {
                const hint = document.createElement('div');
                hint.id = 'voice-hint';
                hint.innerText = "TAP SCREEN TO ENABLE VOICE GUIDANCE";
                hint.style = `
                    position:fixed;
                    bottom:20px;
                    left:50%;
                    transform:translateX(-50%);
                    background:rgba(0,0,0,0.5);
                    padding:10px 20px;
                    border-radius:30px;
                    font-size:12px;
                    letter-spacing:2px;
                    z-index:2000;
                    border:1px solid rgba(255,255,255,0.2);
                    pointer-events:none;
                    color:white;
                `;
                document.body.appendChild(hint);
            }
        }, 2000);

        document.body.addEventListener('click', () => {
            if (initialized) {
                const hint = document.getElementById('voice-hint');
                if (hint) hint.remove();
                speak("Vision Engine Active. Monitoring quality...", "warning");
                initialized = false;
            }
        }, { once: true });
    });

    // 3. Result from backend
    socket.on('analysis_result', (data) => {
        isProcessing = false;

        // Remove old states
        document.body.classList.remove('state-red', 'state-yellow', 'state-green');

        // Apply new state
        if (data.state === 'clear') {
            videoElem.classList.add('active');
            document.body.classList.add('state-green');
        }
        else if (data.state === 'blurry') {
            videoElem.classList.remove('active');
            document.body.classList.add('state-yellow');
            speak("Warning. Vision is partially blocked.", "warning");
        }
        else if (data.state === 'black') {
            videoElem.classList.remove('active');
            document.body.classList.add('state-red');
            speak("Alert. Camera vision is not visible.", "danger");
        }

        // system lock/unlock
        handleLockState(data.lock);
    });

    // 4. Voice command response
    socket.on('voice_command', (data) => {
        speak(data.message, data.type);
    });
});

// Initialize Camera (Robust Production Pattern)
async function initCamera() {
    // Prevent duplicate requests
    if (activeStream && activeStream.active) return;

    try {
        stopCamera();
        // Delay to allow previous module to release hardware
        await new Promise(r => setTimeout(r, 800));
        
        const highQuality = { video: { width: 1280, height: 720 } };
        const fallback = { video: true, audio: false };

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia(highQuality);
        } catch (e) {
            console.warn("High quality camera failed, using fallback...");
            stream = await navigator.mediaDevices.getUserMedia(fallback);
        }

        activeStream = stream;
        videoElem.srcObject = activeStream;
        
        // Monitor tracks for health
        stream.getVideoTracks().forEach(track => {
            track.onended = () => handleStreamInterruption("Track Ended");
            track.onmute = () => handleStreamInterruption("Track Muted");
            track.oninactive = () => handleStreamInterruption("Track Inactive");
        });

        await videoElem.play();
        console.log("Vision Engine Initialized");
        startAnalysisLoop();

    } catch (err) {
        handleCameraError(err);
    }
}

function handleStreamInterruption(reason) {
    if (document.hidden) return; // Ignore if tab hidden
    console.warn(`Camera stream interrupted: ${reason}. Restarting...`);
    
    setTimeout(() => {
        if (!document.hidden) initCamera();
    }, 2000); // Increased delay
}

function handleCameraError(err) {
    console.error("Camera Access Error: ", err);
    let userMsg = "Error accessing camera.";
    
    if (err.name === 'NotReadableError') {
        console.warn("Camera busy, retrying...");
        setTimeout(initCamera, 2000);
        return;
    } else if (err.name === 'NotAllowedError') {
        userMsg = "Permission Denied. Please enable camera access.";
    }

    socket.emit('camera_error', { error: err.message });
    speak(userMsg, "danger");
}

function stopCamera() {
    if (activeStream) {
        console.log("Shutting down Camera Check tracks...");
        activeStream.getTracks().forEach(track => {
            track.onended = null;
            track.onmute = null;
            track.oninactive = null;
            track.stop();
        });
        activeStream = null;
    }
    videoElem.pause();
    videoElem.srcObject = null;
}

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log("Tab hidden, releasing camera...");
        stopCamera();
    } else {
        console.log("Tab visible, restarting camera...");
        initCamera();
    }
});

window.addEventListener('beforeunload', stopCamera);

function handleLockState(locked) {
    if (isLocked === locked) return;
    isLocked = locked;
    if (locked) {
        document.body.classList.add('system-locked');
    } else {
        document.body.classList.remove('system-locked');
    }
}

function startAnalysisLoop() {
    // Only start if not already running (setInterval management)
    if (window.analysisInterval) clearInterval(window.analysisInterval);
    
    window.analysisInterval = setInterval(() => {
        if (!videoElem.videoWidth || isProcessing || !activeStream) return;

        isProcessing = true;

        // Reduce resolution for backend speed
        canvasElem.width = 400;
        canvasElem.height = 300;

        ctx.drawImage(videoElem, 0, 0, 400, 300);

        const base64Data = canvasElem.toDataURL('image/jpeg', 0.5).split(',')[1];

        socket.emit('analyze_frame', { image: base64Data });

    }, 300); // every 300ms
}

function speak(text, type) {
    if (!voiceText || !voiceOverlay || !pulse || !synth) return;

    synth.cancel(); // Cut previous audio

    voiceText.innerText = text;
    voiceOverlay.classList.remove('hidden', 'danger');

    if (type === 'danger') {
        voiceOverlay.classList.add('danger');
    }

    const colors = {
        success: '#00ff88',
        danger: '#ff4444',
        warning: '#ffcc00'
    };
    pulse.style.backgroundColor = colors[type] || colors['warning'];

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.onend = () => {
        if (type === 'success')
            setTimeout(() => voiceOverlay.classList.add('hidden'), 1500);
    };

    synth.speak(utterance);
}