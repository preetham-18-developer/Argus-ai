(function (root) {
  'use strict';

  const DIRECTIONS = new Set(['downstairs', 'upstairs']);

  class StaircaseDecision {
    constructor(options = {}) {
      this.windowSize = options.windowSize || 5;
      this.confirmationHits = options.confirmationHits || 3;
      this.directionSwitchHits = options.directionSwitchHits || 4;
      this.cooldownMs = options.cooldownMs || 8000;
      this.clock = options.clock || (() => Date.now());
      this.reset();
    }

    reset() {
      this.history = [];
      this.currentDirection = null;
      this.lastAnnouncementKey = '';
      this.lastAnnouncementTime = 0;
      this.state = 'NONE';
    }

    update(result, options = {}) {
      const now = Number.isFinite(options.now) ? options.now : this.clock();
      if (!result || result.status === 'error' || options.unavailable) {
        this.history.push({ label: null, observed: false, status: 'error' });
        this._trimHistory();
        this.state = 'UNCERTAIN';
        return this._result(
          'UNCERTAIN',
          null,
          'unavailable',
          'Staircase detection is unavailable. Do not rely on it.',
          now
        );
      }

      if (!['detected', 'ambiguous', 'none'].includes(result.status) ||
          !Array.isArray(result.detections)) {
        throw new TypeError('Invalid staircase inference response.');
      }

      if (result.status === 'ambiguous' && result.detections.length === 0) {
        this.history.push({ label: null, observed: true, status: 'ambiguous' });
        this._trimHistory();
        this.state = 'UNCERTAIN';
        return this._result(
          'UNCERTAIN',
          null,
          'camera-view-unclear',
          'Camera view is unclear. Staircase detection may be unreliable.',
          now
        );
      }

      const primary = result.detections.find((item) =>
        item && DIRECTIONS.has(item.label) && Number.isFinite(item.confidence)
      );
      const label = result.status === 'detected' && primary ? primary.label : null;
      this.history.push({
        label,
        observed: result.status !== 'none' && result.detections.length > 0,
        status: result.status
      });
      this._trimHistory();

      const counts = { downstairs: 0, upstairs: 0 };
      this.history.forEach((frame) => {
        if (frame.label) counts[frame.label] += 1;
      });

      let direction = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
      const directionHits = counts[direction];
      if (directionHits >= this.confirmationHits) {
        const switching = this.currentDirection && direction !== this.currentDirection;
        const requiredHits = switching ? this.directionSwitchHits : this.confirmationHits;
        if (directionHits >= requiredHits) {
          this.currentDirection = direction;
          this.state = 'CONFIRMED';
          const phrase = direction === 'downstairs'
            ? 'Stairs may be going down ahead. Stop and check.'
            : 'Stairs may be going up ahead. Stop and check.';
          return this._result(this.state, direction, `direction-${direction}`, phrase, now);
        }
      }

      const observedFrames = this.history.filter((frame) => frame.observed).length;
      if (observedFrames > 0) {
        this.state = 'HYPOTHESIS';
        return this._result(
          this.state,
          null,
          'direction-uncertain',
          'Stair direction is uncertain. Stop and check carefully.',
          now
        );
      }

      const missedFrames = this.history.filter((frame) => frame.status === 'none').length;
      this.state = missedFrames >= this.confirmationHits ? 'NONE' : 'UNCERTAIN';
      const announcement = this.state === 'NONE' ? 'No stairs detected in this view.' : null;
      return this._result(this.state, null, this.state.toLowerCase(), announcement, now);
    }

    _trimHistory() {
      this.history = this.history.slice(-this.windowSize);
    }

    _result(state, className, key, message, now) {
      let announcement = null;
      if (message && (
        key !== this.lastAnnouncementKey ||
        now - this.lastAnnouncementTime >= this.cooldownMs
      )) {
        announcement = message;
        this.lastAnnouncementKey = key;
        this.lastAnnouncementTime = now;
      }
      return { state, className, announcement };
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { StaircaseDecision };
  } else {
    root.StaircaseDecision = StaircaseDecision;
  }
})(typeof window !== 'undefined' ? window : globalThis);
