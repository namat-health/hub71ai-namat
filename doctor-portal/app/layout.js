import localFont from "next/font/local";
import "./globals.css";

// The same font files as namat.health.
const archivo = localFont({
  src: "./fonts/archivo-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-archivo",
  declarations: [{ prop: "font-stretch", value: "62% 125%" }],
});

const dmSans = localFont({
  src: "./fonts/dm-sans-latin-wght.woff2",
  weight: "100 1000",
  display: "swap",
  variable: "--font-dm-sans",
});

const plexMono = localFont({
  src: "./fonts/ibm-plex-mono-latin-400.woff2",
  weight: "400",
  display: "swap",
  variable: "--font-plex-mono",
});

export const metadata = {
  title: "Namat doctor portal",
  description: "Review new patients’ questionnaires and lab reports.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${dmSans.variable} ${plexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
