/**
 * Argus.AI — Companion Controller (Phase D: Natural Wake Word + Light UI + Robust Routes)
 * Manages homepage single-page assistive companion interaction:
 * - Hands-Free "Hey Argus" two-stage voice engine:
 *   1. WAKE STAGE: Listens for "Hey Argus" / "Argus" with automatic timeout recovery.
 *   2. GREETING STAGE: Greets user by saved name: "I'm here, Prem. What kind of help do you need?"
 *   3. COMMAND STAGE: Acoustic guard delay (prevents audio feedback loops), then listens for module command.
 *   4. NAVIGATION STAGE: Spoken confirmation and clean navigation to all verified routes.
 * - Manual "Tap to Speak" button integration for accessible alternative.
 * - Comprehensive command dictionary & natural spoken aliases for all 6 modules, SOS, and Profile.
 * - Reliable navigation to percent-encoded canonical routes (`Visual%20Explanation`, `Camera%20Check`, Night Vision `mode=ON`).
 * - Modal lock preventing speech collisions when Profile or SOS dialog is active.
 * - Full status transitions: Ready, Listening, Processing, Speaking, Error.
 */

(function (root) {
  'use strict';

  class ArgusCompanionController {
    constructor() {
      this.speechService = null;
      this.isListening = false;
      this.isSpeaking = false;
      this.wakeWordEnabled = false;
      this.isListeningWakeWord = false;
      this.isListeningCommand = false;
      this._isStartingListening = false;
      this.currentState = 'idle'; // idle | listening-wake | listening | processing | speaking | error

      this.commandTimeoutTimer = null;
      this.wakeRestartTimer = null;

      // DOM Elements
      this.robotStage = null;
      this.robotStatusPill = null;
      this.robotStatusText = null;
      this.robotGreeting = null;
      this.tapButton = null;
      this.tapButtonLabel = null;
      this.voiceHintText = null;
      this.transcriptCard = null;
      this.transcriptText = null;
      this.profileHeaderBtn = null;
      this.profileNameLabel = null;
      this.wakeToggleBtn = null;
      this.wakeToggleLabel = null;

      // Verified Canonical Routes & Comprehensive Command Aliases
      this.routes = [
        {
          id: 'pathguide',
          name: 'PathGuide Pro',
          url: './Night-Vision/index.html',
          regex: /(open pathguide|start pathguide|pathguide pro|pathguide|path guide|navigation mode|walking guidance|start navigation|navigate|obstacle awareness|obstacles)/i,
          spokenConfirm: 'Starting PathGuide Pro navigation.'
        },
        {
          id: 'object-detection',
          name: 'Object Detection Pro',
          url: './object-detection-pro/index.html',
          regex: /(open object detection|start object detection|object detection pro|object detection|object detector|detect objects?|identify objects?|find objects?|object scanner)/i,
          spokenConfirm: 'Opening Object Detection Pro.'
        },
        {
          id: 'visionaid',
          name: 'VisionAid AI',
          url: './Visual%20Explanation/index.html',
          regex: /(open visionaid|start visionaid|open vision aid|start vision aid|visionaid ai|visionaid|vision aid|visual explanation|explain surroundings|explain my surroundings|describe scene|describe surroundings|read text|read document|medicine scanner|multimodal)/i,
          spokenConfirm: 'Opening VisionAid AI.'
        },
        {
          id: 'queue-detector',
          name: 'Queue Detector',
          url: './queue-detection/index.html',
          regex: /(open queue detector|start queue detector|open queue|start queue|check queue|check the queue|queue detector|queue detection|detect people in line|people in line|distance tracker|track queue|check line|line check|queue)/i,
          spokenConfirm: 'Opening Queue Detector.'
        },
        {
          id: 'optima-vision',
          name: 'Optima Vision',
          url: './Camera%20Check/index.html',
          regex: /(open optima vision|start optima vision|open optima|start optima|check camera quality|camera quality|check camera|check lens|check visibility|optima vision|optima|camera check|optical monitor|blur check)/i,
          spokenConfirm: 'Opening Optima Vision camera check.'
        },
        {
          id: 'night-vision',
          name: 'Night Vision',
          url: './Night-Vision/index.html?mode=ON',
          regex: /(turn on night vision|turn night vision on|activate night vision|enable night vision|start night vision|open night vision|night vision|night mode|dark mode|low light mode|photon enhancement)/i,
          spokenConfirm: 'Turning on Night Vision mode.'
        },
        {
          id: 'emergency-sos',
          name: 'Emergency SOS',
          action: () => {
            if (typeof root.triggerEmergencySOS === 'function') {
              root.triggerEmergencySOS();
            }
          },
          regex: /(emergency sos|call my emergency contact|call emergency contact|trigger emergency sos|trigger sos|help me|call 112|send help|danger|emergency)/i,
          spokenConfirm: 'Opening Emergency SOS. You have 5 seconds to cancel.'
        },
        {
          id: 'profile-setup',
          name: 'Profile Setup',
          action: () => {
            if (typeof root.openProfileModalSafe === 'function') {
              root.openProfileModalSafe();
            } else if (root.argusProfileUI && typeof root.argusProfileUI.openModal === 'function') {
              root.argusProfileUI.openModal();
            }
          },
          regex: /(open my profile|open profile|edit my details|set up profile|edit profile|change my name|profile settings|user profile|my profile)/i,
          spokenConfirm: 'Opening your profile settings.'
        }
      ];

      this._init();
    }

    _init() {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this._bind());
      } else {
        this._bind();
      }
    }

    _bind() {
      // Cache DOM elements
      this.robotStage = document.getElementById('companion-robot-stage');
      this.robotStatusPill = document.getElementById('companion-robot-status');
      this.robotStatusText = document.getElementById('companion-status-text');
      this.robotGreeting = document.getElementById('companion-greeting-text');
      this.tapButton = document.getElementById('btn-tap-to-speak');
      this.tapButtonLabel = document.getElementById('tap-to-speak-label');
      this.voiceHintText = document.getElementById('voice-hint-text');
      this.transcriptCard = document.getElementById('voice-transcript-card');
      this.transcriptText = document.getElementById('voice-transcript-text');
      this.profileHeaderBtn = document.getElementById('btn-header-profile');
      this.profileNameLabel = document.getElementById('header-profile-name');
      this.wakeToggleBtn = document.getElementById('btn-wake-toggle');
      this.wakeToggleLabel = document.getElementById('wake-toggle-label');

      // Initialize speech coordination
      this._initSpeechService();

      // Bind Tap to Speak button
      if (this.tapButton) {
        this.tapButton.addEventListener('click', (e) => {
          e.preventDefault();
          this.handleTapToSpeak();
        });

        this.tapButton.addEventListener('keydown', (e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            this.handleTapToSpeak();
          }
        });
      }

      // Bind Hands-Free "Hey Argus" Toggle button
      if (this.wakeToggleBtn) {
        this.wakeToggleBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.toggleWakeWord();
        });
      }

      // Sync user profile display name
      this.syncUserProfile();

      // Restore saved Hands-Free preference if previously enabled
      try {
        const savedWake = localStorage.getItem('argus_wake_word_enabled');
        if (savedWake === 'true') {
          // Defer activation slightly to let page settle
          setTimeout(() => {
            this.toggleWakeWord(true, false);
          }, 600);
        }
      } catch (e) {}

      // Listen for profile save events
      if (typeof window !== 'undefined') {
        window.addEventListener('storage', (e) => {
          if (e.key === 'argus_user_profile') {
            this.syncUserProfile();
          }
        });
        window.addEventListener('argus_profile_updated', () => {
          this.syncUserProfile();
        });
      }

      // Fast periodic check (600ms) to ensure instantaneous update across all components
      if (typeof root !== 'undefined' && typeof root.setInterval === 'function') {
        const syncTimer = root.setInterval(() => this.syncUserProfile(), 600);
        if (syncTimer && typeof syncTimer.unref === 'function') {
          syncTimer.unref();
        }
      }
    }

    _initSpeechService() {
      const ArgusProfile = root.ArgusProfile;
      if (!ArgusProfile || !ArgusProfile.ArgusSpeechService) {
        console.warn('[ArgusCompanion] ArgusProfile.ArgusSpeechService not found.');
        return;
      }

      // Reuse existing speech service instance if already present
      if (root.argusProfileUI && root.argusProfileUI.speechService) {
        this.speechService = root.argusProfileUI.speechService;
      } else {
        this.speechService = new ArgusProfile.ArgusSpeechService({
          onListeningChange: (listening) => this._onListeningChange(listening),
          onSpeakingChange: (speaking) => this._onSpeakingChange(speaking),
          onError: (errMsg) => this._onError(errMsg)
        });
      }
    }

    syncUserProfile() {
      const ArgusProfile = root.ArgusProfile;
      if (!ArgusProfile || !ArgusProfile.ProfileStorage) return;

      const storage = (typeof root !== 'undefined' && root.localStorage) ? root.localStorage : undefined;
      const profile = ArgusProfile.ProfileStorage.loadProfile(storage);
      const hasName = profile && profile.displayName && profile.displayName.trim().length > 0;
      const displayName = hasName ? profile.displayName.trim() : '';

      // Update greeting in DOM
      const greetingNameElem = document.getElementById('hero-greeting-name');
      if (greetingNameElem) {
        greetingNameElem.textContent = hasName ? displayName : 'there';
      }

      if (this.robotGreeting) {
        if (hasName) {
          this.robotGreeting.innerHTML = `Hi <span id="hero-greeting-name" class="greeting-name-highlight">${this._escapeHTML(displayName)}</span>,<br>I'm Argus.`;
        } else {
          this.robotGreeting.innerHTML = `Hi <span id="hero-greeting-name" class="greeting-name-highlight">there</span>,<br>I'm Argus.`;
        }
      }

      // Update header profile button
      if (this.profileNameLabel) {
        this.profileNameLabel.textContent = hasName ? displayName : 'Profile';
      }
    }

    getUserDisplayName() {
      try {
        const ArgusProfile = root.ArgusProfile;
        if (!ArgusProfile || !ArgusProfile.ProfileStorage) return '';
        const storage = (typeof root !== 'undefined' && root.localStorage) ? root.localStorage : undefined;
        const profile = ArgusProfile.ProfileStorage.loadProfile(storage);
        if (profile && profile.displayName && profile.displayName.trim().length > 0) {
          return profile.displayName.trim();
        }
      } catch (e) {}
      return '';
    }

    /**
     * Checks if either Profile or Emergency SOS modal is currently active
     */
    isModalActive() {
      const profileModal = document.getElementById('argus-profile-modal-overlay');
      if (profileModal && profileModal.classList.contains('active')) return true;

      const sosModal = document.getElementById('sos-modal-overlay');
      if (sosModal && sosModal.classList.contains('active')) return true;

      return false;
    }

    /**
     * Toggles Hands-Free "Hey Argus" listening mode
     */
    toggleWakeWord(forceState) {
      if (this.isModalActive()) return;

      if (!this.speechService || !this.speechService.isSupported()) {
        this.setRobotState('error', 'Speech not supported in browser');
        this.setTranscript('Hands-free mode requires Speech Recognition support (Google Chrome or Microsoft Edge).');
        if (this.wakeToggleLabel) {
          this.wakeToggleLabel.textContent = 'Speech Not Supported';
        }
        return;
      }

      const nextState = (typeof forceState === 'boolean') ? forceState : !this.wakeWordEnabled;
      this.wakeWordEnabled = nextState;

      try {
        localStorage.setItem('argus_wake_word_enabled', nextState ? 'true' : 'false');
      } catch (e) {}

      // Update toggle button UI
      if (this.wakeToggleBtn) {
        this.wakeToggleBtn.classList.toggle('is-active', nextState);
        this.wakeToggleBtn.setAttribute('aria-pressed', nextState ? 'true' : 'false');
      }

      if (nextState) {
        if (this.wakeToggleLabel) {
          this.wakeToggleLabel.textContent = 'Hands-Free: Starting Microphone...';
        }
        this.setRobotState('processing', 'Starting microphone...');
        this.setTranscript('Requesting microphone access for Hands-Free mode...');

        // Start listening directly without blocking speech delay
        this.startWakeWordListening();
      } else {
        // Disabled
        this._stopAllListening();
        if (this.wakeToggleLabel) {
          this.wakeToggleLabel.textContent = 'Hands-Free: Tap to Enable "Hey Argus"';
        }
        this.setRobotState('idle', 'Ready');
        this.setTranscript('Hands-Free Mode disabled. Tap to Speak is always available.');
      }
    }

    /**
     * Starts listening strictly for the wake word: "Hey Argus" or "Argus"
     */
    startWakeWordListening() {
      if (!this.wakeWordEnabled || this.isModalActive() || this.isSpeaking) {
        return;
      }

      if (!this.speechService || !this.speechService.isSupported()) return;

      this.isListeningWakeWord = true;
      this.isListeningCommand = false;

      // Clearly indicate microphone starting state until onstart confirms listening
      if (this.currentState !== 'listening-wake') {
        this.setRobotState('processing', 'Starting microphone...');
        if (this.wakeToggleLabel) {
          this.wakeToggleLabel.textContent = 'Hands-Free: Starting Microphone...';
        }
      }

      this.speechService.startListening((transcript, isFinal) => {
        this.handleWakeSpeechResult(transcript, isFinal);
      }, { isWakeWord: true });
    }

    /**
     * Handles speech recognition events during Wake Word mode
     */
    handleWakeSpeechResult(transcript, isFinal) {
      if (!transcript || !this.isListeningWakeWord) return;

      const normalized = this._normalizeCommand(transcript);

      // Check if user directly spoke a full command with wake prefix (e.g. "Hey Argus open VisionAid")
      const matched = this._resolveCommand(normalized);
      if (matched) {
        this._stopAllListening();
        this.setRobotState('processing', 'Processing command...');
        this.processVoiceCommand(transcript);
        return;
      }

      // Check if user spoke the wake word
      if (this._detectWakeWord(transcript) || this._detectWakeWord(normalized)) {
        // WAKE WORD DETECTED!
        this._triggerWakeWordReaction();
        return;
      }

      if (isFinal) {
        // Not a wake word; remain in wake listening state
        this.setRobotState('listening-wake', 'Listening for "Hey Argus"...');
      }
    }

    _detectWakeWord(normalizedText) {
      if (!normalizedText) return false;
      return /\b(hey\s+argus|hi\s+argus|hello\s+argus|ok\s+argus|okay\s+argus|argus|argos|august|argo)\b/i.test(normalizedText);
    }

    /**
     * Executes conversational reaction when voice interaction or "Hey Argus" is triggered:
     * Argus: "Hi [Name], I'm Argus. What kind of help do you need?"
     */
    _triggerWakeWordReaction() {
      this._stopAllListening();

      const displayName = this.getUserDisplayName();
      const greeting = displayName
        ? `Hi ${displayName}, I'm Argus. What kind of help do you need?`
        : `Hello, I'm Argus. What kind of help do you need?`;

      this.setRobotState('speaking', 'Argus is responding...');
      this.setTranscript(`✓ "Hey Argus" detected`);

      if (this.speechService) {
        this.speechService.speak(greeting, () => {
          // Acoustic guard delay (200ms) so speaker resonance finishes completely
          setTimeout(() => {
            this.startCommandListening();
          }, 200);
        });
      } else {
        this.startCommandListening();
      }
    }

    /**
     * Starts focused command listening session (after wake word OR after Tap to Speak)
     */
    startCommandListening() {
      if (this.isModalActive() || this.isSpeaking) return;

      this.isListeningWakeWord = false;
      this.isListeningCommand = true;
      this._isStartingListening = false;

      this.setRobotState('listening', "I'm listening...");
      this.setTranscript('Listening for your command (e.g. "Open VisionAid")...');

      if (this.voiceHintText) {
        this.voiceHintText.innerHTML = '<strong>Listening now...</strong> Speak your command.';
      }

      // Clear any prior command timeout
      if (this.commandTimeoutTimer) {
        clearTimeout(this.commandTimeoutTimer);
        this.commandTimeoutTimer = null;
      }

      // Command timeout guard (7.5 seconds of silence)
      this.commandTimeoutTimer = setTimeout(() => {
        if (this.isListeningCommand) {
          this.handleCommandTimeout();
        }
      }, 7500);

      this.speechService.startListening((transcript, isFinal) => {
        this.handleCommandSpeechResult(transcript, isFinal);
      }, { isWakeWord: false });
    }

    handleCommandSpeechResult(transcript, isFinal) {
      if (!transcript || !transcript.trim()) {
        if (isFinal) {
          this.handleCommandTimeout();
        }
        return;
      }

      // Speech active, clear timeout
      if (this.commandTimeoutTimer) {
        clearTimeout(this.commandTimeoutTimer);
        this.commandTimeoutTimer = null;
      }

      this.setTranscript(transcript, !isFinal);

      if (isFinal) {
        this.isListeningCommand = false;
        this.setRobotState('processing', 'Understanding request...');
        this.processVoiceCommand(transcript);
      }
    }

    handleCommandTimeout() {
      if (this.commandTimeoutTimer) {
        clearTimeout(this.commandTimeoutTimer);
        this.commandTimeoutTimer = null;
      }

      this._stopAllListening();
      this.setTranscript("I didn't hear a command. Tap to speak or say 'Hey Argus' anytime.");

      if (this.speechService) {
        this.speechService.speak("I didn't hear a command. Tap to speak or say 'Hey Argus' anytime.", () => {
          this._returnToStandby();
        });
      } else {
        this._returnToStandby();
      }
    }

    _returnToStandby() {
      this.setRobotState('idle', 'Ready');
      if (this.wakeWordEnabled && !this.isModalActive()) {
        setTimeout(() => this.startWakeWordListening(), 300);
      }
    }

    _stopAllListening() {
      this.isListeningWakeWord = false;
      this.isListeningCommand = false;
      this._isStartingListening = false;
      if (this.commandTimeoutTimer) {
        clearTimeout(this.commandTimeoutTimer);
        this.commandTimeoutTimer = null;
      }
      if (this.speechService) {
        this.speechService.stopListening();
      }
    }

    /**
     * Manual Tap to Speak handler
     */
    handleTapToSpeak() {
      if (this.isModalActive()) return;

      if (!this.speechService || !this.speechService.isSupported()) {
        this.setRobotState('error', 'Speech not supported in browser');
        this.setTranscript('Speech recognition is unavailable. Please click any feature card below to navigate.');
        return;
      }

      // If currently listening for a command, toggle off
      if (this.isListeningCommand) {
        this._stopAllListening();
        this._returnToStandby();
        return;
      }

      // If currently speaking, stop speech
      if (this.isSpeaking) {
        this._stopAllListening();
        this.speechService.cancel();
        this._returnToStandby();
        return;
      }

      // If in wake-word listening mode, tapping Tap to Speak directly activates command listening!
      if (this.isListeningWakeWord) {
        this.speechService.stopListening();
        setTimeout(() => {
          this.startCommandListening();
        }, 120);
        return;
      }

      if (this._isStartingListening) return;

      this._isStartingListening = true;
      this.startCommandListening();
    }

    /**
     * Normalizes spoken input text:
     * - Converts to lowercase and trims
     * - Replaces curly apostrophes
     * - Removes punctuation
     * - Strips conversational prefixes (e.g. "hey argus", "please", "can you")
     * - Collapses multiple spaces
     */
    _normalizeCommand(rawText) {
      if (!rawText || typeof rawText !== 'string') return '';
      let str = rawText.toLowerCase().trim();
      str = str.replace(/[’`]/g, "'");
      str = str.replace(/[.,\/#!$%\^&\*;:{}=\-_~()?"`]/g, ' ');
      str = str.replace(/\s+/g, ' ').trim();

      // Iteratively strip conversational prefixes
      let prev;
      do {
        prev = str;
        str = str.replace(/^(hey argus|argus|can you please|could you please|please can you|can you|could you|please|i want to|i need to)\s+/i, '');
      } while (str !== prev);

      return str.trim();
    }

    /**
     * Resolves voice command against routes and triggers navigation
     */
    processVoiceCommand(rawTranscript) {
      const normalized = this._normalizeCommand(rawTranscript);
      if (!normalized) {
        this._returnToStandby();
        return;
      }

      const matched = this._resolveCommand(normalized);

      if (matched) {
        this.setRobotState('speaking', `Launching ${matched.name}...`);
        this.setTranscript(`✓ Command recognized: "${matched.name}"`);

        // Spoken confirmation before navigation
        let hasExecuted = false;
        const doNavigate = () => {
          if (hasExecuted) return;
          hasExecuted = true;
          this._executeRoute(matched);
        };

        if (this.speechService) {
          // Safety timeout in case TTS onend does not fire in 3 seconds
          const fallbackTimer = setTimeout(doNavigate, 3000);
          this.speechService.speak(matched.spokenConfirm, () => {
            clearTimeout(fallbackTimer);
            doNavigate();
          });
        } else {
          doNavigate();
        }
      } else {
        // Unrecognized command
        this.setRobotState('error', 'Command not recognized');
        this.setTranscript(`Could not match "${rawTranscript.trim()}". Try saying "Open VisionAid", "Open PathGuide", or "Detect Objects".`);

        if (this.speechService) {
          this.speechService.speak(
            "I didn't recognize that command. You can say 'Open VisionAid', 'Open PathGuide', or tap any feature below.",
            () => {
              setTimeout(() => this._returnToStandby(), 1000);
            }
          );
        } else {
          setTimeout(() => this._returnToStandby(), 2200);
        }
      }
    }

    _resolveCommand(normalizedText) {
      if (!normalizedText) return null;
      for (const route of this.routes) {
        if (route.regex.test(normalizedText)) {
          return route;
        }
      }
      return null;
    }

    _executeRoute(route) {
      try {
        if (typeof route.action === 'function') {
          route.action();
          this.setRobotState('idle', 'Ready');
        } else if (route.url) {
          window.location.href = route.url;
        }
      } catch (err) {
        console.error('[ArgusCompanion] Navigation error:', err);
        this.setRobotState('error', 'Navigation failed');
        this.setTranscript(`Unable to open ${route.name}. Please tap the feature card directly.`);
      }
    }

    setRobotState(state, statusText) {
      this.currentState = state;

      if (this.robotStage) {
        this.robotStage.classList.remove(
          'state-idle',
          'state-listening',
          'state-listening-wake',
          'state-processing',
          'state-speaking',
          'state-error'
        );
        this.robotStage.classList.add(`state-${state}`);
      }

      if (this.robotStatusText && statusText) {
        this.robotStatusText.textContent = statusText;
      }

      // Update button visual state
      if (this.tapButton) {
        this.tapButton.classList.toggle('is-listening', state === 'listening' || state === 'listening-wake');
        this.tapButton.classList.toggle('is-speaking', state === 'speaking');
      }

      if (this.tapButtonLabel) {
        switch (state) {
          case 'listening':
            this.tapButtonLabel.textContent = "I'm listening...";
            break;
          case 'listening-wake':
            this.tapButtonLabel.textContent = 'Listening for "Hey Argus"...';
            break;
          case 'processing':
            this.tapButtonLabel.textContent = 'Understanding...';
            break;
          case 'speaking':
            this.tapButtonLabel.textContent = 'Argus is responding...';
            break;
          case 'error':
            this.tapButtonLabel.textContent = 'Tap to try again';
            break;
          case 'idle':
          default:
            this.tapButtonLabel.textContent = 'Tap to Speak';
            break;
        }
      }

      // Sync footer microphone status indicator if present
      const footerMicText = document.getElementById('footer-mic-status-text');
      if (footerMicText) {
        if (state === 'listening' || state === 'listening-wake') {
          footerMicText.textContent = 'Microphone Active';
        } else if (state === 'error') {
          footerMicText.textContent = 'Microphone Notice';
        } else {
          footerMicText.textContent = 'Microphone Ready';
        }
      }

      // Update hint text when idle
      if (state === 'idle' && this.voiceHintText) {
        this.voiceHintText.innerHTML = 'or say <strong>"Hey Argus"</strong>';
      }
    }

    setTranscript(text, isInterim = false) {
      if (!this.transcriptText || !this.transcriptCard) return;

      this.transcriptText.textContent = text;
      this.transcriptText.classList.toggle('is-interim', isInterim);
      this.transcriptCard.classList.toggle('has-content', Boolean(text && text.trim()));
    }

    _onListeningChange(listening) {
      this.isListening = listening;

      if (listening) {
        this._isStartingListening = false;
        if (this.wakeWordEnabled && this.isListeningWakeWord) {
          this.setRobotState('listening-wake', 'Listening for "Hey Argus"...');
          if (this.wakeToggleLabel) {
            this.wakeToggleLabel.textContent = 'Hands-Free: Listening for "Hey Argus"';
          }
        } else if (this.isListeningCommand) {
          this.setRobotState('listening', "I'm listening...");
        }
      } else {
        this._isStartingListening = false;

        // If in wake-listening mode and browser session timed out due to silence, safely restart
        if (this.wakeWordEnabled && this.isListeningWakeWord && !this.isModalActive() && !this.isSpeaking) {
          if (this.wakeRestartTimer) clearTimeout(this.wakeRestartTimer);
          this.wakeRestartTimer = setTimeout(() => {
            if (this.wakeWordEnabled && this.isListeningWakeWord && !this.isModalActive() && !this.isSpeaking) {
              this.startWakeWordListening();
            }
          }, 200);
        } else if (this.currentState === 'listening' || this.currentState === 'listening-wake') {
          if (!this.isListeningCommand) {
            this.setRobotState('idle', 'Ready');
          }
        }
      }
    }

    _onSpeakingChange(speaking) {
      this.isSpeaking = speaking;
      if (!speaking && this.currentState === 'speaking') {
        if (!this.isListeningCommand) {
          this.setRobotState('idle', 'Ready');
        }
      }
    }

    _onError(errMsg) {
      this._isStartingListening = false;
      this.isListeningCommand = false;

      const isPermissionDenied = Boolean(
        errMsg && (errMsg.includes('denied') || errMsg.includes('permission') || errMsg.includes('not-allowed'))
      );

      if (isPermissionDenied) {
        // Fatal permission error: disable hands-free mode
        this.wakeWordEnabled = false;
        this.isListeningWakeWord = false;
        try {
          localStorage.setItem('argus_wake_word_enabled', 'false');
        } catch (e) {}

        if (this.wakeToggleBtn) {
          this.wakeToggleBtn.classList.remove('is-active');
          this.wakeToggleBtn.setAttribute('aria-pressed', 'false');
        }
        if (this.wakeToggleLabel) {
          this.wakeToggleLabel.textContent = 'Hands-Free: Microphone Access Denied';
        }
        this.setRobotState('error', 'Microphone blocked');
        this.setTranscript(errMsg || 'Microphone access denied. Please allow microphone in browser settings.');
        return;
      }

      // If in wake mode, non-fatal errors should not permanently abort wake listening
      if (this.wakeWordEnabled && this.isListeningWakeWord) {
        return;
      }

      this.setRobotState('error', 'Microphone notice');
      this.setTranscript(errMsg || 'Audio notice. You can tap any feature directly.');

      setTimeout(() => {
        if (this.currentState === 'error') {
          this._returnToStandby();
        }
      }, 3000);
    }

    _escapeHTML(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  }

  // Auto-instantiate and export
  const controller = new ArgusCompanionController();
  root.argusCompanion = controller;

})(typeof window !== 'undefined' ? window : this);
