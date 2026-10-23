/**
 * DOM Integration Tests for Argus.AI Voice Profile Onboarding
 * Tests DOM injection, Welcome modal display, State transitions, Manual forms,
 * Banner activation, and Storage integration in a mocked browser DOM environment.
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Minimal Mock DOM Environment
function setupMockDOM() {
  const store = new Map();
  const sessionStore = new Map();

  const mockStorage = {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };

  const mockSessionStorage = {
    getItem: (k) => sessionStore.has(k) ? sessionStore.get(k) : null,
    setItem: (k, v) => sessionStore.set(k, String(v)),
    removeItem: (k) => sessionStore.delete(k),
    clear: () => sessionStore.clear()
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
        toggle: (c) => this.classList.contains(c) ? this.classList.remove(c) : this.classList.add(c)
      };
      this.attributes = new Map();
      this.style = {};
      this.listeners = new Map();
      this.children = [];
      this.parentElement = null;
      this._innerHTML = '';
      this.value = '';
      this.innerText = '';
    }

    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.get(k) || null; }
    hasAttribute(k) { return this.attributes.has(k); }

    addEventListener(event, cb) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(cb);
    }

    dispatchEvent(event) {
      const cbs = this.listeners.get(event.type) || [];
      cbs.forEach(cb => cb(event));
    }

    click() {
      this.dispatchEvent({ type: 'click', target: this, defaultPrevented: false });
    }

    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }

    prepend(child) {
      child.parentElement = this;
      this.children.unshift(child);
      return child;
    }

    insertBefore(newNode, refNode) {
      const idx = this.children.indexOf(refNode);
      if (idx !== -1) {
        this.children.splice(idx, 0, newNode);
      } else {
        this.appendChild(newNode);
      }
      newNode.parentElement = this;
      return newNode;
    }

    querySelector(sel) {
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        return this._find(el => el.classList && el.classList.contains(cls));
      }
      if (sel.startsWith('#')) {
        const id = sel.slice(1);
        return this._find(el => el.id === id);
      }
      return this._find(el => el.tagName.toLowerCase() === sel.toLowerCase());
    }

    querySelectorAll(sel) {
      const res = [];
      this._findAll(el => {
        if (sel.startsWith('.')) return el.classList && el.classList.contains(sel.slice(1));
        if (sel.startsWith('#')) return el.id === sel.slice(1);
        return el.tagName.toLowerCase() === sel.toLowerCase();
      }, res);
      return res;
    }

    _find(predicate) {
      for (const ch of this.children) {
        if (predicate(ch)) return ch;
        const sub = ch._find(predicate);
        if (sub) return sub;
      }
      return null;
    }

    _findAll(predicate, res) {
      for (const ch of this.children) {
        if (predicate(ch)) res.push(ch);
        ch._findAll(predicate, res);
      }
    }

    set innerHTML(html) {
      this._innerHTML = html;
      this._parseSimpleHTML(html);
    }

    get innerHTML() {
      return this._innerHTML;
    }

    _parseSimpleHTML(html) {
      // Create element nodes for IDs and classes found in templates
      const idMatches = html.matchAll(/id=["']([^"']+)["']/g);
      for (const m of idMatches) {
        const id = m[1];
        if (!this._find(el => el.id === id)) {
          const el = new MockElement('div');
          el.id = id;
          this.appendChild(el);
        }
      }
    }
  }

  const documentMock = {
    body: new MockElement('body'),
    createElement: (tag) => new MockElement(tag),
    getElementById: (id) => documentMock.body._find(el => el.id === id),
    querySelector: (sel) => documentMock.body.querySelector(sel),
    querySelectorAll: (sel) => documentMock.body.querySelectorAll(sel),
    addEventListener: (ev, cb) => {},
    readyState: 'complete'
  };

  const topNav = new MockElement('nav');
  topNav.className = 'top-nav';
  topNav.classList.add('top-nav');
  const sosBtn = new MockElement('a');
  sosBtn.className = 'btn-sos-cta';
  sosBtn.classList.add('btn-sos-cta');
  topNav.appendChild(sosBtn);
  documentMock.body.appendChild(topNav);

  const windowMock = {
    localStorage: mockStorage,
    sessionStorage: mockSessionStorage,
    speechSynthesis: {
      speak: () => {},
      cancel: () => {},
      getVoices: () => []
    },
    addEventListener: (ev, cb) => {},
    confirm: (msg) => true
  };

  return { windowMock, documentMock, mockStorage, mockSessionStorage };
}

describe('4. DOM Integration & UI Controller', () => {
  let env;

  beforeEach(() => {
    env = setupMockDOM();
    global.window = env.windowMock;
    global.document = env.documentMock;
    global.localStorage = env.mockStorage;
    global.sessionStorage = env.mockSessionStorage;

    // Load Core Engine
    delete require.cache[require.resolve('../assets/js/voice-profile-core.js')];
    delete require.cache[require.resolve('../assets/js/profile-setup-ui.js')];

    global.ArgusProfile = require('../assets/js/voice-profile-core.js');
    require('../assets/js/profile-setup-ui.js');
  });

  test('DOM injection creates overlay, modal card, and banner in document', () => {
    const overlay = env.documentMock.getElementById('argus-profile-modal-overlay');
    assert.ok(overlay, 'Modal overlay must exist in DOM');
    assert.equal(overlay.getAttribute('role'), 'dialog');
    assert.equal(overlay.getAttribute('aria-modal'), 'true');

    const banner = env.documentMock.getElementById('argus-profile-banner');
    assert.ok(banner, 'Incomplete setup banner must exist in DOM');

    const robot = env.documentMock.getElementById('argus-robot-avatar');
    assert.ok(robot, 'Argus Robot avatar container must exist');
  });

  test('first-time user sees auto-opened modal with welcome view', async () => {
    await new Promise(r => setTimeout(r, 400));
    const overlay = env.documentMock.getElementById('argus-profile-modal-overlay');
    // Initially opens modal on first visit
    assert.equal(overlay.classList.contains('active'), true);

    const welcomeView = env.documentMock.getElementById('profile-view-welcome');
    assert.ok(welcomeView, 'Welcome view must exist');
    assert.notEqual(welcomeView.style.display, 'none');

    const startBtn = env.documentMock.getElementById('btn-start-voice');
    const manualBtn = env.documentMock.getElementById('btn-fill-manually');
    const skipBtn = env.documentMock.getElementById('btn-skip-welcome');

    assert.ok(startBtn, 'Start Voice Setup button must exist');
    assert.ok(manualBtn, 'Fill Manually button must exist');
    assert.ok(skipBtn, 'Skip for Now button must exist');
  });

  test('clicking Fill Manually displays the accessible manual input form', () => {
    const manualBtn = env.documentMock.getElementById('btn-fill-manually');
    manualBtn.click();

    const manualView = env.documentMock.getElementById('profile-view-manual');
    assert.equal(manualView.style.display, 'block');

    const nameInput = env.documentMock.getElementById('manual-input-name');
    const phoneInput = env.documentMock.getElementById('manual-input-phone');
    assert.ok(nameInput, 'Manual name input must exist');
    assert.ok(phoneInput, 'Manual phone input must exist');
  });

  test('manual form validates required name and international phone number', () => {
    const manualBtn = env.documentMock.getElementById('btn-fill-manually');
    manualBtn.click();

    const saveBtn = env.documentMock.getElementById('btn-save-manual');
    const nameInput = env.documentMock.getElementById('manual-input-name');
    const errorDiv = env.documentMock.getElementById('manual-form-error');

    // Attempt to save with empty name
    nameInput.value = '';
    saveBtn.click();
    assert.equal(errorDiv.style.display, 'block');
    assert.match(errorDiv.innerText, /at least 2 characters/i);

    // Provide valid name and invalid phone
    nameInput.value = 'Prem Pareesh';
    const phoneInput = env.documentMock.getElementById('manual-input-phone');
    phoneInput.value = '123'; // invalid short phone
    saveBtn.click();
    assert.equal(errorDiv.style.display, 'block');
    assert.match(errorDiv.innerText, /valid personal phone number/i);

    // Provide valid international phone and save
    phoneInput.value = '+919876543210';
    saveBtn.click();
    assert.equal(errorDiv.style.display, 'none');

    // Transitions to review view
    const reviewView = env.documentMock.getElementById('profile-view-review');
    assert.equal(reviewView.style.display, 'block');

    const displayNameReview = env.documentMock.getElementById('review-display-name');
    assert.equal(displayNameReview.innerText, 'Prem Pareesh');
  });

  test('Skip for Now immediately closes modal and activates top incomplete banner', () => {
    const skipBtn = env.documentMock.getElementById('btn-skip-welcome');
    const overlay = env.documentMock.getElementById('argus-profile-modal-overlay');
    const banner = env.documentMock.getElementById('argus-profile-banner');

    skipBtn.click();

    assert.equal(overlay.classList.contains('active'), false);
    assert.equal(banner.classList.contains('active'), true);
    assert.equal(env.mockSessionStorage.getItem('argus_profile_skipped'), 'true');
  });

  test('completed profile does not show incomplete banner', () => {
    const p = {
      profileVersion: 1,
      displayName: 'Alice Walker',
      phoneNumber: '+14155550100',
      address: '',
      emergencyContacts: [],
      completed: true
    };
    env.mockStorage.setItem('argus_user_profile', JSON.stringify(p));

    // Re-check status on UI instance
    const ui = env.windowMock.argusUI || global.argusUI;
    if (ui) ui._checkInitialProfileStatus();

    const banner = env.documentMock.getElementById('argus-profile-banner');
    assert.equal(banner.classList.contains('active'), false);
  });
});
