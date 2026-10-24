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

      // Active Language (en, te, hi)
      this.currentLanguage = (root.ArgusProfile && root.ArgusProfile.ProfileStorage)
        ? root.ArgusProfile.ProfileStorage.getLanguagePreference()
        : 'en';

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
      this.headerLanguageSelect = null;
      this.wakeToggleBtn = null;
      this.wakeToggleLabel = null;

      // Verified Canonical Routes & Comprehensive Multilingual Command Aliases
      this.routes = [
        {
          id: 'pathguide',
          name: 'PathGuide Pro',
          url: './Night-Vision/index.html',
          regex: /(open pathguide|start pathguide|pathguide pro|pathguide|path guide|navigation mode|walking guidance|start navigation|navigate|obstacle awareness|obstacles|పాత్గైడ్ తెరువు|పాత్ గైడ్ ఓపెన్ చేయి|పాత్గైడ్ ప్రారంభించు|దారి చూపించు|నావిగేట్ చేయి|దారి చూపు|పాత్గైడ్ ప్రో|పాత్గైడ్|పాత్ గైడ్|पाथगाइड खोलो|पाथगाइड शुरू करो|पाथगाइड खोलें|रास्ता दिखाओ|नेविगेट करो|पाथगाइड प्रो|पाथगाइड|पाथ गाइड)/i,
          spokenConfirm: 'Starting PathGuide Pro navigation.',
          spokenConfirms: {
            en: 'Starting PathGuide Pro navigation.',
            te: 'పాత్గైడ్ ప్రో నావిగేషన్ ప్రారంభిస్తున్నాను.',
            hi: 'पाथगाइड प्रो नेविगेशन शुरू कर रहा हूँ।'
          }
        },
        {
          id: 'object-detection',
          name: 'Object Detection Pro',
          url: './object-detection-pro/index.html',
          regex: /(open object detection|start object detection|object detection pro|object detection|object detector|detect objects?|identify objects?|find objects?|object scanner|can you identify this object|what is in front of me|ఆబ్జెక్ట్ డిటెక్షన్ తెరువు|ఆబ్జెక్ట్ డిటెక్షన్ ఓపెన్ చేయి|ఇది ఏ వస్తువో చెప్పు|వస్తువులను గుర్తించు|వస్తువును గుర్తించు|నా ముందు ఏముంది|వస్తువులను స్కాన్ చేయి|ఆబ్జెక్ట్ డిటెక్టర్|ऑब्जेक्ट डिटेक्शन खोलो|ऑब्जेक्ट डिटेक्शन शुरू करो|यह कौन सी वस्तु है|वस्तु पहचानो|वस्तुओं की पहचान करो|मेरे सामने क्या है|ऑब्जेक्ट डिटेक्टर)/i,
          spokenConfirm: 'Opening Object Detection Pro.',
          spokenConfirms: {
            en: 'Opening Object Detection Pro.',
            te: 'ఆబ్జెక్ట్ డిటెక్షన్ ప్రో తెరుస్తున్నాను.',
            hi: 'ऑब्जेक्ट डिटेक्शन प्रो खोल रहा हूँ।'
          }
        },
        {
          id: 'visionaid',
          name: 'VisionAid AI',
          url: './Visual%20Explanation/index.html',
          regex: /(open visionaid|start visionaid|open vision aid|start vision aid|visionaid ai|visionaid|vision aid|visual explanation|explain surroundings|explain my surroundings|describe scene|describe surroundings|read text|read document|medicine scanner|multimodal|విజన్ ఎయిడ్ తెరువు|విజన్ఎయిడ్ ఓపెన్ చేయి|విజన్ ఎయిడ్ ప్రారంభించు|దృశ్యాన్ని వివరించు|పరిసరాలను వివరించు|వివరించు|విజన్ ఎయిడ్|విజన్ఎయిడ్|विज़नएड खोलो|विज़न एड खोलो|विज़नएड शुरू करो|विज़न एड शुरू करो|दृश्य समझाओ|आसपास का दृश्य बताओ|चित्र का वर्णन करो|वर्णन करो|विज़नएड|विज़न एड)/i,
          spokenConfirm: 'Opening VisionAid AI.',
          spokenConfirms: {
            en: 'Opening VisionAid AI.',
            te: 'ఇప్పుడే విజన్ ఎయిడ్ తెరుస్తున్నాను.',
            hi: 'अब विज़नएड खोल रहा हूँ।'
          }
        },
        {
          id: 'queue-detector',
          name: 'Queue Detector',
          url: './queue-detection/index.html',
          regex: /(open queue detector|start queue detector|open queue|start queue|check queue|check the queue|queue detector|queue detection|detect people in line|people in line|distance tracker|track queue|check line|line check|queue|క్యూ డిటెక్టర్ తెరువు|క్యూ తనిఖీ చేయి|క్యూ చెక్ చేయి|లైన్ చెక్ చేయి|లైన్లో ఎంతమంది ఉన్నారు|క్యూలో ఎంతమంది ఉన్నారు|క్యూ డిటెక్టర్|క్యూ|कतार डिटेक्टर खोलो|क्यू डिटेक्टर खोलो|कतार जांचो|कतार चेक करो|लाइन चेक करो|लाइन में कितने लोग हैं|कतार में कितने लोग हैं|कतार|क्यू)/i,
          spokenConfirm: 'Opening Queue Detector.',
          spokenConfirms: {
            en: 'Opening Queue Detector.',
            te: 'క్యూ డిటెక్టర్ తెరుస్తున్నాను.',
            hi: 'कतार डिटेक्टर खोल रहा हूँ।'
          }
        },
        {
          id: 'optima-vision',
          name: 'Optima Vision',
          url: './Camera%20Check/index.html',
          regex: /(open optima vision|start optima vision|open optima|start optima|check camera quality|camera quality|check camera|check lens|check visibility|optima vision|optima|camera check|optical monitor|blur check|read this text|read text|ఆప్టిమా విజన్ తెరువు|ఆప్టిమా విజన్ ఓపెన్ చేయి|కెమెరా నాణ్యత తనిఖీ చేయి|కెమెరా చెక్ చేయి|లెన్స్ చెక్ చేయి|ఈ టెక్స్ట్ చదువు|టెక్స్ట్ చదువు|ఆప్టిమా విజన్|ఆప్టిమా|కెమెరా చెక్|ऑप्टिमा विज़न खोलो|ऑप्टिमा विज़न शुरू करो|कैमरा गुणवत्ता जांचो|कैमरा चेक करो|लेंस चेक करो|यह टेक्स्ट पढ़ो|टेक्स्ट पढ़ो|ऑप्टिमा विज़न|ऑप्टिमा|कैमरा चेक)/i,
          spokenConfirm: 'Opening Optima Vision camera check.',
          spokenConfirms: {
            en: 'Opening Optima Vision camera check.',
            te: 'ఆప్టిమా విజన్ కెమెరా చెక్ తెరుస్తున్నాను.',
            hi: 'ऑप्टिमा विज़न कैमरा चेक खोल रहा हूँ।'
          }
        },
        {
          id: 'night-vision',
          name: 'Night Vision',
          url: './Night-Vision/index.html?mode=ON',
          regex: /(turn on night vision|turn night vision on|activate night vision|enable night vision|start night vision|open night vision|night vision|night mode|dark mode|low light mode|photon enhancement|నైట్ విజన్ ఆన్ చేయి|నైట్ విజన్ తెరువు|నైట్ విజన్ ప్రారంభించు|తక్కువ వెలుతురు మోడ్|నైట్ విజన్|नाइट विज़न चालू करो|नाइट विज़न खोलो|नाइट विज़न शुरू करो|कम रोशनी मोड|नाइट विज़न)/i,
          spokenConfirm: 'Turning on Night Vision mode.',
          spokenConfirms: {
            en: 'Turning on Night Vision mode.',
            te: 'నైట్ విజన్ మోడ్ ఆన్ చేస్తున్నాను.',
            hi: 'नाइट विज़न मोड चालू कर रहा हूँ।'
          }
        },
        {
          id: 'emergency-sos',
          name: 'Emergency SOS',
          action: () => {
            if (typeof root.triggerEmergencySOS === 'function') {
              root.triggerEmergencySOS();
            }
          },
          regex: /(emergency sos|call my emergency contact|call emergency contact|trigger emergency sos|trigger sos|help me\b(?!\s*(walk|navigate|read|see|find|identify|guide|with|understand|look|check))|call 112|send help|danger|emergency|ఎమర్జెన్సీ ఎస్ఓఎస్|నా అత్యవసర కాంటాక్ట్‌కు కాల్ చేయి|సహాయం కావాలి|నాకు సహాయం చేయండి(?!\s*(నడవడానికి|చదవడానికి))|అత్యవసరం|ఎమర్జెన్సీ|इमरजेंसी एसओएस|मेरे आपातकालीन संपर्क को कॉल करो|मदद चाहिए|मेरी मदद करो(?!\s*(चलने|पढ़ने))|आपातकाल|इमरजेंसी)/i,
          spokenConfirm: 'Opening Emergency SOS. You have 5 seconds to cancel.',
          spokenConfirms: {
            en: 'Opening Emergency SOS. You have 5 seconds to cancel.',
            te: 'ఎమర్జెన్సీ ఎస్ఓఎస్ తెరుస్తున్నాను. రద్దు చేయడానికి 5 సెకన్ల సమయం ఉంది.',
            hi: 'इमरजेंसी एसओएस खोल रहा हूँ। रद्द करने के लिए आपके पास 5 सेकंड हैं।'
          }
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
          regex: /(open my profile|open profile|edit my details|set up profile|edit profile|change my name|profile settings|user profile|my profile|settings|నా ప్రొఫైల్ తెరువు|ప్రొఫైల్ తెరువు|ప్రొఫైల్ సెట్టింగ్స్|నా వివరాలు మార్చు|నా పేరు మార్చు|సెట్టింగ్స్|ప్రొఫైల్|मेरी प्रोफ़ाइल खोलो|प्रोफ़ाइल खोलो|प्रोफ़ाइल सेटिंग्स|मेरा विवरण बदलो|मेरा नाम बदलो|सेटिंग्स|प्रोफ़ाइल)/i,
          spokenConfirm: 'Opening your profile settings.',
          spokenConfirms: {
            en: 'Opening your profile settings.',
            te: 'మీ ప్రొఫైల్ సెట్టింగ్స్ తెరుస్తున్నాను.',
            hi: 'आपकी प्रोफ़ाइल सेटिंग्स खोल रहा हूँ।'
          }
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
      this.headerLanguageSelect = document.getElementById('header-language-select');
      this.wakeToggleBtn = document.getElementById('btn-wake-toggle');
      this.wakeToggleLabel = document.getElementById('wake-toggle-label');

      // Bind header language selector
      if (this.headerLanguageSelect) {
        this.headerLanguageSelect.value = this.currentLanguage;
        this.headerLanguageSelect.addEventListener('change', (e) => {
          this.setLanguage(e.target.value);
        });
      }

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

      // Initialize interactive 3D robot companion if container exists
      const robotContainer = document.getElementById('interactive-3d-robot-container');
      if (robotContainer && typeof root.Interactive3DRobot === 'function') {
        try {
          this.robot3D = new root.Interactive3DRobot('interactive-3d-robot-container', { width: 260, height: 260 });
          if (typeof root !== 'undefined') {
            root.argus3DRobot = this.robot3D;
          }
        } catch (e) {
          console.warn('[ArgusCompanion] 3D robot init notice:', e);
        }
      }

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

      // Listen for profile save and language change events
      if (typeof window !== 'undefined') {
        window.addEventListener('storage', (e) => {
          if (e.key === 'argus_user_profile') {
            this.syncUserProfile();
          }
          if (e.key === 'argus_language_preference' && e.newValue) {
            this.setLanguage(e.newValue, false);
          }
        });
        window.addEventListener('argus_profile_updated', () => {
          this.syncUserProfile();
        });
        window.addEventListener('argus_language_changed', (e) => {
          if (e.detail && e.detail.language) {
            this.setLanguage(e.detail.language, false);
          }
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

    setLanguage(langCode, syncStorage = true) {
      const code = (langCode === 'te' || langCode === 'hi') ? langCode : 'en';
      this.currentLanguage = code;

      const storage = (typeof root !== 'undefined' && root.localStorage)
        ? root.localStorage
        : ((typeof window !== 'undefined' && window.localStorage) ? window.localStorage : null);

      if (syncStorage && root.ArgusProfile && root.ArgusProfile.ProfileStorage) {
        root.ArgusProfile.ProfileStorage.setLanguagePreference(code, storage);
      } else if (storage) {
        try {
          storage.setItem('argus_language_preference', code);
        } catch (e) {}
      }

      if (this.headerLanguageSelect && this.headerLanguageSelect.value !== code) {
        this.headerLanguageSelect.value = code;
      }

      const modalLangSelect = document.getElementById('manual-language-select');
      if (modalLangSelect && modalLangSelect.value !== code) {
        modalLangSelect.value = code;
      }

      if (this.speechService && typeof this.speechService.setLanguage === 'function') {
        this.speechService.setLanguage(code);
      }

      return code;
    }

    _getSpokenConfirm(route) {
      if (!route) return '';
      const lang = this.currentLanguage || 'en';
      if (route.spokenConfirms && route.spokenConfirms[lang]) {
        return route.spokenConfirms[lang];
      }
      if (typeof route.spokenConfirm === 'string') return route.spokenConfirm;
      if (route.spokenConfirm && typeof route.spokenConfirm === 'object') {
        return route.spokenConfirm[lang] || route.spokenConfirm.en || '';
      }
      return '';
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
      const enMatch = /\b(hey\s+argus|hi\s+argus|hello\s+argus|ok\s+argus|okay\s+argus|argus|argos|august|argo)\b/i.test(normalizedText);
      const teMatch = /(హాయ్\s+ఆర్గస్|హే\s+ఆర్గస్|ఆర్గస్)/i.test(normalizedText);
      const hiMatch = /(हाय\s+आर्गस|हे\s+आर्गस|नमस्ते\s+आर्गस|आर्गस)/i.test(normalizedText);
      return enMatch || teMatch || hiMatch;
    }

    /**
     * Executes conversational reaction when voice interaction or "Hey Argus" is triggered:
     * English: "I'm here, [Name]. What kind of help do you need?"
     * Telugu: "నేను ఇక్కడే ఉన్నాను, [Name]. మీకు ఎలాంటి సహాయం కావాలి?"
     * Hindi: "मैं यहाँ हूँ, [Name]। आपको किस प्रकार की मदद चाहिए?"
     */
    _triggerWakeWordReaction() {
      this._stopAllListening();

      const displayName = this.getUserDisplayName();
      let greeting;
      if (this.currentLanguage === 'te') {
        greeting = displayName
          ? `నేను ఇక్కడే ఉన్నాను, ${displayName}. మీకు ఎలాంటి సహాయం కావాలి?`
          : `నేను ఇక్కడే ఉన్నాను. మీకు ఎలాంటి సహాయం కావాలి?`;
      } else if (this.currentLanguage === 'hi') {
        greeting = displayName
          ? `मैं यहाँ हूँ, ${displayName}। आपको किस प्रकार की मदद चाहिए?`
          : `मैं यहाँ हूँ। आपको किस प्रकार की मदद चाहिए?`;
      } else {
        greeting = displayName
          ? `I'm here, ${displayName}. What kind of help do you need?`
          : `I'm here. What kind of help do you need?`;
      }

      this.setRobotState('speaking', 'Argus is responding...');
      this.setTranscript(
        this.currentLanguage === 'te' ? '✓ "ఆర్గస్" గుర్తించబడింది' :
        this.currentLanguage === 'hi' ? '✓ "आर्गस" पहचाना गया' :
        '✓ "Hey Argus" detected'
      );

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
      let timeoutMsg;
      if (this.currentLanguage === 'te') {
        timeoutMsg = "నాకు ఎలాంటి ఆదేశం వినిపించలేదు. మాట్లాడటానికి నొక్కండి లేదా 'హాయ్ ఆర్గస్' అనండి.";
      } else if (this.currentLanguage === 'hi') {
        timeoutMsg = "मुझे कोई कमांड नहीं सुनाई दी। बोलने के लिए टैप करें या 'हाय आर्गस' कहें।";
      } else {
        timeoutMsg = "I didn't hear a command. Tap to speak or say 'Hey Argus' anytime.";
      }
      this.setTranscript(timeoutMsg);

      if (this.speechService) {
        this.speechService.speak(timeoutMsg, () => {
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
     * - Removes punctuation (including Latin and Indic dandas ।॥)
     * - Strips conversational prefixes (e.g. "hey argus", "please", "can you", Telugu/Hindi equivalents)
     * - Collapses multiple spaces
     */
    _normalizeCommand(rawText) {
      if (!rawText || typeof rawText !== 'string') return '';
      let str = rawText.toLowerCase().trim();
      str = str.replace(/[’`]/g, "'");
      // Clean punctuation while preserving Indic Unicode letters and vowels
      str = str.replace(/[.,\/#!$%\^&\*;:{}=\-_~()?"`।॥]/g, ' ');
      str = str.replace(/\s+/g, ' ').trim();

      // Iteratively strip conversational prefixes across English, Telugu, and Hindi
      let prev;
      do {
        prev = str;
        str = str.replace(/^(hey argus|hi argus|hello argus|argus|can you please|could you please|please can you|can you|could you|please|i want to|i need to|హాయ్ ఆర్గస్|హే ఆర్గస్|ఆర్గస్|దయచేసి|నాకు|నేను|ఒక్కసారి|हाय आर्गस|हे आर्गस|नमस्ते आर्गस|आर्गस|कृपया|जरा|मुझे)\s+/i, '');
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

      const matched = this._resolveCommand(normalized, rawTranscript);

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

        const spokenText = this._getSpokenConfirm(matched);
        if (this.speechService) {
          // Safety timeout in case TTS onend does not fire in 3 seconds
          const fallbackTimer = setTimeout(doNavigate, 3000);
          this.speechService.speak(spokenText, () => {
            clearTimeout(fallbackTimer);
            doNavigate();
          });
        } else {
          doNavigate();
        }
      } else {
        // Check for ambiguous query to ask a helpful clarifying question
        const isAmbiguous = /\b(help|assist|what can you do|how to use|options)\b/i.test(normalized) ||
                            /(సహాయం|ఏమి చేయగలవు|ఎలా ఉపయోగించాలి)/i.test(normalized) ||
                            /(मदद|सहायता|क्या कर सकते हो|कैसे उपयोग करें)/i.test(normalized);

        let unrecMsg;
        if (isAmbiguous) {
          this.setRobotState('speaking', 'Clarifying request...');
          if (this.currentLanguage === 'te') {
            unrecMsg = "మీకు నావిగేషన్, వస్తువులను గుర్తించడం, లేదా టెక్స్ట్ చదవడంలో సహాయం కావాలా?";
            this.setTranscript('వస్తువులను గుర్తించాలా, దారి చూపించాలా, లేదా టెక్స్ట్ చదవాలా?');
          } else if (this.currentLanguage === 'hi') {
            unrecMsg = "क्या आपको नेविगेशन, वस्तु पहचानने या टेक्स्ट पढ़ने में मदद चाहिए?";
            this.setTranscript('क्या आपको नेविगेशन, वस्तु पहचानने या टेक्स्ट पढ़ने में मदद चाहिए?');
          } else {
            unrecMsg = "Would you like help with navigation, identifying objects, or reading text?";
            this.setTranscript('Would you like help with navigation, identifying objects, or reading text?');
          }
        } else {
          this.setRobotState('error', 'Command not recognized');
          if (this.currentLanguage === 'te') {
            unrecMsg = "ఆ ఆదేశం నాకు అర్థం కాలేదు. మీరు 'విజన్ ఎయిడ్ తెరువు' లేదా 'పాత్గైడ్ తెరువు' అని అనవచ్చు.";
            this.setTranscript(`"${rawTranscript.trim()}" అర్థం కాలేదు. 'విజన్ ఎయిడ్ తెరువు' లేదా 'పాత్గైడ్ తెరువు' అని ప్రయత్నించండి.`);
          } else if (this.currentLanguage === 'hi') {
            unrecMsg = "मुझे यह कमांड समझ नहीं आई। आप 'विज़नएड खोलो' या 'पाथगाइड खोलो' कह सकते हैं।";
            this.setTranscript(`"${rawTranscript.trim()}" समझ नहीं आई। 'विज़नएड खोलो' या 'पाथगाइड खोलो' बोलें।`);
          } else {
            unrecMsg = "I didn't recognize that command. You can say 'Open VisionAid', 'Open PathGuide', or tap any feature below.";
            this.setTranscript(`Could not match "${rawTranscript.trim()}". Try saying "Open VisionAid", "Open PathGuide", or "Detect Objects".`);
          }
        }

        if (this.speechService) {
          this.speechService.speak(unrecMsg, () => {
            setTimeout(() => this._returnToStandby(), 1000);
          });
        } else {
          setTimeout(() => this._returnToStandby(), 2200);
        }
      }
    }

    _resolveCommand(normalizedText, rawTranscript = '') {
      if (!normalizedText && !rawTranscript) return null;

      const norm = (normalizedText || '').toLowerCase().trim();
      const raw = (rawTranscript || '').toLowerCase().trim();
      const combined = `${norm} ${raw}`.trim();

      // Tier 1: Canonical Regex Match across registered routes
      for (const route of this.routes) {
        if (route.regex.test(norm) || (raw && route.regex.test(raw))) {
          return route;
        }
      }

      // Tier 2: Natural-Language Intent Mapping
      const findRoute = (id) => this.routes.find(r => r.id === id);

      // Intent A: Person & Object Identification -> Object Detection Pro
      // "Who is in front of me? Please identify them", "Who is standing in front of me",
      // "Can you tell me what this object is", "Who is there", "What is ahead",
      // Telugu: "నా ముందు ఎవరు ఉన్నారు?", "ఈ వస్తువు ఏమిటో చెప్పు", "ఎవరు ఉన్నారు"
      // Hindi: "मेरे सामने कौन है? कृपया पहचानें", "सामने कौन खड़ा है", "यह कौन सी वस्तु है", "यह वस्तु क्या है"
      const isPersonOrObjectIntent = 
        /\b(who\s+is\s+(in\s+front|standing|there|here|ahead)|who\s+are\s+they|identify\s+(them|person|people|who|this|object|face|item)|what\s+is\s+this(\s+object)?|what\s+object|tell\s+me\s+what\s+this\s+is|what('s|\s+is)\s+in\s+front|what\s+do\s+you\s+see|detect\s+objects?|find\s+objects?|look\s+for\s+objects?)\b/i.test(combined) ||
        /(నా\s+ముందు\s+ఎవరు\s+ఉన్నారు|ఎవరు\s+ఉన్నారు|ఎవరు\s+నిలబడి\s+ఉన్నారు|ఈ\s+వస్తువు\s+ఏమిటి|ఈ\s+వస్తువు\s+ఏమిటో\s+చెప్పు|ఇది\s+ఏ\s+వస్తువో\s+చెప్పు|వస్తువును\s+గుర్తించు|వస్తువులను\s+గుర్తించు|నా\s+ముందు\s+ఏముంది|ఏమి\s+కనిపిస్తోంది)/i.test(combined) ||
        /(मेरे\s+सामने\s+कौन\s+है|सामने\s+कौन\s+है|सामने\s+कौन\s+खड़ा\s+है|कौन\s+है\s+यहाँ|यह\s+कौन\s+सी\s+वस्तु\s+है|यह\s+वस्तु\s+क्या\s+है|यह\s+क्या\s+है|वस्तु\s+पहचानो|वस्तुओं\s+की\s+पहचान\s+करो|पहचान\s+करो|पहचानें|मेरे\s+सामने\s+क्या\s+है)/i.test(combined);

      if (isPersonOrObjectIntent) {
        return findRoute('object-detection');
      }

      // Intent B: Reading / OCR / Text Inspection -> VisionAid AI
      // "Can you read what's written here?", "Please read this document", "Read this text", "Read label",
      // Telugu: "ఇక్కడ ఏమి రాసి ఉందో చదువు", "ఈ పత్రాన్ని చదువు", "ఈ టెక్స్ట్ చదువు", "లేబుల్ చదువు", "నాకు చదివి వినిపించు"
      // Hindi: "यहाँ क्या लिखा है पढ़ो", "यह दस्तावेज़ पढ़ो", "यह टेक्स्ट पढ़ो", "दवा की पर्ची पढ़ो", "मुझे पढ़कर सुनाओ"
      const isReadingIntent =
        /\b(read\s+(what('s|\s+is)\s+written|this(\s+text|\s+document|\s+label|\s+page|\s+book|\s+letter|\s+sign)?|text|document|label|prescription|medicine|to\s+me|for\s+me)|can\s+you\s+read|what\s+does\s+it\s+say|ocr|read\s+it)\b/i.test(combined) ||
        /(ఇక్కడ\s+ఏమి\s+రాసి\s+ఉందో\s+చదువు|ఈ\s+పత్రాన్ని\s+చదువు|ఈ\s+టెక్స్ట్\s+చదువు|టెక్స్ట్\s+చదువు|పత్రం\s+చదువు|లేబుల్\s+చదువు|నాకు\s+చదివి\s+వినిపించు|చదివి\s+చెప్పు|ఏమి\s+రాసి\s+ఉంది)/i.test(combined) ||
        /(यहाँ\s+क्या\s+लिखा\s+है\s+पढ़ो|यह\s+दस्तावेज़\s+पढ़ो|यह\s+टेक्स्ट\s+पढ़ो|टेक्स्ट\s+पढ़ो|दस्तावेज़\s+पढ़ो|दवा\s+की\s+पर्ची\s+पढ़ो|लेबल\s+पढ़ो|मुझे\s+पढ़कर\s+सुनाओ|पढ़कर\s+बताओ|क्या\s+लिखा\s+है)/i.test(combined);

      if (isReadingIntent) {
        return findRoute('visionaid');
      }

      // Intent C: Navigation Guidance / Walking / Obstacles -> PathGuide Pro
      // "Help me walk safely", "Help me navigate", "Guide me as I walk", "Show me the way",
      // "Are there obstacles in my way?", "Guide my path",
      // Telugu: "నాకు దారి చూపించు", "దారి చూపు", "నేను సురక్షితంగా నడవడానికి సహాయం చేయి", "అడ్డంకులు ఏమైనా ఉన్నాయా", "దారి"
      // Hindi: "मुझे रास्ता बताओ", "रास्ता दिखाओ", "मुझे सुरक्षित चलने में मदद करो", "चलने में मदद करो", "क्या रास्ते में कोई रुकावट है"
      const isNavigationIntent =
        /\b(help\s+me\s+(walk|navigate|move)|walk\s+safely|guide\s+(me|my\s+walking|my\s+steps|my\s+path)|show\s+(me\s+the\s+way|direction)|(check|watch|are\s+there)\s+obstacles?|obstacle\s+avoidance|safe\s+walking|walking\s+guidance)\b/i.test(combined) ||
        /(నాకు\s+దారి\s+చూపించు|దారి\s+చూపు|దారి\s+చూపించు|సురక్షితంగా\s+నడవడానికి\s+సహాయం|నడవడానికి\s+సహాయం|అడ్డంకులు\s+ఏమైనా\s+ఉన్నాయా|అడ్డంకులు\s+తనిఖీ\s+చేయి|దారి)/i.test(combined) ||
        /(मुझे\s+रास्ता\s+बताओ|रास्ता\s+दिखाओ|रास्ता\s+बताओ|सुरक्षित\s+चलने\s+में\s+मदद|चलने\s+में\s+मदद\s+करो|क्या\s+रास्ते\s+में\s+कोई\s+रुकावट\s+है|रुकावट\s+जांचो|रास्ता)/i.test(combined);

      if (isNavigationIntent) {
        return findRoute('pathguide');
      }

      // Intent D: Queue / Waiting Line Analysis -> Queue Detector
      // "Check the queue", "How many people in line", "Is there a line", "Wait line check",
      // Telugu: "క్యూ తనిఖీ చేయి", "లైన్లో ఎంతమంది ఉన్నారు", "క్యూలో ఎంతమంది ఉన్నారు", "లైన్ చెక్ చేయి"
      // Hindi: "कतार जांचो", "लाइन में कितने लोग हैं", "कतार में कितने लोग हैं", "लाइन चेक करो"
      const isQueueIntent =
        /\b(how\s+many\s+people\s+(are\s+)?(in\s+line|in\s+the\s+queue|waiting)|(check|track|is\s+there\s+a)\s+(queue|line|waiting\s+line)|queue\s+length|line\s+length)\b/i.test(combined) ||
        /(క్యూ\s+తనిఖీ\s+చేయి|క్యూ\s+చెక్\s+చేయి|లైన్\s+చెక్\s+చేయి|లైన్లో\s+ఎంతమంది\s+ఉన్నారు|క్యూలో\s+ఎంతమంది\s+ఉన్నారు|క్యూ)/i.test(combined) ||
        /(कतार\s+जांचो|कतार\s+चेक\s+करो|लाइन\s+चेक\s+करो|लाइन\s+में\s+कितने\s+लोग\s+हैं|कतार\s+में\s+कितने\s+लोग\s+हैं|कतार|क्यू)/i.test(combined);

      if (isQueueIntent) {
        return findRoute('queue-detector');
      }

      // Intent E: Darkness / Night Mode / Low Light Visibility -> Night Vision
      // "Is it too dark to see clearly?", "It's too dark", "Can't see in dark", "Turn on night vision",
      // Telugu: "చాలా చీకటిగా ఉంది", "స్పష్టంగా కనిపించడం లేదు", "చీకటి", "నైట్ విజన్"
      // Hindi: "बहुत अंधेरा है", "क्या साफ देखने के लिए बहुत अंधेरा है", "अंधेरा", "कम रोशनी"
      const isNightVisionIntent =
        /\b((too\s+dark|very\s+dark|can't\s+see|cannot\s+see|darkness|hard\s+to\s+see)\s+(to\s+see|clearly|here|around|outside)?|night\s+mode|low\s+light(\s+mode)?|night\s+vision)\b/i.test(combined) ||
        /(చాలా\s+చీకటిగా\s+ఉంది|స్పష్టంగా\s+కనిపించడం\s+లేదు|చీకటిగా\s+ఉంది|చీకటి|నైట్\s+విజన్)/i.test(combined) ||
        /(बहुत\s+अंधेरा\s+है|साफ\s+देखने\s+के\s+लिए\s+बहुत\s+अंधेरा|अंधेरा\s+है|अंधेरा|नाइट\s+विज़न|कम\s+रोशनी)/i.test(combined);

      if (isNightVisionIntent) {
        return findRoute('night-vision');
      }

      // Intent F: Camera Quality / Blur / Lens Clarity -> Optima Vision
      // "Check camera quality", "Is camera working", "Check lens", "Is camera blurry",
      // Telugu: "కెమెరా నాణ్యత తనిఖీ చేయి", "లెన్స్ చెక్ చేయి", "కెమెరా సరిగ్గా పనిచేస్తోందా"
      // Hindi: "कैमरा गुणवत्ता जांचो", "लेंस चेक करो", "क्या कैमरा ठीक काम कर रहा है"
      const isCameraQualityIntent =
        /\b((check|test|verify|inspect)\s+(camera(\s+quality)?|lens|visibility)|is\s+(the\s+camera|my\s+camera|lens)\s+(working|blurry|dirty|clean)|camera\s+check|optima)\b/i.test(combined) ||
        /(కెమెరా\s+నాణ్యత\s+తనిఖీ\s+చేయి|కెమెరా\s+చెక్\s+చేయి|లెన్స్\s+చెక్\s+చేయి|కెమెరా\s+సరిగ్గా\s+పనిచేస్తోందా|ఆప్టిమా)/i.test(combined) ||
        /(कैमरा\s+गुणवत्ता\s+जांचो|कैमरा\s+चेक\s+करो|लेंस\s+चेक\s+करो|क्या\s+कैमरा\s+ठीक\s+काम\s+कर\s+रहा\s+है|ऑप्टिमा)/i.test(combined);

      if (isCameraQualityIntent) {
        return findRoute('optima-vision');
      }

      // Intent G: Emergency SOS
      const isSosIntent =
        /\b(help\s+me|i('m|\s+am)\s+in\s+danger|emergency|call\s+112|call\s+(my\s+)?(emergency\s+)?contact|need\s+urgent\s+help|save\s+me)\b/i.test(combined) ||
        /(సహాయం\s+కావాలి|నాకు\s+సహాయం\s+చేయండి|అత్యవసరం|నేను\s+ప్రమాదంలో\s+ఉన్నాను|కాపాడండి)/i.test(combined) ||
        /(मदद\s+चाहिए|मेरी\s+मदद\s+करो|आपातकाल|खतरे\s+में\s+हूँ|बचाओ|इमरजेंसी)/i.test(combined);

      if (isSosIntent) {
        return findRoute('emergency-sos');
      }

      // Intent H: Profile Settings
      const isProfileIntent =
        /\b(profile\s+settings|my\s+profile|edit\s+(my\s+)?(details|profile|name)|change\s+my\s+name|user\s+settings)\b/i.test(combined) ||
        /(నా\s+ప్రొఫైల్|ప్రొఫైల్\s+సెట్టింగ్స్|నా\s+పేరు\s+మార్చు|నా\s+వివరాలు\s+మార్చు)/i.test(combined) ||
        /(मेरी\s+प्रोफ़ाइल|प्रोफ़ाइल\s+सेटिंग्स|मेरा\s+नाम\s+बदलो|मेरा\s+विवरण\s+बदलो)/i.test(combined);

      if (isProfileIntent) {
        return findRoute('profile-setup');
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

      // Update interactive 3D robot companion actions
      if (this.robot3D && typeof this.robot3D.setState === 'function') {
        this.robot3D.setState(state, statusText);
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
