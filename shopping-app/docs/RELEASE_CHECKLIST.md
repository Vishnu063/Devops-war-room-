# Release checklist

Local evidence: deployment-summary.json and application-qa-summary.json when present. A checked development gate never means a public deployment happened.

## Internal preview

- [ ] Review current application+main reconciliation and deployment PR.
- [ ] Execute all current unit/API/SQL/browser/static/audit gates.
- [ ] Build and scan pinned non-root images; verify no secrets in context/layers.
- [ ] Verify Compose private ports, HTTPS authentication, secure cookies and disabled live/preview orders.
- [ ] Verify backup upload/readback/restore and repeatable checksum migrations on disposable data.
- [ ] Owner selects server/origin/access and approves any spending.
- [ ] Inspect actual host capacity/ports/other sites without disturbing services.
- [ ] Configure valid public certificate and test renewal, if publicly exposed.
- [ ] Configure and verify real off-server encrypted storage, key escrow, retention and alert delivery.
- [ ] Configure protected GitHub environment/reviewers, approved registry and actual passing Actions.
- [ ] Perform authenticated HTTPS smoke, bounded load, recovery and previous-version rollback on target preview.

## Production (separate explicit approval)

- [ ] Approve seller/legal/privacy/retention/returns/contact and actual catalog/imagery.
- [ ] Approve GST/tax/rounding and statutory invoices.
- [ ] Select/authorize gateway and verify UPI/cards/netbanking, signed/replayed/late events, refunds and settlement in sandbox.
- [ ] Verify inventory reconciliation and courier/physical fulfillment/delivery workflow.
- [ ] Verify real verification/reset/transactional notifications and consent.
- [ ] Complete independent security, manual accessibility, supported browsers and representative load acceptance.
- [ ] Verify host/DB TLS, least privilege, secret/key rotation, MFA recovery and incident procedures.
- [ ] Restore real off-server backup to fresh target and establish RPO/RTO.
- [ ] Prove prior-version rollback/schema compatibility and target health/error/resource alerts.
- [ ] Obtain explicit owner authorization before live payments/order acceptance or production deployment.

Production verdict: NOT READY. No owner policy, account or deployment approval is inferred from the local fixtures or this checklist.
