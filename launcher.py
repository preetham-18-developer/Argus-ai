import os
import subprocess
import webbrowser
import time
import sys
import socket
import signal
import atexit
from flask import Flask, render_template, request, jsonify, send_from_directory

# ─── CONFIGURATION ───────────────────────────────────────────────────────────
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, template_folder='.')

# Track running processes to avoid multiple instances and ensure cleanup
processes = {}

def cleanup_processes():
    """Ensure all spawned subprocesses are terminated upon exit."""
    for name, p in list(processes.items()):
        if p and p.poll() is None:
            print(f"[*] Terminating {name} backend (PID: {p.pid})...")
            try:
                p.terminate()
                p.wait(timeout=2)
            except Exception:
                try:
                    p.kill()
                except Exception:
                    pass

atexit.register(cleanup_processes)

def signal_handler(sig, frame):
    cleanup_processes()
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def find_available_port(start_port, max_attempts=10):
    for p in range(start_port, start_port + max_attempts):
        if not is_port_in_use(p):
            return p
    return start_port

# ─── ROUTES ──────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    """Serve the main VisionAid Dashboard."""
    return render_template('index.html')

@app.route('/api/launch/<feature>')
def launch_feature(feature):
    """
    Triggers the Python backend for a specific feature.
    If the feature is pure HTML, returns the local path.
    """
    python_exe = sys.executable
    hub_port = int(os.environ.get('PORT', 5005))
    
    # Feature Configuration
    configs = {
        'camera_check': {
            'cwd': os.path.join(ROOT_DIR, 'Camera Check'),
            'script': 'app.py',
            'port': 5001
        },
        'visual_explanation': {
            'cwd': os.path.join(ROOT_DIR, 'Visual Explanation', 'Visual Explanation'),
            'script': 'app.py',
            'port': 5002
        }
    }
    
    # 1. Handle Python Backend Features
    if feature in configs:
        conf = configs[feature]
        
        # Check if already running or if port is already active
        port_active = is_port_in_use(conf['port'])
        is_running = feature in processes and processes[feature].poll() is None
        
        if not is_running and not port_active:
            print(f"[*] Starting {feature} backend on port {conf['port']}...")
            try:
                # Use CREATE_NO_WINDOW on Windows to hide logs
                CREATE_NO_WINDOW = 0x08000000
                env = os.environ.copy()
                env['HUB_PORT'] = str(hub_port)
                env['HUB_URL'] = f"http://localhost:{hub_port}"
                
                p = subprocess.Popen(
                    [python_exe, conf['script']],
                    cwd=conf['cwd'],
                    env=env,
                    creationflags=CREATE_NO_WINDOW if os.name == 'nt' else 0
                )
                processes[feature] = p
            except Exception as e:
                return jsonify({"success": False, "error": str(e)})
        
        return jsonify({
            "success": True, 
            "url": f"http://localhost:{conf['port']}?hub=http://localhost:{hub_port}",
            "type": "backend"
        })
    
    # 2. Handle HTML-only Features
    html_features = {
        'night_vision': 'Night-Vision/index.html',
        'object_detection': 'object-detection-pro/index.html',
        'queue_detection': 'queue-detection/index.html'
    }
    
    if feature in html_features:
        return jsonify({
            "success": True, 
            "url": f"/{html_features[feature]}",
            "type": "frontend"
        })

    return jsonify({"success": False, "error": "Unknown feature module"})

@app.route('/api/status')
def get_system_status():
    """Return health & operational status of all ecosystem modules & external endpoints."""
    hub_port = int(os.environ.get('PORT', 5005))
    
    status_data = {
        "hub": {"status": "online", "port": hub_port},
        "modules": {
            "camera_check": {
                "name": "Optima Vision (Camera Quality Gate)",
                "port": 5001,
                "running": is_port_in_use(5001),
                "type": "Flask-SocketIO + OpenCV"
            },
            "visual_explanation": {
                "name": "VisionAid AI (Medicine/Object/Doc)",
                "port": 5002,
                "running": is_port_in_use(5002),
                "type": "Flask + Gemini AI / NVIDIA NIM"
            },
            "night_vision": {
                "name": "PathGuide Pro",
                "type": "Client-side OpenCV.js",
                "status": "ready"
            },
            "object_detection": {
                "name": "Object Detector Pro",
                "type": "Client-side TensorFlow.js + COCO-SSD",
                "status": "ready"
            },
            "queue_detection": {
                "name": "Queue Detector",
                "type": "Client-side MoveNet Pose Estimation",
                "status": "ready"
            }
        },
        "apis": {
            "gemini": {
                "configured": bool(os.getenv("GEMINI_API_KEY")),
                "mode": "Active" if os.getenv("GEMINI_API_KEY") else "Demo Mode (Realistic Fallback)"
            },
            "nvidia": {
                "configured": bool(os.getenv("NVIDIA_API_KEY")),
                "mode": "Active" if os.getenv("NVIDIA_API_KEY") else "Demo Mode (Realistic Fallback)"
            },
            "emergency_sos": {
                "webhook_configured": bool(os.getenv("EMERGENCY_WEBHOOK_URL")),
                "mode": "Local Dispatch + WhatsApp Alert"
            }
        }
    }
    return jsonify(status_data)

@app.route('/api/sos', methods=['POST'])
def emergency_sos():
    """
    Handle Emergency SOS triggers.
    Dispatches alert locally, formats WhatsApp quick link,
    and forwards to webhook if EMERGENCY_WEBHOOK_URL is set.
    """
    data = request.get_json(silent=True) or {}
    user_id = data.get("user_id", "U1001")
    location = data.get("location", "17.3850,78.4867")
    
    maps_url = f"https://maps.google.com/?q={location}"
    message = f"🚨 *EMERGENCY SOS ALERT* from User {user_id}!\n📍 Live Location: {maps_url}\n⚠️ Immediate assistance requested."
    
    whatsapp_url = f"https://api.whatsapp.com/send?text={message.replace(' ', '%20').replace(chr(10), '%0A')}"
    
    print(f"\n[🚨 EMERGENCY SOS] User: {user_id} | Location: {location}")
    print(f"[🚨 MAPS LINK] {maps_url}\n")
    
    # Try custom webhook if configured in environment
    webhook_url = os.getenv("EMERGENCY_WEBHOOK_URL")
    webhook_status = "not_configured"
    if webhook_url:
        try:
            import requests
            resp = requests.post(webhook_url, json={"user_id": user_id, "location": location, "maps_url": maps_url}, timeout=3)
            webhook_status = f"HTTP {resp.status_code}"
        except Exception as e:
            webhook_status = f"Failed: {str(e)}"
    
    return jsonify({
        "success": True,
        "status": "dispatched",
        "user_id": user_id,
        "location": location,
        "maps_url": maps_url,
        "whatsapp_url": whatsapp_url,
        "webhook_status": webhook_status,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    })

@app.route('/<path:filename>')
def serve_static(filename):
    """
    Serve static files from the root directory safely.
    Blocks directory traversal and sensitive/hidden files.
    """
    # Block path traversal
    if '..' in filename or filename.startswith('/'):
        return jsonify({"error": "Forbidden"}), 403
    
    # Block hidden files and sensitive directories (.git, .env, __pycache__, etc.)
    parts = filename.split('/')
    if any(p.startswith('.') for p in parts) or any(p in ('__pycache__', 'venv', '.venv') for p in parts):
        return jsonify({"error": "Forbidden"}), 403
    
    # Block direct source/script downloads from root
    if filename.endswith(('.py', '.pyc', '.env', '.pem', '.key')):
        return jsonify({"error": "Forbidden"}), 403
        
    return send_from_directory(ROOT_DIR, filename)

# ─── MAIN ─────────────────────────────────────────────────────────────────────

def main():
    default_port = int(os.environ.get('PORT', 5005))
    port = find_available_port(default_port)
    os.environ['PORT'] = str(port)
    
    print("="*60)
    print("      VISIONAID AI ECOSYSTEM — INTEGRATED CONTROLLER")
    print("="*60)
    print(f"[*] Dashboard Root: {ROOT_DIR}")
    print(f"[*] Port: {port} (Main Hub)")
    print(f"[*] Status: http://localhost:{port}/api/status")
    print("="*60)
    
    # Automatically open the dashboard in the default browser
    import threading
    def auto_open():
        time.sleep(1.5)
        print(f"\n🚀 Opening VisionAid Dashboard at http://localhost:{port} ...")
        try:
            webbrowser.open(f"http://localhost:{port}")
        except Exception:
            pass
        
    threading.Thread(target=auto_open, daemon=True).start()
    
    # Start the Flask Hub
    try:
        app.run(host='0.0.0.0', port=port, debug=False)
    except KeyboardInterrupt:
        print("\nStopping all modules...")
        cleanup_processes()
        print("Goodbye!")

if __name__ == "__main__":
    main()
