# NovaCart — 30-step application development roadmap

**Product:** NovaCart · India-first general marketplace-style online store · Premium visual design · INR · Online payments + COD.

**Current state:** Prototype storefront only. Every step below remains subject to implementation, review, and verification. A static demo does not constitute a completed production feature.

**Responsibility:** Application design, frontend, backend, database, security and application testing. Infrastructure, hosting, deployments, CI/CD and DevOps belong to the owner.

## Phase 1 — Discovery and design
- [ ] 01. Confirm business rules, customer personas, marketplace vs single-seller, fulfillment, tax and return policies
- [ ] 02. Define the 20-page information architecture and 40-feature acceptance criteria
- [ ] 03. Select application stack, APIs, data model, and external integration boundaries
- [ ] 04. Finalize brand tokens, typography, product imagery and content guidelines
- [ ] 05. Complete responsive page layouts, accessibility design and UX review

## Phase 2 — Foundation
- [ ] 06. Set up modular frontend/backend, validation, configuration and lint/test structure
- [ ] 07. Design normalized database schema, indexes, constraints, and migrations
- [ ] 08. Build reusable UI components, navigation, forms, loading and error states
- [ ] 09. Implement customer sign-up/login, verification, reset and session security
- [ ] 10. Implement owner-only Master Admin, role permissions and admin MFA

## Phase 3 — Catalog and discovery
- [ ] 11. Build editable homepage, banners and CMS content
- [ ] 12. Implement products, categories, variants, images, inventory and bulk upload
- [ ] 13. Implement indexed search, filtering, sorting and pagination
- [ ] 14. Implement product details, reviews/moderation, Q&A and comparisons
- [ ] 15. Implement persistent cart, wishlist, recently viewed and recommendations

## Phase 4 — Checkout and fulfillment
- [ ] 16. Implement addresses, PIN-code eligibility and secure guest checkout
- [ ] 17. Integrate approved online payment gateway and COD; verify signed webhooks and idempotency
- [ ] 18. Implement transactional orders, stock reservation, state machine and PDF invoices
- [ ] 19. Implement shipment creation, tracking and delivery notifications
- [ ] 20. Implement cancellations, returns, refunds and payment reconciliation with duplicate prevention

## Phase 5 — Business operations
- [ ] 21. Implement coupons, gift cards/store credit, loyalty ledger and scheduled sales
- [ ] 22. Implement opt-in notifications and abandoned-cart recovery
- [ ] 23. Implement support tickets, contact forms and customer service workflows
- [ ] 24. Implement analytics, reports, exports, stock alerts and admin audit views
- [ ] 25. Implement SEO metadata, sitemaps, content editing and marketing controls

## Phase 6 — Security, quality and handoff
- [ ] 26. Harden authorization, validation, abuse/rate limits, secrets and security headers
- [ ] 27. Implement consent, data export/deletion, retention rules and auditable privacy controls
- [ ] 28. Validate accessibility, responsive behavior, browser support and performance
- [ ] 29. Run unit, integration, E2E, security and failure-recovery tests; fix findings
- [ ] 30. Complete API documentation, operational handoff, acceptance evidence and release checklist

## Quality gates for every step
- Document acceptance criteria and dependencies
- Write application tests where applicable
- Verify failure paths and authorization boundaries
- Never claim an external payment, SMS, shipping or email integration works without credentials and end-to-end verification
- No real transactions until security and reconciliation tests pass

## Known decisions still required before production
Payment gateway, shipping provider, seller structure, business contact details, legal policies, GST/invoicing rules, inventory source and production catalog imagery.

## Existing prototype
The `shopping-app/` folder contains the initial visual storefront with demo products, filters, local cart and wishlist. It is **not production-ready**.
