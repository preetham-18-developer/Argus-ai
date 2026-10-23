import os
import subprocess
import webbrowser
import time
import sys
from flask import Flask, render_template, jsonify, send_from_directory

# ─── CONFIGURATION ───────────────────────────────────────────────────────────
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, template_folder='.')

# Track running processes to avoid multiple instances
processes = {}

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
        
        # Check if already running
        if feature not in processes or processes[feature].poll() is not None:
            print(f"[*] Starting {feature} backend...")
            try:
                # Use CREATE_NO_WINDOW on Windows to hide logs
                CREATE_NO_WINDOW = 0x08000000
                p = subprocess.Popen(
                    [python_exe, conf['script']],
                    cwd=conf['cwd'],
                    creationflags=CREATE_NO_WINDOW if os.name == 'nt' else 0
                )
                processes[feature] = p
                time.sleep(0.8)  # Allow process to bind to port
            except Exception as e:
                return jsonify({"success": False, "error": str(e)})
        
        return jsonify({
            "success": True, 
            "url": f"http://localhost:{conf['port']}",
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

@app.route('/<path:filename>')
def serve_static(filename):
    """Serve static files from the root directory."""
    return send_from_directory(ROOT_DIR, filename)

# ─── MAIN ─────────────────────────────────────────────────────────────────────

import socket

def find_free_port(preferred_ports=(5000, 5005, 5050, 8000, 8080)):
    for port in preferred_ports:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('0.0.0.0', port))
                return port
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('0.0.0.0', 0))
        return s.getsockname()[1]

def main():
    port = find_free_port([int(os.environ['PORT'])] if 'PORT' in os.environ else [5000, 5005, 5050, 8000, 8080])
    url = f"http://localhost:{port}"
    print("="*60)
    print("      VISIONAID AI ECOSYSTEM — INTEGRATED CONTROLLER")
    print("="*60)
    print(f"[*] Dashboard Root: {ROOT_DIR}")
    print(f"[*] Port: {port} (Main Hub)")
    print(f"[*] Access URL: {url}")
    print("="*60)
    
    # Automatically open the dashboard in the default browser
    import threading
    def auto_open():
        time.sleep(2)
        print(f"\n🚀 Opening VisionAid Dashboard at {url}...")
        webbrowser.open(url)
        
    threading.Thread(target=auto_open, daemon=True).start()
    
    # Start the Flask Hub
    try:
        app.run(host='0.0.0.0', port=port, debug=False)
    except KeyboardInterrupt:
        print("\nStopping all modules...")
        for p in processes.values():
            p.terminate()
        print("Goodbye!")

if __name__ == "__main__":
    main()
