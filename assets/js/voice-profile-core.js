/**
 * Argus.AI — Voice-Guided Profile Core Engine
 * 
 * Modular, deterministic state machine and utilities for accessible
 * voice-first and manual profile onboarding.
 * 
 * Features:
 * - Deterministic, testable state machine (Zero external AI API needed)
 * - Versioned profile schema with local-first persistence
 * - Spoken text normalizer for international phone numbers and commands
 * - Dual-mode controller (Voice via Web Speech API + Manual accessible form)
 * - Concurrency & race-condition guards (single recognition, debouncing, speech cancel)
 */

(function (global) {
  'use strict';

  // -------------------------------------------------------------------------
  // 1. PROFILE SCHEMA & PERSISTENCE
  // -------------------------------------------------------------------------

  const PROFILE_STORAGE_KEY = 'argus_user_profile';
  const EMERGENCY_CONTACT_KEY = 'argus_emergency_contact';
  const CURRENT_PROFILE_VERSION = 1;

  const SUPPORTED_LANGUAGES = {
    en: { code: 'en', bcp47: 'en-IN', name: 'English', label: 'EN' },
    te: { code: 'te', bcp47: 'te-IN', name: 'తెలుగు (Telugu)', label: 'తెలుగు' },
    hi: { code: 'hi', bcp47: 'hi-IN', name: 'हिन्दी (Hindi)', label: 'हिन्दी' }
  };

  function createEmptyProfile() {
    return {
      profileVersion: CURRENT_PROFILE_VERSION,
      displayName: '',
      phoneNumber: '',
      address: '',
      preferredLanguage: 'en',
      emergencyContacts: [],
      completed: false,
      updatedAt: new Date().toISOString()
    };
  }

  const ProfileStorage = {
    getStorageKey() {
      return PROFILE_STORAGE_KEY;
    },

    getLanguagePreference(storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
      if (!storage) return 'en';
      try {
        const val = storage.getItem('argus_language_preference');
        if (val === 'te' || val === 'hi' || val === 'en') return val;
        const profile = this.loadProfile(storage);
        if (profile && (profile.preferredLanguage === 'te' || profile.preferredLanguage === 'hi')) {
          return profile.preferredLanguage;
        }
      } catch (e) {}
      return 'en';
    },

    setLanguagePreference(langCode, storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
      const code = (langCode === 'te' || langCode === 'hi') ? langCode : 'en';
      if (storage) {
        try {
          storage.setItem('argus_language_preference', code);
        } catch (e) {}
      }
      const profile = this.loadProfile(storage);
      profile.preferredLanguage = code;
      this.saveProfile(profile, storage);

      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try {
          window.dispatchEvent(new CustomEvent('argus_language_changed', { detail: { language: code } }));
        } catch (e) {}
      }
      return code;
    },

    loadProfile(storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
      if (!storage) return createEmptyProfile();
      try {
        const raw = storage.getItem(PROFILE_STORAGE_KEY);
        if (!raw) {
          const empty = createEmptyProfile();
          empty.preferredLanguage = this.getLanguagePreference(storage);
          return empty;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return createEmptyProfile();

        // Migrate older versions if needed
        const langVal = (parsed.preferredLanguage === 'te' || parsed.preferredLanguage === 'hi' || parsed.preferredLanguage === 'en')
          ? parsed.preferredLanguage
          : (storage.getItem('argus_language_preference') || 'en');

        return {
          profileVersion: parsed.profileVersion || CURRENT_PROFILE_VERSION,
          displayName: typeof parsed.displayName === 'string' ? parsed.displayName.trim() : '',
          phoneNumber: typeof parsed.phoneNumber === 'string' ? parsed.phoneNumber.trim() : '',
          address: typeof parsed.address === 'string' ? parsed.address.trim() : '',
          preferredLanguage: langVal,
          emergencyContacts: Array.isArray(parsed.emergencyContacts) ? parsed.emergencyContacts : [],
          completed: !!parsed.completed,
          updatedAt: parsed.updatedAt || new Date().toISOString()
        };
      } catch (e) {
        console.warn('[ArgusProfile] Failed to load profile from storage:', e);
        return createEmptyProfile();
      }
    },

    saveProfile(profile, storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
      if (!storage) return false;
      try {
        const langVal = (profile.preferredLanguage === 'te' || profile.preferredLanguage === 'hi' || profile.preferredLanguage === 'en')
          ? profile.preferredLanguage
          : (storage.getItem('argus_language_preference') || 'en');

        const toSave = {
          profileVersion: profile.profileVersion || CURRENT_PROFILE_VERSION,
          displayName: (profile.displayName || '').trim(),
          phoneNumber: (profile.phoneNumber || '').trim(),
          address: (profile.address || '').trim(),
          preferredLanguage: langVal,
          emergencyContacts: Array.isArray(profile.emergencyContacts) ? profile.emergencyContacts : [],
          completed: !!profile.completed,
          updatedAt: new Date().toISOString()
        };
        storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(toSave));
        storage.setItem('argus_language_preference', langVal);

        // Sync Primary Emergency Contact with existing Emergency SOS module
        if (toSave.emergencyContacts && toSave.emergencyContacts.length > 0) {
          const primary = toSave.emergencyContacts[0];
          if (primary && primary.name && primary.phone) {
            storage.setItem(EMERGENCY_CONTACT_KEY, JSON.stringify({
              name: primary.name,
              phone: primary.phone,
              relation: primary.relation || 'Emergency Contact 1',
              isTestMode: primary.isTestMode !== false
            }));
          }
        }

        // Notify runtime and companion controller of profile updates immediately
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          try {
            window.dispatchEvent(new CustomEvent('argus_profile_updated', { detail: toSave }));
            window.dispatchEvent(new CustomEvent('argus_language_changed', { detail: { language: langVal } }));
          } catch (e) {}
        }
        if (typeof window !== 'undefined' && window.argusCompanion && typeof window.argusCompanion.syncUserProfile === 'function') {
          try {
            window.argusCompanion.syncUserProfile();
          } catch (e) {}
        }

        return true;
      } catch (e) {
        console.error('[ArgusProfile] Failed to persist profile:', e);
        return false;
      }
    },

    clearProfile(storage = (typeof window !== 'undefined' ? window.localStorage : null)) {
      if (!storage) return;
      try {
        storage.removeItem(PROFILE_STORAGE_KEY);
        storage.removeItem(EMERGENCY_CONTACT_KEY);

        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
          try {
            window.dispatchEvent(new CustomEvent('argus_profile_updated', { detail: null }));
          } catch (e) {}
        }
        if (typeof window !== 'undefined' && window.argusCompanion && typeof window.argusCompanion.syncUserProfile === 'function') {
          try {
            window.argusCompanion.syncUserProfile();
          } catch (e) {}
        }
      } catch (e) {
        console.warn('[ArgusProfile] Failed to clear profile storage:', e);
      }
    },

    isCompleted(storage) {
      const p = this.loadProfile(storage);
      return !!p.completed;
    },

    hasStarted(storage) {
      const p = this.loadProfile(storage);
      return !!(p.displayName || p.phoneNumber || p.address || (p.emergencyContacts && p.emergencyContacts.length > 0));
    }
  };

  // -------------------------------------------------------------------------
  // 2. SPOKEN TEXT NORMALIZER & COMMAND PARSER
  // -------------------------------------------------------------------------

  const SpokenTextNormalizer = {
    /**
     * Map common spoken words for digits & telephone tokens
     */
    DIGIT_WORDS: {
      zero: '0', oh: '0', o: '0',
      one: '1', won: '1',
      two: '2', to: '2', too: '2',
      three: '3',
      four: '4', for: '4', fore: '4',
      five: '5',
      six: '6',
      seven: '7',
      eight: '8', ate: '8',
      nine: '9',
      plus: '+'
    },

    /**
     * Converts spoken telephone words (e.g. "plus nine one nine eight seven...")
     * into a standardized phone string
     */
    normalizeSpokenPhoneNumber(rawText) {
      if (!rawText || typeof rawText !== 'string') return '';
      let text = rawText.toLowerCase().trim();

      // Replace verbal doubles & triples: "double nine" -> "9 9", "triple zero" -> "0 0 0"
      const multiplierWords = {
        'double zero': '0 0', 'double one': '1 1', 'double two': '2 2', 'double three': '3 3',
        'double four': '4 4', 'double five': '5 5', 'double six': '6 6', 'double seven': '7 7',
        'double eight': '8 8', 'double nine': '9 9',
        'triple zero': '0 0 0', 'triple one': '1 1 1', 'triple two': '2 2 2', 'triple three': '3 3 3',
        'triple four': '4 4 4', 'triple five': '5 5 5', 'triple six': '6 6 6', 'triple seven': '7 7 7',
        'triple eight': '8 8 8', 'triple nine': '9 9 9'
      };

      for (const [key, replacement] of Object.entries(multiplierWords)) {
        text = text.replaceAll(key, replacement);
      }

      // Convert word digits to numeric characters
      const tokens = text.split(/[\s\-]+/);
      const convertedTokens = tokens.map(token => {
        const cleaned = token.replace(/[^a-z0-9\+]/g, '');
        return this.DIGIT_WORDS[cleaned] !== undefined ? this.DIGIT_WORDS[cleaned] : cleaned;
      });

      let joined = convertedTokens.join('');
      // Keep only + and digits
      joined = joined.replace(/[^0-9\+]/g, '');

      // Ensure at most one leading +
      if (joined.includes('+')) {
        joined = '+' + joined.replace(/\+/g, '');
      }

      return joined;
    },

    /**
     * International phone number validation (ITU E.164 compatible: 7 to 15 digits)
     */
    isValidPhoneNumber(phone) {
      if (!phone || typeof phone !== 'string') return false;
      const cleaned = phone.replace(/[\s\-\(\)]/g, '');
      // Optional leading +, then 7 to 15 digits, starting with non-zero
      const e164Regex = /^\+?[1-9]\d{6,14}$/;
      return e164Regex.test(cleaned);
    },

    /**
     * Formats phone number for readable display (e.g., +91 98765 43210 or +1 415 555 0123)
     */
    formatPhoneForDisplay(phone) {
      if (!phone) return '';
      const clean = phone.replace(/[\s\-\(\)]/g, '');
      if (clean.startsWith('+')) {
        // Simple chunking for international numbers
        const countryDigits = clean.length > 12 ? 3 : 2;
        const cc = clean.slice(0, countryDigits);
        const rest = clean.slice(countryDigits);
        if (rest.length > 5) {
          return `${cc} ${rest.slice(0, 5)} ${rest.slice(5)}`;
        }
        return `${cc} ${rest}`;
      }
      return clean;
    },

    /**
     * Converts phone number into spaced digits so TTS reads it clearly one by one
     */
    formatPhoneForSpeech(phone) {
      if (!phone) return '';
      const clean = phone.replace(/[\s\-\(\)]/g, '');
      const parts = [];
      for (const char of clean) {
        if (char === '+') parts.push('plus');
        else parts.push(char);
      }
      return parts.join(' ');
    },

    /**
     * Clean and capitalize display name
     */
    cleanDisplayName(raw) {
      if (!raw) return '';
      // Remove conversational prefix e.g. "my name is Prem", "it is Prem", "call me Prem"
      let cleaned = raw.replace(/^(my name is|it's|it is|i am|i'm|call me|this is)\s+/i, '');
      cleaned = cleaned.replace(/[\.\,\!\"\'\?]/g, '').trim();
      if (!cleaned) return '';
      return cleaned
        .split(' ')
        .map(w => w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : '')
        .join(' ');
    },

    /**
     * Standardize spoken text by converting to lowercase, standardizing apostrophes,
     * removing harsh punctuation, and collapsing multiple spaces.
     */
    normalizeText(raw) {
      if (!raw || typeof raw !== 'string') return '';
      return raw
        .toLowerCase()
        .replace(/[’‘`]/g, "'") // standardize apostrophes
        .replace(/[.,!?;:"_\-\(\)\/]/g, ' ') // convert punctuation to space
        .replace(/\s+/g, ' ') // collapse multiple spaces
        .trim();
    },

    /**
     * Recognize natural affirmative confirmation phrases
     */
    isAffirmative(rawText) {
      const text = this.normalizeText(rawText);
      if (!text) return false;
      const noApos = text.replace(/'/g, ''); // "thats correct", "thats right"

      // 1. Exact tokens
      const exactTokens = /^(yes|yeah|yep|yup|sure|correct|affirmative|confirm|proceed|sounds good|you got it|looks good|definitely|absolutely)$/i;
      if (exactTokens.test(text) || exactTokens.test(noApos)) return true;

      // 2. Comprehensive affirmative phrases
      const affirmativePhrases = [
        /^(yes\s+)?(that\s*is|thats)\s*(correct|right|true|accurate)$/i,
        /^(that\s*is|thats)\s*(correct|right|true|accurate)$/i,
        /^(yes\s+)?(it\s*is|its)\s*(correct|right)$/i,
        /^(it\s*is|its)\s*(correct|right)$/i,
        /^yes\s+(correct|right|please|sure|definitely|affirmative|it is|its me)$/i,
        /^(that\s*is|thats)\s*my\s*(name|phone|number|address|contact)$/i,
        /^(yes\s+)?(that\s*is|thats)\s*my\s*(name|phone|number|address|contact)$/i,
        /\b(thats\s*(correct|right|my\s*(name|number|phone|address)))\b/i,
        /\b(that\s+is\s*(correct|right|my\s*(name|number|phone|address)))\b/i
      ];

      return affirmativePhrases.some(p => p.test(text) || p.test(noApos));
    },

    /**
     * Recognize natural negative rejection or correction phrases
     */
    isNegative(rawText) {
      const text = this.normalizeText(rawText);
      if (!text) return false;
      const noApos = text.replace(/'/g, '');

      // 1. Exact negative tokens
      const exactTokens = /^(no|nope|nah|incorrect|wrong|negative|redo|cancel)$/i;
      if (exactTokens.test(text) || exactTokens.test(noApos)) return true;

      // 2. Comprehensive rejection phrases
      const negativePhrases = [
        /^(not\s*(correct|right|true|accurate|my\s*(name|number|phone|address)))$/i,
        /^(no\s+)?(that\s*is|thats)\s*(wrong|incorrect|false|not\s*right|not\s*correct)$/i,
        /^(that\s*is|thats)\s*(wrong|incorrect|false|not\s*right|not\s*correct)$/i,
        /^(no\s+)?(that\s*is|thats)\s*not\s*my\s*(name|number|phone|address|contact)$/i,
        /^(change\s*it|let\s*me\s*(correct|change)\s*(that|it)|try\s*again)$/i,
        /^no\s+(thats\s*wrong|thats\s*incorrect|not\s*correct|change\s*it|wrong)$/i,
        /\b(thats\s*(wrong|incorrect|not\s*(correct|right|my\s*(name|number))))\b/i,
        /\b(let\s*me\s*(correct|change)\s*(that|it))\b/i
      ];

      return negativePhrases.some(p => p.test(text) || p.test(noApos));
    },

    /**
     * Parse global voice commands from spoken transcript
     */
    detectCommand(transcript) {
      if (!transcript || typeof transcript !== 'string') return null;

      if (this.isAffirmative(transcript)) {
        return 'YES';
      }

      if (this.isNegative(transcript)) {
        return 'NO';
      }

      const text = this.normalizeText(transcript);
      const noApos = text.replace(/'/g, '');

      if (/\b(repeat|repeat the question|say again|what was the question|pardon|pardon me|what did you say)\b/i.test(text)) {
        return 'REPEAT';
      }
      if (/^(skip|pass|skip this|skip question|next|leave blank)$/i.test(text) || exactMatch(noApos, 'skip')) {
        return 'SKIP';
      }
      if (/\b(go back|previous|previous question|back)\b/i.test(text)) {
        return 'BACK';
      }
      if (/\b(cancel setup|exit setup|cancel|stop|close setup|quit)\b/i.test(text)) {
        return 'CANCEL';
      }
      if (/\b(fill manually|manual|switch to manual|manual form|typing|type)\b/i.test(text)) {
        return 'MANUAL';
      }

      return null;
    }
  };

  function exactMatch(str, target) {
    return str === target;
  }

  // -------------------------------------------------------------------------
  // 3. STEP DEFINITIONS FOR PROFILE ONBOARDING
  // -------------------------------------------------------------------------

  const STEPS = [
    {
      id: 'displayName',
      stepNumber: 1,
      totalSteps: 5,
      title: 'Your Name',
      fieldLabel: 'Display Name',
      isRequired: true,
      questionSpoken: 'What is your name?',
      questionDisplay: 'What is your name?',
      helpText: 'Say your full or preferred name. You can also type it below.',
      confirmSpoken: (val) => `I heard ${val}. Is that correct?`,
      parseAnswer: (transcript) => SpokenTextNormalizer.cleanDisplayName(transcript),
      validate: (val) => Boolean(val && val.trim().length >= 2),
      invalidMessage: "Please provide a valid name with at least two characters."
    },
    {
      id: 'phoneNumber',
      stepNumber: 2,
      totalSteps: 5,
      title: 'Phone Number',
      fieldLabel: 'Personal Phone',
      isRequired: false,
      questionSpoken: 'What is your phone number, including your country code? You can say skip if you prefer.',
      questionDisplay: 'What is your phone number, including country code?',
      helpText: 'Example: +1 415 555 0123 or +91 98765 43210. Say "Skip" to leave blank.',
      confirmSpoken: (val) => `I heard phone number ${SpokenTextNormalizer.formatPhoneForSpeech(val)}. Is that correct?`,
      parseAnswer: (transcript) => SpokenTextNormalizer.normalizeSpokenPhoneNumber(transcript),
      validate: (val) => !val || SpokenTextNormalizer.isValidPhoneNumber(val),
      invalidMessage: "Please provide a valid phone number with country code (e.g. +1 555 123 4567 or +91 98765 43210), or say 'skip'."
    },
    {
      id: 'address',
      stepNumber: 3,
      totalSteps: 5,
      title: 'Your Address',
      fieldLabel: 'Home / Primary Address',
      isRequired: false,
      questionSpoken: 'Would you like to add your address? You can skip this.',
      questionDisplay: 'Would you like to add your address? (Optional)',
      helpText: 'Enter your city or address. Say "Skip" if you do not want to add an address.',
      confirmSpoken: (val) => `I heard address: ${val}. Is that correct?`,
      parseAnswer: (transcript) => transcript.replace(/^(my address is|it's|it is)\s+/i, '').trim(),
      validate: (val) => true, // Optional free text
      invalidMessage: ""
    },
    {
      id: 'emergencyContact1',
      stepNumber: 4,
      totalSteps: 5,
      title: 'Primary Emergency Contact',
      fieldLabel: 'Emergency Contact 1',
      isRequired: false, // Can be skipped, but highly recommended
      subStep: 'name', // Sub-steps: 'name' then 'phone'
      questionSpoken: 'Who is your primary emergency contact? Please say their name.',
      questionDisplay: 'Primary emergency contact name & WhatsApp number',
      helpText: 'First say the contact name, then you will provide their WhatsApp phone number.',
      validate: (val) => true
    },
    {
      id: 'emergencyContact2',
      stepNumber: 5,
      totalSteps: 5,
      title: 'Secondary Emergency Contact',
      fieldLabel: 'Emergency Contact 2',
      isRequired: false,
      questionSpoken: 'Would you like to add a second emergency contact? Say yes, or say skip.',
      questionDisplay: 'Secondary emergency contact (Optional)',
      helpText: 'Say "Yes" to add a second contact, or "Skip" to complete setup.',
      validate: (val) => true
    }
  ];

  // -------------------------------------------------------------------------
  // 4. CONVERSATIONAL PROFILE STATE MACHINE
  // -------------------------------------------------------------------------

  const MachineState = {
    WELCOME: 'WELCOME',
    ASKING: 'ASKING',
    LISTENING: 'LISTENING',
    CONFIRMING: 'CONFIRMING',
    SAVING: 'SAVING',
    REVIEW: 'REVIEW',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    MANUAL_MODE: 'MANUAL_MODE'
  };

  class VoiceProfileStateMachine {
    constructor(options = {}) {
      this.storage = options.storage || (typeof window !== 'undefined' ? window.localStorage : null);
      this.speechService = options.speechService || null;

      // Callbacks
      this.onStateChange = options.onStateChange || (() => {});
      this.onTranscriptUpdate = options.onTranscriptUpdate || (() => {});
      this.onProgressUpdate = options.onProgressUpdate || (() => {});
      this.onError = options.onError || (() => {});

      // Internal State
      this.state = MachineState.WELCOME;
      this.currentStepIndex = 0;
      this.pendingValue = null;
      this.contactSubStep = 'name'; // for emergencyContact: 'name' | 'phone' | 'confirm'
      this.pendingContact = { name: '', phone: '', relation: '', isTestMode: true };
      this.profile = ProfileStorage.loadProfile(this.storage);

      // Concurrency and race guards
      this.isBusy = false;
      this.activeUtterance = null;
      this.silenceTimeoutTimer = null;
    }

    /**
     * Get current machine state & step info
     */
    getState() {
      return {
        state: this.state,
        currentStepIndex: this.currentStepIndex,
        currentStep: STEPS[this.currentStepIndex] || null,
        pendingValue: this.pendingValue,
        contactSubStep: this.contactSubStep,
        pendingContact: { ...this.pendingContact },
        profile: { ...this.profile }
      };
    }

    /**
     * Start onboarding from Welcome screen
     */
    startVoiceFlow() {
      this.profile = ProfileStorage.loadProfile(this.storage);
      // Determine where to resume if partial profile exists
      this.currentStepIndex = this._determineResumeStep();
      this.contactSubStep = 'name';
      this.pendingValue = null;
      this._transitionTo(MachineState.ASKING);
      this._askCurrentQuestion();
    }

    /**
     * Switch to manual mode
     */
    switchToManualMode() {
      this._cancelSpeechAndRecognition();
      this._transitionTo(MachineState.MANUAL_MODE);
    }

    /**
     * Skip setup for now (persists partial progress, marks incomplete)
     */
    skipForNow() {
      this._cancelSpeechAndRecognition();
      this.profile.completed = false;
      ProfileStorage.saveProfile(this.profile, this.storage);
      this._transitionTo(MachineState.CANCELLED);
    }

    /**
     * Cancel setup completely
     */
    cancelSetup() {
      this._cancelSpeechAndRecognition();
      this._transitionTo(MachineState.CANCELLED);
    }

    /**
     * Clear profile data completely
     */
    clearProfile() {
      this._cancelSpeechAndRecognition();
      ProfileStorage.clearProfile(this.storage);
      this.profile = createEmptyProfile();
      this.currentStepIndex = 0;
      this.pendingValue = null;
      this._transitionTo(MachineState.WELCOME);
    }

    /**
     * Repeat the current question
     */
    repeatQuestion() {
      if (this.state === MachineState.CONFIRMING) {
        this._askConfirmation();
      } else {
        this._transitionTo(MachineState.ASKING);
        this._askCurrentQuestion();
      }
    }

    /**
     * Go back to previous step
     */
    goBack() {
      if (this.currentStepIndex > 0) {
        this.currentStepIndex--;
        this.pendingValue = null;
        this.contactSubStep = 'name';
        this._transitionTo(MachineState.ASKING);
        this._askCurrentQuestion();
      } else {
        this._speak("You are at the first step.");
      }
    }

    /**
     * Skip the current optional field
     */
    skipCurrentField() {
      const step = STEPS[this.currentStepIndex];
      if (!step) return;

      if (step.isRequired) {
        this._speak("Your name is required to personalize your Argus vision experience. What name would you like me to use?");
        this._transitionTo(MachineState.LISTENING);
        this._startListening();
        return;
      }

      this._speak("Skipping.");
      this._advanceToNextStep();
    }

    /**
     * Handle manual submission of the current step
     */
    submitManualAnswer(val) {
      const step = STEPS[this.currentStepIndex];
      if (!step) return;

      if (step.id === 'emergencyContact1' || step.id === 'emergencyContact2') {
        if (typeof val === 'object' && val !== null) {
          if (!val.name && step.id === 'emergencyContact2') {
            // Skipped 2nd contact
            this._advanceToNextStep();
            return;
          }
          if (!val.name) {
            this.onError("Emergency contact name is required.");
            return;
          }
          if (val.phone && !SpokenTextNormalizer.isValidPhoneNumber(val.phone)) {
            this.onError("Please enter a valid international phone number.");
            return;
          }
          this._saveEmergencyContact(step.id === 'emergencyContact1' ? 0 : 1, {
            name: val.name.trim(),
            phone: val.phone ? val.phone.trim() : '',
            relation: val.relation || (step.id === 'emergencyContact1' ? 'Emergency Contact 1' : 'Emergency Contact 2'),
            isTestMode: val.isTestMode !== false
          });
          this._advanceToNextStep();
          return;
        }
      }

      // Standard field validation
      if (step.isRequired && (!val || val.trim().length < 2)) {
        this.onError(step.invalidMessage || "This field is required.");
        return;
      }

      if (step.id === 'phoneNumber' && val) {
        const norm = SpokenTextNormalizer.normalizeSpokenPhoneNumber(val);
        if (!SpokenTextNormalizer.isValidPhoneNumber(norm)) {
          this.onError(step.invalidMessage);
          return;
        }
        val = norm;
      }

      this.profile[step.id] = (val || '').trim();
      ProfileStorage.saveProfile(this.profile, this.storage);
      this._advanceToNextStep();
    }

    /**
     * Handle user confirmation ("Yes" or "No")
     */
    handleConfirmation(isYes) {
      const step = STEPS[this.currentStepIndex];
      if (!step) return;

      if (isYes) {
        if (this.isProcessingConfirmation) return;
        this.isProcessingConfirmation = true;
        this._handleConfirmedValue();
      } else {
        this.isProcessingConfirmation = false;
        // User answered "No" -> ask to repeat or correct value
        this.pendingValue = null;
        if (step.id === 'emergencyContact1' || step.id === 'emergencyContact2') {
          this.contactSubStep = 'name';
          this.pendingContact = { name: '', phone: '', relation: '', isTestMode: true };
        }
        this._transitionTo(MachineState.LISTENING);
        this._speak("Understood. Let's fix that. Please say your answer again, or tap Fill Manually.", () => {
          this._startListening();
        });
      }
    }

    /**
     * Process spoken input from speech recognition
     */
    processSpokenInput(rawTranscript) {
      if (!rawTranscript || !rawTranscript.trim()) return;
      const transcript = rawTranscript.trim();
      this.onTranscriptUpdate({ transcript, isFinal: true });

      // Check for global commands first
      const cmd = SpokenTextNormalizer.detectCommand(transcript);

      // In CONFIRMING state, YES / NO takes priority
      if (this.state === MachineState.CONFIRMING) {
        if (cmd === 'YES') {
          this.handleConfirmation(true);
          return;
        }
        if (cmd === 'NO') {
          this.handleConfirmation(false);
          return;
        }
      }

      // Universal navigation commands
      if (cmd === 'REPEAT') {
        this.repeatQuestion();
        return;
      }
      if (cmd === 'BACK') {
        this.goBack();
        return;
      }
      if (cmd === 'CANCEL') {
        this.cancelSetup();
        return;
      }
      if (cmd === 'MANUAL') {
        this.switchToManualMode();
        return;
      }
      if (cmd === 'SKIP') {
        this.skipCurrentField();
        return;
      }

      // In CONFIRMING state, guard against duplicate speech events or extraneous noise
      if (this.state === MachineState.CONFIRMING) {
        this._speak("Please say 'Yes' to confirm, or 'No' to change it.");
        this._startListening();
        return;
      }

      // Step-specific input handling
      const step = STEPS[this.currentStepIndex];
      if (!step) return;

      if (step.id === 'emergencyContact1') {
        this._handleEmergencyContact1Spoken(transcript);
        return;
      }

      if (step.id === 'emergencyContact2') {
        this._handleEmergencyContact2Spoken(transcript);
        return;
      }

      // Standard fields: Display Name, Phone Number, Address
      const parsed = step.parseAnswer ? step.parseAnswer(transcript) : transcript;

      // Validate
      if (step.validate && !step.validate(parsed)) {
        this._speak(step.invalidMessage || "I couldn't validate that. Please say it again or say skip.");
        this._transitionTo(MachineState.LISTENING);
        this._startListening();
        return;
      }

      // Valid answer received -> Move to CONFIRMING state
      this.pendingValue = parsed;
      this._transitionTo(MachineState.CONFIRMING);
      this._askConfirmation();
    }

    /**
     * Finish setup from review screen
     */
    finishSetup() {
      this.profile.completed = true;
      this.profile.updatedAt = new Date().toISOString();
      ProfileStorage.saveProfile(this.profile, this.storage);
      this._transitionTo(MachineState.COMPLETED);
      this._speak("Your profile is ready. You can edit your details anytime. Welcome to Argus.AI!");
    }

    // -----------------------------------------------------------------------
    // INTERNAL HELPERS
    // -----------------------------------------------------------------------

    _determineResumeStep() {
      if (!this.profile.displayName) return 0;
      if (!this.profile.phoneNumber && !this.profile.address) return 1;
      return 0; // default start at beginning for review
    }

    _transitionTo(newState) {
      this.state = newState;
      this.onStateChange(this.getState());
      this.onProgressUpdate({
        stepNumber: (STEPS[this.currentStepIndex] ? STEPS[this.currentStepIndex].stepNumber : 5),
        totalSteps: 5,
        percentage: Math.round(((this.currentStepIndex) / 5) * 100)
      });
    }

    _askCurrentQuestion() {
      const step = STEPS[this.currentStepIndex];
      if (!step) {
        this._showReview();
        return;
      }

      let textToSpeak = step.questionSpoken;
      if (step.id === 'emergencyContact1') {
        if (this.contactSubStep === 'name') {
          textToSpeak = "Who is your primary emergency contact? Please say their name.";
        } else if (this.contactSubStep === 'phone') {
          textToSpeak = `What is ${this.pendingContact.name}'s WhatsApp phone number with country code?`;
        }
      } else if (step.id === 'emergencyContact2') {
        if (this.contactSubStep === 'name') {
          textToSpeak = "Would you like to add a second emergency contact? Say yes, or say skip.";
        } else if (this.contactSubStep === 'name_entry') {
          textToSpeak = "What is the second contact's name?";
        } else if (this.contactSubStep === 'phone') {
          textToSpeak = `What is ${this.pendingContact.name}'s WhatsApp phone number with country code?`;
        }
      }

      this._speak(textToSpeak, () => {
        // After robot finishes speaking, start listening
        if (this.state === MachineState.ASKING) {
          this._transitionTo(MachineState.LISTENING);
          this._startListening();
        }
      });
    }

    _askConfirmation() {
      const step = STEPS[this.currentStepIndex];
      if (!step) return;

      let confirmText = '';
      if (step.confirmSpoken) {
        confirmText = step.confirmSpoken(this.pendingValue);
      } else if (step.id === 'emergencyContact1' || step.id === 'emergencyContact2') {
        const spokenPhone = SpokenTextNormalizer.formatPhoneForSpeech(this.pendingContact.phone);
        confirmText = `I have ${this.pendingContact.name} with number ${spokenPhone}. Is this correct?`;
      } else {
        confirmText = `I heard ${this.pendingValue}. Is that correct?`;
      }

      this._speak(confirmText, () => {
        if (this.state === MachineState.CONFIRMING) {
          this._startListening();
        }
      });
    }

    _handleConfirmedValue() {
      const step = STEPS[this.currentStepIndex];
      if (!step) return;

      this._transitionTo(MachineState.SAVING);

      if (step.id === 'emergencyContact1' || step.id === 'emergencyContact2') {
        const idx = step.id === 'emergencyContact1' ? 0 : 1;
        this._saveEmergencyContact(idx, {
          name: this.pendingContact.name,
          phone: this.pendingContact.phone,
          relation: step.id === 'emergencyContact1' ? 'Emergency Contact 1' : 'Emergency Contact 2',
          isTestMode: true
        });
        this.pendingContact = { name: '', phone: '', relation: '', isTestMode: true };
        this.contactSubStep = 'name';
      } else {
        this.profile[step.id] = this.pendingValue;
        ProfileStorage.saveProfile(this.profile, this.storage);
      }

      this.pendingValue = null;
      this.isProcessingConfirmation = false;
      this._advanceToNextStep();
    }

    _handleEmergencyContact1Spoken(transcript) {
      if (this.contactSubStep === 'name') {
        const name = SpokenTextNormalizer.cleanDisplayName(transcript);
        if (!name || name.length < 2) {
          this._speak("Please say the full name of your emergency contact, or tap Fill Manually.");
          this._startListening();
          return;
        }
        this.pendingContact.name = name;
        this.contactSubStep = 'phone';
        this._speak(`Thank you. What is ${name}'s WhatsApp phone number, including country code?`, () => {
          this._startListening();
        });
        return;
      }

      if (this.contactSubStep === 'phone') {
        const phone = SpokenTextNormalizer.normalizeSpokenPhoneNumber(transcript);
        if (!SpokenTextNormalizer.isValidPhoneNumber(phone)) {
          this._speak("I couldn't catch a valid international phone number. You can say it again, or tap Fill Manually to type it.");
          this._startListening();
          return;
        }
        this.pendingContact.phone = phone;
        this.contactSubStep = 'confirm';
        this._transitionTo(MachineState.CONFIRMING);
        this._askConfirmation();
      }
    }

    _handleEmergencyContact2Spoken(transcript) {
      if (this.contactSubStep === 'name') {
        const cmd = SpokenTextNormalizer.detectCommand(transcript);
        if (cmd === 'NO' || cmd === 'SKIP') {
          this._speak("All set!");
          this._showReview();
          return;
        }
        if (cmd === 'YES') {
          this.contactSubStep = 'name_entry';
          this._speak("What is the second contact's name?", () => {
            this._startListening();
          });
          return;
        }
        // User may have directly spoken the name
        const name = SpokenTextNormalizer.cleanDisplayName(transcript);
        if (name && name.length >= 2) {
          this.pendingContact.name = name;
          this.contactSubStep = 'phone';
          this._speak(`What is ${name}'s WhatsApp phone number with country code?`, () => {
            this._startListening();
          });
          return;
        }
        this._speak("Would you like to add a second emergency contact? Say yes, or say skip.");
        this._startListening();
        return;
      }

      if (this.contactSubStep === 'name_entry') {
        const name = SpokenTextNormalizer.cleanDisplayName(transcript);
        if (!name || name.length < 2) {
          this._speak("Please say the contact's name, or say skip.");
          this._startListening();
          return;
        }
        this.pendingContact.name = name;
        this.contactSubStep = 'phone';
        this._speak(`What is ${name}'s WhatsApp phone number with country code?`, () => {
          this._startListening();
        });
        return;
      }

      if (this.contactSubStep === 'phone') {
        const phone = SpokenTextNormalizer.normalizeSpokenPhoneNumber(transcript);
        if (!SpokenTextNormalizer.isValidPhoneNumber(phone)) {
          this._speak("Please say a valid phone number with country code, or tap Fill Manually.");
          this._startListening();
          return;
        }
        this.pendingContact.phone = phone;
        this.contactSubStep = 'confirm';
        this._transitionTo(MachineState.CONFIRMING);
        this._askConfirmation();
      }
    }

    _saveEmergencyContact(index, contactObj) {
      if (!Array.isArray(this.profile.emergencyContacts)) {
        this.profile.emergencyContacts = [];
      }
      this.profile.emergencyContacts[index] = contactObj;
      ProfileStorage.saveProfile(this.profile, this.storage);
    }

    _advanceToNextStep() {
      this.currentStepIndex++;
      this.pendingValue = null;
      this.contactSubStep = 'name';

      if (this.currentStepIndex >= STEPS.length) {
        this._showReview();
      } else {
        this._transitionTo(MachineState.ASKING);
        this._askCurrentQuestion();
      }
    }

    _showReview() {
      this._cancelSpeechAndRecognition();
      this._transitionTo(MachineState.REVIEW);
      this._speak("We've gathered your details. Please review your profile summary on screen, or confirm to finish.");
    }

    _speak(text, onEnd) {
      if (!this.speechService) {
        if (onEnd) onEnd();
        return;
      }
      this.speechService.speak(text, onEnd);
    }

    _startListening() {
      if (!this.speechService) return;
      this.speechService.startListening((transcript, isFinal) => {
        if (isFinal) {
          this.processSpokenInput(transcript);
        } else {
          this.onTranscriptUpdate({ transcript, isFinal: false });
        }
      });
    }

    _cancelSpeechAndRecognition() {
      if (this.speechService) {
        this.speechService.cancel();
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. MODULAR SPEECH SERVICE ABSTRACTION
  // -------------------------------------------------------------------------

  class ArgusSpeechService {
    constructor(options = {}) {
      const savedLang = (typeof window !== 'undefined' && window.localStorage)
        ? window.localStorage.getItem('argus_language_preference')
        : 'en';
      const defaultBcp47 = (savedLang === 'te') ? 'te-IN' : (savedLang === 'hi') ? 'hi-IN' : 'en-IN';
      this.lang = options.lang || defaultBcp47;
      // Calm, comfortable, natural pacing (0.95)
      this.voiceRate = options.voiceRate || 0.95;
      this.pitch = options.pitch || 1.0;
      this.volume = options.volume || 1.0;
      this.onListeningChange = options.onListeningChange || (() => {});
      this.onSpeakingChange = options.onSpeakingChange || (() => {});
      this.onError = options.onError || (() => {});

      this.recognition = null;
      this.isListening = false;
      this.isSpeaking = false;
      this.activeUtterance = null;
      this.silenceTimer = null;
      this.silenceTimeoutMs = options.silenceTimeoutMs || 9000;
      this.selectedVoice = null;
      this.onResultCallback = null;
      this._isStartingRecognition = false;

      this._initVoices();
      this._initRecognition();
    }

    setLanguage(langCode) {
      const code = (langCode === 'te' || langCode === 'te-IN') ? 'te-IN'
                 : (langCode === 'hi' || langCode === 'hi-IN') ? 'hi-IN'
                 : 'en-IN';
      this.lang = code;
      if (this.recognition) {
        this.recognition.lang = code;
      }
      this.selectedVoice = this._selectBestVoice();
      return this.lang;
    }

    isSupported() {
      if (typeof window === 'undefined') return false;
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      return Boolean(SpeechRecognition && window.speechSynthesis);
    }

    _initVoices() {
      if (typeof window === 'undefined' || !window.speechSynthesis || typeof window.speechSynthesis.getVoices !== 'function') return;
      this.selectedVoice = this._selectBestVoice();
      if (typeof window.speechSynthesis.onvoiceschanged !== 'undefined') {
        window.speechSynthesis.onvoiceschanged = () => {
          this.selectedVoice = this._selectBestVoice();
        };
      }
    }

    _selectBestVoice() {
      if (typeof window === 'undefined' || !window.speechSynthesis || typeof window.speechSynthesis.getVoices !== 'function') return null;
      const voices = window.speechSynthesis.getVoices();
      if (!voices || voices.length === 0) return null;

      // 1. If active language is Telugu (te / te-IN)
      if (this.lang.startsWith('te')) {
        const teVoice = voices.find(v => v.lang.startsWith('te') || /telugu/i.test(v.name));
        if (teVoice) return teVoice;
      }

      // 2. If active language is Hindi (hi / hi-IN)
      if (this.lang.startsWith('hi')) {
        const hiVoice = voices.find(v => 
          v.lang.startsWith('hi') || 
          /hindi/i.test(v.name) || 
          /(lekha|kalpana|neel)/i.test(v.name)
        );
        if (hiVoice) return hiVoice;
      }

      // 3. Natural / Enhanced / Neural / Premium English voices
      const naturalPref = voices.find(v => 
        v.lang.startsWith('en') && 
        /(natural|enhanced|premium|neural)/i.test(v.name)
      );
      if (naturalPref) return naturalPref;

      // 4. High-quality system English voices (Samantha, Ava, Serena, Karen, Daniel, Oliver, Alex)
      const systemPref = voices.find(v => 
        v.lang.startsWith('en') && 
        /^(samantha|ava|serena|karen|daniel|oliver|kate|tessa|moira|alex)/i.test(v.name)
      );
      if (systemPref) return systemPref;

      // 5. Google Chrome English voices
      const googlePref = voices.find(v => 
        v.name.includes('Google') && v.lang.startsWith('en')
      );
      if (googlePref) return googlePref;

      // 6. Default or local en-US / en-GB / en-IN voice
      const localPref = voices.find(v => (v.lang === 'en-IN' || v.lang === 'en-US') && v.localService) ||
                        voices.find(v => v.lang.startsWith('en') && v.default) ||
                        voices.find(v => v.lang.startsWith('en'));
      if (localPref) return localPref;

      return voices[0] || null;
    }

    getSelectedVoice() {
      if (!this.selectedVoice) {
        this.selectedVoice = this._selectBestVoice();
      }
      return this.selectedVoice;
    }

    _initRecognition() {
      if (typeof window === 'undefined') return;
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) return;

      try {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = false; // We want single-utterance turn taking
        this.recognition.interimResults = true;
        this.recognition.lang = this.lang;
        this.recognition.maxAlternatives = 1;
      } catch (e) {
        console.warn('[ArgusSpeech] Failed to initialize SpeechRecognition:', e);
      }
    }

    speak(text, onEnd) {
      if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
        if (onEnd) onEnd();
        return;
      }

      this.cancel(); // Stop existing speech and recognition to prevent collisions

      const cleanText = text.replace(/[*#_~`]/g, '');
      const utterance = new SpeechSynthesisUtterance(cleanText);
      const voice = this.getSelectedVoice();
      if (voice) {
        utterance.voice = voice;
      }
      utterance.rate = this.voiceRate;
      utterance.pitch = this.pitch;
      utterance.volume = this.volume;
      utterance.lang = this.lang;

      // Retain utterance reference on window to prevent Chrome GC discarding it mid-speech
      this.activeUtterance = utterance;
      if (typeof window !== 'undefined') {
        window._argusUtterance = utterance;
      }

      this.isSpeaking = true;
      this.onSpeakingChange(true);

      let finished = false;
      const finishSpeech = () => {
        if (finished) return;
        finished = true;
        if (this._ttsWatchdog) {
          clearTimeout(this._ttsWatchdog);
          this._ttsWatchdog = null;
        }
        this.isSpeaking = false;
        this.activeUtterance = null;
        this.onSpeakingChange(false);
        // Guard delay (200ms) so speaker resonance finishes before mic starts
        setTimeout(() => {
          if (onEnd) onEnd();
        }, 200);
      };

      utterance.onend = finishSpeech;
      utterance.onerror = (err) => {
        console.warn('[ArgusSpeech] TTS utterance error:', err);
        finishSpeech();
      };

      // Watchdog timer: safety cleanup in case browser loses onend event
      const estimatedMs = Math.max(3500, Math.min(12000, cleanText.length * 85));
      this._ttsWatchdog = setTimeout(() => {
        if (this.isSpeaking && this.activeUtterance === utterance) {
          console.warn('[ArgusSpeech] TTS watchdog timeout triggered.');
          finishSpeech();
        }
      }, estimatedMs);

      // Workaround for Chrome paused speech synthesis bug
      if (window.speechSynthesis.paused) {
        try { window.speechSynthesis.resume(); } catch (e) {}
      }

      window.speechSynthesis.speak(utterance);
    }

    previewVoice(customText) {
      const sample = customText || "Hello! I'm Argus, your calm and friendly vision assistant. I'm ready to help you set up your profile.";
      this.speak(sample);
    }

    startListening(onResultCallback, options = {}) {
      if (!this.recognition) {
        this.onError('Speech recognition is not supported in this browser.');
        return;
      }

      // If assistant is currently speaking, do not open mic yet
      if (this.isSpeaking) {
        return;
      }

      this.onResultCallback = onResultCallback;
      const isWakeWord = Boolean(options && options.isWakeWord);
      this.isWakeWordMode = isWakeWord;

      // If already listening or starting, handle mode switch smoothly
      if (this.isListening || this._isStartingRecognition) {
        if (this._currentModeIsWake === isWakeWord) {
          return; // Already in requested mode
        }
        // Mode changed: stop current and switch
        this.stopListening();
        setTimeout(() => {
          this.startListening(onResultCallback, options);
        }, 100);
        return;
      }

      this._currentModeIsWake = isWakeWord;
      this._isStartingRecognition = true;
      if (!isWakeWord) {
        this._resetSilenceTimer();
      } else {
        this._clearSilenceTimer();
      }

      // Set continuous mode for wake word listening
      try {
        this.recognition.continuous = isWakeWord;
      } catch (e) {}

      this.recognition.onstart = () => {
        this._isStartingRecognition = false;
        this.isListening = true;
        this.onListeningChange(true);
      };

      this.recognition.onresult = (event) => {
        if (!isWakeWord) {
          this._clearSilenceTimer();
        }
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript.trim()) {
          if (!isWakeWord) {
            this.stopListening();
          }
          if (this.onResultCallback) {
            this.onResultCallback(finalTranscript.trim(), true);
          }
        } else if (interimTranscript.trim()) {
          if (this.onResultCallback) {
            this.onResultCallback(interimTranscript.trim(), false);
          }
        }
      };

      this.recognition.onerror = (event) => {
        if (!isWakeWord) {
          this._clearSilenceTimer();
        }
        this._isStartingRecognition = false;
        this.isListening = false;
        this.onListeningChange(false);

        if (event.error === 'not-allowed' || event.error === 'permission-denied') {
          this.onError('Microphone permission was denied. Please allow microphone access in your browser settings.');
        } else if (event.error === 'no-speech') {
          // In wake-word mode, silence is normal and expected; do not trigger error notice
          if (!isWakeWord) {
            this.onError('No speech was detected. Please try again or tap Repeat.');
          }
        } else if (event.error !== 'aborted') {
          console.warn('[ArgusSpeech] Recognition error:', event.error);
        }
      };

      this.recognition.onend = () => {
        if (!isWakeWord) {
          this._clearSilenceTimer();
        }
        this._isStartingRecognition = false;
        this.isListening = false;
        this.onListeningChange(false);
      };

      try {
        this.recognition.start();
      } catch (err) {
        this._isStartingRecognition = false;
        if (err.name === 'InvalidStateError') {
          this.isListening = true;
          this.onListeningChange(true);
        } else {
          console.warn('[ArgusSpeech] Recognition start error:', err);
          this.isListening = false;
          this.onListeningChange(false);
        }
      }
    }

    stopListening() {
      this._clearSilenceTimer();
      if (this.recognition && this.isListening) {
        try {
          this.recognition.stop();
        } catch (e) {}
      }
      this.isListening = false;
      this.onListeningChange(false);
    }

    cancel() {
      if (this._ttsWatchdog) {
        clearTimeout(this._ttsWatchdog);
        this._ttsWatchdog = null;
      }
      this._clearSilenceTimer();
      if (this.recognition) {
        try { this.recognition.abort(); } catch (e) {}
      }
      this.isListening = false;
      this.onListeningChange(false);

      if (typeof window !== 'undefined' && window.speechSynthesis) {
        try { window.speechSynthesis.cancel(); } catch (e) {}
      }
      this.isSpeaking = false;
      this.activeUtterance = null;
      this.onSpeakingChange(false);
    }

    _resetSilenceTimer(onResultCallback) {
      this._clearSilenceTimer();
      this.silenceTimer = setTimeout(() => {
        if (this.isListening) {
          this.stopListening();
          this.onError("I didn't hear anything. You can speak now, tap Repeat, or switch to manual input.");
        }
      }, this.silenceTimeoutMs);
    }

    _clearSilenceTimer() {
      if (this.silenceTimer) {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
      }
    }
  }

  // -------------------------------------------------------------------------
  // EXPORTS
  // -------------------------------------------------------------------------

  const ArgusProfile = {
    CURRENT_PROFILE_VERSION,
    ProfileStorage,
    SpokenTextNormalizer,
    MachineState,
    STEPS,
    VoiceProfileStateMachine,
    ArgusSpeechService,
    SUPPORTED_LANGUAGES,
    createEmptyProfile
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ArgusProfile;
  }
  if (typeof window !== 'undefined') {
    window.ArgusProfile = ArgusProfile;
  }
  if (typeof global !== 'undefined') {
    global.ArgusProfile = ArgusProfile;
  }

})(typeof window !== 'undefined' ? window : this);
