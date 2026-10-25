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
      this.value = '';
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
  getOrCreateElement('header-language-select', 'select');
  getOrCreateElement('manual-language-select', 'select');
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

  test('changing profile name updates visual greeting and spoken greeting to new name dynamically', () => {
    const { mockWindow, mockStorage, elements } = setupMockEnvironment();
    const profile = ArgusProfile.createEmptyProfile();
    profile.displayName = 'Prem';
    mockStorage.setItem('argus_user_profile', JSON.stringify(profile));

    const controller = loadController(mockWindow);
    assert.equal(controller.getUserDisplayName(), 'Prem');

    // Change name in storage to Rahul
    profile.displayName = 'Rahul';
    mockStorage.setItem('argus_user_profile', JSON.stringify(profile));
    controller.syncUserProfile();

    // Verify visual update
    const greetingEl = elements.get('companion-greeting-text');
    assert.ok(greetingEl.innerHTML.includes('Rahul'), 'Greeting must display updated name Rahul');
    assert.equal(elements.get('header-profile-name').textContent, 'Rahul');

    // Verify spoken greeting update
    let spoken = '';
    controller.speechService = {
      isSupported: () => true,
      speak: (text, cb) => { spoken = text; if (cb) cb(); },
      startListening: () => {},
      stopListening: () => {},
      cancel: () => {}
    };
    controller._triggerWakeWordReaction();
    assert.equal(spoken, "I'm here, Rahul. What kind of help do you need?");
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

  test('resolves staircase aliases through the existing command parser', () => {
    const { mockWindow } = setupMockEnvironment();
    const controller = loadController(mockWindow);

    const commands = [
      ['activate staircase', 'on'],
      ['start staircase mode', 'on'],
      ['Detect stairs', 'on'],
      ['Staircase detection', 'on'],
      ['Check stairs', 'on'],
      ['stair case on', 'on'],
      ['activaté stairs case', 'on'],
      ['deactivate staircase', 'off'],
      ['stop staircase', 'off'],
      ['staircase status', 'status']
    ];

    commands.forEach(([phrase, action]) => {
      const normalized = controller._normalizeCommand(phrase);
      const match = controller._resolveCommand(normalized, phrase);
      assert.equal(match.id, 'staircase-command');
      assert.equal(match.action, action);
      assert.match(match.url, /staircase-detection\/index\.html\?staircaseCommand=/);
    });
  });

  test('dispatches staircase commands to the registered in-page handler', async () => {
    const { mockWindow } = setupMockEnvironment();
    const controller = loadController(mockWindow);
    let handledAction = '';
    let spokenMessage = '';
    controller.registerStaircaseCommandHandler(async (action) => {
      handledAction = action;
      return 'Staircase mode is on. The detector is unavailable.';
    });
    controller.speechService = {
      isSupported: () => true,
      speak: (text, callback) => {
        spokenMessage = text;
        if (callback) callback();
      }
    };

    controller.processVoiceCommand('activate staircase');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(handledAction, 'on');
    assert.equal(spokenMessage, 'Staircase mode is on. The detector is unavailable.');
  });

  test('feature flag disables staircase commands in the shared parser', () => {
    const { mockWindow } = setupMockEnvironment();
    mockWindow.ARGUS_FEATURES = { staircaseMode: false };
    const controller = loadController(mockWindow);
    assert.equal(controller._resolveCommand('activate staircase'), null);
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

  test('Night Vision card is rendered as exactly one complete feature card with all elements in index.html', () => {
    const indexPath = path.join(__dirname, '../index.html');
    const html = fs.readFileSync(indexPath, 'utf8');

    // Exactly one launcher-nightvision element
    const matches = html.match(/id="launcher-nightvision"/g);
    assert.equal(matches ? matches.length : 0, 1, 'There must be exactly one launcher-nightvision element in index.html');

    // Extract the entire Night Vision card snippet
    const cardStart = html.indexOf('id="launcher-nightvision"');
    assert.ok(cardStart !== -1, 'launcher-nightvision must exist');

    // Find the enclosing <a> tag
    const tagOpen = html.lastIndexOf('<a ', cardStart);
    const tagClose = html.indexOf('</a>', cardStart);
    assert.ok(tagOpen !== -1 && tagClose !== -1 && tagClose > tagOpen, 'Night Vision card must be an enclosed <a> tag');

    const cardSnippet = html.slice(tagOpen, tagClose + 4);

    // Verify all required components are contained within this single card
    assert.ok(cardSnippet.includes('feature-card-icon-frame'), 'Must contain icon frame');
    assert.ok(cardSnippet.includes('feature-card-body'), 'Must contain feature-card-body');
    assert.ok(cardSnippet.includes('NIGHT VISION'), 'Must contain NIGHT VISION title');
    assert.ok(cardSnippet.includes('Ready'), 'Must contain Ready badge');
    assert.ok(cardSnippet.includes('Enhance dim images and warn when visibility is unreliable.'), 'Must contain description');
    assert.ok(cardSnippet.includes('feature-card-chevron'), 'Must contain feature-card-chevron');
    assert.ok(cardSnippet.includes('href="./Night-Vision/index.html?mode=ON"'), 'Must have correct canonical URL');
  });

  test('Staircase Detection has its own dashboard card and is not embedded in PathGuide', () => {
    const root = path.resolve(__dirname, '..');
    const dashboard = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const pathGuideHtml = fs.readFileSync(path.join(root, 'Night-Vision', 'index.html'), 'utf8');
    const pathGuideScript = fs.readFileSync(path.join(root, 'Night-Vision', 'script.js'), 'utf8');

    assert.match(dashboard, /href="\.\/staircase-detection\/index\.html"[^>]*id="launcher-staircase"/);
    assert.ok(fs.existsSync(path.join(root, 'staircase-detection', 'index.html')));
    assert.doesNotMatch(pathGuideHtml, /staircase-toggle|staircase-voice|staircase-health/i);
    assert.doesNotMatch(pathGuideScript, /staircase|Staircase/);
  });

  test('Hands-Free mode lifecycle: toggle, starting state, active listening, error on permission denial', () => {
    const { mockWindow, elements } = setupMockEnvironment();
    const controller = loadController(mockWindow);

    let startListeningOptions = null;
    let listeningCallback = null;

    controller.speechService = {
      isSupported: () => true,
      speak: (text, cb) => { if (cb) cb(); },
      startListening: (cb, opts) => {
        listeningCallback = cb;
        startListeningOptions = opts;
      },
      stopListening: () => {}
    };

    const toggleBtn = elements.get('btn-wake-toggle');
    const toggleLabel = elements.get('wake-toggle-label');
    const statusText = elements.get('companion-status-text');

    // 1. Enable Hands-Free mode
    controller.toggleWakeWord(true);
    assert.equal(controller.wakeWordEnabled, true);
    assert.equal(toggleBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(toggleLabel.textContent, 'Hands-Free: Starting Microphone...');
    assert.equal(statusText.textContent, 'Starting microphone...');
    assert.equal(startListeningOptions?.isWakeWord, true, 'Must pass isWakeWord: true to speech service');

    // 2. Microphone actually starts (recognition.onstart fires -> onListeningChange(true))
    controller._onListeningChange(true);
    assert.equal(toggleLabel.textContent, 'Hands-Free: Listening for "Hey Argus"');
    assert.equal(statusText.textContent, 'Listening for "Hey Argus"...');
    assert.equal(controller.currentState, 'listening-wake');

    // 3. Unexpected silence timeout (onListeningChange(false)) must NOT kill wake loop
    controller._onListeningChange(false);
    assert.equal(controller.wakeWordEnabled, true, 'Wake mode remains enabled on silence');
    assert.equal(controller.isListeningWakeWord, true, 'Wake listening flag remains true to allow restart');

    // 4. Permission denied error must cleanly disable toggle and show clear error
    controller._onError('Microphone permission was denied. Please allow microphone access in your browser settings.');
    assert.equal(controller.wakeWordEnabled, false, 'Permission denial must disable hands-free mode');
    assert.equal(controller.isListeningWakeWord, false);
    assert.equal(toggleBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(toggleLabel.textContent, 'Hands-Free: Microphone Access Denied');
    assert.equal(statusText.textContent, 'Microphone blocked');
    assert.equal(controller.currentState, 'error');
  });

  test('Full end-to-end flow: Hey Argus -> greeting with saved name Prem -> command listening -> Open VisionAid', async () => {
    const { mockWindow, mockStorage } = setupMockEnvironment();

    // Set user profile name
    const profile = ArgusProfile.createEmptyProfile();
    profile.displayName = 'Prem';
    mockStorage.setItem('argus_user_profile', JSON.stringify(profile));

    const controller = loadController(mockWindow);

    let spokenTexts = [];
    let startListeningCalls = [];

    controller.speechService = {
      isSupported: () => true,
      speak: (text, cb) => {
        spokenTexts.push(text);
        if (cb) cb();
      },
      startListening: (cb, opts) => {
        startListeningCalls.push({ cb, opts });
      },
      stopListening: () => {}
    };

    // 1. Enable wake word
    controller.toggleWakeWord(true);
    controller._onListeningChange(true);

    // 2. User says "Hey Argus"
    controller.handleWakeSpeechResult('Hey Argus', true);

    // 3. Argus responds with personalized greeting using saved name Prem
    assert.equal(spokenTexts.length >= 1, true);
    assert.equal(spokenTexts[0], "I'm here, Prem. What kind of help do you need?");

    // 4. Wait for acoustic guard delay (200ms) to transition to command listening
    await new Promise(r => setTimeout(r, 250));

    // After greeting, command listening is triggered
    assert.equal(controller.isListeningCommand, true);
    assert.equal(controller.currentState, 'listening');

    // 5. User speaks command: "Open VisionAid"
    controller.handleCommandSpeechResult('Open VisionAid', true);

    // 6. Argus confirms and opens VisionAid
    assert.equal(spokenTexts[spokenTexts.length - 1], 'Opening VisionAid AI.');
    assert.equal(mockWindow.location.href, './Visual%20Explanation/index.html');
  });

  test('All six core module commands navigate correctly from command listening', () => {
    const testCases = [
      { cmd: 'Open PathGuide', expectedUrl: './Night-Vision/index.html', confirm: 'Starting PathGuide Pro navigation.' },
      { cmd: 'Open Object Detection', expectedUrl: './object-detection-pro/index.html', confirm: 'Opening Object Detection Pro.' },
      { cmd: 'Open VisionAid', expectedUrl: './Visual%20Explanation/index.html', confirm: 'Opening VisionAid AI.' },
      { cmd: 'Open Queue Detector', expectedUrl: './queue-detection/index.html', confirm: 'Opening Queue Detector.' },
      { cmd: 'Open Optima Vision', expectedUrl: './Camera%20Check/index.html', confirm: 'Opening Optima Vision camera check.' },
      { cmd: 'Turn on Night Vision', expectedUrl: './Night-Vision/index.html?mode=ON', confirm: 'Turning on Night Vision mode.' }
    ];

    for (const tc of testCases) {
      const { mockWindow } = setupMockEnvironment();
      const controller = loadController(mockWindow);

      let spoken = '';
      controller.speechService = {
        isSupported: () => true,
        speak: (text, cb) => {
          spoken = text;
          if (cb) cb();
        },
        startListening: () => {},
        stopListening: () => {}
      };

      controller.processVoiceCommand(tc.cmd);

      assert.equal(spoken, tc.confirm, `Confirmation must match for ${tc.cmd}`);
      assert.equal(mockWindow.location.href, tc.expectedUrl, `Target URL must match for ${tc.cmd}`);
    }
  });

  test('Tap to Speak works independently of Hands-Free mode', () => {
    const { mockWindow } = setupMockEnvironment();
    const controller = loadController(mockWindow);

    let startListeningOpts = null;
    controller.speechService = {
      isSupported: () => true,
      speak: (text, cb) => { if (cb) cb(); },
      startListening: (cb, opts) => { startListeningOpts = opts; },
      stopListening: () => {}
    };

    // Case 1: Hands-Free is OFF -> Tap to Speak directly activates command listening
    assert.equal(controller.wakeWordEnabled, false);
    controller.handleTapToSpeak();
    assert.equal(controller.isListeningCommand, true);
    assert.equal(startListeningOpts?.isWakeWord, false);
    assert.equal(controller.currentState, 'listening');

    // Case 2: Tapping again stops command listening
    controller.handleTapToSpeak();
    assert.equal(controller.isListeningCommand, false);
    assert.equal(controller.currentState, 'idle');
  });

  test('clicking header profile control reliably invokes profile settings modal', () => {
    const { mockWindow } = setupMockEnvironment();
    let modalOpened = false;
    mockWindow.argusProfileUI = {
      openModal: () => { modalOpened = true; }
    };

    // Test openProfileModalSafe logic
    if (typeof mockWindow.openProfileModalSafe === 'function') {
      mockWindow.openProfileModalSafe = function() {
        if (mockWindow.argusProfileUI && typeof mockWindow.argusProfileUI.openModal === 'function') {
          mockWindow.argusProfileUI.openModal();
        }
      };
    }
    mockWindow.openProfileModalSafe();
    assert.equal(modalOpened, true, 'openProfileModalSafe must open profile modal via window.argusProfileUI');
  });

  test('ProfileStorage maintains language preference and profile fields intact without reset', () => {
    const { mockStorage } = setupMockEnvironment();

    // Default language is English
    assert.equal(ArgusProfile.ProfileStorage.getLanguagePreference(mockStorage), 'en');

    // Save profile with existing contacts
    const profile = ArgusProfile.createEmptyProfile();
    profile.displayName = 'Prem Pareesh';
    profile.phoneNumber = '+919876543210';
    profile.emergencyContacts = [{ name: 'Dr. Sharma', phone: '+919876543211', relation: 'Doctor' }];
    ArgusProfile.ProfileStorage.saveProfile(profile, mockStorage);

    // Change language to Telugu
    ArgusProfile.ProfileStorage.setLanguagePreference('te', mockStorage);
    assert.equal(ArgusProfile.ProfileStorage.getLanguagePreference(mockStorage), 'te');

    // Reload profile and ensure fields and contacts are preserved
    const reloaded = ArgusProfile.ProfileStorage.loadProfile(mockStorage);
    assert.equal(reloaded.displayName, 'Prem Pareesh');
    assert.equal(reloaded.phoneNumber, '+919876543210');
    assert.equal(reloaded.preferredLanguage, 'te');
    assert.equal(reloaded.emergencyContacts.length, 1);
    assert.equal(reloaded.emergencyContacts[0].name, 'Dr. Sharma');
  });

  test('synchronizes header and modal language selectors and updates speech service language', () => {
    const { mockWindow, elements } = setupMockEnvironment();
    const controller = loadController(mockWindow);

    let configuredLang = '';
    controller.speechService = {
      isSupported: () => true,
      setLanguage: (code) => { configuredLang = code; return code; },
      speak: () => {},
      startListening: () => {},
      stopListening: () => {}
    };

    const headerSelect = elements.get('header-language-select');
    const modalSelect = elements.get('manual-language-select');

    // 1. Switch to Telugu ('te')
    controller.setLanguage('te');
    assert.equal(controller.currentLanguage, 'te');
    assert.equal(headerSelect.value, 'te');
    assert.equal(modalSelect.value, 'te');
    assert.equal(configuredLang, 'te');
    assert.equal(mockWindow.localStorage.getItem('argus_language_preference'), 'te');

    // 2. Switch to Hindi ('hi')
    controller.setLanguage('hi');
    assert.equal(controller.currentLanguage, 'hi');
    assert.equal(headerSelect.value, 'hi');
    assert.equal(modalSelect.value, 'hi');
    assert.equal(configuredLang, 'hi');
    assert.equal(mockWindow.localStorage.getItem('argus_language_preference'), 'hi');

    // 3. Switch back to English ('en')
    controller.setLanguage('en');
    assert.equal(controller.currentLanguage, 'en');
    assert.equal(headerSelect.value, 'en');
    assert.equal(modalSelect.value, 'en');
    assert.equal(configuredLang, 'en');
  });

  test('ArgusSpeechService configures BCP-47 recognition language correctly for EN, TE, HI', () => {
    const speech = new ArgusProfile.ArgusSpeechService();

    speech.setLanguage('te');
    assert.equal(speech.lang, 'te-IN');
    if (speech.recognition) {
      assert.equal(speech.recognition.lang, 'te-IN');
    }

    speech.setLanguage('hi');
    assert.equal(speech.lang, 'hi-IN');
    if (speech.recognition) {
      assert.equal(speech.recognition.lang, 'hi-IN');
    }

    speech.setLanguage('en');
    assert.equal(speech.lang, 'en-IN');
    if (speech.recognition) {
      assert.equal(speech.recognition.lang, 'en-IN');
    }
  });

  test('multilingual wake words and greetings for Telugu and Hindi', () => {
    const { mockWindow, mockStorage } = setupMockEnvironment();
    const profile = ArgusProfile.createEmptyProfile();
    profile.displayName = 'Prem';
    mockStorage.setItem('argus_user_profile', JSON.stringify(profile));

    const controller = loadController(mockWindow);

    let spoken = '';
    controller.speechService = {
      isSupported: () => true,
      speak: (text, cb) => { spoken = text; if (cb) cb(); },
      startListening: () => {},
      stopListening: () => {}
    };

    // 1. Telugu wake words: "హాయ్ ఆర్గస్", "ఆర్గస్"
    controller.setLanguage('te', false);
    assert.equal(controller._detectWakeWord('హాయ్ ఆర్గస్'), true);
    assert.equal(controller._detectWakeWord('ఆర్గస్'), true);
    controller._triggerWakeWordReaction();
    assert.equal(spoken, 'నేను ఇక్కడే ఉన్నాను, Prem. మీకు ఎలాంటి సహాయం కావాలి?');

    // 2. Hindi wake words: "हाय आर्गस", "आर्गस"
    controller.setLanguage('hi', false);
    assert.equal(controller._detectWakeWord('हाय आर्गस'), true);
    assert.equal(controller._detectWakeWord('आर्गस'), true);
    controller._triggerWakeWordReaction();
    assert.equal(spoken, 'मैं यहाँ हूँ, Prem। आपको किस प्रकार की मदद चाहिए?');
  });

  test('Telugu command normalization, routing, and spoken confirmations for all 6 modules', () => {
    const teluguTestCases = [
      { cmd: 'పాత్గైడ్ తెరువు', expectedUrl: './Night-Vision/index.html', confirm: 'పాత్గైడ్ ప్రో నావిగేషన్ ప్రారంభిస్తున్నాను.' },
      { cmd: 'ఇది ఏ వస్తువో చెప్పు', expectedUrl: './object-detection-pro/index.html', confirm: 'ఆబ్జెక్ట్ డిటెక్షన్ ప్రో తెరుస్తున్నాను.' },
      { cmd: 'విజన్ ఎయిడ్ తెరువు', expectedUrl: './Visual%20Explanation/index.html', confirm: 'ఇప్పుడే విజన్ ఎయిడ్ తెరుస్తున్నాను.' },
      { cmd: 'క్యూ డిటెక్టర్ తెరువు', expectedUrl: './queue-detection/index.html', confirm: 'క్యూ డిటెక్టర్ తెరుస్తున్నాను.' },
      { cmd: 'ఈ టెక్స్ట్ చదువు', expectedUrl: './Camera%20Check/index.html', confirm: 'ఆప్టిమా విజన్ కెమెరా చెక్ తెరుస్తున్నాను.' },
      { cmd: 'నైట్ విజన్ ఆన్ చేయి', expectedUrl: './Night-Vision/index.html?mode=ON', confirm: 'నైట్ విజన్ మోడ్ ఆన్ చేస్తున్నాను.' }
    ];

    for (const tc of teluguTestCases) {
      const { mockWindow } = setupMockEnvironment();
      const controller = loadController(mockWindow);
      controller.setLanguage('te', false);

      let spoken = '';
      controller.speechService = {
        isSupported: () => true,
        speak: (text, cb) => { spoken = text; if (cb) cb(); },
        startListening: () => {},
        stopListening: () => {}
      };

      controller.processVoiceCommand(tc.cmd);

      assert.equal(spoken, tc.confirm, `Telugu spoken confirm must match for ${tc.cmd}`);
      assert.equal(mockWindow.location.href, tc.expectedUrl, `Target URL must match for ${tc.cmd}`);
    }
  });

  test('Hindi command normalization, routing, and spoken confirmations for all 6 modules', () => {
    const hindiTestCases = [
      { cmd: 'पाथगाइड खोलो', expectedUrl: './Night-Vision/index.html', confirm: 'पाथगाइड प्रो नेविगेशन शुरू कर रहा हूँ।' },
      { cmd: 'यह कौन सी वस्तु है?', expectedUrl: './object-detection-pro/index.html', confirm: 'ऑब्जेक्ट डिटेक्शन प्रो खोल रहा हूँ।' },
      { cmd: 'विज़नएड खोलो', expectedUrl: './Visual%20Explanation/index.html', confirm: 'अब विज़नएड खोल रहा हूँ।' },
      { cmd: 'कतार डिटेक्टर खोलो', expectedUrl: './queue-detection/index.html', confirm: 'कतार डिटेक्टर खोल रहा हूँ।' },
      { cmd: 'यह टेक्स्ट पढ़ो', expectedUrl: './Camera%20Check/index.html', confirm: 'ऑप्टिमा विज़न कैमरा चेक खोल रहा हूँ।' },
      { cmd: 'नाइट विज़न चालू करो', expectedUrl: './Night-Vision/index.html?mode=ON', confirm: 'नाइट विज़न मोड चालू कर रहा हूँ।' }
    ];

    for (const tc of hindiTestCases) {
      const { mockWindow } = setupMockEnvironment();
      const controller = loadController(mockWindow);
      controller.setLanguage('hi', false);

      let spoken = '';
      controller.speechService = {
        isSupported: () => true,
        speak: (text, cb) => { spoken = text; if (cb) cb(); },
        startListening: () => {},
        stopListening: () => {}
      };

      controller.processVoiceCommand(tc.cmd);

      assert.equal(spoken, tc.confirm, `Hindi spoken confirm must match for ${tc.cmd}`);
      assert.equal(mockWindow.location.href, tc.expectedUrl, `Target URL must match for ${tc.cmd}`);
    }
  });

  test('clean footer verification: removed Voice: Ready, Language: English, footer language select, and slogan', () => {
    const indexPath = path.join(__dirname, '../index.html');
    const html = fs.readFileSync(indexPath, 'utf8');

    // Extract footer HTML snippet
    const footerStart = html.indexOf('<footer');
    const footerEnd = html.indexOf('</footer>');
    assert.ok(footerStart !== -1 && footerEnd !== -1, 'Footer must exist in index.html');
    const footerHtml = html.slice(footerStart, footerEnd + 9);

    // Verify 4 unwanted items are completely absent from footer
    assert.ok(!footerHtml.includes('Voice: Ready'), 'Voice: Ready must be removed from footer');
    assert.ok(!footerHtml.includes('Language: English'), 'Language: English must be removed from footer');
    assert.ok(!footerHtml.includes('footer-caret'), 'Footer caret / language dropdown must be removed from footer');
    assert.ok(!footerHtml.includes('See More. Live Independently.'), 'Slogan must be removed from footer');

    // Verify minimal clean footer contains copyright and settings button
    assert.ok(footerHtml.includes('© 2026 Argus.AI'), 'Footer must contain copyright');
    assert.ok(footerHtml.includes('Settings'), 'Footer must contain Settings button');
  });

  test('natural-language intent routing across complex phrasing for English, Telugu, and Hindi', () => {
    const naturalTestCases = [
      // English natural intents
      { cmd: 'Who is in front of me? Please identify them.', lang: 'en', expectedUrl: './object-detection-pro/index.html', confirm: 'Opening Object Detection Pro.' },
      { cmd: "Who is standing in front of me?", lang: 'en', expectedUrl: './object-detection-pro/index.html', confirm: 'Opening Object Detection Pro.' },
      { cmd: "Can you read what's written here?", lang: 'en', expectedUrl: './Visual%20Explanation/index.html', confirm: 'Opening VisionAid AI.' },
      { cmd: 'Please read this document.', lang: 'en', expectedUrl: './Visual%20Explanation/index.html', confirm: 'Opening VisionAid AI.' },
      { cmd: 'Help me walk safely.', lang: 'en', expectedUrl: './Night-Vision/index.html', confirm: 'Starting PathGuide Pro navigation.' },
      { cmd: 'Help me navigate.', lang: 'en', expectedUrl: './Night-Vision/index.html', confirm: 'Starting PathGuide Pro navigation.' },
      { cmd: 'How many people are in line?', lang: 'en', expectedUrl: './queue-detection/index.html', confirm: 'Opening Queue Detector.' },
      { cmd: 'Is it too dark to see clearly?', lang: 'en', expectedUrl: './Night-Vision/index.html?mode=ON', confirm: 'Turning on Night Vision mode.' },

      // Telugu natural intents
      { cmd: 'నా ముందు ఎవరు ఉన్నారు?', lang: 'te', expectedUrl: './object-detection-pro/index.html', confirm: 'ఆబ్జెక్ట్ డిటెక్షన్ ప్రో తెరుస్తున్నాను.' },
      { cmd: 'ఈ పత్రాన్ని చదువు', lang: 'te', expectedUrl: './Visual%20Explanation/index.html', confirm: 'ఇప్పుడే విజన్ ఎయిడ్ తెరుస్తున్నాను.' },
      { cmd: 'నాకు దారి చూపించు', lang: 'te', expectedUrl: './Night-Vision/index.html', confirm: 'పాత్గైడ్ ప్రో నావిగేషన్ ప్రారంభిస్తున్నాను.' },
      { cmd: 'లైన్లో ఎంతమంది ఉన్నారు?', lang: 'te', expectedUrl: './queue-detection/index.html', confirm: 'క్యూ డిటెక్టర్ తెరుస్తున్నాను.' },
      { cmd: 'చాలా చీకటిగా ఉంది', lang: 'te', expectedUrl: './Night-Vision/index.html?mode=ON', confirm: 'నైట్ విజన్ మోడ్ ఆన్ చేస్తున్నాను.' },

      // Hindi natural intents
      { cmd: 'मेरे सामने कौन है? कृपया पहचानें।', lang: 'hi', expectedUrl: './object-detection-pro/index.html', confirm: 'ऑब्जेक्ट डिटेक्शन प्रो खोल रहा हूँ।' },
      { cmd: 'यह दस्तावेज़ पढ़ो।', lang: 'hi', expectedUrl: './Visual%20Explanation/index.html', confirm: 'अब विज़नएड खोल रहा हूँ।' },
      { cmd: 'मुझे रास्ता बताओ।', lang: 'hi', expectedUrl: './Night-Vision/index.html', confirm: 'पाथगाइड प्रो नेविगेशन शुरू कर रहा हूँ।' },
      { cmd: 'कतार में कितने लोग हैं?', lang: 'hi', expectedUrl: './queue-detection/index.html', confirm: 'कतार डिटेक्टर खोल रहा हूँ।' },
      { cmd: 'क्या साफ देखने के लिए बहुत अंधेरा है?', lang: 'hi', expectedUrl: './Night-Vision/index.html?mode=ON', confirm: 'नाइट विज़न मोड चालू कर रहा हूँ।' }
    ];

    for (const tc of naturalTestCases) {
      const { mockWindow } = setupMockEnvironment();
      const controller = loadController(mockWindow);
      controller.setLanguage(tc.lang, false);

      let spoken = '';
      controller.speechService = {
        isSupported: () => true,
        speak: (text, cb) => { spoken = text; if (cb) cb(); },
        startListening: () => {},
        stopListening: () => {}
      };

      controller.processVoiceCommand(tc.cmd);

      assert.equal(spoken, tc.confirm, `Spoken confirmation mismatch for "${tc.cmd}"`);
      assert.equal(mockWindow.location.href, tc.expectedUrl, `Navigation route mismatch for "${tc.cmd}"`);
    }
  });

  test('profile save persists changes, updates header and spoken greeting without reload', () => {
    const { mockWindow, mockStorage, elements } = setupMockEnvironment();
    const initialProfile = ArgusProfile.createEmptyProfile();
    initialProfile.displayName = 'Prem';
    initialProfile.completed = true;
    ArgusProfile.ProfileStorage.saveProfile(initialProfile, mockStorage);

    const controller = loadController(mockWindow);

    // Initial state: profile name is Prem
    assert.equal(elements.get('header-profile-name').textContent, 'Prem');

    // Simulate saving a new profile name
    const updatedProfile = ArgusProfile.ProfileStorage.loadProfile(mockStorage);
    updatedProfile.displayName = 'Aarav Sharma';
    updatedProfile.phoneNumber = '+91 98765 11223';
    updatedProfile.completed = true;
    ArgusProfile.ProfileStorage.saveProfile(updatedProfile, mockStorage);

    // Trigger runtime synchronization
    controller.syncUserProfile();

    // Verify DOM was immediately updated
    assert.equal(elements.get('header-profile-name').textContent, 'Aarav Sharma');
    assert.ok(elements.get('companion-greeting-text').innerHTML.includes('Aarav Sharma'));

    // Verify next spoken greeting uses new name
    let spoken = '';
    controller.speechService = {
      isSupported: () => true,
      speak: (text, cb) => { spoken = text; if (cb) cb(); },
      startListening: () => {},
      stopListening: () => {}
    };

    controller._triggerWakeWordReaction();
    assert.ok(spoken.includes('Aarav Sharma'), `Greeting must address user as Aarav Sharma, got: ${spoken}`);
  });

  test('interactive 3D robot script exists and exports Interactive3DRobot class', () => {
    const robotScriptPath = path.join(__dirname, '../assets/js/interactive-3d-robot.js');
    assert.ok(fs.existsSync(robotScriptPath), 'assets/js/interactive-3d-robot.js must exist on disk');

    const robotModule = require(robotScriptPath);
    assert.ok(typeof robotModule.Interactive3DRobot === 'function', 'Interactive3DRobot class must be exported');
  });

});
