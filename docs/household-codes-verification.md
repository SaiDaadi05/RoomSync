# Household invitation codes

New households create their first invitation atomically with the household and owner membership. Each 10-character code is generated with cryptographic randomness and protected by the existing database unique constraint. Existing households can create a code under Household → Invite roommates.

Codes are household-bound, single-use, and expire after seven days. This does not introduce a permanent reusable house password. Create another invitation for each additional roommate. Codes and links grant joining access; share them with intended roommates.

Signup now accepts an optional code, validates it before creating an account, and carries it to the existing join confirmation. A code that expires or is used during signup is rejected at confirmation. Existing users can enter codes on /onboarding. Copy code and copy link controls appear on Home, Household and onboarding invitations; clipboard failures show selectable text.

Validation: TypeScript and production build passed. Eight isolated tests with mocked database/auth verified initial random codes, membership-gated access, normalization, invalid/used/expired/revoked previews, signup routing and email restrictions. Added a database-backed test for two households and joining/isolation. Full npm test cannot run without a dedicated test database; live/browser joining has not been verified. No deployment or merge was performed.
