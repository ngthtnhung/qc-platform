/**
 * Internal AI QA Testing Platform - Workflow Checkpoint & Idempotency Manager
 * Ensures robust fault tolerance, resumability, and duplicate submission prevention.
 */

import { db } from '../../database/db.js';
import { StateMachineValidator } from './state-machine.js';
import { Redactor } from '../../packages/diagnostics/redactor.js';

export class CheckpointManager {
  /**
   * Start or retrieve an idempotent workflow run
   */
  static async startWorkflowRun({
    workflowType,
    createdBy,
    projectId = null,
    moduleId = null,
    inputPayload = {},
    idempotencyKey = null
  }) {
    // 1. Idempotency Check
    if (idempotencyKey) {
      const existing = await db.findOne('workflow_runs', r => r.idempotency_key === idempotencyKey);
      if (existing) {
        console.log(`[CheckpointManager] Idempotent hit for key: ${idempotencyKey}, returning existing run.`);
        return {
          run: existing,
          isDuplicate: true
        };
      }
    }

    const initialStatus = 'DRAFT';
    const initialStep = 'INIT';
    const sanitizedPayload = Redactor.redactObject(inputPayload);

    const record = await db.insert('workflow_runs', {
      workflow_type: workflowType,
      status: initialStatus,
      created_by: createdBy,
      project_id: projectId,
      module_id: moduleId,
      input_payload: JSON.stringify(sanitizedPayload),
      current_step: initialStep,
      checkpoint: JSON.stringify({ step: initialStep, data: sanitizedPayload, timestamp: new Date().toISOString() }),
      idempotency_key: idempotencyKey,
      started_at: new Date().toISOString()
    });

    return {
      run: record,
      isDuplicate: false
    };
  }

  /**
   * Advance workflow state with validation and checkpoint snapshot
   */
  static async advanceWorkflow(runId, nextState, nextStep = null, checkpointData = {}) {
    const run = await db.findById('workflow_runs', runId);
    if (!run) throw new Error(`Workflow run ${runId} not found`);

    // State machine legality check
    StateMachineValidator.transition(run.workflow_type, run.status, nextState);

    const existingCheckpoint = typeof run.checkpoint === 'string' ? JSON.parse(run.checkpoint || '{}') : (run.checkpoint || {});
    const updatedCheckpoint = {
      ...existingCheckpoint,
      step: nextStep || run.current_step,
      lastState: run.status,
      currentState: nextState,
      data: { ...(existingCheckpoint.data || {}), ...Redactor.redactObject(checkpointData) },
      updatedAt: new Date().toISOString()
    };

    const updates = {
      status: nextState,
      current_step: nextStep || run.current_step,
      checkpoint: JSON.stringify(updatedCheckpoint)
    };

    if (['COMPLETED', 'ARCHIVED', 'CANCELLED', 'REJECTED'].includes(nextState)) {
      updates.finished_at = new Date().toISOString();
    }

    const updated = await db.update('workflow_runs', runId, updates);
    return updated;
  }

  /**
   * Mark workflow as failed with sanitized error summary
   */
  static async failWorkflow(runId, errorCode, errorSummary) {
    return await db.update('workflow_runs', runId, {
      status: 'FAILED',
      error_code: errorCode,
      error_summary: Redactor.redactText(errorSummary),
      finished_at: new Date().toISOString()
    });
  }

  /**
   * Get checkpoint for resume
   */
  static async getResumeCheckpoint(runId) {
    const run = await db.findById('workflow_runs', runId);
    if (!run) return null;
    return {
      status: run.status,
      currentStep: run.current_step,
      checkpoint: typeof run.checkpoint === 'string' ? JSON.parse(run.checkpoint || '{}') : (run.checkpoint || {})
    };
  }
}
