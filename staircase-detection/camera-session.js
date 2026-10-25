(function (root) {
    'use strict';

    class CameraStartupError extends Error {
        constructor(code, message, cause) {
            super(message);
            this.name = 'CameraStartupError';
            this.code = code;
            if (cause) this.cause = cause;
        }
    }

    function stopTracks(stream) {
        if (stream && typeof stream.getTracks === 'function') {
            stream.getTracks().forEach((track) => track.stop());
        }
    }

    class CameraSession {
        constructor(mediaDevices, options = {}) {
            this.mediaDevices = mediaDevices;
            this.timeoutMs = options.timeoutMs || 15000;
            this.onPendingChange = options.onPendingChange || (() => {});
            this.pendingRequest = null;
            this.generation = 0;
            this.stream = null;
        }

        get isPending() {
            return this.pendingRequest !== null;
        }

        async start(constraints) {
            if (this.stream) return this.stream;
            if (this.pendingRequest) {
                throw new CameraStartupError(
                    'pending',
                    'The previous camera permission request is still pending.'
                );
            }
            if (!this.mediaDevices || typeof this.mediaDevices.getUserMedia !== 'function') {
                throw new CameraStartupError('unavailable', 'Camera access is unavailable.');
            }

            const generation = ++this.generation;
            let request;
            try {
                request = Promise.resolve(this.mediaDevices.getUserMedia(constraints));
            } catch (error) {
                throw this._normalizeError(error);
            }
            this.pendingRequest = request;
            this.onPendingChange(true);

            request.then((stream) => {
                if (generation !== this.generation) stopTracks(stream);
                if (this.pendingRequest === request) {
                    this.pendingRequest = null;
                    this.onPendingChange(false);
                }
            }, () => {
                if (this.pendingRequest === request) {
                    this.pendingRequest = null;
                    this.onPendingChange(false);
                }
            });

            let timeoutId;
            const timeout = new Promise((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new CameraStartupError(
                        'timeout',
                        'The camera permission request timed out.'
                    ));
                }, this.timeoutMs);
            });

            try {
                const stream = await Promise.race([request, timeout]);
                if (generation !== this.generation) {
                    stopTracks(stream);
                    throw new CameraStartupError('cancelled', 'Camera startup was canceled.');
                }
                this.stream = stream;
                return stream;
            } catch (error) {
                const normalized = this._normalizeError(error);
                if (normalized.code === 'timeout' && generation === this.generation) {
                    this.generation += 1;
                }
                throw normalized;
            } finally {
                clearTimeout(timeoutId);
            }
        }

        stop() {
            this.generation += 1;
            stopTracks(this.stream);
            this.stream = null;
        }

        _normalizeError(error) {
            if (error instanceof CameraStartupError) return error;
            const name = error && error.name;
            if (name === 'NotAllowedError' || name === 'SecurityError') {
                return new CameraStartupError(
                    'permission-denied',
                    'Camera permission was denied.',
                    error
                );
            }
            if (name === 'NotFoundError' || name === 'NotReadableError' ||
                name === 'OverconstrainedError' || name === 'TypeError') {
                return new CameraStartupError(
                    'unavailable',
                    'No usable camera is available.',
                    error
                );
            }
            return new CameraStartupError(
                'startup-failed',
                'The camera could not be started.',
                error
            );
        }
    }

    const api = { CameraSession, CameraStartupError };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        root.ArgusCameraSession = api;
    }
})(typeof window !== 'undefined' ? window : globalThis);
