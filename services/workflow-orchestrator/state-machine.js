/**
 * Internal AI QA Testing Platform - Workflow Orchestrator & State Machines
 * Implements the 4 distinct state machines from Section 6 of System Design v1.0:
 * 1. Bug Analysis Workflow
 * 2. Test Plan Workflow
 * 3. Test Run Workflow
 * 4. Task Integration Workflow
 */

export class WorkflowTransitionError extends Error {
  constructor(workflowType, fromState, toState) {
    super(`Chuyển đổi trạng thái không hợp lệ trong [${workflowType}]: ${fromState} -> ${toState}`);
    this.name = 'WorkflowTransitionError';
    this.fromState = fromState;
    this.toState = toState;
  }
}

// 1. Bug Analysis State Machine
export const BUG_ANALYSIS_TRANSITIONS = {
  DRAFT: ['INPUT_VALIDATION', 'ANALYSIS_READY', 'WAITING_FOR_QC_REVIEW', 'NEEDS_INFORMATION', 'CANCELLED'],
  INPUT_VALIDATION: ['NEEDS_INFORMATION', 'KNOWLEDGE_RETRIEVAL', 'ANALYSIS_READY', 'WAITING_FOR_QC_REVIEW', 'FAILED'],
  NEEDS_INFORMATION: ['INPUT_VALIDATION', 'KNOWLEDGE_RETRIEVAL', 'ANALYSIS_READY', 'WAITING_FOR_QC_REVIEW', 'BLOCKED', 'CANCELLED'],
  KNOWLEDGE_RETRIEVAL: ['ANALYSIS_READY', 'WAITING_FOR_QC_REVIEW', 'FAILED'],
  ANALYSIS_READY: ['WAITING_FOR_QC_REVIEW', 'APPROVED_FOR_REPRODUCTION', 'NEEDS_INFORMATION'],
  WAITING_FOR_QC_REVIEW: ['APPROVED_FOR_REPRODUCTION', 'REJECTED', 'DRAFT', 'NEEDS_INFORMATION'],
  APPROVED_FOR_REPRODUCTION: ['ENVIRONMENT_CHECK', 'RUNNING', 'CANCELLED'],
  ENVIRONMENT_CHECK: ['WAITING_FOR_ORG_CONFIRMATION', 'RUNNING', 'BLOCKED'],
  WAITING_FOR_ORG_CONFIRMATION: ['RUNNING', 'BLOCKED', 'CANCELLED'],
  RUNNING: ['EVIDENCE_REVIEW', 'PAUSED', 'FAILED', 'INCONCLUSIVE', 'COMPLETED'],
  PAUSED: ['RUNNING', 'CANCELLED'],
  EVIDENCE_REVIEW: ['COMPLETED', 'RUNNING', 'INCONCLUSIVE'],
  COMPLETED: [],
  REJECTED: ['DRAFT'],
  BLOCKED: ['DRAFT', 'CANCELLED'],
  CANCELLED: [],
  FAILED: ['DRAFT'],
  INCONCLUSIVE: ['DRAFT', 'COMPLETED']
};

// 2. Test Plan State Machine
export const TEST_PLAN_TRANSITIONS = {
  DRAFT: ['SOURCE_COLLECTION', 'GENERATION', 'WAITING_FOR_QC_REVIEW', 'APPROVED', 'CANCELLED'],
  SOURCE_COLLECTION: ['REQUIREMENT_EXTRACTION', 'GENERATION', 'BLOCKED', 'FAILED'],
  REQUIREMENT_EXTRACTION: ['GENERATION', 'WAITING_FOR_QC_REVIEW', 'FAILED'],
  GENERATION: ['WAITING_FOR_QC_REVIEW', 'APPROVED', 'FAILED'],
  WAITING_FOR_QC_REVIEW: ['APPROVED', 'DRAFT', 'GENERATION'],
  APPROVED: ['READY_FOR_EXECUTION', 'EXECUTING'],
  READY_FOR_EXECUTION: ['EXECUTING', 'ARCHIVED'],
  EXECUTING: ['RESULTS_REVIEW', 'COMPLETED', 'FAILED'],
  RESULTS_REVIEW: ['COMPLETED', 'EXECUTING'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
  FAILED: ['DRAFT'],
  BLOCKED: ['DRAFT', 'CANCELLED'],
  CANCELLED: []
};

// 3. Test Run State Machine
export const TEST_RUN_TRANSITIONS = {
  CREATED: ['POLICY_CHECK', 'WAITING_FOR_USER_START', 'ENVIRONMENT_CHECK', 'RUNNING', 'CANCELLED'],
  POLICY_CHECK: ['WAITING_FOR_USER_START', 'ENVIRONMENT_CHECK', 'RUNNING', 'BLOCKED'],
  WAITING_FOR_USER_START: ['ENVIRONMENT_CHECK', 'WAITING_FOR_ORG_CONFIRMATION', 'RUNNING', 'CANCELLED'],
  ENVIRONMENT_CHECK: ['WAITING_FOR_ORG_CONFIRMATION', 'RUNNING', 'BLOCKED'],
  WAITING_FOR_ORG_CONFIRMATION: ['RUNNING', 'BLOCKED', 'CANCELLED'],
  RUNNING: ['PAUSED', 'BLOCKED', 'FAILED', 'RESULTS_REVIEW', 'COMPLETED'],
  PAUSED: ['ENVIRONMENT_CHECK', 'RUNNING', 'CANCELLED'],
  RESULTS_REVIEW: ['COMPLETED', 'RUNNING'],
  COMPLETED: [],
  BLOCKED: ['WAITING_FOR_USER_START', 'CANCELLED'],
  FAILED: ['WAITING_FOR_USER_START'],
  CANCELLED: []
};

// 4. Task Integration State Machine
export const TASK_INTEGRATION_TRANSITIONS = {
  DRAFT: ['DRAFT_BUG_REPORT', 'WAITING_FOR_QC_APPROVAL', 'APPROVED', 'PRECHECK', 'SUBMITTING', 'CANCELLED'],
  DRAFT_BUG_REPORT: ['WAITING_FOR_QC_APPROVAL', 'APPROVED', 'CANCELLED'],
  WAITING_FOR_QC_APPROVAL: ['APPROVED', 'REJECTED', 'DRAFT_BUG_REPORT'],
  APPROVED: ['PRECHECK', 'SUBMITTING'],
  PRECHECK: ['SUBMITTING', 'DUPLICATE_DETECTED', 'PERMISSION_DENIED', 'BLOCKED'],
  SUBMITTING: ['VERIFYING_REMOTE_STATE', 'CREATED_OR_UPDATED', 'REMOTE_STATE_UNKNOWN', 'RETRY_PENDING', 'FAILED'],
  VERIFYING_REMOTE_STATE: ['CREATED_OR_UPDATED', 'REMOTE_STATE_UNKNOWN', 'FAILED'],
  RETRY_PENDING: ['SUBMITTING', 'MANUAL_RECOVERY_REQUIRED'],
  CREATED_OR_UPDATED: [],
  DUPLICATE_DETECTED: [],
  PERMISSION_DENIED: [],
  REMOTE_STATE_UNKNOWN: ['MANUAL_RECOVERY_REQUIRED', 'VERIFYING_REMOTE_STATE'],
  MANUAL_RECOVERY_REQUIRED: ['SUBMITTING', 'CANCELLED'],
  REJECTED: ['DRAFT'],
  FAILED: ['DRAFT_BUG_REPORT', 'DRAFT'],
  BLOCKED: ['DRAFT_BUG_REPORT', 'DRAFT'],
  CANCELLED: []
};

export class StateMachineValidator {
  /**
   * Validate if a state transition is legal according to system design
   */
  static canTransition(workflowType, currentState, nextState) {
    let allowedTransitions = {};
    switch (workflowType) {
      case 'BUG_ANALYSIS':
        allowedTransitions = BUG_ANALYSIS_TRANSITIONS;
        break;
      case 'TEST_PLAN':
        allowedTransitions = TEST_PLAN_TRANSITIONS;
        break;
      case 'TEST_RUN':
        allowedTransitions = TEST_RUN_TRANSITIONS;
        break;
      case 'TASK_INTEGRATION':
        allowedTransitions = TASK_INTEGRATION_TRANSITIONS;
        break;
      default:
        return false;
    }

    const nextAllowed = allowedTransitions[currentState];
    return Array.isArray(nextAllowed) && nextAllowed.includes(nextState);
  }

  static transition(workflowType, currentState, nextState) {
    if (!this.canTransition(workflowType, currentState, nextState)) {
      throw new WorkflowTransitionError(workflowType, currentState, nextState);
    }
    return nextState;
  }
}
