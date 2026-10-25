# Staircase Detection

## Current implementation and safety limits

Staircase Detection is a standalone feature card and page, separate from
PathGuide. It requests its own camera stream only while the Staircase Detection
page is active and detection is started. PathGuide continues to use its own
camera and COCO-SSD obstacle detector unchanged. The existing Flask hub loads
the locally supplied YOLO checkpoint once at startup and reuses it.

The only supported classes are checkpoint class `0` (`downstairs`) and class
`1` (`upstairs`). This checkpoint does not provide labels for spiral stairs,
landings, step edges, ramps, or obstacles. A model score is not a calibrated
probability. A prediction is not a walking instruction, and neither a missing
detection nor a healthy endpoint means that the view or route is clear. The
feature is a prototype, not a safety-rated mobility aid.

### Model, weights, and configuration

- Checkpoint: repository-root `best.pt` (user-provided YOLOv8n weights); it is
  intentionally excluded from this public repository.
- Supply the weights through a private channel and place them at the repository
  root, or set `STAIRCASE_MODEL_PATH` to a private local path. Without weights,
  the detection API reports that inference is unavailable.
- Default lookup is relative to `staircase_inference.py`, not the process's
  current working directory.
- Override the path with `STAIRCASE_MODEL_PATH`. Absolute paths are accepted;
  relative paths are resolved from the directory containing
  `staircase_inference.py`.
- `STAIRCASE_CONFIDENCE` sets the confidence filter (default `0.35`; must be
  greater than 0 and at most 1).
- Prediction uses `iou=0.5`, `imgsz=416`, and `agnostic_nms=True`.
- The feature flag defaults on. Set `STAIRCASE_FEATURE_ENABLED=false` to
  disable the backend route and startup load; set `staircaseMode: false` in
  [feature-flags.js](../assets/js/feature-flags.js) to hide/disable the dashboard
  card and shared voice route as well. Runtime mode always starts OFF and is not
  saved.
- Ultralytics is licensed under **AGPL-3.0**. Review license obligations before
  redistributing the application or model integration.

Install the Python dependencies and start the existing Flask hub from the
repository root:

```powershell
python -m pip install -r "Visual Explanation\Visual Explanation\requirements.txt"
python launcher.py
```

The same hub serves `POST /api/staircase/detect` and the static Staircase
Detection page at `/staircase-detection/`.
The endpoint accepts a JPEG body and returns:

```json
{
  "status": "detected",
  "detections": [
    { "label": "downstairs", "confidence": 0.82, "box": [10, 20, 200, 180] }
  ],
  "latency_ms": 24.5
}
```

`box` coordinates are `[x1, y1, x2, y2]` in the submitted frame. Status is
`detected`, `ambiguous`, `none`, or `error`. Invalid images return HTTP 400;
missing/unloadable model or inference dependencies return HTTP 503. The API
never returns the server's model path. Frames are limited to 2 MiB and 12
megapixels.

Very dark frames (mean grayscale luminance below 8 on the 0–255 scale) are
returned as `ambiguous` with no detections, rather than allowing the model to
assign a direction to an unusable frame.

The standalone page resizes frames to 416 pixels wide, encodes JPEG, and sends
only one request at a time. Its adaptive polling targets 2–4 frames per second,
with a 3-second timeout and a visible unavailable state. A successful frame updates
the displayed boxes, labels, and model scores. Directional speech requires at
least 3 matching results among the last 5 frames; switching direction requires
4 of 5. Ambiguous/low-score results do not vote for a direction. Repeated
announcements are rate-limited.

Camera startup waits at most 15 seconds for the browser permission request and
5 seconds for the first usable video frame. Permission denial, missing or busy
camera, a pending permission prompt, and a camera that produces no frame have
distinct visible messages. Browser permission prompts cannot be programmatically
dismissed; after a permission timeout, the page blocks another request until
the original browser prompt is dismissed or resolves. A late-granted stream is
stopped rather than attached. Stop cancels frame polling, aborts in-flight
inference, stops the stream tracks, and ignores stale results.

YOLO is called with class-agnostic NMS as requested. If two overlapping
opposing-class detections survive NMS and their scores differ by less than
0.15, the result is ambiguous. Class-agnostic NMS can itself suppress an
opposing-class box, so this rule only evaluates competing boxes that remain in
the model output.

## Voice and UI

The existing shared voice parser recognizes:

- `activate staircase`, `start staircase mode`, `staircase on`
- `deactivate staircase`, `stop staircase`, `staircase off`
- `staircase status`
- `detect stairs`, `staircase detection`, `check stairs`

The feature card opens the independent Staircase Detection page. The shared
voice parser routes staircase commands to that page; commands issued while on
the page use the same in-memory mode state as its Start/Stop controls. Turning
the feature off stops its camera, polling, and pending request. PathGuide has
no Staircase Detection controls or inference loop.

## Data and training provenance

The development workspace had a user-supplied `best.pt`, but the weights are
not included in this public repository. No training run outputs, training
dataset, annotation manifests, or class-balance report were provided for this
integration. Consequently, training metrics and dataset counts are **not
available here**; they are not inferred from the checkpoint. No retraining or
weight modification was performed.

For future reproducible data collection:

| Class | Annotation definition |
| --- | --- |
| `downstairs` | A visible stair flight viewed from its upper end, with visible evidence that the flight descends away from the camera. |
| `upstairs` | A visible stair flight viewed from its lower end, with visible evidence that the flight ascends away from the camera. |

If the image does not establish the viewed direction, mark it ambiguous or
exclude it from directional labels; do not guess from step appearance alone.
Annotate the visible staircase extent consistently and retain partial-view and
occlusion metadata. Do not label ramps or escalators as stairs.

Collect with consent across different buildings, sessions, camera heights,
approach directions, stair materials, lighting, and viewpoints. Include hard
negative examples such as ramps, escalators, patterned floors, shadows,
reflections/glass, low light, partial views, crowds, and ordinary floor
textures. Group train/validation/test splits by building or recording session,
not randomly by adjacent video frames. Keep real, synthetic, and augmented
data in separate manifests, and report their results separately. Audit class
balance, box bounds, duplicate labels, ambiguous directions, and inter-
annotator disagreements before training. Do not add a third class without
retraining and verifying a new checkpoint.

For a reproducible class-balance report, count images and instances for each
class by split, site/session, source type, lighting, camera height, and
visibility/occlusion. Review duplicate images and split leakage. Double-
annotate a representative difficult subset, adjudicate disagreements, and
record class agreement and box-overlap agreement; set acceptance criteria
before evaluating the held-out set. The checkpoint's original training
configuration and these reports were not supplied, so they are not
reconstructed here.

## Verification and evaluation

Automated endpoint tests:

```powershell
python -m pytest tests\test_staircase_inference.py
node --test tests\camera-session.test.js tests\staircase-decision.test.js tests\companion-ui.test.js
```

Manual checks:

1. Confirm the dashboard has a dedicated Staircase Detection card. Open it and
   confirm detection starts off; start it and grant camera access.
2. Turn detection on and off by button and by each supported voice phrase;
   verify the camera state, displayed results, and spoken state agree.
3. Test approaches from below and above, curved/spiral stairs and landings
   (unsupported classes), varying camera heights, partial views, blur, tilt,
   low light, glare, occlusion, people crossing, ramps, escalators, and
   patterned floors. Verify the model does not claim untrained classes.
4. Verify overlapping competing labels and low scores produce uncertainty;
   require 3/5 before a directional announcement and verify the direction
   switch hysteresis and speech cooldown.
5. Test blank and corrupt images, missing weights, inference exceptions,
   camera permission denial, a stalled permission prompt, a missing/busy camera,
   no video frame, inference timeout, and stopping during startup or an
   in-flight request. Separately verify PathGuide still works without any
   staircase UI or staircase inference.
6. Sustain testing on a real low-memory Android device and record thermal
   behavior as well as latency and memory. Stop if the feature is unstable.

**Measured on the locally supplied checkpoint:** its metadata reports
`0=downstairs`, `1=upstairs`, and
`task=detect`. A synthetic pure-black 416-pixel-wide frame initially produced
an `upstairs` box with score `0.7124`; the low-luminance guard now returns an
ambiguous result without exposing that box. On the development host
(Windows 11, NVIDIA GeForce RTX 2050, Torch 2.5.1+cu121), model load and
warm-up took `9180.36 ms`. Five subsequent API predictions on a synthetic
uniform-gray 416x312 frame returned `none`; latencies were `174.70`, `20.67`,
`17.15`, `19.19`, and `23.04 ms` (sample median `20.67 ms`, maximum
`174.70 ms`). This small synthetic sample is not a p95 or a real-scene
benchmark. Automated endpoint and temporal tests cover route behavior.
**Not measured:** training precision/recall, missed-hazard and false-warning
rates, up/down accuracy, warning lead time, real-device p50/p95 latency, peak
memory, and thermal slowdown. Training-run metrics and dataset sizes were not
provided. No real-world safety or accuracy claim is made.

The current Vercel configuration serves static files and JavaScript APIs; it
does not host this PyTorch/Flask checkpoint service. Run PathGuide through
`launcher.py` (or deploy the existing Flask hub and model as a supported
backend) for this endpoint to be available.
