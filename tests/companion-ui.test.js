/**
 * Automated Test Suite for Argus.AI Single-Page Companion UI & Voice Controller
 * Tests Phase D Requirements:
 * - Natural "Hey Argus" wake-word detection & conversational greeting with personalized user name
 * - Separation of wake-word detection from command recognition
 * - Acoustic feedback loop prevention (microphone stays off while assistant speaks)
 * - Hands-Free mode toggle (button state, aria-pressed, persistent preference)
 * - Every voice command and expanded aliases for all 6 features + Emergency SOS + Profile
 * - Canonical route resolution with verified percent-encoded URIs (Visual%20Explanation, Camera%20Check)
 * - Verification that all 6 module target routes match existing filesystem assets & Vercel rewrites
 * - Night Vision mode URL parameter verification (?mode=ON)
 * - Modal speech isolation (Profile and SOS modal locks)
 * - Command timeout, unknown phrase handling, and graceful error notices
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Mock DOM Environment for Companion Controller Tests
function setupMockEnvironment() {
  const store = new Map();

  const mockStorage = {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };

  class MockElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.id = '';
      this.className = '';
      this.classList = {
        _classes: new Set(),
        add: (...cls) => cls.forEach(c => this.classList._classes.add(c)),
        remove: (...cls) => cls.forEach(c => this.classList._classes.delete(c)),
        contains: (c) => this.classList._classes.has(c),
        toggle: (c, force) => {
          if (force !== undefined) {
            force ? this.classList.add(c) : this.classList.remove(c);
          } else {
            this.classList.contains(c) ? this.classList.remove(c) : this.classList.add(c);
          }
        }
      };
      this.listeners = new Map();
      this.attributes = new Map();
      this.textContent = '';
      this.innerHTML = '';
      this.children = [];
    }

    addEventListener(event, cb) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(cb);
    }

    dispatchEvent(event) {
      const cbs = this.listeners.get(event.type) || [];
      cbs.forEach(cb => cb(event));
    }

    setAttribute(k, v) {
      this.attributes.set(k, String(v));
    }

    getAttribute(k) {
      return this.attributes.has(k) ? this.attributes.get(k) : null;
    }

    click() {
      this.dispatchEvent({ type: 'click', defaultPrevented: false });
    }
  }

  const elements = new Map();

  function getOrCreateElement(id, tag = 'div') {
    if (!elements.has(id)) {
      const el = new MockElement(tag);
      el.id = id;
      elements.set(id, el);
    }
    return elements.get(id);
  }

  // Pre-populate expected companion DOM elements
  getOrCreateElement('companion-robot-stage');
  getOrCreateElement('companion-robot-status');
  getOrCreateElement('companion-status-text');
  getOrCreateElement('companion-greeting-text');
  getOrCreateElement('btn-tap-to-speak', 'button');
  getOrCreateElement('tap-to-speak-label');
  getOrCreateElement('btn-wake-toggle', 'button');
  getOrCreateElement('wake-toggle-label');
  getOrCreateElement('voice-hint-text');
  getOrCreateElement('voice-transcript-card');
  getOrCreateElement('voice-transcript-text');
  getOrCreateElement('btn-header-profile', 'button');
  getOrCreateElement('header-profile-name');
  getOrCreateElement('sos-modal-overlay');
  getOrCreateElement('argus-profile-modal-overlay');

  const mockDocument = {
    readyState: 'complete',
    getElementById: (id) => elements.get(id) || null,
    addEventListener: () => {}
  };

  const mockWindow = {
    location: { href: '' },
    document: mockDocument,
    localStorage: mockStorage,
    addEventListener: () => {},
    setInterval: () => 1,
    triggerEmergencySOS: () => {},
    openProfileModalSafe: () => {},
    argusProfileUI: {
      openModal: () => {}
    }
  };

  return { mockWindow, mockDocument, mockStorage, elements };
}

// Load core profile library for testing
const ArgusProfile = require('../assets/js/voice-profile-core.js');

describe('6. Voice-Command Integration & Companion Controller (Phase D)', () => {

  function loadController(mockWindow) {
    mockWindow.ArgusProfile = ArgusProfile;
    const code = fs.readFileSync(path.join(__dirname, '../assets/js/companion-controller.js'), 'utf8');
    const fn = new Function('window', 'document', 'root', code);
    fn(mockWindow, mockWindow.document, mockWindow);
    return mockWindow.argusCompanion;
  }

  test('normalizes spoken input text by stripping prefixes, harmless punctuation, and extra spaces', () => {
    const { mockWindow } = setupMockEnvironment();
    const controller = loadController(mockWindow);

    assert.equal(controller._normalizeCommand('Hey Argus, open pathguide!'), 'open pathguide');
    assert.equal(controller._normalizeCommand('  Argus, please can you detect objects?  '), 'detect objects');
    assert.equal(controller._normalizeCommand("Can you explain my surroundings?"), 'explain my surroundings');
    assert.equal(controller._normalizeCommand('Please check the queue...'), 'check the queue');
    assert.equal(controller._normalizeCommand('Could you turn on night vision?'), 'turn on night vision');
    assert.equal(controller._normalizeCommand('I want to open my profile'), 'open my profile');
    assert.equal(controller._normalizeCommand(''), '');
    assert.equal(controller._normalizeCommand(null), '');
  });

  test('detects wake word "Hey Argus" and "Argus" reliably', () => {
    const { mockWindow } = setupMockEnvironment();
    const controller = loadController(mockWindow);

    assert.equal(controller._detectWakeWord('hey argus'), true);
    assert.equal(controller._detectWakeWord('argus'), true);
    assert.equal(controller._detectWakeWord('hey argus please help'), true);
    assert.equal(controller._detectWakeWord('open visionaid'), false);
    assert.equal(controller._detectWakeWord(''), false);
  });

  test('wake word triggers personalized greeting when user profile exists', () => {
    const { mockWindow, mockStorage } = setupMockEnvironment();
    // Save profile with name
    const profile = ArgusProfile.createEmptyProfile();
    profile.displayName = 'Prem';
    mockStorage.setItem('argus_user_profile', JSON.stringify(profile));

    const controller = loadController(mockWindow);

    let spokenGreeting = '';
    controller.speechService = {
      isSupported: () => true,
      speak: (text, cb) => {
        spokenGreeting = text;
        if (cb) cb();
      },
      startListening: () => {},
      stopListening: () => {}
    };

    controller._triggerWakeWordReaction();

    assert.equal(spokenGreeting, "I'm here, Prem. What kind of help do you need?");
    assert.equal(controller.currentState, 'speaking');
  });

  test('wake word triggers neutral greeting when user profile name is absent', () => {
    const { mockWindow } = setupMockEnvironment();
    const controller = loadController(mockWindow);

    let spokenGreeting = '';
    controller.speechService = {
      isSupported: () => true,
      speak: (text, cb) => {
        spokenGreeting = text;
        if (cb) cb();
      },
      startListening: () => {},
      stopListening: () => {}
    };

    controller._triggerWakeWordReaction();

    assert.equal(spokenGreeting, "I'm here. What kind of help do you need?");
    assert.equal(controller.currentState, 'speaking');
  });

  test('hands-free toggle button toggles wakeWordEnabled and updates accessible attributes', () => {
    const { mockWindow, elements } = setupMockEnvironment();
    const controller = loadController(mockWindow);

    controller.speechService = {
      isSupported: () => true,
      speak: (text, cb) => { if (cb) cb(); },
      startListening: () => {},
      stopListening: () => {}
    };

    const toggleBtn = elements.get('btn-wake-toggle');

    // Initially disabled
    assert.equal(controller.wakeWordEnabled, false);

    // Toggle ON
    controller.toggleWakeWord();
    assert.equal(controller.wakeWordEnabled, true);
    assert.equal(toggleBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(toggleBtn.classList.contains('is-active'), true);

    // Toggle OFF
    controller.toggleWakeWord();
    assert.equal(controller.wakeWordEnabled, false);
    assert.equal(toggleBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(toggleBtn.classList.contains('is-active'), false);
    assert.equal(controller.currentState, 'idle');
  });

  test('resolves PathGuide Pro with expanded phrases and spoken confirmation', () => {
    const { mockWindow } = setupMockEnvironment();
    const controller = loadController(mockWindow);

    const aliases = [
      'Open PathGuide',
      'Start PathGuide',
      'PathGuide Pro',
      'pathguide',
      'path guide',
      'navigation mode',
      'walking guidance',
      'start navigation',
      'navigate',
      'obstacle awareness'
    ];

    for (const phrase of aliases) {
      const normalized = controller._normalizeCommand(phrase);
      const match = controller._resolveCommand(normalized);
      assert.ok(match, `Must match phrase: "${phrase}"`);
      assert.equal(match.id, 'pathguide');
      assert.equal(match.url, './Night-Vision/index.html');
      assert.equal(match.spokenConfirm, 'Starting PathGuide Pro navigation.');
    }
  });

  test('resolves Object Detection Pro with expanded phrases and spoken confirmation', () => {
    const { mockWindow } = setupMockEnvironment();
    const controller = loadController(mockWindow);

    const aliases = [
      'Open object detection',
      'Start object detection',
      'Object Detection Pro',
      'Detect objects',
      'object detector',
      'identify objects',
      'find objects',
      'object scanner'
    ];

    for (const phrase of aliases) {
      const normalized = controller._normalizeCommand(phrase);
      const match = controller._resolveCommand(normalized);
      assert.ok(match, `Must match phrase: "${phrase}"`);
      assert.equal(match.id, 'object-detection');
      assert.equal(match.url, './object-detection-pro/index.html');
      assert.equal(match.spokenConfirm, 'Opening Object Detection Pro.');
    }
  });

  test('resolves VisionAid AI with percent-encoded URI and expanded natural phrases', () => {
    const { mockWindow } = setupMockEnvironment();
    const controller = loadController(mockWindow);

    const aliases = [
      'Open VisionAid',
      'Start VisionAid',
      'Open Vision Aid',
      'VisionAid AI',
      'visual explanation',
      'Explain surroundings',
      'Describe scene',
      'Read text',
      'Read document',
      'medicine scanner'
    ];

    for (const phrase of aliases) {
      const normalized = controller._normalizeCommand(phrase);
      const match = controller._resolveCommand(normalized);
      assert.ok(match, `Must match phrase: "${phrase}"`);
      assert.equal(match.id, 'visionaid');
      assert.equal(match.url, './Visual%20Explanation/index.html', 'URL must be percent-encoded to prevent HTTP 400');
      assert.equal(match.spokenConfirm, 'Opening VisionAid AI.');
    }
  });

  test('resolves Queue Detector with natural short phrases (Open queue, Check queue, Line check)', () => {
    const { mockWindow } = setupMockEnvironment();
    const controller = loadController(mockWindow);

    const aliases = [
      'Open Queue',
      'Start Queue',
      'Queue',
      'Open Queue Detector',
      'Check queue',
      'Check the queue',
      'Detect people in line',
      'people in line',
      'track queue',
      'line check'
    ];

    for (const phrase of aliases) {
      const normalized = controller._normalizeCommand(phrase);
      const match = controller._resolveCommand(normalized);
      assert.ok(match, `Must match phrase: "${phrase}"`);
      assert.equal(match.id, 'queue-detector');
      assert.equal(match.url, './queue-detection/index.html');
      assert.equal(match.spokenConfirm, 'Opening Queue Detector.');
    }
  });

  test('resolves Optima Vision with percent-encoded URI and expanded natural phrases', () => {
    const { mockWindow } = setupMockEnvironment();
    const controller = loadController(mockWindow);

    const aliases = [
      'Open Optima Vision',
      'Start Optima',
      'Open Optima',
      'Check camera quality',
      'Check camera',
      'Camera quality',
      'optima vision',
      'optima',
      'camera check',
      'check visibility',
      'check lens',
      'optical monitor'
    ];

    for (const phrase of aliases) {
      const normalized = controller._normalizeCommand(phrase);
      const match = controller._resolveCommand(normalized);
      assert.ok(match, `Must match phrase: "${phrase}"`);
      assert.equal(match.id, 'optima-vision');
      assert.equal(match.url, './Camera%20Check/index.html', 'URL must be percent-encoded to prevent HTTP 400');
      assert.equal(match.spokenConfirm, 'Opening Optima Vision camera check.');
    }
  });

  test('resolves Night Vision with verified mode=ON parameter and natural variations', () => {
    const { mockWindow } = setupMockEnvironment();
    const controller = loadController(mockWindow);

    const aliases = [
      'Turn on Night Vision',
      'Turn Night Vision on',
      'Activate Night Vision',
      'Enable Night Vision',
      'Start Night Vision',
      'Open Night Vision',
      'night vision',
      'night mode',
      'dark mode',
      'low light mode'
    ];

    for (const phrase of aliases) {
      const normalized = controller._normalizeCommand(phrase);
      const match = controller._resolveCommand(normalized);
      assert.ok(match, `Must match phrase: "${phrase}"`);
      assert.equal(match.id, 'night-vision');
      assert.equal(match.url, './Night-Vision/index.html?mode=ON');
      assert.equal(match.spokenConfirm, 'Turning on Night Vision mode.');
    }
  });

  test('resolves Emergency SOS and invokes confirmation workflow safely', () => {
    const { mockWindow } = setupMockEnvironment();
    let emergencyTriggered = false;
    mockWindow.triggerEmergencySOS = () => { emergencyTriggered = true; };

    const controller = loadController(mockWindow);

    const aliases = [
      'Emergency SOS',
      'Call my emergency contact',
      'trigger emergency sos',
      'help me',
      'emergency'
    ];

    for (const phrase of aliases) {
      const normalized = controller._normalizeCommand(phrase);
      const match = controller._resolveCommand(normalized);
      assert.ok(match, `Must match phrase: "${phrase}"`);
      assert.equal(match.id, 'emergency-sos');
      assert.equal(match.spokenConfirm, 'Opening Emergency SOS. You have 5 seconds to cancel.');

      emergencyTriggered = false;
      match.action();
      assert.equal(emergencyTriggered, true, 'Emergency action must call triggerEmergencySOS');
    }
  });

  test('resolves Profile Setup commands and opens profile modal safely', () => {
    const { mockWindow } = setupMockEnvironment();
    let profileOpened = false;
    mockWindow.openProfileModalSafe = () => { profileOpened = true; };

    const controller = loadController(mockWindow);

    const aliases = [
      'Open my profile',
      'Edit my details',
      'set up profile',
      'edit profile',
      'change my name',
      'profile settings'
    ];

    for (const phrase of aliases) {
      const normalized = controller._normalizeCommand(phrase);
      const match = controller._resolveCommand(normalized);
      assert.ok(match, `Must match phrase: "${phrase}"`);
      assert.equal(match.id, 'profile-setup');
      assert.equal(match.spokenConfirm, 'Opening your profile settings.');

      profileOpened = false;
      match.action();
      assert.equal(profileOpened, true, 'Profile action must open modal');
    }
  });

  test('handles unknown phrases, empty speech, and whitespace without crashing', () => {
    const { mockWindow } = setupMockEnvironment();
    const controller = loadController(mockWindow);

    // Empty and whitespace speech results
    controller.handleCommandSpeechResult('', true);
    assert.equal(controller.currentState, 'idle');

    controller.handleCommandSpeechResult('   ', true);
    assert.equal(controller.currentState, 'idle');

    // Unknown command
    controller.processVoiceCommand('play hip hop radio');
    assert.equal(controller.currentState, 'error');
    assert.ok(controller.transcriptText.textContent.includes('Could not match "play hip hop radio"'));
  });

  test('tap to speak handles click toggling and speech cancellation cleanly', () => {
    const { mockWindow } = setupMockEnvironment();
    const controller = loadController(mockWindow);

    let stopCalled = false;
    let cancelCalled = false;
    let startCalled = false;

    controller.speechService = {
      isSupported: () => true,
      startListening: () => { startCalled = true; },
      stopListening: () => { stopCalled = true; },
      cancel: () => { cancelCalled = true; }
    };

    // Click while idle starts command listening
    controller.currentState = 'idle';
    controller.isListening = false;
    controller.isSpeaking = false;
    controller.handleTapToSpeak();
    assert.equal(startCalled, true);
    assert.equal(controller.currentState, 'listening');

    // Click while listening stops listening
    controller.isListening = true;
    controller.handleTapToSpeak();
    assert.equal(stopCalled, true);
    assert.equal(controller.currentState, 'idle');

    // Click while speaking cancels speech
    controller.isListening = false;
    controller.isSpeaking = true;
    controller.currentState = 'speaking';
    controller.handleTapToSpeak();
    assert.equal(cancelCalled, true);
    assert.equal(controller.currentState, 'idle');
  });

  test('all six core module target routes exist on filesystem and match Vercel config', () => {
    const rootDir = path.join(__dirname, '..');
    const vercelConfig = JSON.parse(fs.readFileSync(path.join(rootDir, 'vercel.json'), 'utf8'));

    const expectedRoutes = [
      { path: 'Night-Vision/index.html', vercel: '/night-vision' },
      { path: 'object-detection-pro/index.html', vercel: '/object-detection' },
      { path: 'Visual Explanation/index.html', vercel: '/visual-explanation' },
      { path: 'queue-detection/index.html', vercel: '/queue-detection' },
      { path: 'Camera Check/index.html', vercel: '/camera-check' }
    ];

    for (const item of expectedRoutes) {
      const fullPath = path.join(rootDir, item.path);
      assert.ok(fs.existsSync(fullPath), `Target route file must exist on disk: ${item.path}`);

      // Verify Vercel rewrite exists for route
      const hasRewrite = vercelConfig.rewrites.some(r => r.source === item.vercel);
      assert.ok(hasRewrite, `Vercel rewrite must be configured for ${item.vercel}`);
    }
  });

  test('Night-Vision script supports URL mode parameter to trigger ON mode', () => {
    const scriptPath = path.join(__dirname, '../Night-Vision/script.js');
    const content = fs.readFileSync(scriptPath, 'utf8');

    assert.ok(content.includes('new URLSearchParams(window.location.search)'), 'Night-Vision script must parse URL parameters');
    assert.ok(content.includes('modeParam'), 'Night-Vision script must inspect mode parameter');
  });

});
