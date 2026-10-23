/**
 * NightVisionCore - Reusable Low-Light Vision Analysis & Adaptive Enhancement Engine
 * Part of Argus.AI Assistive Vision System
 * 
 * Capabilities:
 * 1. Measures mean pixel luminance (range 0.0 - 255.0) using ITU-R BT.601 coefficients.
 * 2. Implements 3 operating modes: AUTO, ON, OFF.
 * 3. Hysteresis-gated state transitions to prevent rapid toggling/flicker.
 * 4. Darkness discrimination (detects near-total darkness / lens occlusion / camera failure).
 * 5. Adaptive Gamma Correction & Knee Curve highlight preservation via precomputed LUT.
 * 6. Software signal amplification disclaimer (does not claim hardware night-vision replacement).
 */

class NightVisionCore {
    constructor(options = {}) {
        // Mode: 'AUTO' | 'ON' | 'OFF'
        this.mode = options.mode || 'AUTO';

        // Configurable Mean Pixel Luminance Thresholds (0.0 to 255.0)
        // Hysteresis window: 40.0 to 52.0 prevents flickering between states
        this.LOW_LIGHT_ENTER = options.lowLightEnter || 40.0;
        this.LOW_LIGHT_EXIT = options.lowLightExit || 52.0;
        this.NEAR_DARKNESS_THRESHOLD = options.nearDarknessThreshold || 8.0;

        // Current Environmental & State Metrics
        this.meanPixelLuminance = 128.0;
        this.isLowLight = false;
        this.isNearDarkness = false;
        this.isEnhancementActive = false;
        this.lastSpokenAnnouncement = "";

        // Reusable Offscreen Canvas for Non-Destructive Model Enhancement
        this.offscreenCanvas = null;
        this.offscreenCtx = null;

        // Callback hooks
        this.onStateChange = options.onStateChange || null;
        this.onSpeechAnnounce = options.onSpeechAnnounce || null;

        // Precompute Gamma & Knee Lookup Tables (LUTs) for O(1) pixel transformation
        this._buildLUTs();
    }

    /**
     * Precomputes lookup tables across 256 byte values for fast rendering
     */
    _buildLUTs() {
        this.luts = {};
        // Common gamma profiles from 0.45 (heavy boost) to 0.85 (mild boost)
        const gammas = [0.45, 0.55, 0.65, 0.75, 0.85];
        gammas.forEach(g => {
            const table = new Uint8Array(256);
            for (let i = 0; i < 256; i++) {
                // Normalized gamma curve
                const norm = i / 255.0;
                let corrected = Math.pow(norm, g) * 255.0;

                // Knee-curve compression above 215 to preserve specular highlights from blowing out
                if (corrected > 215) {
                    const over = corrected - 215;
                    corrected = 215 + over * 0.45;
                }

                table[i] = Math.min(255, Math.max(0, Math.round(corrected)));
            }
            this.luts[g.toFixed(2)] = table;
        });
    }

    /**
     * Sets operating mode: 'AUTO' | 'ON' | 'OFF'
     */
    setMode(newMode) {
        const normalized = (newMode || '').toUpperCase();
        if (!['AUTO', 'ON', 'OFF'].includes(normalized)) {
            console.warn(`[NightVisionCore] Invalid mode: ${newMode}. Defaulting to AUTO.`);
            return;
        }

        if (this.mode !== normalized) {
            this.mode = normalized;
            this.evaluateEnhancementState();

            const announcement = `Night Vision mode set to ${this.mode}.`;
            this._announce(announcement);

            if (this.onStateChange) {
                this.onStateChange(this.getReport());
            }
        }
    }

    /**
     * Measures mean pixel luminance from an RGBA buffer using ITU-R BT.601 coefficients
     * L = 0.299*R + 0.587*G + 0.114*B
     * Samples every `sampleStep` pixel for low CPU overhead (< 1ms per frame)
     */
    calculateMeanLuminance(rgbaData, sampleStep = 16) {
        if (!rgbaData || rgbaData.length < 4) return 128.0;

        let totalLuma = 0;
        let count = 0;
        const len = rgbaData.length;
        const stride = 4 * sampleStep;

        for (let i = 0; i < len; i += stride) {
            const r = rgbaData[i];
            const g = rgbaData[i + 1];
            const b = rgbaData[i + 2];
            totalLuma += 0.299 * r + 0.587 * g + 0.114 * b;
            count++;
        }

        const mean = count > 0 ? totalLuma / count : 128.0;
        this.meanPixelLuminance = Math.round(mean * 10) / 10;
        return this.meanPixelLuminance;
    }

    /**
     * Evaluates whether enhancement should be active based on mode and hysteresis
     */
    evaluateEnhancementState() {
        const prevLowLight = this.isLowLight;
        const prevActive = this.isEnhancementActive;

        // 1. Evaluate near darkness / camera lens covered (black frame)
        this.isNearDarkness = this.meanPixelLuminance < this.NEAR_DARKNESS_THRESHOLD;

        // 2. Evaluate low-light condition using hysteresis
        if (this.isLowLight) {
            // Requires luminance to rise above EXIT threshold to clear low-light flag
            if (this.meanPixelLuminance > this.LOW_LIGHT_EXIT) {
                this.isLowLight = false;
            }
        } else {
            // Requires luminance to fall below ENTER threshold to trigger low-light flag
            if (this.meanPixelLuminance < this.LOW_LIGHT_ENTER) {
                this.isLowLight = true;
            }
        }

        // 3. Resolve active enhancement flag based on mode
        if (this.mode === 'ON') {
            this.isEnhancementActive = true;
        } else if (this.mode === 'OFF') {
            this.isEnhancementActive = false;
        } else {
            // AUTO mode: active only when low-light condition is met
            this.isEnhancementActive = this.isLowLight;
        }

        // 4. Trigger state announcements if mode is AUTO and condition flipped
        if (this.mode === 'AUTO' && this.isLowLight !== prevLowLight) {
            if (this.isLowLight) {
                if (this.isNearDarkness) {
                    this._announce("Scene is near darkness. Visual detection may be unreliable.");
                } else {
                    this._announce("Low light detected. Night vision enhancement active.");
                }
            } else {
                this._announce("Normal lighting restored. Night vision enhancement deactivated.");
            }
        }

        return this.isEnhancementActive;
    }

    /**
     * Processes a source canvas or video frame:
     * - Analyzes luminance
     * - Applies adaptive gamma LUT & knee curve if enhancement is active
     * - Returns an enhanced buffer and comprehensive status report
     */
    processFrame(sourceElement, targetCanvas = null) {
        if (!sourceElement) {
            return { error: 'No source element provided', fallback: true };
        }

        const width = sourceElement.videoWidth || sourceElement.width || 640;
        const height = sourceElement.videoHeight || sourceElement.height || 480;

        // Ensure offscreen canvas exists for intermediate processing
        if (!this.offscreenCanvas) {
            if (typeof document !== 'undefined') {
                this.offscreenCanvas = document.createElement('canvas');
                this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });
            }
        }

        if (this.offscreenCanvas) {
            if (this.offscreenCanvas.width !== width || this.offscreenCanvas.height !== height) {
                this.offscreenCanvas.width = width;
                this.offscreenCanvas.height = height;
            }
        }

        const ctx = this.offscreenCtx || (targetCanvas ? targetCanvas.getContext('2d') : null);
        if (!ctx) {
            return {
                mode: this.mode,
                meanPixelLuminance: this.meanPixelLuminance,
                isEnhancementActive: false,
                fallback: true
            };
        }

        try {
            // 1. Draw source into offscreen context
            ctx.drawImage(sourceElement, 0, 0, width, height);
            const imgData = ctx.getImageData(0, 0, width, height);
            const data = imgData.data;

            // 2. Measure mean pixel luminance
            this.calculateMeanLuminance(data);

            // 3. Resolve active state
            this.evaluateEnhancementState();

            // 4. Apply enhancement if active
            if (this.isEnhancementActive) {
                // Select gamma based on luminance: lower luminance gets lower gamma (stronger boost)
                let selectedGamma = 0.65;
                if (this.meanPixelLuminance < 15) selectedGamma = 0.45;
                else if (this.meanPixelLuminance < 28) selectedGamma = 0.55;
                else if (this.meanPixelLuminance < 40) selectedGamma = 0.65;
                else if (this.meanPixelLuminance < 50) selectedGamma = 0.75;
                else selectedGamma = 0.85;

                const lut = this.luts[selectedGamma.toFixed(2)] || this.luts['0.65'];

                // Apply LUT transformation across RGB channels
                const len = data.length;
                for (let i = 0; i < len; i += 4) {
                    data[i] = lut[data[i]];         // R
                    data[i + 1] = lut[data[i + 1]]; // G
                    data[i + 2] = lut[data[i + 2]]; // B
                    // Alpha left untouched
                }

                ctx.putImageData(imgData, 0, 0);

                // If target canvas was provided, mirror enhanced frame onto it
                if (targetCanvas && targetCanvas !== this.offscreenCanvas) {
                    const tCtx = targetCanvas.getContext('2d');
                    if (tCtx) tCtx.drawImage(this.offscreenCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
                }
            } else if (targetCanvas && targetCanvas !== this.offscreenCanvas) {
                // Inactive: mirror unaltered frame onto target canvas
                const tCtx = targetCanvas.getContext('2d');
                if (tCtx) tCtx.drawImage(sourceElement, 0, 0, targetCanvas.width, targetCanvas.height);
            }

            return this.getReport(this.offscreenCanvas || targetCanvas);

        } catch (err) {
            console.warn("[NightVisionCore] Frame enhancement fallback:", err);
            return {
                mode: this.mode,
                meanPixelLuminance: this.meanPixelLuminance,
                isEnhancementActive: false,
                enhancedCanvas: sourceElement,
                fallback: true,
                error: err.message
            };
        }
    }

    /**
     * Returns structured diagnostic and status payload
     */
    getReport(enhancedCanvas = null) {
        let conditionText = "Normal Lighting";
        let badgeColor = "#00E676"; // Green

        if (this.isNearDarkness) {
            conditionText = "Near Darkness / Lens Occluded";
            badgeColor = "#FF1744"; // Red
        } else if (this.isLowLight) {
            conditionText = "Low Light Detected";
            badgeColor = "#FFD600"; // Yellow
        }

        let statusText = `Night Vision [${this.mode}]`;
        if (this.mode === 'AUTO') {
            statusText += this.isEnhancementActive ? ` • Active (${conditionText})` : ` • Inactive (${conditionText})`;
        } else if (this.mode === 'ON') {
            statusText += ` • Forced ON (${conditionText})`;
        } else {
            statusText += ` • Forced OFF`;
        }

        return {
            mode: this.mode,
            meanPixelLuminance: this.meanPixelLuminance,
            isLowLight: this.isLowLight,
            isNearDarkness: this.isNearDarkness,
            isEnhancementActive: this.isEnhancementActive,
            conditionText,
            badgeColor,
            statusText,
            enhancedCanvas,
            disclaimer: "Software enhancement amplifies pixel signal. It cannot recover optical detail absent from the sensor."
        };
    }

    _announce(text) {
        if (!text || text === this.lastSpokenAnnouncement) return;
        this.lastSpokenAnnouncement = text;
        if (this.onSpeechAnnounce) {
            this.onSpeechAnnounce(text);
        }
    }
}

// Universal Module Definition (Browser global & Node.js)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NightVisionCore;
} else if (typeof window !== 'undefined') {
    window.NightVisionCore = NightVisionCore;
}
