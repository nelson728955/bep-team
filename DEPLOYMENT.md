# Host the working Bep app for free

GitHub Pages cannot run this app's backend. Use Render Free with a Turso libSQL cloud database. The desktop app continues using its local database.

1. Create accounts at https://dashboard.render.com and https://turso.tech.
2. In Turso, create a libSQL-compatible database for @libsql/client. Copy its database URL and create an authentication token. Keep the token private.
3. Push this project to GitHub. Never include data/, .env or database tokens.
4. In Render choose New > Blueprint, connect GitHub, and select bep-team. Render reads render.yaml. Confirm the plan is Free with no paid disk.
5. Fill in the private environment fields: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, ADMIN_EMAIL and ADMIN_PASSWORD (at least 16 characters).
6. Deploy, open Render's HTTPS address, and sign in with those manager credentials. The new database has no demo employees or restaurant records. Add your positions and team.
7. Verify saving a schedule and signing back in, then restart the service and verify your records remain.

Render supplies the website address automatically. For a custom domain set APP_URL to its exact HTTPS address. Keep one service instance. Timezone is America/Toronto. Employees are enabled by default; set EMPLOYEE_ACCESS=false for manager-only access.

Free Render services sleep after 15 minutes of inactivity and can take about a minute to wake up. Automatic scheduled attendance catches up at startup; it does not run during sleep. Turso keeps records outside Render across restarts. Free plans have usage limits. Cloud queries currently run sequentially; check responsiveness before inviting staff.

Existing desktop data is not automatically uploaded. Store database tokens only in Render's private environment settings. Keep backups and test restoration before relying on payroll records. Payroll calculations remain estimates.
