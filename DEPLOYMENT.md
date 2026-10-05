# Online hosting

Create a private GitHub repository containing this folder, excluding data and node_modules. Create a Render Blueprint from render.yaml. This requires a paid service and persistent disk; review charges before creating it.

Set APP_URL to the exact HTTPS service address, ADMIN_EMAIL to your email, and ADMIN_PASSWORD to a unique password of at least 16 characters in Render's secret environment fields. Deploy, sign in, and add positions and employees. Existing local records are not uploaded. Demo databases are blocked in production.

Confirm sign-in, employee permissions, punches, tips and database persistence after a restart before inviting staff. Configure database-aware off-site backups and test restoration before using real payroll data. Keep one service instance. Update APP_URL when adding a domain. Restaurant timezone is America/Toronto. Payroll remains an estimate.

Employee access is enabled by default. Employees can sign in to their own tools; manager permissions remain restricted. Set EMPLOYEE_ACCESS=false and restart for manager-only mode.
