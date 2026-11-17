/**
 * Test Suite: Policy & Approval Engine
 * Verifies Org Confirmation Gate, Fail Closed Security, and Production Safety
 */

import assert from 'node:assert';
import { PolicyEngine, ERROR_CODES } from '../packages/policy-engine/policy-engine.js';
import { db } from '../database/db.js';

export async function runPolicyEngineTests() {
  console.log('\n--- Running Policy Engine Tests ---');
  await db.init();

  const qcUser = { id: 'usr_qc_lead', role: 'QC', type: 'USER' };
  const aiActor = { id: 'ai_service', role: 'AI', type: 'AI' };

  const stagingEnv = {
    id: 'env_staging',
    environment_type: 'STAGING',
    allowed_actions: ['READ', 'REPRODUCE', 'AUTOMATE']
  };

  const prodTestEnv = {
    id: 'env_prod_test',
    environment_type: 'PRODUCTION_TEST',
    allowed_actions: ['READ', 'REPRODUCE_READ_ONLY'],
    requires_org_confirmation: 1
  };

  const prodEnv = {
    id: 'env_prod',
    environment_type: 'PRODUCTION',
    allowed_actions: ['READ']
  };

  // Test 1: Fail Closed on missing actor
  try {
    await PolicyEngine.evaluateAction({ actor: null, action: 'READ', environmentProfile: stagingEnv });
    assert.fail('Should fail on missing actor');
  } catch (err) {
    assert.strictEqual(err.code, ERROR_CODES.AUTH_REQUIRED);
    console.log('✓ Test 1 Passed: Missing actor correctly rejected (Fail Closed)');
  }

  // Test 2: AI actor cannot self-approve or write to task system
  try {
    await PolicyEngine.evaluateAction({ actor: aiActor, action: 'APPROVE', environmentProfile: stagingEnv });
    assert.fail('AI should not be allowed to approve');
  } catch (err) {
    assert.strictEqual(err.code, ERROR_CODES.PERMISSION_DENIED);
    console.log('✓ Test 2 Passed: AI self-approval strictly blocked');
  }

  // Test 3: Production-Test Gate - Fails closed if Org is not confirmed
  try {
    await PolicyEngine.evaluateAction({
      actor: qcUser,
      action: 'REPRODUCE_READ_ONLY',
      environmentProfile: prodTestEnv,
      sessionState: { is_active: true, org_confirmed: false }
    });
    assert.fail('Should block when org is unconfirmed on PRODUCTION_TEST');
  } catch (err) {
    assert.strictEqual(err.code, ERROR_CODES.ORG_NOT_CONFIRMED);
    console.log('✓ Test 3 Passed: Production-test blocked when Org is unconfirmed');
  }

  // Test 4: Production-Test Gate - Allows execution once Org IS confirmed
  const allowResult = await PolicyEngine.evaluateAction({
    actor: qcUser,
    action: 'REPRODUCE_READ_ONLY',
    environmentProfile: prodTestEnv,
    sessionState: { is_active: true, org_confirmed: true }
  });
  assert.strictEqual(allowResult.decision, 'ALLOW');
  console.log('✓ Test 4 Passed: Production-test execution permitted after Org confirmation');

  // Test 5: Production Safety - Blocks destructive writes
  try {
    await PolicyEngine.evaluateAction({
      actor: qcUser,
      action: 'WRITE',
      environmentProfile: prodEnv,
      sessionState: { is_active: true }
    });
    assert.fail('Should block WRITE on PRODUCTION');
  } catch (err) {
    assert.strictEqual(err.code, ERROR_CODES.POLICY_BLOCKED);
    console.log('✓ Test 5 Passed: Destructive writes blocked on Production');
  }
}
