# Production passive reliability monitor

This observer reads existing Render application traces, `/api/health` and optional
PostgreSQL message metadata. It imports no customer runtime, performs no model
calls, writes no production records and does not decide whether a guest deserves
a reply. Explicit FinalResponse `shouldReply` and transport outcomes remain the
authorities. Normal NO_REPLY, clarification and handoff are retained. Resolver
`unknown` / missing inventory is not classified as a technical exception.

The production audit found structured `line_inbound`, C01, Resolver, final and
transport logs on the existing service. `server.js` already persists processing,
reply failure and FinalResponse contract failure in `message_logs`; the optional
SQL reader projects only status/identity metadata and reply length, using READ
ONLY, a five-second statement timeout and a 1,000-row cap. No schema changes.
The existing production trace-reader connection and Render SQL connector failed
during audit, including a TLS retry. Live database coverage is not claimed.

Detection covers mature traced turns with no final, declared replies without
delivery, empty/missing FinalResponse, terminal core failure, explicit Resolver
technical errors, LINE failure, trace persistence failure and inconsistent
property IDs across the same trace. Error-level service logs are alerts without
text/keyword matching. Duplicate trace output counts once. Three failed mature
turns out of at least five and a rate of at least 20% adds an error-rate alarm.
No natural-language input, month, room or property-specific rules are used.

The five-minute schedule observes a rolling 30-minute window with a five-minute
processing grace period. Left-boundary fragments are not treated as lost inbound
events. Render pagination is capped at 20 pages of 100 records; exhaustion,
cursor problems, missing credentials, source errors or unexpected service
identity are monitoring failures, never healthy results. No retry selects a
passing sample. Reports contain only fixed alarm codes, counts and hashed refs;
raw logs, guest messages, replies and credentials must never enter public CI logs
or artifacts. The workflow creates no artifacts or caches.

## Activation and notification

Set `PRODUCTION_MONITOR_RENDER_API_KEY` as an Actions secret after reviewing the
workflow. Do not paste its value into chat or a PR. Optionally configure the
existing read-only `PRODUCTION_MONITOR_DATABASE_URL` once external connectivity is
verified. Do not copy an OpenAI, LINE, or application write credential. Only the
production schedule/manual run receives monitor secrets; PR tests receive none.

Use the existing GitHub Actions failure email/web notifications, enabled in the
owner's GitHub Settings → Notifications → Actions. This monitor does not change
notification preferences or claim email delivery without confirmation. No guest
or operator LINE messages are sent. During this task the owner said the Render
secret will be configured later and notification settings are uncertain; the
production schedule is therefore not declared active or delivered.

Activation update (2026-09-21): the owner confirmed configuring the Render secret
and GitHub Email / On GitHub / failed-workflows-only notifications. Secret name
existence was checked without reading its value. Actual access and delivery still
require the first workflow runs.

For the authorized notification check, manually dispatch with `alert_test=true`.
This feeds one synthetic failed-delivery record through the same analyzer and
nonzero-exit reporting path. It receives no monitor credentials, makes no network
or database calls and labels the run as an expected synthetic failure. Scheduled
runs and the default manual input always observe real production. A GitHub failed
run proves the failure trigger; inbox receipt requires separate delivery evidence.

The repository is public. Standard GitHub-hosted runners are free; this workflow
uses those runners, no paid services, additional Render instances or artifact
storage. If repository visibility or runner type changes, reassess cost before
activation. Render's existing service failure notifications remain unchanged.

## Coverage limits

- Failure before the first durable message/trace cannot prove receipt or reply
  obligation. Service error logs/health can reveal some such failures, not all.
- PostgreSQL failure can appear as a Resolver technical error; exact database
  attribution is unavailable when both the database and its logs are unreachable.
- Trace property consistency detects observed disagreement, not an internally
  consistent wrong initial binding; it does not create another property authority.
- LINE API success proves transport acceptance, not that the guest read a message.
- Missing intermediate traces indicate observability gaps, not inferred facts.
- Records older than the observation window and provider log drops are not fully
  covered. A healthy quiet window does not prove the webhook received every event.
- GitHub schedules may be delayed and public-repository schedules can disable
  after 60 days of inactivity. Existing Render health notifications remain the
  complementary platform signal; there is no claim of a hard realtime SLA.

References: [Render logs API](https://api-docs.render.com/reference/list-logs),
[Render notifications](https://render.com/docs/notifications),
[Actions notifications](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs),
[Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
