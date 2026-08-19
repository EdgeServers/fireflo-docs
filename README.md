# FireFlo documentation

The published documentation site for [FireFlo](https://github.com/EdgeServers/fireflo-sms-gateway), an
open-source headless SMS gateway. Built with [Mintlify](https://mintlify.com).

## Running it locally

```bash
npx mintlify dev
```

Serves on `http://localhost:3000` by default. Because the control panel's own dev server also uses 3000,
pass `--port 3001` when both are running.

```bash
npx mintlify broken-links
```

## How this repo relates to the others

| Repo | Holds |
| :--- | :--- |
| `fireflo-sms-gateway` | The gateway, and `docs/` — the in-repo documentation for people who have cloned it |
| `fireflo-control-panel` | The operator panel and customer portal |
| **this repo** | The published site, derived from both |

**The gateway's `docs/` folder stays where it is.** It is part of a GPL project people clone, and it
should keep working offline in a checkout. This site is written from it, adapted for a reader who has
not cloned anything.

That means two copies of some material, and two copies drift. Two rules keep it honest:

1. **Neither is authoritative for facts.** The code is. Configuration keys are checked against
   `application.properties` and the `prms` tables in `AbstractOutWorker`, `SmppClientWorker` and
   `SmppServerWorker`; API fields against `lib/api-catalogue.ts` in the panel.
2. **Pages that render another file carry its name in their frontmatter**, as `source:`, with the
   version they were written from. When something looks wrong, that is where to look first.

## The API reference is hand-written, deliberately

`fireflo-sms-gateway/api/send-sms.swagger.json` exists and is **wrong** — stamped 0.4.1 against a 0.7.3
gateway, typing `custom_tlvs` as an array the parser rejects, and omitting `product` entirely. The
panel's own test calls it "the proof that a separately-maintained description drifts."

The pages under `reference/api/` are written from `fireflo-control-panel/lib/api-catalogue.ts`, which is
test-pinned against the actual request parser. Every payload on those pages has been run against a live
gateway. Do not regenerate them from the swagger file.

## Conventions

- **Vendor** and **server**, never `smppclient` and `smppserver`, outside code blocks and key names.
- Every command shown is one somebody has run. Where output is quoted, it is real output.
- Where FireFlo refuses something, say that it refuses and why — the refusals are design, and most of
  them exist because the alternative silently lost a message or some money.
