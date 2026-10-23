/**
 * Automated Unit Tests for Argus.AI Voice Profile Onboarding
 * Tests State Machine, Validation, Commands, and Persistence with Mocks
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const ArgusProfile = require('../assets/js/voice-profile-core.js');

const {
  ProfileStorage,
  SpokenTextNormalizer,
  MachineState,
  STEPS,
  VoiceProfileStateMachine
} = ArgusProfile;

// In-Memory Storage Mock
function createMockStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    }
  };
}

// Mock Speech Service
function createMockSpeechService() {
  return {
    spokenHistory: [],
    listeningState: false,
    speak(text, onEnd) {
      this.spokenHistory.push(text);
      if (onEnd) setTimeout(onEnd, 0);
    },
    startListening(cb) {
      this.listeningState = true;
      this._onResult = cb;
    },
    stopListening() {
      this.listeningState = false;
    },
    cancel() {
      this.listeningState = false;
    },
    simulateSpokenResult(text, isFinal = true) {
      if (this._onResult) {
        this._onResult(text, isFinal);
      }
    }
  };
}

describe('1. ProfileStorage & Schema', () => {
  let storage;

  beforeEach(() => {
    storage = createMockStorage();
  });

  test('returns clean empty profile when storage is uninitialized', () => {
    const profile = ProfileStorage.loadProfile(storage);
    assert.equal(profile.profileVersion, 1);
    assert.equal(profile.displayName, '');
    assert.equal(profile.phoneNumber, '');
    assert.equal(profile.address, '');
    assert.deepEqual(profile.emergencyContacts, []);
    assert.equal(profile.completed, false);
  });

  test('saves and loads profile accurately', () => {
    const p = {
      profileVersion: 1,
      displayName: 'Prem Pareesh',
      phoneNumber: '+919876543210',
      address: '10 Downing Street',
      emergencyContacts: [
        { name: 'Dr. Jane', phone: '+14155550199', relation: 'Sister', isTestMode: true }
      ],
      completed: true
    };
    ProfileStorage.saveProfile(p, storage);

    const loaded = ProfileStorage.loadProfile(storage);
    assert.equal(loaded.displayName, 'Prem Pareesh');
    assert.equal(loaded.phoneNumber, '+919876543210');
    assert.equal(loaded.address, '10 Downing Street');
    assert.equal(loaded.emergencyContacts.length, 1);
    assert.equal(loaded.emergencyContacts[0].name, 'Dr. Jane');
    assert.equal(loaded.completed, true);
  });

  test('synchronizes primary emergency contact with argus_emergency_contact', () => {
    const p = {
      displayName: 'Alice',
      emergencyContacts: [
        { name: 'Bob Smith', phone: '+919876543211', relation: 'Brother', isTestMode: true }
      ]
    };
    ProfileStorage.saveProfile(p, storage);

    const rawSOS = storage.getItem('argus_emergency_contact');
    assert.ok(rawSOS, 'argus_emergency_contact must be populated');
    const parsedSOS = JSON.parse(rawSOS);
    assert.equal(parsedSOS.name, 'Bob Smith');
    assert.equal(parsedSOS.phone, '+919876543211');
  });

  test('clearProfile removes both profile and emergency contact from storage', () => {
    ProfileStorage.saveProfile({
      displayName: 'Test',
      emergencyContacts: [{ name: 'Friend', phone: '+919876543210' }]
    }, storage);

    assert.ok(storage.getItem('argus_user_profile'));
    ProfileStorage.clearProfile(storage);
    assert.equal(storage.getItem('argus_user_profile'), null);
    assert.equal(storage.getItem('argus_emergency_contact'), null);
  });
});

describe('2. SpokenTextNormalizer', () => {
  test('converts verbal digits and doubles to numeric strings', () => {
    const text1 = 'plus nine one nine eight seven six five four three two one zero';
    assert.equal(SpokenTextNormalizer.normalizeSpokenPhoneNumber(text1), '+919876543210');

    const text2 = 'plus one double four triple five zero one two three';
    assert.equal(SpokenTextNormalizer.normalizeSpokenPhoneNumber(text2), '+1445550123');

    const text3 = 'oh nine eight seven';
    assert.equal(SpokenTextNormalizer.normalizeSpokenPhoneNumber(text3), '0987');
  });

  test('validates international phone numbers correctly', () => {
    assert.equal(SpokenTextNormalizer.isValidPhoneNumber('+919876543210'), true);
    assert.equal(SpokenTextNormalizer.isValidPhoneNumber('+14155550123'), true);
    assert.equal(SpokenTextNormalizer.isValidPhoneNumber('+442079460958'), true);
    assert.equal(SpokenTextNormalizer.isValidPhoneNumber('9876543210'), true); // valid 10 digits
    assert.equal(SpokenTextNormalizer.isValidPhoneNumber('123'), false); // too short
    assert.equal(SpokenTextNormalizer.isValidPhoneNumber('abc1234567'), false);
    assert.equal(SpokenTextNormalizer.isValidPhoneNumber(''), false);
  });

  test('formats phone numbers for display and speech synthesis', () => {
    const formatted = SpokenTextNormalizer.formatPhoneForDisplay('+919876543210');
    assert.equal(formatted, '+91 98765 43210');

    const spoken = SpokenTextNormalizer.formatPhoneForSpeech('+9198');
    assert.equal(spoken, 'plus 9 1 9 8');
  });

  test('cleans conversational prefixes from display names', () => {
    assert.equal(SpokenTextNormalizer.cleanDisplayName('my name is Prem Pareesh'), 'Prem Pareesh');
    assert.equal(SpokenTextNormalizer.cleanDisplayName("i'm Dr. Sarah Connor"), 'Dr Sarah Connor');
    assert.equal(SpokenTextNormalizer.cleanDisplayName('call me Alex'), 'Alex');
  });

  test('detects global commands with variety of phrasing', () => {
    assert.equal(SpokenTextNormalizer.detectCommand('yes'), 'YES');
    assert.equal(SpokenTextNormalizer.detectCommand('yeah'), 'YES');
    assert.equal(SpokenTextNormalizer.detectCommand('correct'), 'YES');
    assert.equal(SpokenTextNormalizer.detectCommand("that's right"), 'YES');

    assert.equal(SpokenTextNormalizer.detectCommand('no'), 'NO');
    assert.equal(SpokenTextNormalizer.detectCommand('wrong'), 'NO');
    assert.equal(SpokenTextNormalizer.detectCommand('change it'), 'NO');

    assert.equal(SpokenTextNormalizer.detectCommand('repeat the question'), 'REPEAT');
    assert.equal(SpokenTextNormalizer.detectCommand('say again'), 'REPEAT');

    assert.equal(SpokenTextNormalizer.detectCommand('skip'), 'SKIP');
    assert.equal(SpokenTextNormalizer.detectCommand('pass'), 'SKIP');

    assert.equal(SpokenTextNormalizer.detectCommand('go back'), 'BACK');
    assert.equal(SpokenTextNormalizer.detectCommand('cancel setup'), 'CANCEL');
    assert.equal(SpokenTextNormalizer.detectCommand('fill manually'), 'MANUAL');
  });
});

describe('3. VoiceProfileStateMachine Deterministic Flow', () => {
  let storage;
  let speech;
  let machine;

  beforeEach(() => {
    storage = createMockStorage();
    speech = createMockSpeechService();
    machine = new VoiceProfileStateMachine({ storage, speechService: speech });
  });

  test('starts at WELCOME state and transitions to ASKING upon voice start', () => {
    assert.equal(machine.state, MachineState.WELCOME);
    machine.startVoiceFlow();
    assert.equal(machine.state, MachineState.ASKING);
    assert.equal(speech.spokenHistory.length, 1);
    assert.match(speech.spokenHistory[0], /What is your name\?/);
  });

  test('full voice onboarding flow: ASK -> LISTEN -> TRANSCRIBE -> CONFIRM -> SAVE -> NEXT', async () => {
    machine.startVoiceFlow();

    // 1. Spoken Name
    machine.processSpokenInput('Prem');
    assert.equal(machine.state, MachineState.CONFIRMING);
    assert.equal(machine.pendingValue, 'Prem');

    // Confirm Name with "Yes"
    machine.processSpokenInput('yes');
    assert.equal(machine.profile.displayName, 'Prem');

    // 2. Phone Number
    machine.processSpokenInput('plus nine one nine eight seven six five four three two one zero');
    assert.equal(machine.state, MachineState.CONFIRMING);
    assert.equal(machine.pendingValue, '+919876543210');

    // Confirm Phone with "Correct"
    machine.processSpokenInput('correct');
    assert.equal(machine.profile.phoneNumber, '+919876543210');

    // 3. Address (Skip optional field)
    machine.processSpokenInput('skip');
    assert.equal(machine.currentStepIndex, 3); // Moved to Step 4 (emergencyContact1)

    // 4. Primary Emergency Contact (Name then Phone)
    machine.processSpokenInput('Jane Doe');
    assert.equal(machine.pendingContact.name, 'Jane Doe');
    assert.equal(machine.contactSubStep, 'phone');

    machine.processSpokenInput('plus nine one nine eight seven six five four three two one one');
    assert.equal(machine.state, MachineState.CONFIRMING);
    assert.equal(machine.pendingContact.phone, '+919876543211');

    // Confirm Emergency Contact 1
    machine.processSpokenInput('yes');
    assert.equal(machine.profile.emergencyContacts.length, 1);
    assert.equal(machine.profile.emergencyContacts[0].name, 'Jane Doe');

    // 5. Emergency Contact 2 (Skip)
    machine.processSpokenInput('skip');
    assert.equal(machine.state, MachineState.REVIEW);

    // Finish Setup
    machine.finishSetup();
    assert.equal(machine.state, MachineState.COMPLETED);
    assert.equal(machine.profile.completed, true);

    // Check storage persistence
    const saved = ProfileStorage.loadProfile(storage);
    assert.equal(saved.completed, true);
    assert.equal(saved.displayName, 'Prem');
    assert.equal(saved.phoneNumber, '+919876543210');
  });

  test('handles user rejection ("No") during confirmation and allows correction', () => {
    machine.startVoiceFlow();

    // User says name "John"
    machine.processSpokenInput('John');
    assert.equal(machine.state, MachineState.CONFIRMING);

    // User says "No" to correct
    machine.processSpokenInput('no');
    assert.equal(machine.state, MachineState.LISTENING);
    assert.equal(machine.pendingValue, null);

    // User speaks corrected name "Jonathan"
    machine.processSpokenInput('Jonathan');
    assert.equal(machine.state, MachineState.CONFIRMING);
    assert.equal(machine.pendingValue, 'Jonathan');

    // User confirms "Yes"
    machine.processSpokenInput('yes');
    assert.equal(machine.profile.displayName, 'Jonathan');
  });

  test('prevents skipping required fields (display name)', () => {
    machine.startVoiceFlow();
    machine.processSpokenInput('skip');
    // Display name is required; machine stays on step 0 and prompts
    assert.equal(machine.currentStepIndex, 0);
    assert.match(speech.spokenHistory[speech.spokenHistory.length - 1], /name is required/i);
  });

  test('supports "go back" command to previous question', () => {
    machine.startVoiceFlow();
    machine.processSpokenInput('Prem');
    machine.processSpokenInput('yes');
    assert.equal(machine.currentStepIndex, 1); // Phone step

    // Issue "go back" command
    machine.processSpokenInput('go back');
    assert.equal(machine.currentStepIndex, 0); // Back to name step
  });

  test('supports "skip for now" without corrupting profile or setting completed=true', () => {
    machine.startVoiceFlow();
    machine.processSpokenInput('Prem');
    machine.processSpokenInput('yes');

    machine.skipForNow();
    assert.equal(machine.state, MachineState.CANCELLED);

    const saved = ProfileStorage.loadProfile(storage);
    assert.equal(saved.completed, false);
    assert.equal(saved.displayName, 'Prem'); // confirmed field preserved
  });

  test('duplicate speech events do not advance field twice', () => {
    machine.startVoiceFlow();
    machine.processSpokenInput('Prem');
    assert.equal(machine.state, MachineState.CONFIRMING);

    // Duplicate speech event with same or different text while in CONFIRMING state
    machine.processSpokenInput('Prem again');
    // State remains CONFIRMING for 'Prem', did not skip to next question
    assert.equal(machine.state, MachineState.CONFIRMING);
    assert.equal(machine.pendingValue, 'Prem');
    assert.equal(machine.currentStepIndex, 0);
  });

  test('repeat question command re-speaks the active prompt', () => {
    machine.startVoiceFlow();
    const spokenCountBefore = speech.spokenHistory.length;
    machine.processSpokenInput('repeat');
    assert.equal(speech.spokenHistory.length, spokenCountBefore + 1);
    assert.match(speech.spokenHistory[speech.spokenHistory.length - 1], /What is your name\?/);
  });

  test('partial progress survives page reload/refresh', () => {
    machine.startVoiceFlow();
    machine.processSpokenInput('Prem');
    machine.processSpokenInput('yes');

    // Simulate page refresh: instantiate brand new machine pointing to same storage
    const newMachine = new VoiceProfileStateMachine({ storage, speechService: speech });
    const loadedProfile = newMachine.profile;
    assert.equal(loadedProfile.displayName, 'Prem');
    assert.equal(loadedProfile.completed, false);

    // Resume flow
    newMachine.startVoiceFlow();
    assert.equal(newMachine.currentStepIndex, 1); // Automatically resumes at step 1 (phone number)
  });

  test('manual entry works independently without speech recognition', () => {
    machine.switchToManualMode();
    assert.equal(machine.state, MachineState.MANUAL_MODE);

    // Submit display name
    machine.submitManualAnswer('Alice Cooper');
    assert.equal(machine.profile.displayName, 'Alice Cooper');
    assert.equal(machine.currentStepIndex, 1);

    // Submit phone number
    machine.submitManualAnswer('+14155552671');
    assert.equal(machine.profile.phoneNumber, '+14155552671');
    assert.equal(machine.currentStepIndex, 2);

    // Submit address
    machine.submitManualAnswer('456 Vision St');
    assert.equal(machine.profile.address, '456 Vision St');
    assert.equal(machine.currentStepIndex, 3);

    // Submit emergency contact 1
    machine.submitManualAnswer({
      name: 'Bob Cooper',
      phone: '+14155552672',
      relation: 'Father',
      isTestMode: true
    });
    assert.equal(machine.profile.emergencyContacts.length, 1);
    assert.equal(machine.profile.emergencyContacts[0].name, 'Bob Cooper');
  });

  test('clearing profile resets state to WELCOME and empties storage', () => {
    machine.startVoiceFlow();
    machine.processSpokenInput('Prem');
    machine.processSpokenInput('yes');

    machine.clearProfile();
    assert.equal(machine.state, MachineState.WELCOME);
    assert.equal(machine.profile.displayName, '');
    assert.equal(ProfileStorage.loadProfile(storage).displayName, '');
  });
});

describe('4. FIX 1: Confirmation Normalization & Automatic Advancement', () => {
  let storage;
  let speech;
  let machine;

  beforeEach(() => {
    storage = createMockStorage();
    speech = createMockSpeechService();
    machine = new VoiceProfileStateMachine({ storage, speechService: speech });
  });

  test('normalizes and recognizes all required affirmative confirmation phrases', () => {
    const affirmativeSamples = [
      'Yes',
      "Yes, that's correct",
      "That's correct",
      'Correct',
      'Yes, correct',
      'Yeah',
      'Yes, it is',
      "That's right",
      'Confirm',
      "That's my name",
      "that’s correct", // smart quote
      "YES, THAT'S CORRECT!", // uppercase + punctuation
      "yes   that's   correct", // multiple spaces
      "that is correct",
      "it's correct",
      "sounds good"
    ];

    for (const phrase of affirmativeSamples) {
      assert.equal(
        SpokenTextNormalizer.detectCommand(phrase),
        'YES',
        `Phrase "${phrase}" should be recognized as YES`
      );
      assert.equal(
        SpokenTextNormalizer.isAffirmative(phrase),
        true,
        `isAffirmative("${phrase}") should return true`
      );
    }
  });

  test('normalizes and recognizes all required rejection and correction phrases', () => {
    const rejectionSamples = [
      'No',
      "No, that's wrong",
      "That's incorrect",
      'Change it',
      'Let me correct that',
      "no that’s wrong",
      "NO, THAT'S WRONG!",
      "that is wrong",
      "incorrect",
      "nope",
      "not correct"
    ];

    for (const phrase of rejectionSamples) {
      assert.equal(
        SpokenTextNormalizer.detectCommand(phrase),
        'NO',
        `Phrase "${phrase}" should be recognized as NO`
      );
      assert.equal(
        SpokenTextNormalizer.isNegative(phrase),
        true,
        `isNegative("${phrase}") should return true`
      );
      assert.equal(
        SpokenTextNormalizer.isAffirmative(phrase),
        false,
        `isAffirmative("${phrase}") must NEVER return true`
      );
    }
  });

  test('full spoken confirmation flow: "My name is Prem" -> "Yes, that\'s correct" advances automatically with 0 manual clicks', () => {
    machine.startVoiceFlow();
    assert.equal(machine.state, MachineState.ASKING);
    assert.match(speech.spokenHistory[speech.spokenHistory.length - 1], /What is your name\?/i);

    // User says "My name is Prem"
    machine.processSpokenInput('My name is Prem');
    assert.equal(machine.state, MachineState.CONFIRMING);
    assert.equal(machine.pendingValue, 'Prem');
    assert.match(speech.spokenHistory[speech.spokenHistory.length - 1], /I heard Prem\. Is that correct\?/i);

    // User replies with natural confirmation: "Yes, that's correct"
    machine.processSpokenInput("Yes, that's correct");

    // Must automatically advance:
    // 1. Saved field
    assert.equal(machine.profile.displayName, 'Prem');
    assert.equal(ProfileStorage.loadProfile(storage).displayName, 'Prem');
    // 2. Next question spoken automatically
    assert.equal(machine.currentStepIndex, 1); // Step 2 (Phone number)
    assert.match(speech.spokenHistory[speech.spokenHistory.length - 1], /What is your phone number/i);
  });

  test('spoken confirmation works with "Correct"', () => {
    machine.startVoiceFlow();
    machine.processSpokenInput('Dr. Sarah Connor');
    assert.equal(machine.state, MachineState.CONFIRMING);

    machine.processSpokenInput('Correct');
    assert.equal(machine.profile.displayName, 'Dr Sarah Connor');
    assert.equal(machine.currentStepIndex, 1);
  });

  test('spoken confirmation works with "That\'s right"', () => {
    machine.startVoiceFlow();
    machine.processSpokenInput('John Doe');
    assert.equal(machine.state, MachineState.CONFIRMING);

    machine.processSpokenInput("That's right");
    assert.equal(machine.profile.displayName, 'John Doe');
    assert.equal(machine.currentStepIndex, 1);
  });

  test('spoken rejection with "No, that\'s wrong" does NOT advance and asks for correction', () => {
    machine.startVoiceFlow();
    machine.processSpokenInput('Brem');
    assert.equal(machine.state, MachineState.CONFIRMING);

    // User rejects
    machine.processSpokenInput("No, that's wrong");

    // Stays on Step 0 (Name)
    assert.equal(machine.currentStepIndex, 0);
    assert.equal(machine.state, MachineState.LISTENING);
    assert.equal(machine.pendingValue, null);
    assert.match(speech.spokenHistory[speech.spokenHistory.length - 1], /Understood\. Let's fix that/i);

    // User speaks corrected name
    machine.processSpokenInput('Prem');
    assert.equal(machine.state, MachineState.CONFIRMING);
    assert.equal(machine.pendingValue, 'Prem');

    machine.processSpokenInput("Yes, that's correct");
    assert.equal(machine.profile.displayName, 'Prem');
    assert.equal(machine.currentStepIndex, 1);
  });
});

describe('5. FIX 2: Voice Quality, Selection, and Natural Pacing', () => {
  test('ArgusSpeechService selects highest quality English voice available', () => {
    const mockVoices = [
      { name: 'Alex', lang: 'en-US', default: false },
      { name: 'Samantha (Enhanced)', lang: 'en-US', default: false },
      { name: 'Fred', lang: 'en-US', default: true },
      { name: 'Victoria', lang: 'en-US', default: false }
    ];

    // Mock speechSynthesis with voices
    const mockSynth = {
      getVoices: () => mockVoices,
      speak: () => {},
      cancel: () => {}
    };

    const service = new ArgusProfile.ArgusSpeechService();
    // Simulate browser getVoices
    const selected = service._selectBestVoice.call({
      selectedVoice: null
    }, mockSynth);

    // In our implementation, _selectBestVoice checks window.speechSynthesis
    // Let's test with mock window
    const origWindow = global.window;
    global.window = { speechSynthesis: mockSynth };
    const bestVoice = service._selectBestVoice();
    global.window = origWindow;

    assert.ok(bestVoice, 'Must select a voice');
    assert.equal(bestVoice.name, 'Samantha (Enhanced)', 'Must prioritize enhanced natural voice');
  });

  test('ArgusSpeechService provides fallback when enhanced voice is absent', () => {
    const mockVoices = [
      { name: 'Generic Voice 1', lang: 'fr-FR', default: false },
      { name: 'English Standard', lang: 'en-US', default: true }
    ];

    const mockSynth = {
      getVoices: () => mockVoices,
      speak: () => {},
      cancel: () => {}
    };

    const service = new ArgusProfile.ArgusSpeechService();
    const origWindow = global.window;
    global.window = { speechSynthesis: mockSynth };
    const bestVoice = service._selectBestVoice();
    global.window = origWindow;

    assert.ok(bestVoice, 'Must fallback cleanly to available English voice');
    assert.equal(bestVoice.name, 'English Standard');
  });

  test('speech settings use natural pacing (rate ~0.95, pitch 1.0)', () => {
    const service = new ArgusProfile.ArgusSpeechService();
    assert.equal(service.voiceRate, 0.95, 'Voice rate must be calm and unhurried (~0.95)');
    assert.equal(service.pitch, 1.0, 'Pitch must be comfortable (1.0)');
    assert.equal(service.volume, 1.0, 'Volume must be clear (1.0)');
  });
});


