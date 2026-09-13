# Overtiq reproducibility freeze

* **Freeze date:** 2026-09-13
* **Git tag:** `freeze-2026-09-13`
* **GPU host:** Vast instance 50715957, RTX 3060 Laptop GPU
* **Remote workspace:** `/workspace/overtiq`
* **Serving process:** supervisor program `overtiq_gpu`, remote service `overtiq-gpu-0.4.2`
* **Remote API mapping:** container `10200` to host `41138`

This freeze captures the current frontend/backend source, the model weights and metadata used by the GPU service, and the canonical dataset manifest. It is intended to be reproducible and auditable: the browser remains a rendering/transport client, while physics, feature construction, inference, and scenario branches stay on the GPU host.

## Included in the repository tag

* `backend/overtiq_api.py` and `dist/` frontend assets.
* `models/` model weights, coefficients, policy, metadata, and the recorded forecast output.
* `datasets/MANIFEST.json`, the canonical inventory of exported telemetry, labels, parameters, and baselines.
* `docs/datasets.md`, `docs/model-handoff.md`, and `docs/model-evaluation.md`.
* `README.md` and `start_local.ps1`.

The large telemetry and label Parquet files are not copied into the Git bundle. They remain on the GPU host in `/workspace/overtiq/export` and are indexed with filenames, row counts, time ranges, and sizes in `datasets/MANIFEST.json`. The raw FastF1 cache, Assetto Corsa Gym data, and TUM simulator repository remain remote for the same reason.

## Integrity

After checkout, verify the model bundle with PowerShell:

```powershell
Get-FileHash models\forecaster_2026_v1.pt -Algorithm SHA256
Get-FileHash models\mlp_zone_pass.pt -Algorithm SHA256
Get-FileHash datasets\MANIFEST.json -Algorithm SHA256
```

The handoff folder produced with this freeze contains a source archive and a model-only archive. Their SHA-256 values are reported alongside the download links in the delivery message. The Git tag is the source-of-truth for the code and documentation state.

## Restore and run

1. Extract the source archive or checkout tag `freeze-2026-09-13`.
2. Keep `models/` beside the source tree for local inspection; production serving continues to load the remote GPU copy.
3. Start the GPU service under supervisor on `/workspace/overtiq` and confirm `/health` reports CUDA and the RTX 3060.
4. Open the remote same-origin endpoint from `README.md`; the terminal uses relative API routes and does not require an SSH tunnel.

The local `backend/overtiq_api.py` is the reference implementation and contract mirror. Production secrets and `.env` files are intentionally excluded from the freeze.
