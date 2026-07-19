# Test-only gateway deployment

1. Render Dashboard → **New +** → **Blueprint** → select this repository and branch `test-only/node-pilot-integration`. Render reads [`render.yaml`](../../render.yaml) and creates `nephi-home-junzan-line-gateway-test`.
2. Fill only these secrets from the test-only accounts: `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `DATABASE_URL`, `OPENAI_TEST_API_KEY`, `OPENAI_TEST_MODEL`. `PROPERTY_ID=nephi_home` and `NODE_VERSION=20` are supplied by the Blueprint.
3. Do not copy these old LINE settings: `NEPHI_PILOT_LINE_CHANNEL_SECRET`, `NEPHI_PILOT_LINE_CHANNEL_ACCESS_TOKEN`, `NEPHI_PILOT_LINE_CHANNEL_ID`, `NEPHI_PILOT_LINE_DESTINATION_ID`, `NEPHI_PILOT_LINE_CHANNEL_SECRET_SHA256`, `NEPHI_PILOT_LINE_CHANNEL_IDENTITY_SHA256`, `NEPHI_PILOT_LINE_WEBHOOK_ROUTE`, `NEPHI_PILOT_LINE_BRIDGE_SECRET`.
4. After Live, open `https://<new Render domain>/health`. In LINE Developers set `https://<new Render domain>/webhook?propertyId=nephi_home`, save, press Verify, then send `測試` after Verify returns 200.

The gateway never reads the old LINE variables. It loads the existing V2 engine, V2 coordinator, and persistence provider directly; it does not load `server.js`, the legacy LINE handler, identity guard, test-line adapter, destination validation, SHA256 validation, or push fallback.
