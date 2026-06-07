# secret-gate

Treat any of the following in **added** lines as a CRITICAL finding:

- Stripe live keys (`sk_live_…`), AWS keys (`AKIA…`), private-key PEM blocks.
- Assignments to `password`, `secret`, `token`, `apiKey` with a string literal.

Recommend moving the value to an environment variable / secret store. Cite the
exact file and added line.
