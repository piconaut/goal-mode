# Change Desk UI

`../Actions.tsx` owns the area selector, collapsible sections, and validation map.
The basket remains owned by `useGame` so it survives leaving the Change Desk.

- `shared.tsx`: the Desk contract and presentation helpers.
- `DraftControls.tsx`: draft fields and local form validation.
- `Requests.tsx`: pending policy banner, change request, board, and results.
- `Hardware.tsx`: LPAR profiles, HiperDispatch preview, and hardware purchases.
- `Wlm.tsx`: service classes, classification, and policy scheduling.
- `Subsystems.tsx`: system, CF, DASD, Db2, MQ, and CICS controls.
- `Routing.tsx`: workload routing and job classes.
- `Operations.tsx`: projects and operational fixes.

Area modules receive the existing Desk or GameHandle explicitly. Keep shared
controls independent of area modules and the Actions shell to avoid import cycles.
