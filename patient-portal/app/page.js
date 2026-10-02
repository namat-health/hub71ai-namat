import LoginForm from "@/components/LoginForm/LoginForm";
import styles from "./page.module.css";

export const metadata = {
  title: "namat | Demo profile",
  description: "View your fictional hackathon welcome submission.",
};

export default async function Home({ searchParams }) {
  const query = await searchParams;
  const errors = {
    invalid: "Enter a valid email address.",
    "not-found": "No demo profile was found for that email.",
    unavailable: "Demo sign in is unavailable right now.",
  };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <span className={styles.wordmark}>namat</span>
          <span className={styles.headerLabel}>HACKATHON DEMO</span>
        </header>

        <section className={styles.panel}>
          <h1>Sign in to namat.</h1>
          <p className={styles.intro}>
            Use the email from your submission to continue to your profile.
          </p>
          <LoginForm error={errors[query?.error] || ""} />
        </section>

        <footer className={styles.footer}>
          Demo access uses email only and shows fictional submissions.
        </footer>
      </div>
    </main>
  );
}
