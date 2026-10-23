/**
 * Argus.AI — Companion Controller (Phase C: Voice-Command Integration)
 * Manages homepage single-page interaction:
 * - Animated 3D robot state transitions (IDLE, LISTENING, PROCESSING, SPEAKING, ERROR)
 * - Tap to Speak button binding with ArgusProfile.ArgusSpeechService
 * - Normalized text matching for all core feature commands and natural spoken aliases
 * - Spoken confirmation before navigation
 * - Emergency SOS and Profile voice commands with modal safety
 * - Live transcript visualization and honest listening state indicators
 */

(function (root) {
  'use strict';

  class ArgusCompanionController {
    constructor() {
      this.speechService = null;
      this.isListening = false;
      this.isSpeaking = false;
      this._isStartingListening = false;
      this.currentState = 'idle'; // idle | listening | processing | speaking | error

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

      // Command Definitions & Routes
      this.routes = [
        {
          id: 'pathguide',
          name: 'PathGuide Pro',
          url: './Night-Vision/index.html',
          regex: /(open pathguide|start pathguide|activate navigation mode|pathguide|path guide|navigation mode|walking guidance|start navigation)/i,
          spokenConfirm: 'Starting PathGuide Pro navigation.'
        },
        {
          id: 'object-detection',
          name: 'Object Detection Pro',
          url: './object-detection-pro/index.html',
          regex: /(open object detection|activate detection mode|detect objects?|object detection|object detector|identify objects?|find objects?)/i,
          spokenConfirm: 'Opening Object Detection Pro.'
        },
        {
          id: 'visionaid',
          name: 'VisionAid AI',
          url: './Visual Explanation/index.html',
          regex: /(open visionaid|explain my surroundings|read this document|visionaid|vision aid|explain surroundings|describe scene|read text|medicine scanner|multimodal)/i,
          spokenConfirm: 'Activating VisionAid AI.'
        },
        {
          id: 'queue-detector',
          name: 'Queue Detector',
          url: './queue-detection/index.html',
          regex: /(open queue detector|check the queue|detect people in line|queue detector|queue detection|people tracker|distance tracker|track queue|check line)/i,
          spokenConfirm: 'Launching Queue Detector.'
        },
        {
          id: 'optima-vision',
          name: 'Optima Vision',
          url: './Camera Check/index.html',
          regex: /(open optima vision|check camera quality|optima vision|optima|camera check|check visibility|check lens|blur check)/i,
          spokenConfirm: 'Opening Optima Vision camera check.'
        },
        {
          id: 'night-vision',
          name: 'Night Vision',
          url: './Night-Vision/index.html?mode=ON',
          regex: /(turn on night vision|activate night vision|night vision|night mode|dark mode|low light mode|photon enhancement)/i,
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
          regex: /(emergency sos|call my emergency contact|trigger emergency sos|trigger sos|help me|call 112|send help|danger)/i,
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
          regex: /(open my profile|edit my details|set up profile|edit profile|change my name|profile settings|my profile|open profile)/i,
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
      // Cache elements
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

      // Initialize or coordinate with speech service
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

      // Sync user profile display name
      this.syncUserProfile();

      // Listen for profile save events
      if (typeof window !== 'undefined') {
        window.addEventListener('storage', (e) => {
          if (e.key === 'argus_user_profile') {
            this.syncUserProfile();
          }
        });
      }

      // Periodic check if profile was saved in the same window
      if (typeof root !== 'undefined' && typeof root.setInterval === 'function') {
        const syncTimer = root.setInterval(() => this.syncUserProfile(), 1500);
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

      // Check if profile UI already created a speechService
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

      // Update greeting
      if (this.robotGreeting) {
        if (hasName) {
          this.robotGreeting.innerHTML = `Welcome back, <span class="user-name-highlight">${this._escapeHTML(displayName)}</span>`;
        } else {
          this.robotGreeting.innerHTML = `Hello! How can I help you see today?`;
        }
      }

      // Update header profile button
      if (this.profileNameLabel) {
        this.profileNameLabel.textContent = hasName ? displayName : 'Profile';
      }
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
      
      // Iteratively strip conversational prefixes (e.g. "Argus, please can you...")
      let prev;
      do {
        prev = str;
        str = str.replace(/^(hey argus|argus|can you please|could you please|please can you|can you|could you|please|i want to|i need to)\s+/i, '');
      } while (str !== prev);

      return str.trim();
    }

    handleTapToSpeak() {
      // If profile modal is open, let it retain speech focus
      const profileModal = document.getElementById('argus-profile-modal-overlay');
      if (profileModal && profileModal.classList.contains('active')) {
        return;
      }

      // If SOS modal is open, do not start speech
      const sosModal = document.getElementById('sos-modal-overlay');
      if (sosModal && sosModal.classList.contains('active')) {
        return;
      }

      if (!this.speechService || !this.speechService.isSupported()) {
        this.setRobotState('error', 'Speech not supported in browser');
        this.setTranscript('Speech recognition is unavailable. Please click any feature card below to navigate.');
        return;
      }

      // If currently listening, toggle off
      if (this.isListening) {
        this._isStartingListening = false;
        this.speechService.stopListening();
        this.setRobotState('idle', 'Ready');
        return;
      }

      // If currently speaking, stop speech
      if (this.isSpeaking) {
        this._isStartingListening = false;
        this.speechService.cancel();
        this.setRobotState('idle', 'Ready');
        return;
      }

      // Debounce rapid clicks while starting
      if (this._isStartingListening) {
        return;
      }

      this._isStartingListening = true;
      this.setRobotState('listening', "I'm listening...");
      this.setTranscript('Listening for your command...');

      if (this.voiceHintText) {
        this.voiceHintText.innerHTML = '<strong>Listening now...</strong> Speak your command.';
      }

      this.speechService.startListening((transcript, isFinal) => {
        this._isStartingListening = false;
        this.handleSpeechResult(transcript, isFinal);
      });
    }

    handleSpeechResult(transcript, isFinal) {
      if (!transcript || !transcript.trim()) {
        if (isFinal) {
          this.setRobotState('idle', 'Ready');
          this.setTranscript('No speech detected. Tap to try again.');
        }
        return;
      }

      this.setTranscript(transcript, !isFinal);

      if (isFinal) {
        this.setRobotState('processing', 'Understanding request...');
        this.processVoiceCommand(transcript);
      }
    }

    processVoiceCommand(rawTranscript) {
      const normalized = this._normalizeCommand(rawTranscript);
      if (!normalized) {
        this.setRobotState('idle', 'Ready');
        return;
      }

      const matched = this._resolveCommand(normalized);

      if (matched) {
        this.setRobotState('speaking', `Launching ${matched.name}...`);
        this.setTranscript(`✓ Command recognized: "${matched.name}"`);

        // Speak audio feedback before navigating
        if (this.speechService) {
          this.speechService.speak(matched.spokenConfirm, () => {
            this._executeRoute(matched);
          });
        } else {
          this._executeRoute(matched);
        }
      } else {
        // Unrecognized command
        this.setRobotState('error', 'Command not recognized');
        this.setTranscript(`Could not match "${rawTranscript.trim()}". Try saying "Open PathGuide" or "Open Object Detection".`);

        if (this.speechService) {
          this.speechService.speak(
            "I didn't recognize that command. You can say 'Open PathGuide', 'Open Object Detection', or tap any feature below.",
            () => {
              setTimeout(() => {
                this.setRobotState('idle', 'Ready');
              }, 1200);
            }
          );
        } else {
          setTimeout(() => {
            this.setRobotState('idle', 'Ready');
          }, 2400);
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
      if (typeof route.action === 'function') {
        route.action();
        this.setRobotState('idle', 'Ready');
      } else if (route.url) {
        window.location.href = route.url;
      }
    }

    setRobotState(state, statusText) {
      this.currentState = state;

      if (this.robotStage) {
        this.robotStage.classList.remove('state-idle', 'state-listening', 'state-processing', 'state-speaking', 'state-error');
        this.robotStage.classList.add(`state-${state}`);
      }

      if (this.robotStatusText && statusText) {
        this.robotStatusText.textContent = statusText;
      }

      // Update button visual state
      if (this.tapButton) {
        this.tapButton.classList.toggle('is-listening', state === 'listening');
        this.tapButton.classList.toggle('is-speaking', state === 'speaking');
      }

      if (this.tapButtonLabel) {
        switch (state) {
          case 'listening':
            this.tapButtonLabel.textContent = "I'm listening...";
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
            this.tapButtonLabel.textContent = 'TAP TO SPEAK';
            break;
        }
      }

      // Update hint text when idle
      if (state === 'idle' && this.voiceHintText) {
        this.voiceHintText.innerHTML = 'Tap to speak a command (e.g. <strong>"Open PathGuide"</strong> or <strong>"Detect Objects"</strong>).';
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
      if (!listening) {
        this._isStartingListening = false;
        if (this.currentState === 'listening') {
          this.setRobotState('idle', 'Ready');
        }
      }
    }

    _onSpeakingChange(speaking) {
      this.isSpeaking = speaking;
      if (!speaking && this.currentState === 'speaking') {
        this.setRobotState('idle', 'Ready');
      }
    }

    _onError(errMsg) {
      this._isStartingListening = false;
      this.setRobotState('error', 'Microphone notice');
      this.setTranscript(errMsg || 'Audio error. You can tap any feature directly.');
      setTimeout(() => {
        if (this.currentState === 'error') {
          this.setRobotState('idle', 'Ready');
        }
      }, 3500);
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
