from types import SimpleNamespace

import cv2
import numpy as np
import pytest

import launcher
from staircase_inference import StaircaseInferenceService


class FakeBox:
    def __init__(self, class_id, confidence, box):
        self.cls = SimpleNamespace(item=lambda: class_id)
        self.conf = SimpleNamespace(item=lambda: confidence)
        self.xyxy = [SimpleNamespace(tolist=lambda: box)]


class FakeModel:
    names = {0: "downstairs", 1: "upstairs"}

    def __init__(self, boxes=None):
        self.boxes = boxes or []
        self.calls = []

    def predict(self, **kwargs):
        self.calls.append(kwargs)
        return [SimpleNamespace(boxes=self.boxes)]


def jpeg_frame(value=127):
    success, encoded = cv2.imencode(
        ".jpg",
        np.full((240, 320, 3), value, dtype=np.uint8),
    )
    assert success
    return encoded.tobytes()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(launcher, "staircase_enabled", True)
    return launcher.app.test_client()


def test_valid_image_returns_detection_and_expected_prediction_settings(client, monkeypatch, tmp_path):
    checkpoint = tmp_path / "best.pt"
    checkpoint.write_bytes(b"checkpoint stub")
    model = FakeModel([FakeBox(0, 0.82, [10, 20, 200, 180])])
    service = StaircaseInferenceService(
        model_path=checkpoint,
        confidence=0.35,
        model_factory=lambda _path: model,
    )
    monkeypatch.setattr(launcher, "staircase_service", service)

    response = client.post("/api/staircase/detect", data=jpeg_frame(), content_type="image/jpeg")

    assert response.status_code == 200
    body = response.get_json()
    assert body["status"] == "detected"
    assert body["detections"] == [{
        "label": "downstairs",
        "confidence": 0.82,
        "box": [10.0, 20.0, 200.0, 180.0],
    }]
    assert body["latency_ms"] >= 0
    assert len(model.calls) == 2
    assert all(call["conf"] == 0.35 for call in model.calls)
    assert all(call["iou"] == 0.5 for call in model.calls)
    assert all(call["imgsz"] == 416 for call in model.calls)
    assert all(call["agnostic_nms"] is True for call in model.calls)


def test_endpoint_reuses_one_loaded_model_and_maps_both_checkpoint_classes(client, monkeypatch, tmp_path):
    checkpoint = tmp_path / "best.pt"
    checkpoint.write_bytes(b"checkpoint stub")
    model = FakeModel([
        FakeBox(0, 0.82, [10, 20, 100, 120]),
        FakeBox(1, 0.79, [180, 20, 300, 180]),
    ])
    factory_calls = []

    def create_model(path):
        factory_calls.append(path)
        return model

    service = StaircaseInferenceService(
        model_path=checkpoint,
        confidence=0.35,
        model_factory=create_model,
    )
    monkeypatch.setattr(launcher, "staircase_service", service)

    first_response = client.post(
        "/api/staircase/detect",
        data=jpeg_frame(),
        content_type="image/jpeg",
    )
    second_response = client.post(
        "/api/staircase/detect",
        data=jpeg_frame(),
        content_type="image/jpeg",
    )

    assert first_response.status_code == second_response.status_code == 200
    assert factory_calls == [str(checkpoint.resolve())]
    assert service._model is model
    assert len(model.calls) == 3
    assert first_response.get_json()["detections"] == [
        {
            "label": "downstairs",
            "confidence": 0.82,
            "box": [10.0, 20.0, 100.0, 120.0],
        },
        {
            "label": "upstairs",
            "confidence": 0.79,
            "box": [180.0, 20.0, 300.0, 180.0],
        },
    ]


def test_corrupt_image_returns_explicit_client_error(client, monkeypatch, tmp_path):
    service = StaircaseInferenceService(
        model_path=tmp_path / "best.pt",
        model_factory=lambda _path: FakeModel(),
    )
    monkeypatch.setattr(launcher, "staircase_service", service)

    response = client.post("/api/staircase/detect", data=b"not an image", content_type="image/jpeg")

    assert response.status_code == 400
    assert response.get_json()["status"] == "error"
    assert response.get_json()["detections"] == []


def test_blank_image_returns_ambiguous_without_running_a_directional_prediction(client, monkeypatch, tmp_path):
    checkpoint = tmp_path / "best.pt"
    checkpoint.write_bytes(b"checkpoint stub")
    service = StaircaseInferenceService(
        model_path=checkpoint,
        model_factory=lambda _path: FakeModel(),
    )
    monkeypatch.setattr(launcher, "staircase_service", service)

    response = client.post("/api/staircase/detect", data=jpeg_frame(0), content_type="image/jpeg")

    assert response.status_code == 200
    assert response.get_json()["status"] == "ambiguous"
    assert response.get_json()["detections"] == []
    assert len(service._model.calls) == 1


def test_missing_model_returns_unavailable_without_exposing_path(client, monkeypatch, tmp_path):
    missing_path = tmp_path / "missing-best.pt"
    service = StaircaseInferenceService(model_path=missing_path)
    monkeypatch.setattr(launcher, "staircase_service", service)

    response = client.post("/api/staircase/detect", data=jpeg_frame(), content_type="image/jpeg")

    assert response.status_code == 503
    body = response.get_json()
    assert body["status"] == "error"
    assert body["message"] == "Staircase detection unavailable."
    assert str(missing_path) not in response.get_data(as_text=True)


def test_overlapping_competing_classes_are_ambiguous(client, monkeypatch, tmp_path):
    checkpoint = tmp_path / "best.pt"
    checkpoint.write_bytes(b"checkpoint stub")
    model = FakeModel([
        FakeBox(0, 0.72, [10, 10, 200, 200]),
        FakeBox(1, 0.64, [15, 15, 195, 195]),
    ])
    service = StaircaseInferenceService(
        model_path=checkpoint,
        confidence=0.35,
        model_factory=lambda _path: model,
    )
    monkeypatch.setattr(launcher, "staircase_service", service)

    response = client.post("/api/staircase/detect", data=jpeg_frame(), content_type="image/jpeg")

    assert response.status_code == 200
    assert response.get_json()["status"] == "ambiguous"


def test_low_confidence_prediction_is_ambiguous(client, monkeypatch, tmp_path):
    checkpoint = tmp_path / "best.pt"
    checkpoint.write_bytes(b"checkpoint stub")
    model = FakeModel([FakeBox(1, 0.41, [10, 10, 200, 200])])
    service = StaircaseInferenceService(
        model_path=checkpoint,
        confidence=0.35,
        model_factory=lambda _path: model,
    )
    monkeypatch.setattr(launcher, "staircase_service", service)

    response = client.post("/api/staircase/detect", data=jpeg_frame(), content_type="image/jpeg")

    assert response.status_code == 200
    assert response.get_json()["status"] == "ambiguous"


def test_backend_feature_flag_disables_inference_route(client, monkeypatch):
    monkeypatch.setattr(launcher, "staircase_enabled", False)

    response = client.post("/api/staircase/detect", data=jpeg_frame(), content_type="image/jpeg")

    assert response.status_code == 404
    assert response.get_json()["status"] == "error"
