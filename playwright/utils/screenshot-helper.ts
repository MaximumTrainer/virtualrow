import { Page, TestInfo } from '@playwright/test';

/**
 * Helper utilities for capturing test evidence screenshots with error highlighting
 */

/** Snapshot of all exposed Rower3D telemetry globals at a given moment. */
export interface GameplayState {
  speedMps: number;
  strokePhase: string;
  distanceM: number;
  progress: number;
  oarAngle: number;
  strokeRate: number;
  gpuBackend: string;
  posX: number;
  posY: number;
  posZ: number;
}

/**
 * Reads live gameplay telemetry from window globals exposed by Rower3D.
 */
export async function readGameplayState(page: Page): Promise<GameplayState> {
  return page.evaluate(() => ({
    speedMps:    (window as any).__ROWER3D_SPEED_MPS  ?? 0,
    strokePhase: (window as any).__ROWER3D_STROKE_PHASE ?? 'unknown',
    distanceM:   (window as any).__ROWER3D_DISTANCE_M  ?? 0,
    progress:    (window as any).__ROWER3D_POS?.progress ?? 0,
    oarAngle:    (window as any).__ROWER3D_OAR_ANGLE   ?? 0,
    strokeRate:  (window as any).__ROWER3D_STROKE_RATE ?? 0,
    gpuBackend:  (window as any).__ROWER3D_GPU_BACKEND ?? 'unknown',
    posX:        (window as any).__ROWER3D_POS?.x ?? 0,
    posY:        (window as any).__ROWER3D_POS?.y ?? 0,
    posZ:        (window as any).__ROWER3D_POS?.z ?? 0,
  }));
}

/**
 * Injects a semi-transparent telemetry HUD overlay onto the page for gameplay screenshots.
 * Positioned top-left so it doesn't obscure the boat/water in the centre of the canvas.
 */
export async function injectGameplayHUD(
  page: Page,
  state: GameplayState,
  label: string,
): Promise<void> {
  const paceStr = state.speedMps > 0
    ? (() => {
        const secsPer500 = 500 / state.speedMps;
        const m = Math.floor(secsPer500 / 60);
        const s = String(Math.round(secsPer500 % 60)).padStart(2, '0');
        return `${m}:${s}/500m`;
      })()
    : '--:--/500m';

  await page.evaluate(
    ({ s, lbl, pace }) => {
      const existing = document.getElementById('pw-gameplay-hud');
      if (existing) existing.remove();

      const hud = document.createElement('div');
      hud.id = 'pw-gameplay-hud';
      hud.style.cssText = `
        position: fixed;
        top: 12px;
        left: 12px;
        background: rgba(0,0,0,0.82);
        color: #00ff88;
        padding: 10px 16px;
        border-radius: 6px;
        font-family: 'Courier New', Courier, monospace;
        font-size: 12px;
        line-height: 1.8;
        z-index: 999999;
        border: 1px solid rgba(0,255,136,0.35);
        min-width: 250px;
        pointer-events: none;
      `;
      hud.innerHTML = `
        <div style="color:#fff;font-weight:bold;margin-bottom:4px;font-size:13px">🚣 VirtualRow — ${lbl}</div>
        <div>Speed: <b>${s.speedMps.toFixed(2)} m/s</b> &nbsp;(${pace})</div>
        <div>Distance: ${s.distanceM.toFixed(0)} m &nbsp;|&nbsp; Progress: ${(s.progress * 100).toFixed(1)}%</div>
        <div>Stroke Rate: ${s.strokeRate.toFixed(0)} SPM</div>
        <div>Phase: <b style="color:#ffcc00">${s.strokePhase.toUpperCase()}</b> &nbsp;|&nbsp; Oar: ${s.oarAngle.toFixed(3)} rad</div>
        <div>GPU: ${s.gpuBackend}</div>
        <div style="color:#888;font-size:11px">Pos (${s.posX.toFixed(1)}, ${s.posY.toFixed(1)}, ${s.posZ.toFixed(1)})</div>
      `;
      document.body.appendChild(hud);
    },
    { s: state, lbl: label, pace: paceStr },
  );
}

/** Removes the gameplay HUD overlay. */
export async function removeGameplayHUD(page: Page): Promise<void> {
  await page.evaluate(() => {
    const hud = document.getElementById('pw-gameplay-hud');
    if (hud) hud.remove();
  });
}

/**
 * Captures a canvas-only screenshot with a telemetry HUD overlay, then attaches it to the
 * Playwright HTML report and saves a copy to testInfo.outputDir.
 *
 * Use this for gameplay visual validation: each attachment appears inline in the HTML
 * report so reviewers can inspect rowing models, water shaders, and animation state.
 *
 * @param frameIndex - Sequential number used for sort ordering in the report (01, 02, …)
 * @param label      - Human-readable description of what this frame shows
 */
export async function captureGameplayCanvas(
  page: Page,
  testInfo: TestInfo,
  frameIndex: number,
  label: string,
): Promise<void> {
  const state = await readGameplayState(page);
  await injectGameplayHUD(page, state, label);

  const paddedIndex = String(frameIndex).padStart(2, '0');
  const sanitized = label.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 60);
  const timestamp = Date.now();
  const filePath = `${testInfo.outputDir}/gameplay-${paddedIndex}-${sanitized}-${timestamp}.png`;

  try {
    const container = page.locator('.rower3d-canvas-container');
    if (await container.count() > 0) {
      await container.screenshot({ path: filePath, type: 'png', timeout: 1000 });
    } else {
      await page.screenshot({ path: filePath, fullPage: false, timeout: 1000 });
    }
  } catch {
    try {
      await page.screenshot({ path: filePath, fullPage: false, timeout: 1000 });
    } catch { /* ignore */ }
  }

  // Attach inline to Playwright HTML report for visual model/graphics review
  try {
    await testInfo.attach(`frame-${paddedIndex} | ${label}`, {
      path: filePath,
      contentType: 'image/png',
    });
  } catch { /* ignore if file write failed */ }

  await removeGameplayHUD(page);
}


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
