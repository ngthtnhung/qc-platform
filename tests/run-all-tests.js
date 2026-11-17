/**
 * Test Runner - Runs all unit and integration test suites
 */

import { runPolicyEngineTests } from './policy-engine.test.js';
import { runStateMachineTests } from './state-machine.test.js';
import { runTestCaseSchemaTests } from './test-case-schema.test.js';
import { runAutomationTaskTests } from './automation-tasks.test.js';

async function main() {
  console.log('====================================================');
  console.log('🧪 Internal AI QA Platform - Automated Test Suite');
  console.log('====================================================');

  const start = Date.now();
  let passedSuites = 0;

  try {
    await runPolicyEngineTests();
    passedSuites++;

    await runStateMachineTests();
    passedSuites++;

    await runTestCaseSchemaTests();
    passedSuites++;

    await runAutomationTaskTests();
    passedSuites++;

    console.log('\n====================================================');
    console.log(`🎉 ALL ${passedSuites} TEST SUITES PASSED in ${Date.now() - start}ms!`);
    console.log('====================================================');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err);
    process.exit(1);
  }
}

main();
