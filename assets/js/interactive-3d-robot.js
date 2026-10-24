/**
 * Argus.AI — Interactive 3D Robot Assistant
 * Procedural 3D Canvas engine with interactive physics, mouse/touch tracking,
 * and situational 3D actions (Idle, Listening, Processing, Speaking, Error).
 */

(function (root) {
  'use strict';

  class Interactive3DRobot {
    constructor(containerId, options = {}) {
      this.container = document.getElementById(containerId);
      if (!this.container) return;

      this.width = options.width || 280;
      this.height = options.height || 280;
      this.state = 'idle'; // idle | listening | listening-wake | processing | speaking | error
      this.targetState = 'idle';

      // 3D Rotation & Pointer tracking
      this.yaw = 0;          // Left-Right rotation (-0.4 to 0.4 rad)
      this.pitch = 0;        // Up-Down rotation (-0.25 to 0.25 rad)
      this.targetYaw = 0;
      this.targetPitch = 0;
      this.roll = 0;

      // Situational Action State Timers & Physics
      this.time = 0;
      this.blinkTimer = 180;
      this.isBlinking = false;
      this.scanOffset = 0;
      this.wavePulse = 0;
      this.hoverActive = false;

      // Mouse tracking bounds
      this.mouseX = 0;
      this.mouseY = 0;

      this._initCanvas();
      this._bindEvents();
      this._startLoop();
    }

    _initCanvas() {
      // Clear container and inject Canvas with ambient glow
      this.container.innerHTML = `
        <div class="robot-interactive-wrapper" style="position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; cursor: pointer;" role="img" aria-label="Interactive 3D Argus robot companion. Responds to voice and touch.">
          <div class="robot-ambient-glow" id="robot-3d-glow" aria-hidden="true" style="position: absolute; width: 220px; height: 220px; border-radius: 50%; background: radial-gradient(circle, rgba(0, 242, 254, 0.28) 0%, rgba(94, 234, 212, 0.12) 45%, transparent 70%); filter: blur(24px); pointer-events: none; transition: background 0.4s ease;"></div>
          <canvas id="robot-3d-canvas" width="${this.width * 2}" height="${this.height * 2}" style="width: ${this.width}px; height: ${this.height}px; display: block; z-index: 2;"></canvas>
        </div>
      `;

      this.canvas = document.getElementById('robot-3d-canvas');
      this.ctx = this.canvas.getContext('2d');
      this.glowElem = document.getElementById('robot-3d-glow');
    }

    _bindEvents() {
      // Track mouse/pointer to rotate head in 3D
      window.addEventListener('mousemove', (e) => {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = (e.clientX - centerX) / (window.innerWidth / 2);
        const dy = (e.clientY - centerY) / (window.innerHeight / 2);

        this.targetYaw = Math.max(-0.45, Math.min(0.45, dx * 0.55));
        this.targetPitch = Math.max(-0.28, Math.min(0.28, dy * 0.45));
      });

      // Touch tracking on mobile
      window.addEventListener('touchmove', (e) => {
        if (!e.touches || e.touches.length === 0 || !this.canvas) return;
        const touch = e.touches[0];
        const rect = this.canvas.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = (touch.clientX - centerX) / (window.innerWidth / 2);
        const dy = (touch.clientY - centerY) / (window.innerHeight / 2);

        this.targetYaw = Math.max(-0.4, Math.min(0.4, dx * 0.5));
        this.targetPitch = Math.max(-0.25, Math.min(0.25, dy * 0.4));
      }, { passive: true });

      // Click/Tap reaction: triggers cheerful nod and triggers companion speech/listening if idle
      if (this.canvas) {
        this.canvas.addEventListener('click', () => {
          this.targetPitch = -0.2;
          this.roll = (Math.random() > 0.5 ? 0.15 : -0.15);
          setTimeout(() => {
            this.targetPitch = 0;
            this.roll = 0;
          }, 350);

          if (window.argusCompanion && typeof window.argusCompanion.handleTapToSpeakClick === 'function') {
            if (this.state === 'idle') {
              window.argusCompanion.handleTapToSpeakClick();
            }
          }
        });
      }
    }

    setState(newState, statusText = '') {
      this.state = newState;
      this._updateAura(newState);
    }

    _updateAura(state) {
      if (!this.glowElem) return;
      if (state === 'listening' || state === 'listening-wake') {
        this.glowElem.style.background = 'radial-gradient(circle, rgba(0, 242, 254, 0.45) 0%, rgba(0, 210, 255, 0.20) 50%, transparent 72%)';
      } else if (state === 'speaking') {
        this.glowElem.style.background = 'radial-gradient(circle, rgba(94, 234, 212, 0.45) 0%, rgba(0, 242, 254, 0.22) 50%, transparent 72%)';
      } else if (state === 'processing') {
        this.glowElem.style.background = 'radial-gradient(circle, rgba(14, 165, 233, 0.42) 0%, rgba(99, 102, 241, 0.22) 50%, transparent 72%)';
      } else if (state === 'error') {
        this.glowElem.style.background = 'radial-gradient(circle, rgba(245, 158, 11, 0.38) 0%, rgba(239, 68, 68, 0.18) 50%, transparent 72%)';
      } else {
        this.glowElem.style.background = 'radial-gradient(circle, rgba(0, 242, 254, 0.28) 0%, rgba(94, 234, 212, 0.12) 45%, transparent 70%)';
      }
    }

    _startLoop() {
      const render = () => {
        this._updatePhysics();
        this._draw();
        requestAnimationFrame(render);
      };
      requestAnimationFrame(render);
    }

    _updatePhysics() {
      this.time += 0.035;

      // Smooth pointer interpolation
      this.yaw += (this.targetYaw - this.yaw) * 0.08;
      this.pitch += (this.targetPitch - this.pitch) * 0.08;
      this.roll += (0 - this.roll) * 0.06;

      // Random Blink Timer
      this.blinkTimer--;
      if (this.blinkTimer <= 0) {
        this.isBlinking = true;
        if (this.blinkTimer < -6) {
          this.isBlinking = false;
          this.blinkTimer = Math.floor(140 + Math.random() * 220);
        }
      }

      // Situational dynamic variables
      if (this.state === 'listening' || this.state === 'listening-wake') {
        this.wavePulse = (this.wavePulse + 0.08) % (Math.PI * 2);
      } else if (this.state === 'processing') {
        this.scanOffset = Math.sin(this.time * 3.5) * 32;
      } else if (this.state === 'speaking') {
        this.wavePulse += 0.22;
      }
    }

    _draw() {
      if (!this.ctx || !this.canvas) return;
      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;

      ctx.clearRect(0, 0, w, h);

      ctx.save();
      ctx.scale(2, 2); // Retina 2x coordinate system (0 to 280)

      const cx = 140;
      let cy = 138;

      // 1. Situational Motion & Floating Offset
      let floatY = Math.sin(this.time * 1.5) * 4.5;
      let bodyTilt = this.yaw * 12;

      if (this.state === 'listening' || this.state === 'listening-wake') {
        // Lean forward attentively towards user in 3D perspective
        cy += 4;
        floatY = Math.sin(this.time * 2.5) * 2;
      } else if (this.state === 'speaking') {
        // Rhythmic gentle nodding
        floatY = Math.sin(this.time * 4) * 3.5;
      } else if (this.state === 'processing') {
        // Subtle rotational thinking tilt
        bodyTilt += Math.sin(this.time * 2.5) * 5;
      } else if (this.state === 'error') {
        // Inquisitive head tilt
        bodyTilt += 8;
      }

      const headX = cx + this.yaw * 24;
      const headY = cy + floatY + this.pitch * 18;

      // 2. Soft Shadow beneath Robot
      const shadowW = Math.max(70, 96 - floatY * 2.5);
      const shadowGrad = ctx.createRadialGradient(cx, 245, 10, cx, 245, shadowW / 2);
      shadowGrad.addColorStop(0, 'rgba(15, 23, 42, 0.18)');
      shadowGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = shadowGrad;
      ctx.beginPath();
      ctx.ellipse(cx, 245, shadowW / 2, 9, 0, 0, Math.PI * 2);
      ctx.fill();

      // 3. Antenna Rod & Glowing Situational Beacon
      this._drawAntenna(ctx, headX, headY, bodyTilt);

      // 4. Head Shell (Pearl White with 3D Specular Shading)
      this._drawHead(ctx, headX, headY, bodyTilt);

      // 5. Visor Screen & Situational Eyes/Waveforms
      this._drawVisor(ctx, headX, headY, bodyTilt);

      // 6. Cute Floating Pearl-White Hands
      this._drawHands(ctx, cx, cy, floatY);

      ctx.restore();
    }

    _drawAntenna(ctx, hx, hy, tilt) {
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate((tilt * Math.PI) / 180);

      // Antenna Rod
      ctx.strokeStyle = '#94A3B8';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, -68);
      ctx.lineTo(0, -90);
      ctx.stroke();

      // Top Beacon (Radiates energy pulse when listening)
      const beaconRadius = (this.state === 'listening' || this.state === 'listening-wake')
        ? 6 + Math.sin(this.wavePulse) * 1.5
        : 5.5;

      // Energy Pulse Rings when listening
      if (this.state === 'listening' || this.state === 'listening-wake') {
        const ringRad = 9 + ((this.time * 25) % 18);
        const ringAlpha = Math.max(0, 1 - ringRad / 27);
        ctx.strokeStyle = `rgba(0, 242, 254, ${ringAlpha})`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(0, -92, ringRad, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Beacon Sphere Gradient
      const beaconGrad = ctx.createRadialGradient(-1.5, -93.5, 1, 0, -92, beaconRadius);
      if (this.state === 'error') {
        beaconGrad.addColorStop(0, '#FDE68A');
        beaconGrad.addColorStop(0.6, '#F59E0B');
        beaconGrad.addColorStop(1, '#D97706');
      } else {
        beaconGrad.addColorStop(0, '#A7F3D0');
        beaconGrad.addColorStop(0.5, '#00F2FE');
        beaconGrad.addColorStop(1, '#0284C7');
      }

      ctx.fillStyle = beaconGrad;
      ctx.shadowColor = (this.state === 'error') ? '#F59E0B' : '#00F2FE';
      ctx.shadowBlur = (this.state === 'listening') ? 16 : 8;
      ctx.beginPath();
      ctx.arc(0, -92, beaconRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.restore();
    }

    _drawHead(ctx, hx, hy, tilt) {
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate((tilt * Math.PI) / 180);

      // 1. Ear Sensors / Sound Cups (Cyan Accent Rings)
      const earW = 9;
      const earH = 34;
      const earGrad = ctx.createLinearGradient(-75, 0, 75, 0);
      earGrad.addColorStop(0, '#0284C7');
      earGrad.addColorStop(0.5, '#00F2FE');
      earGrad.addColorStop(1, '#0284C7');

      // Left Ear
      ctx.fillStyle = '#0F172A';
      ctx.strokeStyle = (this.state === 'listening') ? '#00F2FE' : 'rgba(0, 242, 254, 0.5)';
      ctx.lineWidth = 2;
      this._roundRect(ctx, -74, -18, earW, earH, 5, true, true);

      // Right Ear
      this._roundRect(ctx, 65, -18, earW, earH, 5, true, true);

      // 2. Head Spherical Body (Pearl White with Multi-Stop 3D Light)
      const headRadiusX = 66;
      const headRadiusY = 62;

      const headGrad = ctx.createRadialGradient(-18, -24, 8, 0, 0, 70);
      headGrad.addColorStop(0, '#FFFFFF');         // Specular highlight
      headGrad.addColorStop(0.35, '#F8FAFC');      // Pure pearl white
      headGrad.addColorStop(0.75, '#E2E8F0');      // Soft curvature shadow
      headGrad.addColorStop(1, '#CBD5E1');         // Occlusion rim

      ctx.fillStyle = headGrad;
      ctx.shadowColor = 'rgba(15, 23, 42, 0.12)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 8;

      ctx.beginPath();
      ctx.ellipse(0, 0, headRadiusX, headRadiusY, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // Subtle cyan contour rim border
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.28)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.restore();
    }

    _drawVisor(ctx, hx, hy, tilt) {
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate((tilt * Math.PI) / 180);

      // Visor Perspective Offset based on 3D tracking
      const vx = this.yaw * 14;
      const vy = -4 + this.pitch * 10;
      const vw = 86;
      const vh = 56;

      // 1. Dark Visor Screen Shell
      const visorGrad = ctx.createLinearGradient(0, vy - 28, 0, vy + 28);
      visorGrad.addColorStop(0, '#0F172A');
      visorGrad.addColorStop(0.7, '#020617');
      visorGrad.addColorStop(1, '#000000');

      ctx.fillStyle = visorGrad;
      ctx.strokeStyle = 'rgba(0, 242, 254, 0.35)';
      ctx.lineWidth = 1.5;
      this._roundRect(ctx, vx - vw / 2, vy - vh / 2, vw, vh, 24, true, true);

      // 2. Visor Curved Glass Specular Sheen Reflection
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(vx - 14, vy - 14, 22, 9, -0.25, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.fill();
      ctx.restore();

      // 3. Situational Visor Content: Eyes, Scanning Laser, or Speech Wave
      ctx.save();
      ctx.beginPath();
      this._roundRect(ctx, vx - vw / 2 + 3, vy - vh / 2 + 3, vw - 6, vh - 6, 21, false, false);
      ctx.clip(); // Clip inside visor glass

      if (this.state === 'processing') {
        // Horizontal Scanning Laser Beam (Cybernetic AI Thinking)
        this._drawProcessingScan(ctx, vx, vy);
      } else if (this.state === 'speaking') {
        // Animated Speech Waveform on Visor
        this._drawSpeakingWave(ctx, vx, vy);
      } else {
        // Glowing Expressive Cyan Eyes (Idle, Listening, or Error)
        this._drawEyes(ctx, vx, vy);
      }

      ctx.restore();
      ctx.restore();
    }

    _drawEyes(ctx, vx, vy) {
      const eyeSpacing = 19;
      const eyeY = vy - 1;
      let eyeW = 9.5;
      let eyeH = 13.5;

      // Blink animation
      if (this.isBlinking) {
        eyeH = 1.8;
      } else if (this.state === 'listening' || this.state === 'listening-wake') {
        // Wide alert curious eyes
        eyeW = 11;
        eyeH = 15;
      }

      const isError = (this.state === 'error');
      const eyeColor = isError ? '#F59E0B' : '#00F2FE';
      const eyeGlow = isError ? 'rgba(245, 158, 11, 0.65)' : 'rgba(0, 242, 254, 0.75)';

      ctx.fillStyle = eyeColor;
      ctx.shadowColor = eyeGlow;
      ctx.shadowBlur = 12;

      // Left Eye
      ctx.beginPath();
      ctx.ellipse(vx - eyeSpacing, eyeY, eyeW, eyeH, 0, 0, Math.PI * 2);
      ctx.fill();

      // Right Eye
      ctx.beginPath();
      ctx.ellipse(vx + eyeSpacing, eyeY, eyeW, eyeH, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cute inner pupil gleam
      if (!this.isBlinking) {
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(vx - eyeSpacing + 2, eyeY - 3, 2.8, 0, Math.PI * 2);
        ctx.arc(vx + eyeSpacing + 2, eyeY - 3, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.shadowBlur = 0;
    }

    _drawProcessingScan(ctx, vx, vy) {
      // Sweeping horizontal cyan laser
      const laserX = vx + this.scanOffset;
      const grad = ctx.createLinearGradient(laserX - 22, 0, laserX + 22, 0);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(0.5, '#00F2FE');
      grad.addColorStop(1, 'transparent');

      ctx.fillStyle = grad;
      ctx.shadowColor = '#00F2FE';
      ctx.shadowBlur = 14;
      ctx.fillRect(laserX - 22, vy - 14, 44, 28);
      ctx.shadowBlur = 0;

      // Center bright laser line
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(laserX, vy - 18);
      ctx.lineTo(laserX, vy + 18);
      ctx.stroke();
    }

    _drawSpeakingWave(ctx, vx, vy) {
      // Cute animated audio equalizer wave
      const bars = 7;
      const barW = 4;
      const gap = 3.5;
      const totalW = bars * barW + (bars - 1) * gap;
      const startX = vx - totalW / 2;

      ctx.fillStyle = '#5EEAD4';
      ctx.shadowColor = '#00F2FE';
      ctx.shadowBlur = 10;

      for (let i = 0; i < bars; i++) {
        const heightFactor = Math.abs(Math.sin(this.wavePulse + i * 0.75));
        const barH = 5 + heightFactor * 18;
        const x = startX + i * (barW + gap);
        const y = vy - barH / 2;
        this._roundRect(ctx, x, y, barW, barH, 2, true, false);
      }
      ctx.shadowBlur = 0;
    }

    _drawHands(ctx, cx, cy, floatY) {
      ctx.save();

      // Floating Hands Pearl White Gradient
      const handGrad = ctx.createRadialGradient(-3, -3, 2, 0, 0, 14);
      handGrad.addColorStop(0, '#FFFFFF');
      handGrad.addColorStop(0.7, '#F1F5F9');
      handGrad.addColorStop(1, '#CBD5E1');

      // Left Hand (Friendly Wave or Gentle Float)
      let leftHandX = cx - 82 + this.yaw * 10;
      let leftHandY = cy + 42 + Math.sin(this.time * 2 + 1) * 3.5;

      ctx.translate(leftHandX, leftHandY);
      ctx.fillStyle = handGrad;
      ctx.shadowColor = 'rgba(15, 23, 42, 0.1)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.ellipse(0, 0, 12, 11, -0.2, 0, Math.PI * 2);
      ctx.fill();

      // Right Hand (Waving in friendly greeting)
      ctx.restore();
      ctx.save();
      let rightHandX = cx + 82 + this.yaw * 10;
      let rightHandY = cy + 40 + Math.sin(this.time * 2 + 2) * 3.5;

      if (this.state === 'speaking') {
        rightHandY += Math.sin(this.time * 6) * 6; // Active gesturing
      }

      ctx.translate(rightHandX, rightHandY);
      ctx.fillStyle = handGrad;
      ctx.shadowColor = 'rgba(15, 23, 42, 0.1)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.ellipse(0, 0, 12, 11, 0.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    _roundRect(ctx, x, y, width, height, radius, fill, stroke) {
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.lineTo(x + width - radius, y);
      ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
      ctx.lineTo(x + width, y + height - radius);
      ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      ctx.lineTo(x + radius, y + height);
      ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.closePath();
      if (fill) ctx.fill();
      if (stroke) ctx.stroke();
    }
  }

  // Export to global scope
  if (typeof window !== 'undefined') {
    window.Interactive3DRobot = Interactive3DRobot;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Interactive3DRobot };
  }
})(typeof window !== 'undefined' ? window : global);
