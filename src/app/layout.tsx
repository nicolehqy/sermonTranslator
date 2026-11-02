import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Sermon Translator", description: "Follow sermons in Mandarin, English, or Spanish with live translation that helps everyone understand the message." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body suppressHydrationWarning>{children}</body></html>;
}
