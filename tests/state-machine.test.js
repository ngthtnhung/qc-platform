/**
 * Test Suite: State Machines & Idempotency Checkpoints
 */

import assert from 'node:assert';
import { StateMachineValidator, WorkflowTransitionError } from '../services/workflow-orchestrator/state-machine.js';
import { CheckpointManager } from '../services/workflow-orchestrator/checkpoint-manager.js';
import { db } from '../database/db.js';

export async function runStateMachineTests() {
  console.log('\n--- Running State Machine & Idempotency Tests ---');
  await db.init();

  // Test 1: Legal transitions in Test Plan State Machine
  const step1 = StateMachineValidator.transition('TEST_PLAN', 'DRAFT', 'SOURCE_COLLECTION');
  assert.strictEqual(step1, 'SOURCE_COLLECTION');
  const step2 = StateMachineValidator.transition('TEST_PLAN', 'SOURCE_COLLECTION', 'REQUIREMENT_EXTRACTION');
  assert.strictEqual(step2, 'REQUIREMENT_EXTRACTION');
  const step3 = StateMachineValidator.transition('TEST_PLAN', 'REQUIREMENT_EXTRACTION', 'GENERATION');
  assert.strictEqual(step3, 'GENERATION');
  const step4 = StateMachineValidator.transition('TEST_PLAN', 'GENERATION', 'WAITING_FOR_QC_REVIEW');
  assert.strictEqual(step4, 'WAITING_FOR_QC_REVIEW');
  const step5 = StateMachineValidator.transition('TEST_PLAN', 'WAITING_FOR_QC_REVIEW', 'APPROVED');
  assert.strictEqual(step5, 'APPROVED');
  console.log('✓ Test 1 Passed: Legal Test Plan state transitions verified');

  // Test 2: Illegal transition should throw WorkflowTransitionError
  try {
    StateMachineValidator.transition('TEST_PLAN', 'DRAFT', 'EXECUTING');
    assert.fail('Should not allow skipping review phase');
  } catch (err) {
    assert(err instanceof WorkflowTransitionError);
    console.log('✓ Test 2 Passed: Illegal skip transition correctly rejected');
  }

  // Test 3: Idempotency Key Handling
  const uniqueKey = `idemp_test_${Date.now()}`;
  const firstCall = await CheckpointManager.startWorkflowRun({
    workflowType: 'TASK_INTEGRATION',
    createdBy: 'usr_qc_lead',
    inputPayload: { action: 'submit_bug' },
    idempotencyKey: uniqueKey
  });
  assert.strictEqual(firstCall.isDuplicate, false);

  // Second call with same idempotency key
  const secondCall = await CheckpointManager.startWorkflowRun({
    workflowType: 'TASK_INTEGRATION',
    createdBy: 'usr_qc_lead',
    inputPayload: { action: 'submit_bug' },
    idempotencyKey: uniqueKey
  });
  assert.strictEqual(secondCall.isDuplicate, true);
  assert.strictEqual(secondCall.run.id, firstCall.run.id);
  console.log('✓ Test 3 Passed: Idempotent key prevented duplicate workflow run');

  // Test 4: Checkpoint update and resume
  await CheckpointManager.advanceWorkflow(firstCall.run.id, 'WAITING_FOR_QC_APPROVAL', 'REVIEW_STEP', { reviewed: true });
  const resumeState = await CheckpointManager.getResumeCheckpoint(firstCall.run.id);
  assert.strictEqual(resumeState.status, 'WAITING_FOR_QC_APPROVAL');
  assert.strictEqual(resumeState.currentStep, 'REVIEW_STEP');
  assert.strictEqual(resumeState.checkpoint.data.reviewed, true);
  console.log('✓ Test 4 Passed: Checkpoint accurately persisted and resumed');
}
