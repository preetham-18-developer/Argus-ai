"""YOLO inference service for the Staircase Detection feature."""

import logging
import os
import threading
import time
from pathlib import Path

LOGGER = logging.getLogger(__name__)
CLASS_NAMES = {0: "downstairs", 1: "upstairs"}
IMAGE_SIZE = 416
DEFAULT_CONFIDENCE = 0.35
DEFAULT_IOU = 0.5
AMBIGUOUS_SCORE_MARGIN = 0.15
AMBIGUOUS_IOU = 0.5
LOW_CONFIDENCE_MARGIN = 0.10
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_IMAGE_PIXELS = 12_000_000


class InferenceUnavailable(RuntimeError):
    """Raised when the configured checkpoint cannot provide inference."""


class InvalidImage(ValueError):
    """Raised when the request body is not a decodable camera image."""


def _environment_confidence():
    raw_value = os.getenv("STAIRCASE_CONFIDENCE", str(DEFAULT_CONFIDENCE))
    try:
        confidence = float(raw_value)
    except ValueError as error:
        raise ValueError("STAIRCASE_CONFIDENCE must be a number between 0 and 1.") from error
    if not 0 < confidence <= 1:
        raise ValueError("STAIRCASE_CONFIDENCE must be greater than 0 and at most 1.")
    return confidence


def resolve_model_path(value=None):
    """Resolve relative checkpoint paths against this module, never the process CWD."""
    configured = value if value is not None else os.getenv("STAIRCASE_MODEL_PATH", "best.pt")
    path = Path(configured).expanduser()
    if not path.is_absolute():
        path = Path(__file__).resolve().parent / path
    return path.resolve()


class StaircaseInferenceService:
    def __init__(self, model_path=None, confidence=None, model_factory=None):
        self.model_path = resolve_model_path(model_path)
        self._load_error = None
        try:
            self.confidence = _environment_confidence() if confidence is None else float(confidence)
            if not 0 < self.confidence <= 1:
                raise ValueError("confidence must be greater than 0 and at most 1.")
        except ValueError as error:
            self.confidence = DEFAULT_CONFIDENCE
            self._load_error = str(error)
            LOGGER.error("[Staircase] Invalid confidence configuration: %s", error)
        self._model_factory = model_factory
        self._model = None
        self._load_lock = threading.Lock()
        self._predict_lock = threading.Lock()

    @property
    def healthy(self):
        return self._model is not None and self._load_error is None

    def load(self):
        with self._load_lock:
            return self._load_once()

    def _load_once(self):
        if self.healthy:
            return True
        if self._load_error is not None:
            return False
        if not self.model_path.is_file():
            self._load_error = "model file is missing"
            LOGGER.error("[Staircase] Configured model file is missing.")
            return False

        try:
            import numpy as np

            if self._model_factory is None:
                from ultralytics import YOLO

                model = YOLO(str(self.model_path))
            else:
                model = self._model_factory(str(self.model_path))

            self._validate_class_names(model.names)
            model.predict(
                source=np.zeros((IMAGE_SIZE, IMAGE_SIZE, 3), dtype=np.uint8),
                conf=self.confidence,
                iou=DEFAULT_IOU,
                imgsz=IMAGE_SIZE,
                agnostic_nms=True,
                verbose=False,
            )
            self._model = model
            LOGGER.info("[Staircase] YOLO model loaded and warmed up.")
            return True
        except Exception as error:
            self._load_error = str(error)
            LOGGER.exception("[Staircase] Model loading or warm-up failed.")
            return False

    @staticmethod
    def _validate_class_names(names):
        if isinstance(names, list):
            names = dict(enumerate(names))
        if not isinstance(names, dict):
            raise ValueError("YOLO checkpoint must declare its class names.")
        normalized = {int(class_id): str(name).strip().lower() for class_id, name in names.items()}
        if normalized != CLASS_NAMES:
            raise ValueError("YOLO checkpoint classes must be 0=downstairs and 1=upstairs.")

    def predict_jpeg(self, image_bytes):
        started = time.perf_counter()
        if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
            raise InvalidImage("Image is empty or exceeds the 2 MiB limit.")

        try:
            import cv2
            import numpy as np
        except ImportError as error:
            LOGGER.exception("[Staircase] OpenCV or NumPy dependency is unavailable.")
            raise InferenceUnavailable("Staircase dependencies are unavailable.") from error

        encoded = np.frombuffer(image_bytes, dtype=np.uint8)
        try:
            frame = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        except cv2.error as error:
            raise InvalidImage("Image data could not be decoded.") from error
        if frame is None or frame.size == 0:
            raise InvalidImage("Image data could not be decoded.")
        height, width = frame.shape[:2]
        if width < 1 or height < 1 or width * height > MAX_IMAGE_PIXELS:
            raise InvalidImage("Image dimensions are invalid or too large.")

        if not self.healthy and not self.load():
            raise InferenceUnavailable("Staircase model is unavailable.")

        mean_luminance = cv2.mean(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))[0]
        if mean_luminance < 8:
            return {
                "status": "ambiguous",
                "detections": [],
                "latency_ms": round((time.perf_counter() - started) * 1000, 2),
            }

        try:
            with self._predict_lock:
                result = self._model.predict(
                    source=frame,
                    conf=self.confidence,
                    iou=DEFAULT_IOU,
                    imgsz=IMAGE_SIZE,
                    agnostic_nms=True,
                    verbose=False,
                )
        except Exception as error:
            LOGGER.exception("[Staircase] YOLO prediction failed.")
            raise InferenceUnavailable("Staircase inference failed.") from error

        detections = self._collect_detections(result)
        status = self._decision_status(detections)
        return {
            "status": status,
            "detections": detections,
            "latency_ms": round((time.perf_counter() - started) * 1000, 2),
        }

    @staticmethod
    def _collect_detections(results):
        detections = []
        for result in results or []:
            boxes = getattr(result, "boxes", None)
            if boxes is None:
                continue
            for box in boxes:
                class_id = int(box.cls.item())
                if class_id not in CLASS_NAMES:
                    continue
                coords = box.xyxy[0].tolist()
                detections.append({
                    "label": CLASS_NAMES[class_id],
                    "confidence": float(box.conf.item()),
                    "box": [round(float(value), 2) for value in coords],
                })
        detections.sort(key=lambda item: item["confidence"], reverse=True)
        return detections

    def _decision_status(self, detections):
        if not detections:
            return "none"
        if detections[0]["confidence"] < min(1.0, self.confidence + LOW_CONFIDENCE_MARGIN):
            return "ambiguous"

        for index, first in enumerate(detections):
            for second in detections[index + 1:]:
                if first["label"] == second["label"]:
                    continue
                if abs(first["confidence"] - second["confidence"]) >= AMBIGUOUS_SCORE_MARGIN:
                    continue
                if self._box_iou(first["box"], second["box"]) >= AMBIGUOUS_IOU:
                    return "ambiguous"
        return "detected"

    @staticmethod
    def _box_iou(first, second):
        x1 = max(first[0], second[0])
        y1 = max(first[1], second[1])
        x2 = min(first[2], second[2])
        y2 = min(first[3], second[3])
        if x2 <= x1 or y2 <= y1:
            return 0.0
        intersection = (x2 - x1) * (y2 - y1)
        first_area = max(0, first[2] - first[0]) * max(0, first[3] - first[1])
        second_area = max(0, second[2] - second[0]) * max(0, second[3] - second[1])
        union = first_area + second_area - intersection
        return intersection / union if union > 0 else 0.0
