/**
 * Argus.AI — Voice-Guided Profile Setup UI Controller
 * Binds the DOM, Animated 3D Robot, Audio Visualizer, and State Machine
 */

(function (global) {
  'use strict';

  const ArgusProfile = (typeof window !== 'undefined' && window.ArgusProfile) ||
                       (typeof global !== 'undefined' && global.ArgusProfile) ||
                       (typeof require !== 'undefined' ? require('./voice-profile-core.js') : null);

  if (!ArgusProfile) {
    console.error('[ArgusProfileUI] ArgusProfile core module not loaded.');
    return;
  }

  const {
    ProfileStorage,
    SpokenTextNormalizer,
    MachineState,
    STEPS,
    VoiceProfileStateMachine,
    ArgusSpeechService
  } = ArgusProfile;

  class ProfileSetupUI {
    constructor() {
      this.machine = null;
      this.speechService = null;
      this.hasSpokenWelcome = false;

      // DOM Elements
      this.overlay = null;
      this.card = null;
      this.robotAvatar = null;
      this.robotStatusPill = null;
      this.progressBar = null;
      this.progressText = null;
      this.viewWelcome = null;
      this.viewConversational = null;
      this.viewManual = null;
      this.viewReview = null;
      this.audioWave = null;
      this.transcriptText = null;
      this.questionTitle = null;
      this.questionHelp = null;
      this.incompleteBanner = null;
      this.navProfileBtn = null;

      this._init();
    }

    _init() {
      // Inject Modal Markup and Banner if not already in DOM
      this._injectDOM();

      // Initialize Speech Service with calm, natural pacing (shared singleton)
      this.speechService = (typeof ArgusSpeechService.getSharedInstance === 'function')
        ? ArgusSpeechService.getSharedInstance({
            lang: 'en-US',
            voiceRate: 0.95,
            pitch: 1.0,
            volume: 1.0,
            onListeningChange: (isListening) => this._onListeningChange(isListening),
            onSpeakingChange: (isSpeaking) => this._onSpeakingChange(isSpeaking),
            onError: (errMsg) => this._onSpeechError(errMsg)
          })
        : new ArgusSpeechService({
            lang: 'en-US',
            voiceRate: 0.95,
            pitch: 1.0,
            volume: 1.0,
            onListeningChange: (isListening) => this._onListeningChange(isListening),
            onSpeakingChange: (isSpeaking) => this._onSpeakingChange(isSpeaking),
            onError: (errMsg) => this._onSpeechError(errMsg)
          });

      // Initialize State Machine
      this.machine = new VoiceProfileStateMachine({
        storage: window.localStorage,
        speechService: this.speechService,
        onStateChange: (stateData) => this._renderState(stateData),
        onTranscriptUpdate: (data) => this._renderTranscript(data),
        onProgressUpdate: (prog) => this._renderProgress(prog),
        onError: (err) => this._showFormError(err)
      });

      this._bindEvents();
      this._checkInitialProfileStatus();
    }

    // -----------------------------------------------------------------------
    // DOM INJECTION & CREATION
    // -----------------------------------------------------------------------

    _injectDOM() {
      // Top Incomplete Banner
      if (!document.getElementById('argus-profile-banner')) {
        const banner = document.createElement('div');
        banner.id = 'argus-profile-banner';
        banner.className = 'profile-incomplete-banner';
        banner.setAttribute('role', 'region');
        banner.setAttribute('aria-label', 'Profile Setup Alert');
        banner.innerHTML = `
          <div style="display: flex; align-items: center; gap: 8px;">
            <span>👋</span>
            <span><strong>Profile Setup Incomplete:</strong> Personalize Argus with your name and emergency contacts.</span>
          </div>
          <div style="display: flex; align-items: center;">
            <button type="button" class="banner-action-btn" id="banner-continue-btn">Continue Setup</button>
            <button type="button" class="banner-dismiss-btn" id="banner-dismiss-btn" title="Dismiss for now">✕</button>
          </div>
        `;
        document.body.prepend(banner);
        this.incompleteBanner = banner;
      } else {
        this.incompleteBanner = document.getElementById('argus-profile-banner');
      }

      // Profile Modal Markup
      if (!document.getElementById('argus-profile-modal-overlay')) {
        const modalContainer = document.createElement('div');
        modalContainer.id = 'argus-profile-modal-overlay';
        modalContainer.className = 'argus-profile-modal-overlay';
        modalContainer.setAttribute('role', 'dialog');
        modalContainer.setAttribute('aria-modal', 'true');
        modalContainer.setAttribute('aria-labelledby', 'profile-modal-title');
        modalContainer.innerHTML = this._getModalHTML();
        document.body.appendChild(modalContainer);
      }

      // Cache DOM References
      this.overlay = document.getElementById('argus-profile-modal-overlay');
      this.card = document.getElementById('argus-profile-card');
      this.robotAvatar = document.getElementById('argus-robot-avatar');
      this.robotStatusPill = document.getElementById('robot-status-pill');
      this.progressBar = document.getElementById('profile-progress-fill');
      this.progressText = document.getElementById('profile-step-counter');
      this.viewWelcome = document.getElementById('profile-view-welcome');
      this.viewConversational = document.getElementById('profile-view-conversational');
      this.viewManual = document.getElementById('profile-view-manual');
      this.viewReview = document.getElementById('profile-view-review');
      this.audioWave = document.getElementById('audio-wave-visualizer');
      this.transcriptText = document.getElementById('transcript-text');
      this.questionTitle = document.getElementById('conversation-question-title');
      this.questionHelp = document.getElementById('conversation-question-help');

      // Add Nav Profile CTA if top-nav exists
      const topNav = document.querySelector('.top-nav');
      if (topNav && !document.getElementById('nav-profile-btn')) {
        const btn = document.createElement('a');
        btn.id = 'nav-profile-btn';
        btn.className = 'nav-profile-btn';
        btn.href = 'javascript:void(0)';
        btn.setAttribute('role', 'button');
        btn.innerHTML = `👤 <span>Profile</span>`;
        // Insert right before SOS button
        const sosBtn = topNav.querySelector('.btn-sos-cta');
        if (sosBtn) {
          topNav.insertBefore(btn, sosBtn);
        } else {
          topNav.appendChild(btn);
        }
        this.navProfileBtn = btn;
      } else {
        this.navProfileBtn = document.getElementById('nav-profile-btn');
      }
    }

    _getModalHTML() {
      return `
        <div class="argus-profile-card" id="argus-profile-card">
          <!-- Modal Header -->
          <div class="profile-modal-header">
            <div class="profile-brand-pill">
              <span>●</span> ARGUS ONBOARDING
            </div>
            <button type="button" class="profile-close-btn" id="btn-profile-close" aria-label="Close Profile Setup">✕</button>
          </div>

          <!-- Progress Header -->
          <div class="profile-progress-bar-wrap" id="profile-progress-wrap">
            <div class="profile-progress-header">
              <span class="profile-progress-title" id="profile-modal-title">Voice-Guided Profile Setup</span>
              <span id="profile-step-counter">Step 1 of 5</span>
            </div>
            <div class="profile-progress-track">
              <div class="profile-progress-fill" id="profile-progress-fill" style="width: 20%;"></div>
            </div>
          </div>

          <!-- Animated Friendly 3D Robot Assistant -->
          <div class="robot-avatar-container" id="argus-robot-avatar">
            <div class="robot-svg-wrapper">
              <svg class="robot-svg-graphic" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Animated friendly Argus robot assistant">
                <defs>
                  <!-- Head Metallic Spherical Gradient -->
                  <linearGradient id="robotHeadGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#334155" />
                    <stop offset="45%" stop-color="#1E293B" />
                    <stop offset="100%" stop-color="#0F172A" />
                  </linearGradient>

                  <!-- Glossy Visor Gradient -->
                  <linearGradient id="robotVisorGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#0F172A" />
                    <stop offset="100%" stop-color="#020617" />
                  </linearGradient>

                  <!-- Cyan Accent Gradient -->
                  <linearGradient id="robotCyanGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stop-color="#5EEAD4" />
                    <stop offset="100%" stop-color="#00F2FE" />
                  </linearGradient>

                  <!-- Glow Filter -->
                  <filter id="robotTealGlow" x="-30%" y="-30%" width="160%" height="160%">
                    <feGaussianBlur stdDeviation="3.5" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                <!-- Listening Ripple Halo Ring -->
                <circle class="robot-listening-halo" cx="70" cy="65" r="48" stroke="#00F2FE" stroke-width="2" fill="none" opacity="0" />

                <!-- Antenna Rod & Beacon -->
                <line x1="70" y1="26" x2="70" y2="14" stroke="#94A3B8" stroke-width="2.5" stroke-linecap="round" />
                <circle cx="70" cy="12" r="4.5" fill="url(#robotCyanGrad)" filter="url(#robotTealGlow)" />

                <!-- Floating Head Shell -->
                <rect x="25" y="26" width="90" height="74" rx="37" fill="url(#robotHeadGrad)" stroke="rgba(94, 234, 212, 0.3)" stroke-width="1.5" />

                <!-- Ear Pods / Headphone Sensors -->
                <rect x="18" y="48" width="10" height="28" rx="5" fill="#1E293B" stroke="url(#robotCyanGrad)" stroke-width="1.5" />
                <rect x="112" y="48" width="10" height="28" rx="5" fill="#1E293B" stroke="url(#robotCyanGrad)" stroke-width="1.5" />

                <!-- Glossy Curved Visor Screen -->
                <rect x="34" y="38" width="72" height="48" rx="22" fill="url(#robotVisorGrad)" stroke="rgba(0, 242, 254, 0.4)" stroke-width="1.5" />

                <!-- Visor Top Sheen Reflection -->
                <path d="M42 45C52 41 88 41 98 45" stroke="rgba(255, 255, 255, 0.25)" stroke-width="1.8" stroke-linecap="round" />

                <!-- Friendly Glowing Cyan Ocular Eyes -->
                <g class="robot-eye robot-eye-left" filter="url(#robotTealGlow)">
                  <circle cx="53" cy="58" r="7.5" fill="#00F2FE" />
                  <circle cx="51" cy="55" r="2.5" fill="#FFFFFF" />
                </g>
                <g class="robot-eye robot-eye-right" filter="url(#robotTealGlow)">
                  <circle cx="87" cy="58" r="7.5" fill="#00F2FE" />
                  <circle cx="85" cy="55" r="2.5" fill="#FFFFFF" />
                </g>

                <!-- Voice Equalizer Mouth Resonance Wave (Speaking Animation) -->
                <path class="robot-mouth-wave" d="M57 73C63 76 77 76 83 73" stroke="url(#robotCyanGrad)" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.6" />

                <!-- Floating Torso Capsule -->
                <path d="M48 104C48 100 58 98 70 98C82 98 92 100 92 104L88 116C88 120 80 122 70 122C60 122 52 120 52 116Z" fill="#1E293B" stroke="rgba(255, 255, 255, 0.1)" stroke-width="1.2" />
                
                <!-- Central Argus Optical Core Lens -->
                <circle cx="70" cy="110" r="5" fill="url(#robotCyanGrad)" filter="url(#robotTealGlow)" />
              </svg>
            </div>
            <div class="robot-shadow"></div>
            <div class="robot-status-pill" id="robot-status-pill">
              <span>●</span> <span>Ready</span>
            </div>
          </div>

          <!-- Live Region for Screen Readers -->
          <div class="sr-only" aria-live="polite" id="profile-sr-live" style="position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0;"></div>

          <!-- =============================================================
               VIEW 1: WELCOME SCREEN
               ============================================================= -->
          <div id="profile-view-welcome" class="profile-view">
            <div class="profile-speech-bubble" id="welcome-speech-text">
              "Welcome to Argus.AI! I'm Argus, your personal vision assistant. Let's set up your profile together. I'll ask one question at a time. You can answer by speaking or typing. You can also skip this setup and complete it later."
            </div>

            <div class="profile-btn-col">
              <button type="button" class="btn-profile-primary" id="btn-start-voice">
                <span style="font-size: 1.25rem;">🎙️</span> Start Voice Setup
              </button>
              <button type="button" class="btn-profile-secondary" id="btn-fill-manually">
                <span>⌨️</span> Fill Manually
              </button>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                <button type="button" class="btn-profile-preview-voice" id="btn-preview-voice" title="Preview Argus's natural assistant voice">
                  <span>🔊</span> Preview Voice
                </button>
                <button type="button" class="btn-profile-skip" id="btn-skip-welcome">
                  Skip for Now
                </button>
              </div>
            </div>
          </div>

          <!-- =============================================================
               VIEW 2: CONVERSATIONAL VOICE ONBOARDING
               ============================================================= -->
          <div id="profile-view-conversational" class="profile-view" style="display: none;">
            <div class="conversation-question-card">
              <div class="conversation-question-title" id="conversation-question-title">
                What is your name?
              </div>
              <div class="conversation-question-help" id="conversation-question-help">
                Say your preferred name clearly into your microphone.
              </div>
            </div>

            <!-- Animated Wave Bars when Listening -->
            <div class="audio-wave-container" id="audio-wave-visualizer">
              <div class="wave-bar"></div>
              <div class="wave-bar"></div>
              <div class="wave-bar"></div>
              <div class="wave-bar"></div>
              <div class="wave-bar"></div>
              <div class="wave-bar"></div>
              <div class="wave-bar"></div>
            </div>

            <!-- Compact Transcript Box -->
            <div class="transcript-box">
              <div class="transcript-header">
                <span id="transcript-status-label">VOICE TRANSCRIPT</span>
                <span id="transcript-mic-indicator">MIC ACTIVE</span>
              </div>
              <div class="transcript-content" id="transcript-text">
                <span class="transcript-content placeholder">Listening for your response...</span>
              </div>
            </div>

            <!-- Confirmation Buttons Row (Shown when Robot asks for confirmation) -->
            <div id="conversation-confirm-actions" style="display: none;">
              <div class="conversation-actions-grid">
                <button type="button" class="btn-profile-confirm-yes" id="btn-confirm-yes">
                  ✓ Yes, That's Correct
                </button>
                <button type="button" class="btn-profile-confirm-no" id="btn-confirm-no">
                  ✗ No, Change It
                </button>
              </div>
            </div>

            <!-- Helpful Spoken Command Chips -->
            <div class="command-chips-row">
              <button type="button" class="command-chip" id="chip-repeat">🔄 Repeat</button>
              <button type="button" class="command-chip" id="chip-skip">⏩ Skip</button>
              <button type="button" class="command-chip" id="chip-back">⬅️ Go Back</button>
              <button type="button" class="command-chip" id="chip-type">⌨️ Type Instead</button>
            </div>

            <!-- Bottom Navigation Row -->
            <div class="conversation-nav-row">
              <button type="button" class="btn-profile-skip" id="btn-conv-skip-now">
                Skip Setup for Now
              </button>
              <button type="button" class="btn-profile-skip" id="btn-conv-cancel" style="color: #EF4444;">
                Cancel
              </button>
            </div>
          </div>

          <!-- =============================================================
               VIEW 3: MANUAL INPUT FORM
               ============================================================= -->
          <div id="profile-view-manual" class="profile-view" style="display: none;">
            <div class="manual-form-container">
              <div class="manual-error-alert" id="manual-form-error" role="alert"></div>

              <!-- Field 0: Language Preference -->
              <div class="manual-form-group">
                <label class="manual-label" for="manual-language-select">
                  <span>Preferred Language / భాష / भाषा</span>
                  <span class="manual-required-badge">ACTIVE</span>
                </label>
                <select id="manual-language-select" class="manual-input" style="cursor: pointer;">
                  <option value="en">English (EN)</option>
                  <option value="te">తెలుగు — Telugu</option>
                  <option value="hi">हिन्दी — Hindi</option>
                </select>
                <span class="manual-input-hint">Voice guidance and assistant speech language.</span>
              </div>

              <!-- Field 1: Name -->
              <div class="manual-form-group">
                <label class="manual-label" for="manual-input-name">
                  <span>Display Name</span>
                  <span class="manual-required-badge">REQUIRED</span>
                </label>
                <input type="text" id="manual-input-name" class="manual-input" placeholder="e.g. Prem Pareesh" autocomplete="name">
                <span class="manual-input-hint">Your preferred name used for personalized voice guidance.</span>
              </div>

              <!-- Field 2: Phone -->
              <div class="manual-form-group">
                <label class="manual-label" for="manual-input-phone">
                  <span>Personal Phone Number</span>
                  <span class="manual-optional-badge">OPTIONAL</span>
                </label>
                <input type="tel" id="manual-input-phone" class="manual-input" placeholder="e.g. +1 415 555 0123 or +91 98765 43210" autocomplete="tel">
                <span class="manual-input-hint">Include country code with leading + sign.</span>
              </div>

              <!-- Field 3: Address -->
              <div class="manual-form-group">
                <label class="manual-label" for="manual-input-address">
                  <span>Address</span>
                  <span class="manual-optional-badge">OPTIONAL</span>
                </label>
                <input type="text" id="manual-input-address" class="manual-input" placeholder="e.g. 123 Vision Way, San Francisco, CA" autocomplete="street-address">
                <span class="manual-input-hint">No GPS permission required.</span>
              </div>

              <!-- Field 4: Emergency Contact 1 -->
              <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 14px; margin-top: 4px;">
                <div style="font-weight: 700; color: var(--profile-teal); font-size: 0.95rem; margin-bottom: 10px;">
                  🚨 Emergency Contact 1
                </div>
                <div class="manual-form-group">
                  <label class="manual-label" for="manual-input-contact1-name">
                    <span>Contact Name</span>
                    <span class="manual-optional-badge">RECOMMENDED</span>
                  </label>
                  <input type="text" id="manual-input-contact1-name" class="manual-input" placeholder="e.g. Jane Doe">
                </div>
                <div class="manual-form-group" style="margin-top: 8px;">
                  <label class="manual-label" for="manual-input-contact1-phone">
                    <span>WhatsApp Phone Number (with Country Code)</span>
                    <span class="manual-optional-badge">RECOMMENDED</span>
                  </label>
                  <input type="tel" id="manual-input-contact1-phone" class="manual-input" placeholder="e.g. +91 98765 43211">
                </div>
              </div>

              <!-- Field 5: Emergency Contact 2 -->
              <div style="border-top: 1px solid rgba(255,255,255,0.08); padding-top: 14px; margin-top: 4px;">
                <div style="font-weight: 700; color: var(--profile-cyan); font-size: 0.95rem; margin-bottom: 10px;">
                  🚨 Emergency Contact 2 (Optional)
                </div>
                <div class="manual-form-group">
                  <label class="manual-label" for="manual-input-contact2-name">
                    <span>Contact Name</span>
                    <span class="manual-optional-badge">OPTIONAL</span>
                  </label>
                  <input type="text" id="manual-input-contact2-name" class="manual-input" placeholder="e.g. Alex Smith">
                </div>
                <div class="manual-form-group" style="margin-top: 8px;">
                  <label class="manual-label" for="manual-input-contact2-phone">
                    <span>WhatsApp Phone Number</span>
                    <span class="manual-optional-badge">OPTIONAL</span>
                  </label>
                  <input type="tel" id="manual-input-contact2-phone" class="manual-input" placeholder="e.g. +1 555 019 2834">
                </div>
              </div>
            </div>

            <!-- Manual Form Action Buttons -->
            <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 20px;">
              <button type="button" class="btn-profile-primary" id="btn-save-manual" aria-label="Save Changes">
                💾 Save Changes
              </button>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <button type="button" class="btn-profile-secondary" id="btn-back-to-voice" style="width: auto; padding: 10px 18px;">
                  🎙️ Switch to Voice
                </button>
                <button type="button" class="btn-profile-skip" id="btn-manual-skip">
                  Skip for Now
                </button>
              </div>
            </div>
          </div>

          <!-- =============================================================
               VIEW 4: PROFILE REVIEW & CONFIRMATION
               ============================================================= -->
          <div id="profile-view-review" class="profile-view" style="display: none;">
            <div class="review-summary-card">
              <div class="review-item">
                <div>
                  <div class="review-item-label">Display Name</div>
                  <div class="review-item-value" id="review-display-name">—</div>
                </div>
                <button type="button" class="btn-review-edit" onclick="window.argusUI.openEditField('name')">Edit</button>
              </div>

              <div class="review-item">
                <div>
                  <div class="review-item-label">Phone Number</div>
                  <div class="review-item-value" id="review-phone-number">Not provided</div>
                </div>
                <button type="button" class="btn-review-edit" onclick="window.argusUI.openEditField('phone')">Edit</button>
              </div>

              <div class="review-item">
                <div>
                  <div class="review-item-label">Address</div>
                  <div class="review-item-value" id="review-address">Not provided</div>
                </div>
                <button type="button" class="btn-review-edit" onclick="window.argusUI.openEditField('address')">Edit</button>
              </div>

              <div class="review-item">
                <div>
                  <div class="review-item-label">Primary Emergency Contact</div>
                  <div class="review-item-value" id="review-contact1">Not provided</div>
                </div>
                <button type="button" class="btn-review-edit" onclick="window.argusUI.openEditField('contact1')">Edit</button>
              </div>

              <div class="review-item">
                <div>
                  <div class="review-item-label">Secondary Emergency Contact</div>
                  <div class="review-item-value" id="review-contact2">Not provided</div>
                </div>
                <button type="button" class="btn-review-edit" onclick="(window.argusProfileUI || window.argusUI).openEditField('contact2')">Edit</button>
              </div>

              <div class="review-item">
                <div>
                  <div class="review-item-label">Preferred Language</div>
                  <div class="review-item-value" id="review-preferred-language">English (EN)</div>
                </div>
                <button type="button" class="btn-review-edit" onclick="(window.argusProfileUI || window.argusUI).openEditField('language')">Edit</button>
              </div>
            </div>

            <!-- Privacy Guarantee Notice -->
            <div class="privacy-notice-box">
              <span class="privacy-icon">🔒</span>
              <div>
                <strong>Local-First Privacy Assurance:</strong> Your profile is stored securely in this browser's local storage. Argus.AI never uploads or transmits your personal data or emergency contacts to any external AI provider.
              </div>
            </div>

            <!-- Confirmation Button -->
            <div class="profile-btn-col">
              <button type="button" class="btn-profile-primary" id="btn-finish-profile">
                🚀 Confirm & Enter Argus Dashboard
              </button>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <button type="button" class="btn-profile-secondary" id="btn-edit-all-manual" style="width: auto; padding: 10px 18px;">
                  ✏️ Edit Details
                </button>
                <button type="button" class="btn-profile-clear" id="btn-clear-profile">
                  🗑️ Clear My Profile
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // -----------------------------------------------------------------------
    // EVENT BINDINGS
    // -----------------------------------------------------------------------

    _bindEvents() {
      // Close / Dismiss
      const closeBtn = document.getElementById('btn-profile-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.closeModal());
      }

      // Welcome View Actions
      const startVoiceBtn = document.getElementById('btn-start-voice');
      if (startVoiceBtn) {
        startVoiceBtn.addEventListener('click', () => {
          this.machine.startVoiceFlow();
        });
      }

      const fillManualBtn = document.getElementById('btn-fill-manually');
      if (fillManualBtn) {
        fillManualBtn.addEventListener('click', () => {
          this.machine.switchToManualMode();
        });
      }

      const skipWelcomeBtn = document.getElementById('btn-skip-welcome');
      if (skipWelcomeBtn) {
        skipWelcomeBtn.addEventListener('click', () => {
          this.machine.skipForNow();
          this.closeModal();
        });
      }

      const previewVoiceBtn = document.getElementById('btn-preview-voice');
      if (previewVoiceBtn) {
        previewVoiceBtn.addEventListener('click', () => {
          this.speechService.previewVoice();
        });
      }

      // Conversational View Actions
      const confirmYesBtn = document.getElementById('btn-confirm-yes');
      if (confirmYesBtn) {
        confirmYesBtn.addEventListener('click', () => {
          this.machine.handleConfirmation(true);
        });
      }

      const confirmNoBtn = document.getElementById('btn-confirm-no');
      if (confirmNoBtn) {
        confirmNoBtn.addEventListener('click', () => {
          this.machine.handleConfirmation(false);
        });
      }

      const chipRepeat = document.getElementById('chip-repeat');
      if (chipRepeat) {
        chipRepeat.addEventListener('click', () => this.machine.repeatQuestion());
      }

      const chipSkip = document.getElementById('chip-skip');
      if (chipSkip) {
        chipSkip.addEventListener('click', () => this.machine.skipCurrentField());
      }

      const chipBack = document.getElementById('chip-back');
      if (chipBack) {
        chipBack.addEventListener('click', () => this.machine.goBack());
      }

      const chipType = document.getElementById('chip-type');
      if (chipType) {
        chipType.addEventListener('click', () => this.machine.switchToManualMode());
      }

      const convSkipNow = document.getElementById('btn-conv-skip-now');
      if (convSkipNow) {
        convSkipNow.addEventListener('click', () => {
          this.machine.skipForNow();
          this.closeModal();
        });
      }

      const convCancel = document.getElementById('btn-conv-cancel');
      if (convCancel) {
        convCancel.addEventListener('click', () => {
          this.machine.cancelSetup();
          this.closeModal();
        });
      }

      // Manual Form Actions
      const saveManualBtn = document.getElementById('btn-save-manual');
      if (saveManualBtn) {
        saveManualBtn.addEventListener('click', () => this._handleSaveManualForm());
      }

      const backToVoiceBtn = document.getElementById('btn-back-to-voice');
      if (backToVoiceBtn) {
        backToVoiceBtn.addEventListener('click', () => this.machine.startVoiceFlow());
      }

      const manualSkipBtn = document.getElementById('btn-manual-skip');
      if (manualSkipBtn) {
        manualSkipBtn.addEventListener('click', () => {
          this.machine.skipForNow();
          this.closeModal();
        });
      }

      // Review View Actions
      const finishBtn = document.getElementById('btn-finish-profile');
      if (finishBtn) {
        finishBtn.addEventListener('click', () => {
          this.machine.finishSetup();
          this.closeModal();
          this._checkInitialProfileStatus();
          if (typeof window !== 'undefined' && window.argusCompanion && typeof window.argusCompanion.syncUserProfile === 'function') {
            window.argusCompanion.syncUserProfile();
          }
        });
      }

      const editAllManualBtn = document.getElementById('btn-edit-all-manual');
      if (editAllManualBtn) {
        editAllManualBtn.addEventListener('click', () => {
          this.machine.switchToManualMode();
          this._populateManualForm();
        });
      }

      const clearBtn = document.getElementById('btn-clear-profile');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => this._handleClearProfile());
      }

      // Banner Actions
      const bannerContinue = document.getElementById('banner-continue-btn');
      if (bannerContinue) {
        bannerContinue.addEventListener('click', () => this.openModal());
      }

      const bannerDismiss = document.getElementById('banner-dismiss-btn');
      if (bannerDismiss) {
        bannerDismiss.addEventListener('click', () => {
          if (this.incompleteBanner) this.incompleteBanner.classList.remove('active');
        });
      }

      // Nav Profile Button & Header Profile Control
      if (this.navProfileBtn) {
        this.navProfileBtn.addEventListener('click', () => this.openModal());
      }
      const headerProfileBtn = document.getElementById('btn-header-profile');
      if (headerProfileBtn) {
        headerProfileBtn.addEventListener('click', (e) => {
          e.preventDefault();
          this.openModal();
        });
      }

      // Keyboard Accessibility
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.overlay && this.overlay.classList.contains('active')) {
          this.closeModal();
        }
      });
    }

    // -----------------------------------------------------------------------
    // INITIAL SETUP & STATUS CHECK
    // -----------------------------------------------------------------------

    _checkInitialProfileStatus() {
      const isCompleted = ProfileStorage.isCompleted();
      const hasStarted = ProfileStorage.hasStarted();
      const profile = ProfileStorage.loadProfile();

      // Update Nav profile button label
      if (this.navProfileBtn) {
        if (isCompleted && profile.displayName) {
          this.navProfileBtn.innerHTML = `👤 <span>${this._escapeHTML(profile.displayName)}</span>`;
        } else {
          this.navProfileBtn.innerHTML = `👤 <span>Profile</span>`;
        }
      }

      // Check session skip flag
      const sessionSkipped = (typeof sessionStorage !== 'undefined') ? sessionStorage.getItem('argus_profile_skipped') : null;

      if (!isCompleted && !sessionSkipped) {
        // First visit or incomplete without session skip -> auto present modal
        setTimeout(() => {
          this.openModal();
          // Do not autoplay welcome speech without user click to respect browser autoplay policies
        }, 350);
      } else if (!isCompleted && sessionSkipped) {
        // Show subtle top banner
        if (this.incompleteBanner) this.incompleteBanner.classList.add('active');
      }
    }

    _speakWelcomeGreeting() {
      if (this.hasSpokenWelcome) return;
      this.hasSpokenWelcome = true;
      const welcomeText = "Welcome to Argus.AI! I'm Argus, your personal vision assistant. Let's set up your profile together. I'll ask one question at a time. You can answer by speaking or typing. You can also skip this setup and complete it later.";
      this.speechService.speak(welcomeText);
    }

    // -----------------------------------------------------------------------
    // MODAL OPEN / CLOSE
    // -----------------------------------------------------------------------

    openModal(forceEditMode = false) {
      if (this.overlay) {
        this.overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
      }

      const isCompleted = ProfileStorage.isCompleted();
      const hasStarted = ProfileStorage.hasStarted();

      // If opening profile settings for existing user, show manual form pre-populated
      if (isCompleted || hasStarted || forceEditMode) {
        this.machine.switchToManualMode();
        this._populateManualForm();
        const welcomeTitle = document.getElementById('profile-modal-title');
        if (welcomeTitle) welcomeTitle.innerText = "Profile Settings";
      } else {
        this._showView(this.viewWelcome);
      }
    }

    closeModal() {
      // Only cancel speech if the onboarding state machine itself was in an active voice question
      // Avoid cancelling companion assistant speech or navigation announcements
      if (this.machine && this.machine.state !== 'IDLE' && this.machine.state !== 'MANUAL_MODE' && this.machine.state !== 'WELCOME') {
        if (this.speechService) {
          this.speechService.cancel();
        }
      }

      if (this.overlay) {
        this.overlay.classList.remove('active');
        document.body.style.overflow = '';
      }

      // Update banner status
      const isCompleted = ProfileStorage.isCompleted();
      if (!isCompleted) {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.setItem('argus_profile_skipped', 'true');
        }
        if (this.incompleteBanner) {
          this.incompleteBanner.classList.add('active');
        }
      } else {
        if (this.incompleteBanner) {
          this.incompleteBanner.classList.remove('active');
        }
      }
    }

    openEditField(fieldKey) {
      this.machine.switchToManualMode();
      this._populateManualForm();
      setTimeout(() => {
        if (fieldKey === 'language') document.getElementById('manual-language-select')?.focus();
        else if (fieldKey === 'name') document.getElementById('manual-input-name')?.focus();
        else if (fieldKey === 'phone') document.getElementById('manual-input-phone')?.focus();
        else if (fieldKey === 'address') document.getElementById('manual-input-address')?.focus();
        else if (fieldKey === 'contact1') document.getElementById('manual-input-contact1-name')?.focus();
        else if (fieldKey === 'contact2') document.getElementById('manual-input-contact2-name')?.focus();
      }, 100);
    }

    // -----------------------------------------------------------------------
    // STATE RENDERING
    // -----------------------------------------------------------------------

    _renderState(stateData) {
      const { state, currentStep, currentStepIndex, pendingValue, contactSubStep, pendingContact } = stateData;

      switch (state) {
        case MachineState.WELCOME:
          this._showView(this.viewWelcome);
          this._updateRobotStatus('ready', 'Ready');
          break;

        case MachineState.ASKING:
          this._showView(this.viewConversational);
          this._updateRobotStatus('speaking', 'Argus Speaking...');
          this._renderQuestionInfo(currentStep, contactSubStep, pendingContact);
          this._hideConfirmationButtons();
          break;

        case MachineState.LISTENING:
          this._showView(this.viewConversational);
          this._updateRobotStatus('listening', 'Listening to you...');
          this._renderQuestionInfo(currentStep, contactSubStep, pendingContact);
          this._hideConfirmationButtons();
          break;

        case MachineState.CONFIRMING:
          this._showView(this.viewConversational);
          this._updateRobotStatus('confirming', 'Confirming Answer');
          this._showConfirmationButtons(currentStep, pendingValue, pendingContact);
          break;

        case MachineState.SAVING:
          this._updateRobotStatus('speaking', 'Saving...');
          break;

        case MachineState.REVIEW:
          this._renderReview();
          break;

        case MachineState.COMPLETED:
          this._renderReview();
          this._updateRobotStatus('speaking', 'Profile Completed');
          break;

        case MachineState.CANCELLED:
          this.closeModal();
          break;

        case MachineState.MANUAL_MODE:
          this._showView(this.viewManual);
          this._populateManualForm();
          this._updateRobotStatus('ready', 'Manual Entry Mode');
          break;
      }
    }

    _showView(targetView) {
      [this.viewWelcome, this.viewConversational, this.viewManual, this.viewReview].forEach(v => {
        if (v) v.style.display = 'none';
      });
      if (targetView) targetView.style.display = 'block';
    }

    _renderQuestionInfo(step, contactSubStep, pendingContact) {
      if (!step) return;

      if (step.id === 'emergencyContact1') {
        if (contactSubStep === 'name') {
          this.questionTitle.innerText = "Primary Emergency Contact";
          this.questionHelp.innerText = "Who is your primary emergency contact? Say their name.";
        } else if (contactSubStep === 'phone') {
          this.questionTitle.innerText = `${pendingContact.name}'s WhatsApp Number`;
          this.questionHelp.innerText = "Please say their phone number with country code.";
        }
      } else if (step.id === 'emergencyContact2') {
        if (contactSubStep === 'name') {
          this.questionTitle.innerText = "Secondary Emergency Contact";
          this.questionHelp.innerText = "Would you like to add a second emergency contact? Say 'Yes' or 'Skip'.";
        } else if (contactSubStep === 'name_entry') {
          this.questionTitle.innerText = "Second Contact Name";
          this.questionHelp.innerText = "What is their name?";
        } else if (contactSubStep === 'phone') {
          this.questionTitle.innerText = `${pendingContact.name}'s WhatsApp Number`;
          this.questionHelp.innerText = "Say their WhatsApp phone number with country code.";
        }
      } else {
        this.questionTitle.innerText = step.questionDisplay || step.title;
        this.questionHelp.innerText = step.helpText || '';
      }

      // Update screen reader live region
      const srLive = document.getElementById('profile-sr-live');
      if (srLive) srLive.innerText = this.questionTitle.innerText;
    }

    _renderProgress(prog) {
      if (this.progressBar) {
        this.progressBar.style.width = `${Math.max(15, prog.percentage)}%`;
      }
      if (this.progressText) {
        this.progressText.innerText = `Step ${prog.stepNumber} of ${prog.totalSteps}`;
      }
    }

    _renderTranscript(data) {
      if (!this.transcriptText) return;
      if (data.transcript) {
        this.transcriptText.innerHTML = `<span>${this._escapeHTML(data.transcript)}</span>`;
        if (data.isFinal) {
          const srLive = document.getElementById('profile-sr-live');
          if (srLive) srLive.innerText = `Recognized: ${data.transcript}`;
        }
      } else {
        this.transcriptText.innerHTML = `<span class="transcript-content placeholder">Listening for your response...</span>`;
      }
    }

    _showConfirmationButtons(step, pendingValue, pendingContact) {
      const confirmActions = document.getElementById('conversation-confirm-actions');
      if (!confirmActions) return;

      confirmActions.style.display = 'block';

      if (step.id === 'emergencyContact1' || step.id === 'emergencyContact2') {
        this.questionTitle.innerText = `Confirm: ${pendingContact.name}`;
        this.questionHelp.innerText = `Number: ${SpokenTextNormalizer.formatPhoneForDisplay(pendingContact.phone)}. Is this correct?`;
      } else if (step.id === 'phoneNumber') {
        this.questionTitle.innerText = `Confirm Phone Number`;
        this.questionHelp.innerText = `I heard: ${SpokenTextNormalizer.formatPhoneForDisplay(pendingValue)}. Is this correct?`;
      } else {
        this.questionTitle.innerText = `Confirm: "${pendingValue}"`;
        this.questionHelp.innerText = `Is this correct? Say "Yes" or "No".`;
      }
    }

    _hideConfirmationButtons() {
      const confirmActions = document.getElementById('conversation-confirm-actions');
      if (confirmActions) confirmActions.style.display = 'none';
    }

    _renderReview() {
      this._showView(this.viewReview);
      const profile = ProfileStorage.loadProfile();

      document.getElementById('review-display-name').innerText = profile.displayName || '—';
      document.getElementById('review-phone-number').innerText = profile.phoneNumber ? SpokenTextNormalizer.formatPhoneForDisplay(profile.phoneNumber) : 'Not provided';
      document.getElementById('review-address').innerText = profile.address || 'Not provided';

      if (profile.emergencyContacts && profile.emergencyContacts.length > 0) {
        const c1 = profile.emergencyContacts[0];
        document.getElementById('review-contact1').innerText = `${c1.name} (${SpokenTextNormalizer.formatPhoneForDisplay(c1.phone)})`;
      } else {
        document.getElementById('review-contact1').innerText = 'Not provided';
      }

      if (profile.emergencyContacts && profile.emergencyContacts.length > 1) {
        const c2 = profile.emergencyContacts[1];
        document.getElementById('review-contact2').innerText = `${c2.name} (${SpokenTextNormalizer.formatPhoneForDisplay(c2.phone)})`;
      } else {
        document.getElementById('review-contact2').innerText = 'Not provided';
      }

      const langReview = document.getElementById('review-preferred-language');
      if (langReview) {
        const l = profile.preferredLanguage || ProfileStorage.getLanguagePreference();
        langReview.innerText = (l === 'te') ? 'తెలుగు — Telugu' : (l === 'hi') ? 'हिन्दी — Hindi' : 'English (EN)';
      }

      if (this.progressBar) this.progressBar.style.width = '100%';
      if (this.progressText) this.progressText.innerText = 'Profile Review';
    }

    // -----------------------------------------------------------------------
    // MANUAL FORM HANDLING
    // -----------------------------------------------------------------------

    _populateManualForm() {
      const profile = ProfileStorage.loadProfile();
      const langSelect = document.getElementById('manual-language-select');
      if (langSelect) {
        langSelect.value = profile.preferredLanguage || ProfileStorage.getLanguagePreference();
      }
      document.getElementById('manual-input-name').value = profile.displayName || '';
      document.getElementById('manual-input-phone').value = profile.phoneNumber || '';
      document.getElementById('manual-input-address').value = profile.address || '';

      if (profile.emergencyContacts && profile.emergencyContacts.length > 0) {
        document.getElementById('manual-input-contact1-name').value = profile.emergencyContacts[0].name || '';
        document.getElementById('manual-input-contact1-phone').value = profile.emergencyContacts[0].phone || '';
      } else {
        document.getElementById('manual-input-contact1-name').value = '';
        document.getElementById('manual-input-contact1-phone').value = '';
      }

      if (profile.emergencyContacts && profile.emergencyContacts.length > 1) {
        document.getElementById('manual-input-contact2-name').value = profile.emergencyContacts[1].name || '';
        document.getElementById('manual-input-contact2-phone').value = profile.emergencyContacts[1].phone || '';
      } else {
        document.getElementById('manual-input-contact2-name').value = '';
        document.getElementById('manual-input-contact2-phone').value = '';
      }
    }

    _handleSaveManualForm() {
      const name = (document.getElementById('manual-input-name').value || '').trim();
      const phone = (document.getElementById('manual-input-phone').value || '').trim();
      const address = (document.getElementById('manual-input-address').value || '').trim();
      const c1Name = (document.getElementById('manual-input-contact1-name').value || '').trim();
      const c1Phone = (document.getElementById('manual-input-contact1-phone').value || '').trim();
      const c2Name = (document.getElementById('manual-input-contact2-name').value || '').trim();
      const c2Phone = (document.getElementById('manual-input-contact2-phone').value || '').trim();

      const errorDiv = document.getElementById('manual-form-error');

      // Validate required name
      if (!name || name.length < 2) {
        errorDiv.innerText = "Please enter your name (at least 2 characters).";
        errorDiv.style.display = 'block';
        return;
      }

      // Validate phone if provided
      if (phone && !SpokenTextNormalizer.isValidPhoneNumber(phone)) {
        errorDiv.innerText = "Please enter a valid personal phone number with country code (e.g. +1 555 123 4567 or +91 98765 43210).";
        errorDiv.style.display = 'block';
        return;
      }

      // Validate contact 1 phone if name provided
      if (c1Name && c1Phone && !SpokenTextNormalizer.isValidPhoneNumber(c1Phone)) {
        errorDiv.innerText = "Please enter a valid phone number for Emergency Contact 1.";
        errorDiv.style.display = 'block';
        return;
      }

      // Validate contact 2 phone if name provided
      if (c2Name && c2Phone && !SpokenTextNormalizer.isValidPhoneNumber(c2Phone)) {
        errorDiv.innerText = "Please enter a valid phone number for Emergency Contact 2.";
        errorDiv.style.display = 'block';
        return;
      }

      errorDiv.style.display = 'none';

      // Save to profile
      const profile = ProfileStorage.loadProfile();
      const langSelect = document.getElementById('manual-language-select');
      const selectedLang = (langSelect && (langSelect.value === 'te' || langSelect.value === 'hi' || langSelect.value === 'en')) ? langSelect.value : 'en';
      profile.displayName = name;
      profile.phoneNumber = phone;
      profile.address = address;
      profile.preferredLanguage = selectedLang;
      profile.completed = true;

      const contacts = [];
      if (c1Name) {
        contacts.push({
          name: c1Name,
          phone: c1Phone,
          relation: 'Emergency Contact 1',
          isTestMode: true
        });
      }
      if (c2Name) {
        contacts.push({
          name: c2Name,
          phone: c2Phone,
          relation: 'Emergency Contact 2',
          isTestMode: true
        });
      }
      const saved = ProfileStorage.saveProfile(profile);
      ProfileStorage.setLanguagePreference(selectedLang);

      if (!saved) {
        errorDiv.innerText = "Unable to save profile. Please check browser storage settings.";
        errorDiv.style.display = 'block';
        return;
      }

      // Transition and update review view
      this._renderReview();

      // Synchronize in runtime
      this._checkInitialProfileStatus();
      if (typeof window !== 'undefined' && window.argusCompanion && typeof window.argusCompanion.syncUserProfile === 'function') {
        window.argusCompanion.syncUserProfile();
      }

      // Close modal on successful save
      this.closeModal();
    }

    _handleClearProfile() {
      const confirmed = window.confirm("Are you sure you want to clear your Argus profile? All saved details and emergency contacts will be erased.");
      if (confirmed) {
        this.machine.clearProfile();
        this._checkInitialProfileStatus();
        this._showView(this.viewWelcome);
        const welcomeTitle = document.getElementById('profile-modal-title');
        if (welcomeTitle) welcomeTitle.innerText = "Voice-Guided Profile Setup";
        const startBtn = document.getElementById('btn-start-voice');
        if (startBtn) startBtn.innerHTML = `<span style="font-size: 1.25rem;">🎙️</span> Start Voice Setup`;
      }
    }

    // -----------------------------------------------------------------------
    // ROBOT & SPEECH INDICATORS
    // -----------------------------------------------------------------------

    _onListeningChange(isListening) {
      if (this.robotAvatar) {
        if (isListening) {
          this.robotAvatar.classList.add('robot-listening');
        } else {
          this.robotAvatar.classList.remove('robot-listening');
        }
      }

      if (this.audioWave) {
        if (isListening) {
          this.audioWave.classList.add('active');
        } else {
          this.audioWave.classList.remove('active');
        }
      }

      const micIndicator = document.getElementById('transcript-mic-indicator');
      if (micIndicator) {
        micIndicator.innerText = isListening ? 'MIC ACTIVE' : 'MIC IDLE';
        micIndicator.style.color = isListening ? 'var(--profile-cyan)' : 'var(--profile-text-muted)';
      }
    }

    _onSpeakingChange(isSpeaking) {
      if (this.robotAvatar) {
        if (isSpeaking) {
          this.robotAvatar.classList.add('robot-speaking');
        } else {
          this.robotAvatar.classList.remove('robot-speaking');
        }
      }
    }

    _onSpeechError(errMsg) {
      this._updateRobotStatus('error', 'Notice');
      if (this.transcriptText) {
        this.transcriptText.innerHTML = `<span style="color: var(--profile-coral);">${this._escapeHTML(errMsg)}</span>`;
      }
    }

    _showFormError(msg) {
      const errorDiv = document.getElementById('manual-form-error');
      if (errorDiv) {
        errorDiv.innerText = msg;
        errorDiv.style.display = 'block';
      }
    }

    _updateRobotStatus(type, label) {
      if (!this.robotStatusPill) return;
      this.robotStatusPill.className = `robot-status-pill status-${type}`;
      this.robotStatusPill.innerHTML = `<span>●</span> <span>${this._escapeHTML(label)}</span>`;
    }

    _escapeHTML(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  }

  // Auto-initialize when DOM is ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'interactive' || document.readyState === 'complete') {
      const ui = new ProfileSetupUI();
      if (typeof window !== 'undefined') {
        window.argusUI = ui;
        window.argusProfileUI = ui;
      }
      if (typeof global !== 'undefined') {
        global.argusUI = ui;
        global.argusProfileUI = ui;
      }
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        const ui = new ProfileSetupUI();
        if (typeof window !== 'undefined') {
          window.argusUI = ui;
          window.argusProfileUI = ui;
        }
        if (typeof global !== 'undefined') {
          global.argusUI = ui;
          global.argusProfileUI = ui;
        }
      });
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProfileSetupUI;
  }

})(typeof window !== 'undefined' ? window : this);
