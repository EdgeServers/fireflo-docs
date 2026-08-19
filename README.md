# FireFlo documentation

The published documentation site for FireFlo, a headless SMS gateway. Built with
[Mintlify](https://mintlify.com).

**FireFlo is commercial software, licensed per deployment.** This site is public and written for
technical stakeholders — people evaluating, operating or integrating with the product, most of whom
will not have the source. Nothing here should assume they do.

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
| `fireflo-sms-gateway` | The gateway, and `docs/` — internal documentation kept alongside the code |
| `fireflo-control-panel` | The operator panel and customer portal |
| **this repo** | The published site, derived from both |

**The gateway's `docs/` folder stays where it is.** It is written for whoever is working on the code,
and should keep working offline beside it. This site is written from it and adapted for an external
reader.

That means two copies of some material, and two copies drift. Two rules keep it honest:

1. **Neither is authoritative for facts. The code is.** Configuration keys are checked against
   `application.properties` and the worker property tables; API fields against the panel's
   `lib/api-catalogue.ts`, which is test-pinned to the request parser.
2. **Provenance lives here, not on the pages.** Each Platform and Reference page corresponds to a
   numbered document under the gateway's `docs/`; the Developers and REST API pages come from the
   panel's API catalogue. When something looks wrong, start with the code, then that document.

Pages used to carry a `source:` frontmatter field naming the internal file they were written from.
That was removed — the site is public, and the field disclosed repo layout, module names and the
package namespace.

## What must not appear on the published site

This site was originally written on the mistaken premise that FireFlo is open source. When adding or
editing pages, keep these out:

- Any claim of an open-source or GPL licence.
- Links to source repositories, issue trackers or discussion forums.
- Support routed anywhere except **support@fireflo.au**.
- Wording implying a reader can clone, fork, build or freely obtain the software.
- Internal source-file paths, Java or TypeScript class names, test class names, or the
  `au.remotiq.fireflo` package namespace. **State the behaviour, not the file that implements it.**

## The API reference is hand-written, deliberately

An OpenAPI document exists and is **wrong** — stamped 0.4.1 against a 0.7.3 gateway, typing
`custom_tlvs` as an array the parser rejects, and omitting `product` entirely.

The pages under `reference/api/` are written from the panel's `lib/api-catalogue.ts`, which is
test-pinned against the actual request parser. Do not regenerate them from that spec.

## Conventions

- **Vendor** and **server**, never `smppclient` and `smppserver`, outside code blocks and key names.
- Every command shown is one somebody has run. Where output is quoted, it is real output.
- Where FireFlo refuses something, say that it refuses and why — the refusals are design, and most of
  them exist because the alternative silently lost a message or some money.
