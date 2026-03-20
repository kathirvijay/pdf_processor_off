# Temp — HTML copies for demo pairing

These files are copies of the main templates under `samples/`:

- `csde_BOL.html`
- `FCR_hongkong.html`
- `SEA_waybill_FCR.html`
- `TELEX_United_container.html`

Use with **`samples/demo-data/*_sample_data.json`** (same base names). Re-copy from `samples/` if the master template changes:

```powershell
Copy-Item ..\csde_BOL.html,..\FCR_hongkong.html,..\SEA_waybill_FCR.html,..\TELEX_United_container.html -Destination .
```
