// #542 AC6 / D5-b — prove the GPU CI runner really has a GPU.
//
// The epic's hand-written WebGPU engine can only be exercised where
// `navigator.gpu.requestAdapter()` returns a *hardware* adapter. CI's default
// runners rasterise through SwiftShader, which ships no WebGPU backend, so the
// engine's real-GPU paths (and the #498 spike's AC2 timings) never run there —
// SwiftShader is the fallback, not the thing under test.
//
// This standalone check launches Chromium with real WebGPU enabled, asks for a
// high-performance adapter, and reports what it got. It is deliberately NOT a
// `*.spec.ts`: the main E2E glob must not pick it up, because it would demand a
// GPU the SwiftShader shards do not have.
//
// Behaviour:
//   - REQUIRE_REAL_GPU=1 (set by the gpu-smoke CI job): exit non-zero unless a
//     non-software adapter is present. This is what makes the GPU runner job
//     actually enforce that the runner has a GPU.
//   - otherwise (a developer running it locally): report and exit 0 whatever is
//     found, so it is safe to run anywhere.
import { chromium } from '@playwright/test';

const requireRealGpu = process.env.REQUIRE_REAL_GPU === '1';

const SOFTWARE = /swiftshader|llvmpipe|software|basic render|microsoft basic|warp/i;

function classify(result) {
  if (!result.gpuPresent) return { real: false, why: 'navigator.gpu is undefined' };
  if (!result.adapter) return { real: false, why: 'requestAdapter() returned null' };
  if (result.adapter.isFallback) return { real: false, why: 'isFallbackAdapter is true' };
  const fingerprint = [
    result.adapter.vendor,
    result.adapter.architecture,
    result.adapter.description,
    result.adapter.device,
  ]
    .filter(Boolean)
    .join(' ');
  if (SOFTWARE.test(fingerprint)) return { real: false, why: `software adapter: ${fingerprint}` };
  return { real: true, why: fingerprint || 'hardware adapter (no info exposed)' };
}

const browser = await chromium.launch({
  args: [
    '--enable-unsafe-webgpu',
    // Linux Chromium gates WebGPU behind the Vulkan feature flag; the
    // runner provides libvulkan1 + the NVIDIA ICD at `/usr/share/vulkan/
    // icd.d/nvidia_icd.json`, but Chromium still won't surface the API
    // without this flag opt-in (#567-follow-up: NVIDIA image needs it).
    '--enable-features=Vulkan',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
});
try {
  const page = await browser.newPage();
  await page.goto('about:blank');
  const result = await page.evaluate(async () => {
    const gpu = navigator.gpu;
    if (!gpu) return { gpuPresent: false, adapter: null };
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { gpuPresent: true, adapter: null };
    const info = adapter.info ?? {};
    return {
      gpuPresent: true,
      adapter: {
        isFallback: adapter.isFallbackAdapter,
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
      },
    };
  });

  const verdict = classify(result);
  console.log(`[gpu-runner-smoke] ${verdict.real ? 'REAL GPU' : 'no real GPU'}: ${verdict.why}`);
  console.log(`[gpu-runner-smoke] raw: ${JSON.stringify(result)}`);

  if (requireRealGpu && !verdict.real) {
    console.error(
      '[gpu-runner-smoke] REQUIRE_REAL_GPU=1 but no hardware WebGPU adapter was found. ' +
        'The runner this job landed on has no GPU — check the GPU_RUNNER_LABEL runner.',
    );
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
