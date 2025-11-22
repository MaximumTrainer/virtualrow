import { Page, TestInfo } from '@playwright/test';

/**
 * Helper utilities for capturing test evidence screenshots with error highlighting
 */

/**
 * Captures a screenshot with a descriptive name based on test context
 * @param page - Playwright page object
 * @param testInfo - Playwright test info object
 * @param description - Description of what the screenshot captures
 */
export async function captureTestEvidence(
  page: Page,
  testInfo: TestInfo,
  description: string
): Promise<void> {
  const sanitizedDescription = description.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const timestamp = Date.now();
  const screenshotName = `${sanitizedDescription}-${timestamp}.png`;
  
  await page.screenshot({
    path: `${testInfo.outputDir}/${screenshotName}`,
    fullPage: true,
  });
}

/**
 * Highlights an element on the page before taking a screenshot
 * @param page - Playwright page object
 * @param selector - CSS selector of the element to highlight
 * @param color - Color of the highlight (default: red)
 */
export async function highlightElement(
  page: Page,
  selector: string,
  color: string = 'red'
): Promise<void> {
  const locator = page.locator(selector).first();
  await locator.evaluate(
    (element, highlightColor) => {
      if (element instanceof HTMLElement) {
        // Store original styles
        const originalOutline = element.style.outline;
        const originalBoxShadow = element.style.boxShadow;
        
        // Apply highlight
        element.style.outline = `3px solid ${highlightColor}`;
        element.style.boxShadow = `0 0 10px ${highlightColor}`;
        element.setAttribute('data-original-outline', originalOutline);
        element.setAttribute('data-original-box-shadow', originalBoxShadow);
      }
    },
    color
  );
}

/**
 * Removes highlight from a previously highlighted element
 * @param page - Playwright page object
 * @param selector - CSS selector of the element to unhighlight
 */
export async function removeHighlight(
  page: Page,
  selector: string
): Promise<void> {
  const locator = page.locator(selector).first();
  const count = await locator.count();
  if (count > 0) {
    await locator.evaluate((element) => {
      if (element instanceof HTMLElement) {
        const originalOutline = element.getAttribute('data-original-outline') || '';
        const originalBoxShadow = element.getAttribute('data-original-box-shadow') || '';
        
        element.style.outline = originalOutline;
        element.style.boxShadow = originalBoxShadow;
        element.removeAttribute('data-original-outline');
        element.removeAttribute('data-original-box-shadow');
      }
    });
  }
}

/**
 * Captures a screenshot with error highlighting
 * Highlights the error location if a selector is provided
 * @param page - Playwright page object
 * @param testInfo - Playwright test info object
 * @param description - Description of the error
 * @param errorSelector - Optional CSS selector of the element where error occurred
 */
export async function captureErrorEvidence(
  page: Page,
  testInfo: TestInfo,
  description: string,
  errorSelector?: string
): Promise<void> {
  try {
    // Highlight the error element if selector is provided
    if (errorSelector) {
      const elementCount = await page.locator(errorSelector).count();
      if (elementCount > 0) {
        await highlightElement(page, errorSelector, 'red');
      }
    }

    // Generate unique overlay ID to avoid conflicts
    const overlayId = `playwright-error-overlay-${Date.now()}`;
    
    // Add error overlay to the page
    await page.evaluate(({ desc, id }) => {
      // Remove any existing error overlays first
      const existingOverlays = document.querySelectorAll('[id^="playwright-error-overlay"]');
      existingOverlays.forEach(overlay => overlay.remove());
      
      const overlay = document.createElement('div');
      overlay.id = id;
      overlay.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: rgba(255, 0, 0, 0.9);
        color: white;
        padding: 15px;
        border-radius: 5px;
        font-family: monospace;
        font-size: 14px;
        max-width: 400px;
        z-index: 999999;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
      `;
      overlay.textContent = `ERROR: ${desc}`;
      document.body.appendChild(overlay);
    }, { desc: description, id: overlayId });

    // Capture the screenshot
    const sanitizedDescription = description.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const timestamp = Date.now();
    const screenshotName = `error-${sanitizedDescription}-${timestamp}.png`;
    
    await page.screenshot({
      path: `${testInfo.outputDir}/${screenshotName}`,
      fullPage: true,
    });

    // Clean up the overlay and highlight
    await page.evaluate((id) => {
      const overlay = document.getElementById(id);
      if (overlay) {
        overlay.remove();
      }
    }, overlayId);

    if (errorSelector) {
      const elementCount = await page.locator(errorSelector).count();
      if (elementCount > 0) {
        await removeHighlight(page, errorSelector);
      }
    }
  } catch (e) {
    // If screenshot capture fails, log but don't throw
    console.warn(`Failed to capture error evidence: ${e}`);
  }
}

/**
 * Captures multiple screenshots for a test step with before/after states
 * @param page - Playwright page object
 * @param testInfo - Playwright test info object
 * @param stepName - Name of the test step
 * @param action - Async function to execute between screenshots
 */
export async function captureStepEvidence(
  page: Page,
  testInfo: TestInfo,
  stepName: string,
  action: () => Promise<void>
): Promise<void> {
  // Before screenshot
  await captureTestEvidence(page, testInfo, `${stepName}-before`);
  
  // Execute the action
  await action();
  
  // After screenshot
  await captureTestEvidence(page, testInfo, `${stepName}-after`);
}

/**
 * Annotates an element with a label for screenshot evidence
 * @param page - Playwright page object
 * @param selector - CSS selector of the element to annotate
 * @param label - Label text to display
 * @param position - Position of the label relative to element ('top' | 'bottom' | 'left' | 'right')
 */
export async function annotateElement(
  page: Page,
  selector: string,
  label: string,
  position: 'top' | 'bottom' | 'left' | 'right' = 'top'
): Promise<void> {
  const locator = page.locator(selector).first();
  const count = await locator.count();
  if (count > 0) {
    await locator.evaluate(
      (element, { text, pos }) => {
        const annotation = document.createElement('div');
        annotation.className = 'playwright-annotation';
        annotation.style.cssText = `
          position: absolute;
          background: rgba(0, 120, 255, 0.9);
          color: white;
          padding: 5px 10px;
          border-radius: 3px;
          font-size: 12px;
          font-family: sans-serif;
          z-index: 999998;
          pointer-events: none;
          white-space: nowrap;
        `;
        annotation.textContent = text;

        const rect = element.getBoundingClientRect();
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        switch (pos) {
          case 'top':
            annotation.style.left = `${rect.left + scrollX}px`;
            annotation.style.top = `${rect.top + scrollY - 30}px`;
            break;
          case 'bottom':
            annotation.style.left = `${rect.left + scrollX}px`;
            annotation.style.top = `${rect.bottom + scrollY + 5}px`;
            break;
          case 'left':
            annotation.style.left = `${rect.left + scrollX - 100}px`;
            annotation.style.top = `${rect.top + scrollY}px`;
            break;
          case 'right':
            annotation.style.left = `${rect.right + scrollX + 5}px`;
            annotation.style.top = `${rect.top + scrollY}px`;
            break;
        }

        document.body.appendChild(annotation);
      },
      { text: label, pos: position }
    );
  }
}

/**
 * Removes all annotations from the page
 * @param page - Playwright page object
 */
export async function clearAnnotations(
  page: Page
): Promise<void> {
  await page.evaluate(() => {
    const annotations = document.querySelectorAll('.playwright-annotation');
    annotations.forEach((annotation) => annotation.remove());
  });
}
