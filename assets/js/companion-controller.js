/**
 * Argus.AI — Companion Controller
 * Manages homepage single-page interaction:
 * - Animated 3D robot state transitions (IDLE, LISTENING, PROCESSING, SPEAKING, ERROR)
 * - Tap to Speak button binding with ArgusProfile.ArgusSpeechService
 * - Live transcript visualization
 * - Natural voice command routing to core feature modules
 * - Profile greeting & header badge reflection
 * - Clean lifecycle coordination with profile modal and Emergency SOS
 */

(function (root) {
  'use strict';

  class ArgusCompanionController {
    constructor() {
      this.speechService = null;
      this.isListening = false;
      this.isSpeaking = false;
      this.currentState = 'idle'; // idle | listening | processing | speaking | error

      // DOM Elements
      this.robotStage = null;
      this.robotStatusPill = null;
      this.robotStatusText = null;
      this.robotGreeting = null;
      this.tapButton = null;
      this.tapButtonLabel = null;
      this.transcriptCard = null;
      this.transcriptText = null;
      this.profileHeaderBtn = null;
      this.profileNameLabel = null;

      // Command Definitions & Routes
      this.routes = [
        {
          id: 'object-detection',
          name: 'Object Detection Pro',
          url: './object-detection-pro/index.html',
          regex: /(object detection|object detector|detect objects?|detection mode|identify objects?|find objects?)/i,
          spokenConfirm: 'Opening Object Detection Pro.'
        },
        {
          id: 'pathguide',
          name: 'PathGuide Pro',
          url: './Night-Vision/index.html',
          regex: /(pathguide|path guide|navigation|obstacle awareness|spatial steering|walking guidance|start navigation)/i,
          spokenConfirm: 'Starting PathGuide Pro navigation.'
        },
        {
          id: 'visionaid',
          name: 'VisionAid AI',
          url: './Visual Explanation/index.html',
          regex: /(visionaid|vision aid|multimodal|read document|medicine scanner|explain scene|describe scene|read text)/i,
          spokenConfirm: 'Activating VisionAid AI.'
        },
        {
          id: 'queue-detector',
          name: 'Queue Detector',
          url: './queue-detection/index.html',
          regex: /(queue detector|queue detection|people tracker|distance tracker|track queue|check line|queue movement)/i,
          spokenConfirm: 'Launching Queue Detector.'
        },
        {
          id: 'optima-vision',
          name: 'Optima Vision',
          url: './Camera Check/index.html',
          regex: /(optima vision|optima|camera check|camera quality|check visibility|check lens|blur check)/i,
          spokenConfirm: 'Opening Optima Vision camera check.'
        },
        {
          id: 'night-vision',
          name: 'Night Vision',
          url: './Night-Vision/index.html?mode=night',
          regex: /(night vision|night mode|dark mode|low light|photon enhancement|dim image)/i,
          spokenConfirm: 'Turning on Night Vision enhancement.'
        },
        {
          id: 'emergency-sos',
          name: 'Emergency SOS',
          action: () => {
            if (typeof root.triggerEmergencySOS === 'function') {
              root.triggerEmergencySOS();
            }
          },
          regex: /(emergency sos|emergency|trigger sos|help me|call 112|send help|danger)/i,
          spokenConfirm: 'Activating Emergency SOS.'
        },
        {
          id: 'profile-setup',
          name: 'Profile Setup',
          action: () => {
            if (root.argusProfileUI && typeof root.argusProfileUI.openModal === 'function') {
              root.argusProfileUI.openModal();
            }
          },
          regex: /(set up profile|edit profile|change my name|profile settings|my profile|open profile)/i,
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
      window.addEventListener('storage', (e) => {
        if (e.key === 'argus_user_profile') {
          this.syncUserProfile();
        }
      });

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

      // If currently listening, stop
      if (this.isListening) {
        this.speechService.stopListening();
        this.setRobotState('idle', 'Ready');
        return;
      }

      // If currently speaking, stop speech
      if (this.isSpeaking) {
        this.speechService.cancel();
        this.setRobotState('idle', 'Ready');
        return;
      }

      // Start listening
      this.setRobotState('listening', "I'm listening...");
      this.setTranscript('Listening for your command...');

      this.speechService.startListening((transcript, isFinal) => {
        this.handleSpeechResult(transcript, isFinal);
      });
    }

    handleSpeechResult(transcript, isFinal) {
      if (!transcript) return;

      this.setTranscript(transcript, !isFinal);

      if (isFinal) {
        this.setRobotState('processing', 'Understanding request...');
        this.processVoiceCommand(transcript);
      }
    }

    processVoiceCommand(rawTranscript) {
      const clean = rawTranscript.trim();
      const matched = this._resolveCommand(clean);

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
        this.setTranscript(`Could not match "${clean}". Try saying "Open Object Detection" or "Start PathGuide".`);

        if (this.speechService) {
          this.speechService.speak(
            "I didn't recognize that command. You can say 'Open Object Detection', 'Start PathGuide', or tap any feature below.",
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

    _resolveCommand(text) {
      for (const route of this.routes) {
        if (route.regex.test(text)) {
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

      // Update button label
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
    }

    setTranscript(text, isInterim = false) {
      if (!this.transcriptText || !this.transcriptCard) return;

      this.transcriptText.textContent = text;
      this.transcriptText.classList.toggle('is-interim', isInterim);
      this.transcriptCard.classList.toggle('has-content', Boolean(text && text.trim()));
    }

    _onListeningChange(listening) {
      this.isListening = listening;
      if (!listening && this.currentState === 'listening') {
        // Finished listening without final result
        this.setRobotState('idle', 'Ready');
      }
    }

    _onSpeakingChange(speaking) {
      this.isSpeaking = speaking;
      if (!speaking && this.currentState === 'speaking') {
        this.setRobotState('idle', 'Ready');
      }
    }

    _onError(errMsg) {
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
