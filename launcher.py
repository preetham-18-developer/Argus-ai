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

def main():
    print("="*60)
    print("      VISIONAID AI ECOSYSTEM — INTEGRATED CONTROLLER")
    print("="*60)
    print(f"[*] Dashboard Root: {ROOT_DIR}")
    print("[*] Port: 5000 (Main Hub)")
    print("[*] Type 'python launcher.py' to start.")
    print("="*60)
    
    # Automatically open the dashboard in the default browser
    import threading
    def auto_open():
        time.sleep(2)
        print("\n🚀 Opening VisionAid Dashboard...")
        webbrowser.open("http://localhost:5000")
        
    threading.Thread(target=auto_open, daemon=True).start()
    
    # Start the Flask Hub
    try:
        app.run(host='0.0.0.0', port=5000, debug=False)
    except KeyboardInterrupt:
        print("\nStopping all modules...")
        for p in processes.values():
            p.terminate()
        print("Goodbye!")

if __name__ == "__main__":
    main()
