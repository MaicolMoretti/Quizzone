/**
 * Struttura comune delle pagine: lingua italiana, metadati e font Outfit.
 * next/font gestisce il caricamento del font; la variabile CSS viene riutilizzata
 * dal tema Tailwind definito in globals.css.
 */
import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
});

export const metadata: Metadata = {
  title: "Quizzone - Quiz interattivi in tempo reale",
  description: "Crea quiz multiplayer e gioca in tempo reale con codice partita o QR.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it" className={`${outfit.variable} antialiased h-full`}>
      <body className="min-h-full flex flex-col font-sans bg-gray-50 text-gray-900">
        {children}
      </body>
    </html>
  );
}
