# FG Transaction QC

Finished goods QC for CDC. A QC inspector on the shop floor opens this, sees
every pending GPN that has not been inspected, picks one, fills in a defect
count sheet, and submits. The system decides Accepted or Rejected against
Carter's AQL table — the inspector does not decide.

**The verdict is computed by the database, not by this app and not by the
person.** Nothing here computes a pass or a fail. The form shows a warning when
a class crosses its accept number so the inspector is not surprised by the
result, but the number that counts comes back from
`SaveFinishGoodsQCInspection`.

Four files, no build step, no framework:

| File | What it is |
|---|---|
| `index.html` | Every screen, hidden and shown by the router |
| `script.js` | Router, API calls, the count grid and its live flagging |
| `styles.css` | Tablet-first, dark, large type |
| `config.js` | API base URL and the go-live cutoff |

---

## Running it

Open `index.html`. That is the whole thing — no install, no bundler.

`config.js` picks the API automatically:

| Where it is opened | API it talks to |
|---|---|
| `file://` | `http://127.0.0.1:3001/api` |
| localhost or a private IP | that host on port 3001 |
| anywhere else | `https://cdcapi.onrender.com/api` |

To point it somewhere else, set `window.AppConfig.apiBaseUrl` before `config.js`
runs, or edit the file.

The API is the `/api/qc/*` routes in
[`eacdc/CDC-Site`](https://github.com/eacdc/CDC-Site) (`src/routes-fg-qc.js`).
It has to be running or every screen shows a connection error naming the URL it
tried.

### Settings

```js
window.AppConfig.fromGPNDate  // go-live cutoff
window.AppConfig.minLotQty    // GPNs smaller than this need no QC, default 50
window.AppConfig.companyId    // sampling plans are stored against CompanyID 1
window.AppConfig.pageSize     // rows per page, default 25
window.AppConfig.shiftHours   // a lot waiting longer than this is highlighted
```

`fromGPNDate` matters. Without it every historical GPN in the database appears
in the queue on day one. The API has its own default in `FGQC_FROM_GPN_DATE` —
keep the two in step.

---

## Things worth knowing before changing this

**The lot is the GPN, and lot size is what that GPN delivered.**
`outercarton x innercarton x quantityperpack`, summed over the GPN's lines —
the same reading of a GPN as `GPNAgg` in the API's `src/job-card-queries.js`.

It is not the job quantity. `GetPendingFGQCList` reports one of those, and the
API replaces it: matching a sampling plan against the job asks for a sample
drawn from the whole order while the inspector is standing in front of one
delivery. That is how a lot of 100 came to be inspected against a sample of
315 — a sample larger than the lot it was drawn from.

**A GPN under `minLotQty` pieces does not need QC.** Its row is dimmed and its
button says so; pressing the button explains why rather than opening the form.
The form refuses the same lot if reached by its URL, and so does the save. The
API owns the number and sends it with the queue.

**The form is built from the API response.** `GET /api/qc/template` returns the
defect characteristics and their severity. Do not hardcode a defect name here.

**Counts are defective inner cartons.** An inner carton with any bad piece
inside it counts as one defective carton in that class.

**A rejected lot starts clean.** Earlier counts are history. The form always
opens at zero and the verdict is computed from the latest submission alone —
carrying counts forward would make a rejected lot mathematically impossible to
pass. The previous verdict is shown as context at the top of the form.

**The over-limit flag is a warning, never a block.** A rejected lot is a result
the system needs recorded. Do not disable the submit button on a flagged form.

**Except for `Unclassified`.** If the parameter master gives a characteristic no
severity, there is no way to tell which AQL class its counts belong to. Those
appear in their own block at the bottom, are not counted, and the form refuses
to submit while any of them carries a count. Filing them under Minor — which
this used to do — takes a Critical defect and judges it against the Minor accept
number. This is the one place the form stops the inspector, and it goes away
once the severity question in section 5 of the spec is answered.

**It is used standing up, on a tablet, next to a running machine, by someone
wearing gloves.** Large tap targets, numeric keypads, steppers beside every
field, no modal dialogs during entry, and every status paired with a word so it
never depends on colour alone. The in-progress form autosaves to local storage
so a dropped connection does not lose twenty minutes of counting.

---

## Specification

[`docs/FG_QC_SPEC.md`](https://github.com/eacdc/CDC-Site/blob/main/docs/FG_QC_SPEC.md)
in the API repo, with the current build status in
[`docs/FG_QC_IMPLEMENTATION.md`](https://github.com/eacdc/CDC-Site/blob/main/docs/FG_QC_IMPLEMENTATION.md).

Note that roles and permissions are not built yet — the inspector is a free
choice from a dropdown, so submissions are not attributable to a verified user.
That is on the plan, not an oversight, but it is worth knowing before the app is
treated as an audit record.
