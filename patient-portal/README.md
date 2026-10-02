# namat demo

A simple email-only demo sign-in for fictional hackathon submissions.

## Run locally

Set `DATABASE_URL` in `.env`, then run:

```bash
npm run dev
```

Open `http://localhost:3000`, enter the email attached to a submission, and sign in to the separate profile page. Use **Edit** on a submission card to change its name, answers, or notes; multiple answers are comma-separated. Use **Sign out** to return to the login screen.

`POST /api/demo-login` checks for matching rows marked `data_class = 'synthetic'` and `fictional_confirmed = true`, then starts an eight-hour HTTP-only demo session. `PATCH /api/submissions/:id` saves edits to the signed-in email's fictional row. Profile data is loaded on the server. Stored report file contents are not returned.

This is a demo sign-in, not identity verification. Anyone who knows a matching email can view its fictional demo submission.
