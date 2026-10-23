import cv2
import numpy as np
from flask import Flask, render_template, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import base64

app = Flask(__name__, template_folder='.', static_folder='.', static_url_path='')
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

class CameraQualityGate:
    def __init__(self):
        self.last_state = None
        self.modules_allowed = True
        self.frame_count = 0

    def is_black_screen(self, gray, threshold=30):
        return np.mean(gray) < threshold

    def is_blurry(self, gray, threshold=70):
        fm = cv2.Laplacian(gray, cv2.CV_64F).var()
        return fm < threshold, float(fm)

    def check_obstruction(self, gray, cell_threshold=45):
        mini = cv2.resize(gray, (10, 10))
        dark_cells = np.sum(mini < cell_threshold)
        return dark_cells > 45

    def analyze(self, frame_data):
        self.frame_count += 1

        if not frame_data:
            return {"state": "error", "quality": 0, "lock": True, "message": "No frame data received"}

        try:
            img_bytes = base64.b64decode(frame_data)
            nparr = np.frombuffer(img_bytes, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except Exception as e:
            return {"state": "error", "quality": 0, "lock": True, "message": str(e)}

        if frame is None:
            return {"state": "error", "quality": 0, "lock": True, "message": "Corrupted frame"}

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        brightness = float(np.mean(gray))
        blurry, laplacian_var = self.is_blurry(gray)
        obstructed = self.check_obstruction(gray)

        if self.is_black_screen(gray):
            state = "black"
            quality = max(5, int(brightness))
            self.modules_allowed = False
            msg = "Camera vision completely blocked or covered."

        elif obstructed:
            state = "blurry"
            quality = min(45, max(15, int(brightness * 0.6)))
            self.modules_allowed = False
            msg = "Camera lens appears covered or obstructed."

        elif blurry:
            state = "blurry"
            quality = min(60, max(25, int(laplacian_var * 0.5)))
            self.modules_allowed = False
            msg = "Camera focus is blurry or out of position."

        else:
            state = "clear"
            quality = min(99, max(85, int(85 + (brightness / 255.0) * 14)))
            self.modules_allowed = True
            msg = "Camera optical clarity optimal for AI vision."

        if state != self.last_state:
            self.send_alert(state)
            self.last_state = state

        return {
            "state": state,
            "quality": quality,
            "brightness": round(brightness, 1),
            "lock": not self.modules_allowed,
            "message": msg
        }

    def send_alert(self, state):
        if state == "black":
            socketio.emit('voice_command', {
                "message": "Alert. Camera vision blocked completely.",
                "type": "danger"
            })
        elif state == "blurry":
            socketio.emit('voice_command', {
                "message": "Warning. Camera vision is unclear or blurry.",
                "type": "warning"
            })
        elif state == "clear":
            socketio.emit('voice_command', {
                "message": "Optima Vision clear. All systems normal.",
                "type": "success"
            })

gate = CameraQualityGate()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/<path:filename>')
def serve_static(filename):
    return send_file(filename)

@socketio.on('analyze_frame')
def handle_analysis(data):
    result = gate.analyze(data.get('image'))
    emit('analysis_result', result)

@socketio.on('connect')
def handle_connect():
    print('[Optima Vision] Client connected')

if __name__ == '__main__':
    print("Optima Vision Active on http://localhost:5001")
    socketio.run(app, host='0.0.0.0', port=5001, allow_unsafe_werkzeug=True)