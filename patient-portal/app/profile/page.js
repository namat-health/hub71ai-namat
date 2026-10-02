import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import SubmissionCard from "@/components/SubmissionCard/SubmissionCard";
import { DEMO_EMAIL_COOKIE, getDemoSubmissions } from "@/lib/submissions";
import styles from "./page.module.css";

export const metadata = { title: "namat | Your profile" };

export default async function ProfilePage() {
  const email = (await cookies()).get(DEMO_EMAIL_COOKIE)?.value;
  if (!email) redirect("/");

  let submissions = [];
  let unavailable = false;
  try {
    submissions = await getDemoSubmissions(email);
  } catch {
    unavailable = true;
  }

  if (!unavailable && !submissions.length) redirect("/?error=not-found");

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <a className={styles.wordmark} href="/">
            namat
          </a>
          <form action="/api/demo-logout" method="post">
            <button className={styles.signOut} type="submit">
              Sign out
            </button>
          </form>
        </header>

        <div className={styles.heading}>
          <h1>
            Welcome
            {!unavailable && submissions[0]?.firstName
              ? `, ${submissions[0].firstName}`
              : " back"}
            .
          </h1>
          <p className={styles.email}>Signed in as {email}</p>
        </div>

        {unavailable ? (
          <p className={styles.error} role="alert">
            We couldn’t load your profile. Please try again.
          </p>
        ) : (
          <section className={styles.submissions}>
            {submissions.map((submission, index) => (
              <SubmissionCard
                key={`${submission.email}-${submission.createdAt}-${index}`}
                submission={submission}
              />
            ))}
          </section>
        )}
      </div>
    </main>
  );
}
