const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { StaircaseDecision } = require('../staircase-detection/decision.js');

function response(status, label = 'upstairs') {
  return {
    status,
    detections: status === 'none' ? [] : [{ label, confidence: 0.82, box: [20, 20, 180, 160] }]
  };
}

describe('Staircase temporal decision', () => {
  test('requires 3 of the last 5 frames before announcing a direction', () => {
    const decision = new StaircaseDecision({ clock: () => 1000 });
    assert.equal(decision.update(response('detected')).state, 'HYPOTHESIS');
    decision.update(response('none'));
    decision.update(response('detected'));
    const result = decision.update(response('detected'));

    assert.equal(result.state, 'CONFIRMED');
    assert.equal(result.className, 'upstairs');
    assert.equal(result.announcement, 'Stairs may be going up ahead. Stop and check.');
  });

  test('requires stronger evidence to switch from up to down', () => {
    const decision = new StaircaseDecision({ clock: () => 1000 });
    for (let i = 0; i < 3; i += 1) decision.update(response('detected', 'upstairs'));

    let result;
    for (let i = 0; i < 3; i += 1) result = decision.update(response('detected', 'downstairs'));
    assert.equal(result.className, null);
    assert.equal(result.announcement, 'Stair direction is uncertain. Stop and check carefully.');

    result = decision.update(response('detected', 'downstairs'));
    assert.equal(result.className, 'downstairs');
    assert.equal(result.announcement, 'Stairs may be going down ahead. Stop and check.');
  });

  test('treats ambiguous direction as uncertainty, not a directional claim', () => {
    const decision = new StaircaseDecision({ clock: () => 1000 });
    const result = decision.update({
      status: 'ambiguous',
      detections: [
        { label: 'downstairs', confidence: 0.50, box: [10, 10, 120, 100] },
        { label: 'upstairs', confidence: 0.45, box: [12, 12, 118, 98] }
      ]
    });
    assert.equal(result.state, 'HYPOTHESIS');
    assert.equal(result.className, null);
    assert.equal(result.announcement, 'Stair direction is uncertain. Stop and check carefully.');
  });

  test('treats an empty ambiguous frame as an unclear camera view', () => {
    const decision = new StaircaseDecision({ clock: () => 1000 });
    const result = decision.update({ status: 'ambiguous', detections: [] });
    assert.equal(result.state, 'UNCERTAIN');
    assert.equal(result.announcement, 'Camera view is unclear. Staircase detection may be unreliable.');
  });

  test('reports no stairs only after repeated none results and never calls the view clear', () => {
    const decision = new StaircaseDecision({ clock: () => 1000 });
    decision.update(response('none'));
    decision.update(response('none'));
    const result = decision.update(response('none'));
    assert.equal(result.state, 'NONE');
    assert.equal(result.announcement, 'No stairs detected in this view.');
  });

  test('treats unavailable inference as an explicit uncertain state', () => {
    const decision = new StaircaseDecision();
    const result = decision.update(null, { unavailable: true });
    assert.equal(result.state, 'UNCERTAIN');
    assert.equal(result.announcement, 'Staircase detection is unavailable. Do not rely on it.');
  });

  test('applies cooldown to repeated messages but allows changed situations', () => {
    let now = 1000;
    const decision = new StaircaseDecision({ clock: () => now });
    decision.update(response('detected'));
    decision.update(response('detected'));
    assert.equal(decision.update(response('detected')).announcement,
      'Stairs may be going up ahead. Stop and check.');
    assert.equal(decision.update(response('detected')).announcement, null);
    now += 9000;
    assert.equal(
      decision.update(response('detected')).announcement,
      'Stairs may be going up ahead. Stop and check.'
    );
  });
});
