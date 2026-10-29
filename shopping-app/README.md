# NovaCart — shopping application

NovaCart is a premium India-first general shopping website under active development.

## Scope

- 20 planned pages and 40 planned business capabilities.
- Premium responsive customer experience.
- Online payment and cash-on-delivery **planned**, not yet implemented.
- Owner-only Master Control Panel **planned**, not yet implemented.
- DevOps War Room remains untouched in the repository root.

## Current milestone: storefront prototype

Implemented:
- Responsive homepage, category navigation, product collection, and brand section
- Demo catalog with eight illustrative products and INR pricing
- Client-side product search and category filters
- Wishlist and cart with browser-local persistence
- Cart subtotal and a clearly disabled checkout
- Keyboard-friendly controls and basic semantic HTML

Not yet implemented:
- Real catalog backend, database, accounts, checkout, payments, shipping, orders, admin panel, legal pages, or production security controls

**Do not accept real customer orders or payments with this prototype.** Images are loaded from external Unsplash URLs; confirm commercial usage and replace with approved product photography before launch.

## Preview

Open `shopping-app/index.html` in a browser. This is a frontend-only prototype and requires no build process.

## Responsibilities

Application code, design, business logic and tests: application development scope.
Infrastructure, hosting, deployment, CI/CD and DevOps: repository owner's scope.

## Next milestone

Define the detailed domain model and implement the backend, database migrations, product management, and secure authentication. No secrets should be committed.
