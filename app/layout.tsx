import "./globals.css";

export const metadata = {
  title: "Signet | Verified Operations",
  description: "Margin and delivery-risk intelligence with verifiable evidence.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
