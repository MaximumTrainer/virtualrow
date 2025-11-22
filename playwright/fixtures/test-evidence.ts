import { test as base, Page, TestInfo } from '@playwright/test';
import { captureTestEvidence, captureErrorEvidence } from '../utils/screenshot-helper';

/**
 * Custom test fixture that extends Playwright test with automatic screenshot capture
 * and error highlighting functionality
 */

type TestFixtures = {
  /**
   * Extended page fixture that captures screenshots on every action
   */
  evidencePage: Page;
  
  /**
   * Capture a screenshot with a description
   */
  captureEvidence: (description: string) => Promise<void>;
  
  /**
   * Capture an error screenshot with optional element highlighting
   */
  captureError: (description: string, errorSelector?: string) => Promise<void>;
};

export const test = base.extend<TestFixtures>({
  evidencePage: async ({ page }, use, testInfo) => {
    // Note: Initial page load screenshot is captured in the test itself
    // after navigation to the actual test URL
    
    // Use the page
    await use(page);
    
    // Capture final state if test passes
    if (testInfo.status === 'passed') {
      try {
        await captureTestEvidence(page, testInfo, 'test-passed-final-state');
      } catch (e) {
        console.warn('Failed to capture final state screenshot:', e);
      }
    }
  },
  
  captureEvidence: async ({ page }, use, testInfo) => {
    await use(async (description: string) => {
      await captureTestEvidence(page, testInfo, description);
    });
  },
  
  captureError: async ({ page }, use, testInfo) => {
    await use(async (description: string, errorSelector?: string) => {
      await captureErrorEvidence(page, testInfo, description, errorSelector);
    });
  },
});

/**
 * Wrapper function for test.step that captures screenshots before and after each step
 */
export async function stepWithEvidence(
  stepName: string,
  testInfo: TestInfo,
  page: Page,
  action: () => Promise<void>
): Promise<void> {
  await base.step(stepName, async () => {
    // Capture before state
    await captureTestEvidence(page, testInfo, `step-${stepName}-before`);
    
    try {
      // Execute the step
      await action();
      
      // Capture after state on success
      await captureTestEvidence(page, testInfo, `step-${stepName}-after`);
    } catch (error) {
      // Capture error state
      await captureErrorEvidence(page, testInfo, `Step failed: ${stepName}`);
      throw error;
    }
  });
}

export { expect } from '@playwright/test';
