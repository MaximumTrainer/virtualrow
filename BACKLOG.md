# Backlog

Backlog items captured from PR “Implement safe-win technical improvements from codebase review”.

- [ ] Migrate `App.tsx` + components to `useServices()`
  - Move direct singleton imports to the `Services` port bundle via `src/context/ServicesContext.tsx`.
- [ ] Ratchet coverage thresholds upward as tests are added
  - Keep `npm run coverage` thresholds in `vitest.config.ts` as a floor; raise over time.
- [ ] Remove `as unknown as PM5Data` cast in `BluetoothDevice.tsx`
  - Introduce a typed event emitter (or equivalent) on `Concept2BluetoothService`.
- [ ] Replace remaining `Function` types in `heartRateBluetoothService.ts`
  - Narrow listener types with explicit params/return types.
- [ ] Add tests for `routeService` GPX/KML import using extracted seed coords
  - Use `src/data/seedRouteCoordinates.ts` as the stable fixture source.
- [ ] Add integration test for `App.tsx` export-button flow
  - Exercise the UI handler to exporter call boundary.
- [ ] Add `manualChunks` to split `three` / `@react-three/*` out of the Rower3D chunk
  - Evaluate the best split strategy for caching and parallel downloads.
- [ ] Document ports/adapters convention in `agents.md` / `DEVELOPMENT.md`
  - Describe the `Services` port pattern and testing injection approach.

