import cv2
import numpy as np
from flask import Flask, render_template, send_from_directory, jsonify
from flask_socketio import SocketIO, emit
import base64

app = Flask(__name__, template_folder='.', static_folder='.', static_url_path='')
socketio = SocketIO(app, cors_allowed_origins="*")

class CameraQualityGate:
    def __init__(self):
        self.last_state = None
        self.modules_allowed = False
        self.frame_count = 0  # Frame counter for skipping

    # Check if entire frame is dark
    def is_black_screen(self, gray, threshold=30):
        return np.mean(gray) < threshold

    # Blur detection (higher threshold for accuracy)
    def is_blurry(self, gray, threshold=90):
        fm = cv2.Laplacian(gray, cv2.CV_64F).var()
        return fm < threshold

    # Obstruction check (finger blocking / shadows)
    def check_obstruction(self, gray, cell_threshold=50):
        mini = cv2.resize(gray, (10, 10))
        dark_cells = np.sum(mini < cell_threshold)
        return dark_cells > 45   # >45% dark cells

    def analyze(self, frame_data):
        self.frame_count += 1
        # Skip 9 out of 10 frames as requested (Step 5)
        if self.frame_count % 10 != 0:
            return {"state": self.last_state or "skipping", "lock": not self.modules_allowed}

        if not frame_data:
            return {"state": "error", "lock": True}

        try:
            img_bytes = base64.b64decode(frame_data)
            nparr = np.frombuffer(img_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except:
            return {"state": "error", "lock": True}

        if frame is None:
            return {"state": "error", "lock": True}

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # --- ORDER OF DECISION (VERY IMPORTANT) ---
        if self.is_black_screen(gray):
            state = "black"
            self.modules_allowed = False

        elif self.check_obstruction(gray):
            state = "blurry"
            self.modules_allowed = False

        elif self.is_blurry(gray):
            state = "blurry"
            self.modules_allowed = False

        else:
            state = "clear"
            self.modules_allowed = True

        # Emit warnings only if state actually changed
        if state != self.last_state:
            self.send_alert(state)
            self.last_state = state

        return {
            "state": state,
            "lock": not self.modules_allowed
        }

    def send_alert(self, state):
        if state == "black":
            socketio.emit('voice_command', {
                "message": "Alert. Vision blocked completely.",
                "type": "danger"
            })

        elif state == "blurry":
            socketio.emit('voice_command', {
                "message": "Warning. Your camera vision is unclear.",
                "type": "warning"
            })

        elif state == "clear":
            socketio.emit('voice_command', {
                "message": "Vision clear. All systems normal.",
                "type": "success"
            })

gate = CameraQualityGate()


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/health')
def health_check():
    return {"status": "ok", "module": "camera_check", "port": 5001}

@app.route('/<path:filename>')
def serve_static(filename):
    # Prevent directory traversal and block hidden/sensitive files
    parts = filename.split('/')
    if any(p.startswith('.') for p in parts) or '..' in filename or filename.endswith(('.py', '.pyc', '.env')):
        return "Access denied", 403
    return send_from_directory(os.path.dirname(os.path.abspath(__file__)), filename)

@socketio.on('analyze_frame')
def handle_analysis(data):
    result = gate.analyze(data.get('image'))
    emit('analysis_result', result)

@socketio.on('connect')
def handle_connect():
    print('Client connected to Vision Engine')

if __name__ == '__main__':
    print("Vision Engine Active on http://localhost:5001")
    socketio.run(app, host='0.0.0.0', port=5001, allow_unsafe_werkzeug=True)