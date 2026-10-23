/**
 * Automated Test Suite for Argus.AI Single-Page Companion UI & Voice Controller
 * Tests command routing, robot state transitions, transcript updates,
 * profile greeting reflection, and Emergency SOS integration.
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
    argusProfileUI: {
      openModal: () => {}
    }
  };

  return { mockWindow, mockDocument, mockStorage, elements };
}

// Load core profile library for testing
const ArgusProfile = require('../assets/js/voice-profile-core.js');

describe('6. Single-Page Companion UI Controller', () => {

  test('companion controller resolves all 6 core feature voice commands correctly', () => {
    const { mockWindow } = setupMockEnvironment();
    mockWindow.ArgusProfile = ArgusProfile;

    // Load companion controller script in mock context
    const code = fs.readFileSync(path.join(__dirname, '../assets/js/companion-controller.js'), 'utf8');
    const fn = new Function('window', 'document', 'root', code);
    fn(mockWindow, mockWindow.document, mockWindow);

    const controller = mockWindow.argusCompanion;
    assert.ok(controller, 'argusCompanion controller is instantiated');

    // Test 1: Object Detection Pro
    const m1 = controller._resolveCommand('Hey Argus, activate detection mode');
    assert.ok(m1);
    assert.equal(m1.id, 'object-detection');
    assert.equal(m1.url, './object-detection-pro/index.html');

    const m1b = controller._resolveCommand('open object detection');
    assert.ok(m1b);
    assert.equal(m1b.id, 'object-detection');

    // Test 2: PathGuide Pro
    const m2 = controller._resolveCommand('Start PathGuide Pro navigation');
    assert.ok(m2);
    assert.equal(m2.id, 'pathguide');
    assert.equal(m2.url, './Night-Vision/index.html');

    const m2b = controller._resolveCommand('start navigation guidance');
    assert.ok(m2b);
    assert.equal(m2b.id, 'pathguide');

    // Test 3: VisionAid AI
    const m3 = controller._resolveCommand('Activate VisionAid to read document');
    assert.ok(m3);
    assert.equal(m3.id, 'visionaid');
    assert.equal(m3.url, './Visual Explanation/index.html');

    // Test 4: Queue Detector
    const m4 = controller._resolveCommand('Open Queue Detector and check distance');
    assert.ok(m4);
    assert.equal(m4.id, 'queue-detector');
    assert.equal(m4.url, './queue-detection/index.html');

    // Test 5: Optima Vision
    const m5 = controller._resolveCommand('Activate Optima Vision camera check');
    assert.ok(m5);
    assert.equal(m5.id, 'optima-vision');
    assert.equal(m5.url, './Camera Check/index.html');

    // Test 6: Night Vision
    const m6 = controller._resolveCommand('Turn on night vision mode');
    assert.ok(m6);
    assert.equal(m6.id, 'night-vision');
    assert.equal(m6.url, './Night-Vision/index.html?mode=night');
  });

  test('companion controller resolves Emergency SOS and Profile voice commands', () => {
    const { mockWindow } = setupMockEnvironment();
    mockWindow.ArgusProfile = ArgusProfile;

    const code = fs.readFileSync(path.join(__dirname, '../assets/js/companion-controller.js'), 'utf8');
    const fn = new Function('window', 'document', 'root', code);
    fn(mockWindow, mockWindow.document, mockWindow);

    const controller = mockWindow.argusCompanion;

    // Emergency SOS command
    let sosTriggered = false;
    mockWindow.triggerEmergencySOS = () => { sosTriggered = true; };

    const mSos = controller._resolveCommand('Hey Argus, trigger emergency SOS');
    assert.ok(mSos);
    assert.equal(mSos.id, 'emergency-sos');
    mSos.action();
    assert.equal(sosTriggered, true, 'Emergency SOS action must be called');

    // Profile Setup command
    let profileModalOpened = false;
    mockWindow.argusProfileUI = {
      openModal: () => { profileModalOpened = true; }
    };

    const mProfile = controller._resolveCommand('I want to set up profile');
    assert.ok(mProfile);
    assert.equal(mProfile.id, 'profile-setup');
    mProfile.action();
    assert.equal(profileModalOpened, true, 'Profile openModal must be called');
  });

  test('unrecognized command falls through gracefully with helpful feedback', () => {
    const { mockWindow } = setupMockEnvironment();
    mockWindow.ArgusProfile = ArgusProfile;

    const code = fs.readFileSync(path.join(__dirname, '../assets/js/companion-controller.js'), 'utf8');
    const fn = new Function('window', 'document', 'root', code);
    fn(mockWindow, mockWindow.document, mockWindow);

    const controller = mockWindow.argusCompanion;

    const mNone = controller._resolveCommand('play some jazz music');
    assert.equal(mNone, null, 'Unrelated phrases must not match an arbitrary feature');

    controller.processVoiceCommand('play some jazz music');
    assert.equal(controller.currentState, 'error');
    assert.ok(controller.transcriptText.textContent.includes('Could not match "play some jazz music"'));
  });

  test('robot states correctly update classes and UI labels', () => {
    const { mockWindow, elements } = setupMockEnvironment();
    mockWindow.ArgusProfile = ArgusProfile;

    const code = fs.readFileSync(path.join(__dirname, '../assets/js/companion-controller.js'), 'utf8');
    const fn = new Function('window', 'document', 'root', code);
    fn(mockWindow, mockWindow.document, mockWindow);

    const controller = mockWindow.argusCompanion;
    const stage = elements.get('companion-robot-stage');
    const label = elements.get('tap-to-speak-label');
    const statusText = elements.get('companion-status-text');

    // State 1: LISTENING
    controller.setRobotState('listening', "I'm listening...");
    assert.ok(stage.classList.contains('state-listening'));
    assert.equal(label.textContent, "I'm listening...");
    assert.equal(statusText.textContent, "I'm listening...");

    // State 2: PROCESSING
    controller.setRobotState('processing', 'Understanding request...');
    assert.ok(stage.classList.contains('state-processing'));
    assert.equal(label.textContent, 'Understanding...');

    // State 3: SPEAKING
    controller.setRobotState('speaking', 'Argus is responding...');
    assert.ok(stage.classList.contains('state-speaking'));
    assert.equal(label.textContent, 'Argus is responding...');

    // State 4: ERROR
    controller.setRobotState('error', 'Microphone notice');
    assert.ok(stage.classList.contains('state-error'));
    assert.equal(label.textContent, 'Tap to try again');

    // State 5: IDLE
    controller.setRobotState('idle', 'Ready');
    assert.ok(stage.classList.contains('state-idle'));
    assert.equal(label.textContent, 'TAP TO SPEAK');
  });

  test('reflects saved user profile name in greeting and header badge', () => {
    const { mockWindow, mockStorage, elements } = setupMockEnvironment();
    mockWindow.ArgusProfile = ArgusProfile;

    // Save a profile in storage
    const profile = ArgusProfile.createEmptyProfile();
    profile.displayName = 'Prem Pareesh';
    profile.primaryEmergencyPhone = '+919876543210';
    profile.completed = true;
    mockStorage.setItem('argus_user_profile', JSON.stringify(profile));

    const code = fs.readFileSync(path.join(__dirname, '../assets/js/companion-controller.js'), 'utf8');
    const fn = new Function('window', 'document', 'root', code);
    fn(mockWindow, mockWindow.document, mockWindow);

    const greeting = elements.get('companion-greeting-text');
    const headerName = elements.get('header-profile-name');

    assert.ok(greeting.innerHTML.includes('Prem Pareesh'), 'Greeting must show user name');
    assert.equal(headerName.textContent, 'Prem Pareesh', 'Header button must show display name');
  });

  test('tap to speak respects open modals and prevents duplicate listening', () => {
    const { mockWindow, elements } = setupMockEnvironment();
    mockWindow.ArgusProfile = ArgusProfile;

    const code = fs.readFileSync(path.join(__dirname, '../assets/js/companion-controller.js'), 'utf8');
    const fn = new Function('window', 'document', 'root', code);
    fn(mockWindow, mockWindow.document, mockWindow);

    const controller = mockWindow.argusCompanion;

    // Simulate open profile modal
    const profileModal = elements.get('argus-profile-modal-overlay');
    profileModal.classList.add('active');

    let speechStarted = false;
    controller.speechService = {
      isSupported: () => true,
      startListening: () => { speechStarted = true; },
      stopListening: () => {},
      cancel: () => {}
    };

    controller.handleTapToSpeak();
    assert.equal(speechStarted, false, 'Homepage Tap to Speak must not activate when profile modal is open');

    // Close profile modal and simulate open SOS modal
    profileModal.classList.remove('active');
    const sosModal = elements.get('sos-modal-overlay');
    sosModal.classList.add('active');

    controller.handleTapToSpeak();
    assert.equal(speechStarted, false, 'Homepage Tap to Speak must not activate when SOS modal is open');

    // Close SOS modal and verify it now starts cleanly
    sosModal.classList.remove('active');
    controller.handleTapToSpeak();
    assert.equal(speechStarted, true, 'Homepage Tap to Speak must start when modals are closed');
  });

});
